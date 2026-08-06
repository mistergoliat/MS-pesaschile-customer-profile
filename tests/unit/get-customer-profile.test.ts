import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import type { Clock, CustomerOrdersReader, OrderStatesReader, PrestashopCustomerReader } from '../../src/application/customer-profile/ports.js';
import type { CustomerOrderRecord } from '../../src/domain/customer-profile/customer-order-record.js';
import type { OrderStateRecord } from '../../src/domain/customer-profile/order-state-record.js';
import type { PrestashopCustomerRecord } from '../../src/domain/customer-profile/prestashop-customer-record.js';

const fixedClock: Clock = { now: () => new Date('2026-08-05T00:00:00.000Z') };
const recentOrdersLimit = 10;
const orderStateLanguageId = 1;

function identityRepositoryReturning(found: boolean): CustomerIdentityRepository {
  return {
    findByCustomerId: vi.fn(async (customerId) =>
      found
        ? {
            customerId,
            externalCustomerId: customerId,
            identitySource: 'PRESTASHOP' as const,
            identityStatus: 'DIRECT_SOURCE' as const,
            sourceMetadata: { platform: 'PRESTASHOP' as const, entity: 'ps_customer' as const, primaryKey: 'id_customer' as const },
          }
        : null,
    ),
  };
}

function prestashopReaderReturning(record: PrestashopCustomerRecord | null): PrestashopCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function ordersReaderReturning(records: readonly CustomerOrderRecord[]): CustomerOrdersReader {
  return { findByCustomerId: vi.fn(async () => records) };
}

function orderStatesReaderReturning(records: readonly OrderStateRecord[]): OrderStatesReader {
  return { findByIds: vi.fn(async () => records) };
}

const activePrestashopCustomer: PrestashopCustomerRecord = {
  idCustomer: 1,
  firstname: 'Ana',
  lastname: 'Perez',
  email: 'ana@example.com',
  active: true,
  idShop: 1,
  dateAdd: '2024-01-01 00:00:00',
  dateUpd: '2024-01-02 00:00:00',
};

const olderOrder: CustomerOrderRecord = {
  orderId: 100,
  reference: 'REF100',
  customerId: 1,
  currentStateId: 4,
  valid: true,
  createdAt: '2026-01-01 10:00:00',
  updatedAt: '2026-01-02 10:00:00',
  totalPaidTaxIncl: '10000.000000',
  totalProductsTaxIncl: '9500.000000',
  currencyId: 1,
};

const newerOrder: CustomerOrderRecord = {
  ...olderOrder,
  orderId: 101,
  reference: 'REF101',
  currentStateId: 4,
  createdAt: '2026-02-01 10:00:00',
  updatedAt: '2026-02-01 10:00:00',
};

function baseDeps(overrides: Partial<{
  prestashopCustomerReader: PrestashopCustomerReader;
  customerOrdersReader: CustomerOrdersReader;
  orderStatesReader: OrderStatesReader;
  clock: Clock;
}> = {}) {
  return {
    resolveCustomerIdentity: createResolveCustomerIdentity({
      customerIdentityRepository: identityRepositoryReturning(true),
    }),
    prestashopCustomerReader: overrides.prestashopCustomerReader ?? prestashopReaderReturning(activePrestashopCustomer),
    customerOrdersReader: overrides.customerOrdersReader ?? ordersReaderReturning([]),
    orderStatesReader: overrides.orderStatesReader ?? orderStatesReaderReturning([]),
    clock: overrides.clock ?? fixedClock,
    recentOrdersLimit,
    orderStateLanguageId,
  };
}

describe('getCustomerProfile', () => {
  it('is not_found when customer identity does not exist', async () => {
    const ordersReader = ordersReaderReturning([]);
    const getCustomerProfile = createGetCustomerProfile({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(false),
      }),
      prestashopCustomerReader: prestashopReaderReturning(null),
      customerOrdersReader: ordersReader,
      orderStatesReader: orderStatesReaderReturning([]),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ customerId: 999 });

    expect(result).toEqual({ status: 'not_found', customerId: 999, profile: null, warnings: [] });
    expect(ordersReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('is available when the PrestaShop customer exists, is active, and builds provenance', async () => {
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({
        customerOrdersReader: ordersReaderReturning([olderOrder]),
        orderStatesReader: orderStatesReaderReturning([{ stateId: 4, name: 'Enviado' }]),
      }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.customerId).toBe(1);
    expect(result.provenance.customerIdentity.externalCustomerId).toBe('1');
  });

  it('rut is always null in the direct PrestaShop contract, regardless of input', async () => {
    const getCustomerProfile = createGetCustomerProfile(baseDeps());

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.customer.rut).toBeNull();
    expect(result.profile.customer.platformOrigin).toBe('prestashop');
  });

  it('is available with a prestashop_customer_inactive warning when the PrestaShop customer is inactive', async () => {
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({ prestashopCustomerReader: prestashopReaderReturning({ ...activePrestashopCustomer, active: false }) }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.warnings).toContain('prestashop_customer_inactive');
  });

  it('does not warn when the PrestaShop customer is active', async () => {
    const getCustomerProfile = createGetCustomerProfile(baseDeps());

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.warnings).not.toContain('prestashop_customer_inactive');
  });

  it('is degraded / customer_profile_unavailable and never queries orders or order states when identity resolves but ps_customer is missing', async () => {
    const ordersReader = ordersReaderReturning([]);
    const orderStatesReader = orderStatesReaderReturning([]);
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({ prestashopCustomerReader: prestashopReaderReturning(null), customerOrdersReader: ordersReader, orderStatesReader }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result).toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'customer_profile_unavailable',
      profile: null,
      warnings: [],
    });
    expect(ordersReader.findByCustomerId).not.toHaveBeenCalled();
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is degraded / customer_profile_unavailable when snapshot construction throws (e.g. clock failure)', async () => {
    const throwingClock: Clock = {
      now: () => {
        throw new Error('clock failure');
      },
    };
    const getCustomerProfile = createGetCustomerProfile(baseDeps({ clock: throwingClock }));

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result).toMatchObject({ status: 'degraded', reason: 'customer_profile_unavailable', profile: null });
  });

  it('maps known PrestaShop failures (timeout, unavailable, schema incompatible) to degraded results', async () => {
    const buildUseCase = (error: Error) =>
      createGetCustomerProfile(baseDeps({ prestashopCustomerReader: { findById: vi.fn(async () => Promise.reject(error)) } }));

    await expect(buildUseCase(new PrestashopTimeoutError('timeout'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
      profile: null,
      warnings: [],
    });
    await expect(buildUseCase(new PrestashopUnavailableError('down'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
      profile: null,
      warnings: [],
    });
    await expect(buildUseCase(new PrestashopSchemaIncompatibleError('schema'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
      profile: null,
      warnings: [],
    });
  });

  it('propagates unclassified PrestaShop customer reader errors instead of degrading', async () => {
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({ prestashopCustomerReader: { findById: vi.fn(async () => Promise.reject(new Error('boom'))) } }),
    );

    await expect(getCustomerProfile({ customerId: 1 })).rejects.toThrow('boom');
  });

  it('is degraded / prestashop_unavailable and never queries order states when customerOrdersReader fails', async () => {
    const orderStatesReader = orderStatesReaderReturning([]);
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({
        customerOrdersReader: { findByCustomerId: vi.fn(async () => Promise.reject(new PrestashopUnavailableError('down'))) },
        orderStatesReader,
      }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_unavailable' });
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_schema_incompatible when orderStatesReader fails with a schema error', async () => {
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({
        customerOrdersReader: ordersReaderReturning([olderOrder]),
        orderStatesReader: { findByIds: vi.fn(async () => Promise.reject(new PrestashopSchemaIncompatibleError('schema'))) },
      }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_schema_incompatible' });
  });

  it('deduplicates currentStateId and passes orderStateLanguageId through to the order states reader', async () => {
    const orderStatesReader = orderStatesReaderReturning([{ stateId: 4, name: 'Enviado' }]);
    const getCustomerProfile = createGetCustomerProfile({
      ...baseDeps({ customerOrdersReader: ordersReaderReturning([newerOrder, olderOrder]), orderStatesReader }),
      orderStateLanguageId: 7,
    });

    await getCustomerProfile({ customerId: 1 });

    expect(orderStatesReader.findByIds).toHaveBeenCalledTimes(1);
    expect(orderStatesReader.findByIds).toHaveBeenCalledWith([4], 7);
  });

  it('preserves the reader-provided order of recentOrders instead of re-sorting', async () => {
    const orderStatesReader = orderStatesReaderReturning([{ stateId: 4, name: 'Enviado' }]);
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({ customerOrdersReader: ordersReaderReturning([newerOrder, olderOrder]), orderStatesReader }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders.map((order) => order.orderId)).toEqual([newerOrder.orderId, olderOrder.orderId]);
  });

  it('resolves an unrecognized currentStateId as unknown with the order_state_label_missing warning', async () => {
    const getCustomerProfile = createGetCustomerProfile(
      baseDeps({ customerOrdersReader: ordersReaderReturning([olderOrder]), orderStatesReader: orderStatesReaderReturning([]) }),
    );

    const result = await getCustomerProfile({ customerId: 1 });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders[0]?.currentState).toEqual({ stateId: 4, name: null, resolution: 'unknown' });
    expect(result.profile.warnings).toContain('order_state_label_missing');
  });

  it('calls the orders reader with the resolved identity customerId and the configured recentOrdersLimit', async () => {
    const ordersReader = ordersReaderReturning([]);
    const getCustomerProfile = createGetCustomerProfile({ ...baseDeps({ customerOrdersReader: ordersReader }), recentOrdersLimit: 25 });

    await getCustomerProfile({ customerId: 1 });

    expect(ordersReader.findByCustomerId).toHaveBeenCalledWith(1, { limit: 25 });
  });
});
