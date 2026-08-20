// Structurally copies the already-validated clustering/RFM PII guards
// (src/domain/customer-clustering/pii-guard.ts, src/domain/customer-rfm/dataset.ts) — same
// pattern precedent each capability's domain layer already follows: its own copy, not a
// shared import, so a future change to one capability's forbidden-field list can never
// silently loosen another's. Enforces task Section 32: the Data Layer never persists email,
// name, phone, address, RUT, or birthday — only prestashop_customer_id plus numeric/temporal
// commercial features.

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

export function assertNoPiiInAnalyticsValue(value: unknown, path = 'value'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPiiInAnalyticsValue(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (!ALLOWED_EXACT_KEYS.has(key) && isForbiddenFieldName(key)) {
        throw new Error(`Customer analytics data contains a PII-shaped field: ${path}.${key}`);
      }
      assertNoPiiInAnalyticsValue(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenStringValue(value)) {
    throw new Error(`Customer analytics data contains a PII-shaped value at ${path}`);
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
