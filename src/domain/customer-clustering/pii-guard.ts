// Structurally copies the already-validated RFM manifest PII guard
// (src/domain/customer-rfm/dataset.ts: assertRfmManifestHasNoPii/isForbiddenManifestKey),
// promoted from the CP-R2-T01 experimental copy (scripts/clustering/lib/pii-guard.ts) into the
// production domain layer — same pattern precedent as RFM having its own domain-level guard
// distinct from the audit script's guard.

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

const ALLOWED_EXACT_KEYS = new Set(['customerId', 'customer_id', 'prestashopCustomerId', 'prestashop_customer_id']);

const EMAIL_LIKE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CHILEAN_RUT_PATTERN = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/;
const PHONE_LIKE_PATTERN = /\d(?:\D*\d){7,}/;

function isSafeStructuredValue(trimmed: string): boolean {
  return (
    /^\d+\.\d{1,10}$/.test(trimmed) ||
    /^[a-f0-9]{64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(trimmed) ||
    /^[A-Za-z0-9_.-]+(__[A-Za-z0-9_.-]+)+$/.test(trimmed)
  );
}

export function assertNoPiiInClusterValue(value: unknown, path = 'value'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPiiInClusterValue(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (!ALLOWED_EXACT_KEYS.has(key) && isForbiddenFieldName(key)) {
        throw new Error(`Clustering data contains a PII-shaped field: ${path}.${key}`);
      }
      assertNoPiiInClusterValue(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenStringValue(value)) {
    throw new Error(`Clustering data contains a PII-shaped value at ${path}`);
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
