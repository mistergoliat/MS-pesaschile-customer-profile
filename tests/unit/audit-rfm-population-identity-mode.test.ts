import { describe, expect, it } from 'vitest';
import { identityModeMetadata, parseIdentityMode, requiredEnvVarsForMode } from '../../scripts/audits/rfm-population/lib/identity-mode.js';

describe('RFM population audit identity mode', () => {
  it('requires an explicit, valid RFM_IDENTITY_MODE', () => {
    expect(parseIdentityMode({})).toEqual({ ok: false, reason: 'missing' });
    expect(parseIdentityMode({ RFM_IDENTITY_MODE: '' })).toEqual({ ok: false, reason: 'missing' });
    expect(parseIdentityMode({ RFM_IDENTITY_MODE: 'master_customer_v2' })).toEqual({ ok: false, reason: 'invalid' });
    expect(parseIdentityMode({ RFM_IDENTITY_MODE: 'prestashop_customer' })).toEqual({ ok: true, mode: 'prestashop_customer' });
    expect(parseIdentityMode({ RFM_IDENTITY_MODE: 'master_customer' })).toEqual({ ok: true, mode: 'master_customer' });
  });

  it('marks prestashop_customer mode as provisional and non-canonical', () => {
    expect(identityModeMetadata('prestashop_customer')).toEqual({
      identityMode: 'prestashop_customer',
      identityAuthority: 'prestashop_customer_provisional',
      identityCanonical: false,
      migrationPending: true,
    });
  });

  it('marks master_customer mode as canonical with no pending migration', () => {
    expect(identityModeMetadata('master_customer')).toEqual({
      identityMode: 'master_customer',
      identityAuthority: 'master_customer_canonical',
      identityCanonical: true,
      migrationPending: false,
    });
  });

  it('never requires CRM credentials in prestashop_customer mode, always requires them in master_customer mode', () => {
    const prestashopOnly = requiredEnvVarsForMode('prestashop_customer');
    expect(prestashopOnly).not.toContain('CRM_DB_HOST');
    expect(prestashopOnly).toContain('PRESTASHOP_DB_HOST');

    const masterCustomer = requiredEnvVarsForMode('master_customer');
    expect(masterCustomer).toContain('CRM_DB_HOST');
    expect(masterCustomer).toContain('CRM_DB_USER');
    expect(masterCustomer).toContain('CRM_DB_PASSWORD');
    expect(masterCustomer).toContain('PRESTASHOP_DB_HOST');
  });
});
