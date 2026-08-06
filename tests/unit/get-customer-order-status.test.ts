import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { CarriersReader, CustomerOrderStatusReader } from '../../src/application/customer-order-status/ports.js';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import type { OrderStatesReader } from '../../src/application/customer-profile/ports.js';
import type { CarrierRecord } from '../../src/domain/customer-order-status/carrier-record.js';
import type { CustomerOrderStatusRecord } from '../../src/domain/customer-order-status/customer-order-status-record.js';
import type { OrderStateRecord } from '../../src/domain/customer-profile/order-state-record.js';

const clock = { now: () => new Date('2026-08-05T00:00:00.000Z') };

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

function orderReaderReturning(record: CustomerOrderStatusRecord | null): CustomerOrderStatusReader {
  return { findByCustomerAndReference: vi.fn(async () => record) };
}

function orderStatesReaderReturning(records: readonly OrderStateRecord[]): OrderStatesReader {
  return { findByIds: vi.fn(async () => records) };
}

function carriersReaderReturning(record: CarrierRecord | null): CarriersReader {
  return { findById: vi.fn(async () => record) };
}

const orderRecord: CustomerOrderStatusRecord = {
  orderId: 123,
  reference: 'ABC123XYZ',
  customerId: 1,
  currentStateId: 4,
  carrierId: 2,
  updatedAt: new Date('2026-01-02T10:00:00Z'),
};

function baseDeps(overrides: Partial<{
  customerOrderStatusReader: CustomerOrderStatusReader;
  orderStatesReader: OrderStatesReader;
  carriersReader: CarriersReader;
}> = {}) {
  return {
    resolveCustomerIdentity: createResolveCustomerIdentity({
      customerIdentityRepository: identityRepositoryReturning(true),
    }),
    customerOrderStatusReader: overrides.customerOrderStatusReader ?? orderReaderReturning(orderRecord),
    orderStatesReader: overrides.orderStatesReader ?? orderStatesReaderReturning([{ stateId: 4, name: 'Entregado a Transportista' }]),
    carriersReader: overrides.carriersReader ?? carriersReaderReturning({ carrierId: 2, referenceId: 2, name: 'Despacho directo', delay: null }),
    clock,
    orderStateLanguageId: 1,
    carrierLanguageId: 1,
    carrierShopId: 1,
  };
}

describe('getCustomerOrderStatus', () => {
  it('short-circuits customer_not_found when identity is missing', async () => {
    const orderReader = orderReaderReturning(null);
    const getCustomerOrderStatus = createGetCustomerOrderStatus({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(false),
      }),
      customerOrderStatusReader: orderReader,
      orderStatesReader: orderStatesReaderReturning([]),
      carriersReader: carriersReaderReturning(null),
      clock,
      orderStateLanguageId: 1,
      carrierLanguageId: 1,
      carrierShopId: 1,
    });

    const result = await getCustomerOrderStatus({ customerId: 999, orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'customer_not_found', customerId: 999 });
    expect(orderReader.findByCustomerAndReference).not.toHaveBeenCalled();
  });

  it('is order_not_found when the order does not exist for that customer (or belongs to another customer)', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps({ customerOrderStatusReader: orderReaderReturning(null) }));

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'MISSING1' });

    expect(result).toEqual({ status: 'order_not_found', customerId: 1 });
  });

  it('returns available with provenance and resolved state name', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps());

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.customerId).toBe(1);
    expect(result.order.deliveryMethod).toBe('direct_dispatch');
    expect(result.provenance.customerIdentity.externalCustomerId).toBe('1');
  });

  it('resolves currentStateName as null with order_state_label_missing when the state is absent from the catalog', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps({ orderStatesReader: orderStatesReaderReturning([]) }));

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.currentStateName).toBeNull();
    expect(result.warnings).toContain('order_state_label_missing');
  });

  it('marks deliveryMethod unknown with carrier_not_found and delivery_method_unknown when the carrier row is missing', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps({ carriersReader: carriersReaderReturning(null) }));

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('unknown');
    expect(result.order.deliveryEstimate).toEqual({
      status: 'unknown',
      minimumBusinessDays: null,
      maximumBusinessDays: null,
      startsFrom: null,
    });
    expect(result.warnings).toEqual(expect.arrayContaining(['carrier_not_found', 'delivery_method_unknown']));
  });

  it('marks delivery_method_unknown (without carrier_not_found) when the carrier exists but its id has no business mapping', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(
      baseDeps({
        customerOrderStatusReader: orderReaderReturning({ ...orderRecord, carrierId: 999 }),
        carriersReader: carriersReaderReturning({ carrierId: 999, referenceId: 999, name: 'Unmapped carrier', delay: null }),
      }),
    );

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('unknown');
    expect(result.warnings).toContain('delivery_method_unknown');
    expect(result.warnings).not.toContain('carrier_not_found');
  });

  it('resolves an applicable deliveryEstimate for direct_dispatch', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps());

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryEstimate).toEqual({
      status: 'applicable',
      minimumBusinessDays: 3,
      maximumBusinessDays: 5,
      startsFrom: 'dispatch',
    });
  });

  it('resolves a not_applicable deliveryEstimate for store_pickup', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(
      baseDeps({
        customerOrderStatusReader: orderReaderReturning({ ...orderRecord, carrierId: 1 }),
        carriersReader: carriersReaderReturning({ carrierId: 1, referenceId: 1, name: 'Retiro en tienda', delay: null }),
      }),
    );

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('store_pickup');
    expect(result.order.deliveryEstimate).toEqual({
      status: 'not_applicable',
      minimumBusinessDays: null,
      maximumBusinessDays: null,
      startsFrom: null,
    });
  });

  it('maps unavailable/schema issues from the order reader to degraded results', async () => {
    const buildUseCase = (error: Error) =>
      createGetCustomerOrderStatus(
        baseDeps({ customerOrderStatusReader: { findByCustomerAndReference: vi.fn(async () => Promise.reject(error)) } }),
      );

    await expect(buildUseCase(new PrestashopTimeoutError('timeout'))({ customerId: 1, orderReference: 'ABC123XYZ' })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(buildUseCase(new PrestashopUnavailableError('down'))({ customerId: 1, orderReference: 'ABC123XYZ' })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(buildUseCase(new PrestashopSchemaIncompatibleError('schema'))({ customerId: 1, orderReference: 'ABC123XYZ' })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    });
  });

  it('is degraded / prestashop_unavailable when the order states reader fails', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(
      baseDeps({ orderStatesReader: { findByIds: vi.fn(async () => Promise.reject(new PrestashopUnavailableError('down'))) } }),
    );

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', customerId: 1, reason: 'prestashop_unavailable' });
  });

  it('is degraded / prestashop_unavailable when the carriers reader fails', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(
      baseDeps({ carriersReader: { findById: vi.fn(async () => Promise.reject(new PrestashopUnavailableError('down'))) } }),
    );

    const result = await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', customerId: 1, reason: 'prestashop_unavailable' });
  });

  it('propagates unclassified errors instead of degrading', async () => {
    const getCustomerOrderStatus = createGetCustomerOrderStatus(
      baseDeps({ customerOrderStatusReader: { findByCustomerAndReference: vi.fn(async () => Promise.reject(new Error('boom'))) } }),
    );

    await expect(getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' })).rejects.toThrow('boom');
  });

  it('calls the order reader with the resolved identity customerId and the exact reference', async () => {
    const orderReader = orderReaderReturning(orderRecord);
    const getCustomerOrderStatus = createGetCustomerOrderStatus(baseDeps({ customerOrderStatusReader: orderReader }));

    await getCustomerOrderStatus({ customerId: 1, orderReference: 'ABC123XYZ' });

    expect(orderReader.findByCustomerAndReference).toHaveBeenCalledWith(1, 'ABC123XYZ');
  });
});
