// CP-R1-T10A extension: explicit identity-mode switch. ps_customer is not yet the
// canonical identity (master_customer is), so every output produced while
// RFM_IDENTITY_MODE=prestashop_customer must be traceable as provisional — never mixed
// silently with a future canonical master_customer run.
export type IdentityMode = 'prestashop_customer' | 'master_customer';

export type IdentityModeResolution =
  | { readonly ok: true; readonly mode: IdentityMode }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid' };

export type IdentityModeMetadata = {
  readonly identityMode: IdentityMode;
  readonly identityAuthority: 'prestashop_customer_provisional' | 'master_customer_canonical';
  readonly identityCanonical: boolean;
  readonly migrationPending: boolean;
};

const VALID_MODES: readonly IdentityMode[] = ['prestashop_customer', 'master_customer'];

export function parseIdentityMode(env: Readonly<Record<string, string | undefined>>): IdentityModeResolution {
  const raw = env.RFM_IDENTITY_MODE;
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, reason: 'missing' };
  }
  if (!VALID_MODES.includes(raw as IdentityMode)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, mode: raw as IdentityMode };
}

export function identityModeMetadata(mode: IdentityMode): IdentityModeMetadata {
  if (mode === 'prestashop_customer') {
    return {
      identityMode: 'prestashop_customer',
      identityAuthority: 'prestashop_customer_provisional',
      identityCanonical: false,
      migrationPending: true,
    };
  }
  return {
    identityMode: 'master_customer',
    identityAuthority: 'master_customer_canonical',
    identityCanonical: true,
    migrationPending: false,
  };
}

export function requiredEnvVarsForMode(mode: IdentityMode): readonly string[] {
  const prestashopVars = ['PRESTASHOP_DB_HOST', 'PRESTASHOP_DB_USER', 'PRESTASHOP_DB_PASSWORD'] as const;
  if (mode === 'prestashop_customer') {
    return prestashopVars;
  }
  return [...prestashopVars, 'CRM_DB_HOST', 'CRM_DB_USER', 'CRM_DB_PASSWORD'];
}
