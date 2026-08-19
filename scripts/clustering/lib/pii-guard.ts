// Structurally copies the already-validated RFM manifest PII guard
// (src/domain/customer-rfm/dataset.ts: assertRfmManifestHasNoPii/isForbiddenManifestKey) and
// the RFM population audit's result-field guard (scripts/audits/rfm-population/lib/pii-guard.ts)
// rather than inventing a new one (task Section 19: "Preferir copiar/adaptar el patrón ya
// validado en RFM en lugar de inventar uno desde cero"). `customerId` is the one explicitly
// allowed technical identifier and is exempted from the key scan.

const FORBIDDEN_FIELD_SUBSTRINGS = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'telefono',
  'mobile',
  'rut',
  'dni',
  'document',
  'address',
  'street',
  'company',
  'siret',
  'apellido',
  'passwd',
  'password',
  'birthday',
  'ipaddress',
  'securekey',
  'resettoken',
  'payment',
  'paymentcard',
  'authtoken',
] as const;

const ALLOWED_EXACT_KEYS = new Set(['customerId', 'customer_id', 'prestashopCustomerId']);

const EMAIL_LIKE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CHILEAN_RUT_PATTERN = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/;
const PHONE_LIKE_PATTERN = /\d(?:\D*\d){7,}/;

// Structurally identical safe-value allowlist to RFM's isForbiddenManifestString (dataset.ts):
// ISO timestamps, sha256 hex checksums, decimal(6) numbers, and dunder-joined version keys are
// all digit-dense but not PII — without this allowlist, every referenceTime/checksum in the
// manifest false-positives against the phone-like check below.
function isSafeStructuredValue(trimmed: string): boolean {
  return (
    /^\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trimmed) ||
    /^[A-Za-z0-9_.-]+(__[A-Za-z0-9_.-]+)+$/.test(trimmed)
  );
}

export function assertNoPiiInClusterManifest(value: unknown, path = 'manifest'): void {
  assertNoPiiValue(value, path);
}

function assertNoPiiValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPiiValue(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (!ALLOWED_EXACT_KEYS.has(key) && isForbiddenFieldName(key)) {
        throw new Error(`Clustering manifest contains a PII-shaped field: ${path}.${key}`);
      }
      assertNoPiiValue(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenStringValue(value)) {
    throw new Error(`Clustering manifest contains a PII-shaped value at ${path}`);
  }
}

function isForbiddenFieldName(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return FORBIDDEN_FIELD_SUBSTRINGS.some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenStringValue(value: string): boolean {
  const trimmed = value.trim();
  if (isSafeStructuredValue(trimmed)) return false;
  if (EMAIL_LIKE_PATTERN.test(trimmed)) return true;
  if (CHILEAN_RUT_PATTERN.test(trimmed)) return true;
  if ((trimmed.startsWith('+') || /[\s().-]/.test(trimmed)) && PHONE_LIKE_PATTERN.test(trimmed)) return true;
  return false;
}

// Applied to every raw feature row before it is written to disk: only the allow-listed
// technical/numeric columns may appear. Catches PII leakage at the source, independent of the
// manifest-level structural scan above.
export function assertNoPiiInFeatureRow(row: Record<string, unknown>, allowedColumns: readonly string[]): void {
  const allowed = new Set(allowedColumns);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      throw new Error(`Feature row contains an unexpected, non-allow-listed column: ${key}`);
    }
    if (isForbiddenFieldName(key) && !ALLOWED_EXACT_KEYS.has(key)) {
      throw new Error(`Feature row contains a PII-shaped column: ${key}`);
    }
  }
}
