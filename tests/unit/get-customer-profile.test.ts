import { describe, expect, it, vi } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createGetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import type { Clock, MasterCustomerReader, PrestashopCustomerReader } from '../../src/application/customer-profile/ports.js';
import type { MasterCustomerRecord } from '../../src/domain/customer-profile/master-customer-record.js';
import type { PrestashopCustomerRecord } from '../../src/domain/customer-profile/prestashop-customer-record.js';

const fixedClock: Clock = { now: () => new Date('2026-07-27T00:00:00.000Z') };

const linkedMasterCustomer: MasterCustomerRecord = {
  id: '1',
  firstname: 'Ana',
  lastname: 'Perez',
  email: 'ana@example.com',
  platformOrigin: 'prestashop',
  rut: null,
  prestashopCustomerId: 555,
};

const unlinkedMasterCustomer: MasterCustomerRecord = {
  ...linkedMasterCustomer,
  prestashopCustomerId: null,
};

const matchingPrestashopCustomer: PrestashopCustomerRecord = {
  idCustomer: 555,
  firstname: 'Ana',
  lastname: 'Perez',
  email: 'ana@example.com',
  active: true,
  idShop: 1,
  dateAdd: '2024-01-01 00:00:00',
  dateUpd: '2024-01-02 00:00:00',
};

function masterReaderReturning(record: MasterCustomerRecord | null): MasterCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function prestashopReaderReturning(record: PrestashopCustomerRecord | null): PrestashopCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function prestashopReaderThrowing(error: unknown): PrestashopCustomerReader {
  return {
    findById: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachablePrestashopReader(): PrestashopCustomerReader {
  return {
    findById: vi.fn(async () => {
      throw new Error('PrestaShop must not be called for this case');
    }),
  };
}

describe('getCustomerProfile', () => {
  it('is not_found and never calls PrestaShop when master_customer does not exist', async () => {
    const prestashopCustomerReader = unreachablePrestashopReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(null),
      prestashopCustomerReader,
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '999' });

    expect(result.status).toBe('not_found');
    expect(prestashopCustomerReader.findById).not.toHaveBeenCalled();
  });

  it('is partial and never calls PrestaShop when master_customer exists without a link', async () => {
    const prestashopCustomerReader = unreachablePrestashopReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(unlinkedMasterCustomer),
      prestashopCustomerReader,
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'partial', linkStatus: 'not_linked' });
    expect(prestashopCustomerReader.findById).not.toHaveBeenCalled();
  });

  it('is available when master_customer is linked and PrestaShop is found', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'available', linkStatus: 'linked', prestashopCustomerId: 555 });
  });

  it('is degraded / prestashop_customer_not_found when linked but ps_customer is missing', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(null),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_customer_not_found' });
  });

  it('is degraded / prestashop_timeout on a PrestashopTimeoutError', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new PrestashopTimeoutError('timed out')),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_timeout' });
  });

  it('is degraded / prestashop_unavailable on a PrestashopUnavailableError', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new PrestashopUnavailableError('down')),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('is degraded / profile_build_failed when snapshot construction throws', async () => {
    const throwingClock: Clock = {
      now: () => {
        throw new Error('clock failure');
      },
    };
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      clock: throwingClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'profile_build_failed' });
  });

  it('propagates unclassified PrestaShop reader errors instead of guessing a degraded reason', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new Error('boom')),
      clock: fixedClock,
    });

    await expect(getCustomerProfile({ masterCustomerId: '1' })).rejects.toThrow('boom');
  });

  it('propagates CRM (master_customer) read failures instead of treating them as not_found', async () => {
    const masterCustomerReader: MasterCustomerReader = {
      findById: vi.fn(async () => {
        throw new Error('CRM connection failed');
      }),
    };
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader,
      prestashopCustomerReader: unreachablePrestashopReader(),
      clock: fixedClock,
    });

    await expect(getCustomerProfile({ masterCustomerId: '1' })).rejects.toThrow('CRM connection failed');
  });

  it('is available with a warning when the PrestaShop email differs from the master email', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        email: 'other@example.com',
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).toBe('available');
    expect(result.warnings).toContain('prestashop_email_differs_from_master');
  });

  it('is available with a warning when the PrestaShop name differs from the master name', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        firstname: 'Otro',
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).toBe('available');
    expect(result.warnings).toContain('prestashop_name_differs_from_master');
  });

  it('is available with a warning when the PrestaShop customer is inactive', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        active: false,
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).toBe('available');
    expect(result.warnings).toContain('prestashop_customer_inactive');
  });

  it('does not warn when the PrestaShop name only differs by whitespace/casing', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning({ ...linkedMasterCustomer, firstname: ' Ana  Perez ' }),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        firstname: 'ana perez',
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).toBe('available');
    expect(result.warnings).not.toContain('prestashop_name_differs_from_master');
  });

  it('does not warn when the PrestaShop email only differs by whitespace/casing', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning({ ...linkedMasterCustomer, email: '  CLIENTE@MAIL.COM  ' }),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        email: 'cliente@mail.com',
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).toBe('available');
    expect(result.warnings).not.toContain('prestashop_email_differs_from_master');
  });

  it('does not reconcile master_customer with PrestaShop data even when they differ', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning({
        ...matchingPrestashopCustomer,
        email: 'other@example.com',
        firstname: 'Otro',
      }),
      clock: fixedClock,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.customer.email).toBe(linkedMasterCustomer.email);
    expect(result.profile.customer.firstname).toBe(linkedMasterCustomer.firstname);
  });
});
