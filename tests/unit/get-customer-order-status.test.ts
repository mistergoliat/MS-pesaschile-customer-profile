import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { CarriersReader, CustomerOrderStatusReader } from '../../src/application/customer-order-status/ports.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { MasterCustomerReader, OrderStatesReader } from '../../src/application/customer-profile/ports.js';
import type { CarrierRecord } from '../../src/domain/customer-order-status/carrier-record.js';
import type { CustomerOrderStatusRecord } from '../../src/domain/customer-order-status/customer-order-status-record.js';
import type { MasterCustomerRecord } from '../../src/domain/customer-profile/master-customer-record.js';
import type { OrderStateRecord } from '../../src/domain/customer-profile/order-state-record.js';

const orderStateLanguageId = 1;
const carrierLanguageId = 1;
const carrierShopId = 1;

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

const directDispatchOrder: CustomerOrderStatusRecord = {
  orderId: 123,
  reference: 'ABC123XYZ',
  customerId: 555,
  currentStateId: 4,
  carrierId: 2,
  updatedAt: new Date('2026-01-02T10:00:00Z'),
};

const stateShipped: OrderStateRecord = { stateId: 4, name: 'Entregado a Transportista' };

const directDispatchCarrier: CarrierRecord = {
  carrierId: 2,
  referenceId: 2,
  name: 'Despacho directo',
  delay: '3 a 5 días hábiles',
};

const externalCarrier: CarrierRecord = { carrierId: 3, referenceId: 3, name: 'Chilexpress', delay: null };
const storePickupCarrier: CarrierRecord = { carrierId: 1, referenceId: 1, name: 'Retiro en tienda', delay: null };
const unmappedCarrier: CarrierRecord = { carrierId: 14, referenceId: 14, name: '1', delay: null };

function masterReaderReturning(record: MasterCustomerRecord | null): MasterCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function orderReaderReturning(record: CustomerOrderStatusRecord | null): CustomerOrderStatusReader {
  return { findByCustomerAndReference: vi.fn(async () => record) };
}

function orderReaderThrowing(error: unknown): CustomerOrderStatusReader {
  return {
    findByCustomerAndReference: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachableOrderReader(): CustomerOrderStatusReader {
  return {
    findByCustomerAndReference: vi.fn(async () => {
      throw new Error('Order must not be queried for this case');
    }),
  };
}

function orderStatesReaderReturning(records: readonly OrderStateRecord[]): OrderStatesReader {
  return { findByIds: vi.fn(async () => records) };
}

function orderStatesReaderThrowing(error: unknown): OrderStatesReader {
  return {
    findByIds: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachableOrderStatesReader(): OrderStatesReader {
  return {
    findByIds: vi.fn(async () => {
      throw new Error('Order states must not be queried for this case');
    }),
  };
}

function carriersReaderReturning(record: CarrierRecord | null): CarriersReader {
  return { findById: vi.fn(async () => record) };
}

function carriersReaderThrowing(error: unknown): CarriersReader {
  return {
    findById: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachableCarriersReader(): CarriersReader {
  return {
    findById: vi.fn(async () => {
      throw new Error('Carrier must not be queried for this case');
    }),
  };
}

function buildUseCase(overrides: {
  masterCustomerReader?: MasterCustomerReader;
  customerOrderStatusReader?: CustomerOrderStatusReader;
  orderStatesReader?: OrderStatesReader;
  carriersReader?: CarriersReader;
}) {
  return createGetCustomerOrderStatus({
    masterCustomerReader: overrides.masterCustomerReader ?? masterReaderReturning(linkedMasterCustomer),
    customerOrderStatusReader: overrides.customerOrderStatusReader ?? orderReaderReturning(directDispatchOrder),
    orderStatesReader: overrides.orderStatesReader ?? orderStatesReaderReturning([stateShipped]),
    carriersReader: overrides.carriersReader ?? carriersReaderReturning(directDispatchCarrier),
    orderStateLanguageId,
    carrierLanguageId,
    carrierShopId,
  });
}

describe('getCustomerOrderStatus', () => {
  it('is customer_not_found and never queries the order, order states or carrier when master_customer does not exist', async () => {
    const customerOrderStatusReader = unreachableOrderReader();
    const orderStatesReader = unreachableOrderStatesReader();
    const carriersReader = unreachableCarriersReader();
    const getCustomerOrderStatus = buildUseCase({
      masterCustomerReader: masterReaderReturning(null),
      customerOrderStatusReader,
      orderStatesReader,
      carriersReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '999', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'customer_not_found' });
    expect(customerOrderStatusReader.findByCustomerAndReference).not.toHaveBeenCalled();
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
    expect(carriersReader.findById).not.toHaveBeenCalled();
  });

  it('is customer_not_linked and never queries the order when master_customer exists without a PrestaShop link', async () => {
    const customerOrderStatusReader = unreachableOrderReader();
    const getCustomerOrderStatus = buildUseCase({
      masterCustomerReader: masterReaderReturning(unlinkedMasterCustomer),
      customerOrderStatusReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'customer_not_linked' });
    expect(customerOrderStatusReader.findByCustomerAndReference).not.toHaveBeenCalled();
  });

  it('is order_not_found and never queries order states or carrier when the order does not exist for this customer', async () => {
    const orderStatesReader = unreachableOrderStatesReader();
    const carriersReader = unreachableCarriersReader();
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderReturning(null),
      orderStatesReader,
      carriersReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'NOPE' });

    expect(result).toEqual({ status: 'order_not_found' });
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
    expect(carriersReader.findById).not.toHaveBeenCalled();
  });

  it('produces order_not_found the same way whether the order truly does not exist or belongs to another customer (the reader already scoped the query)', async () => {
    // The reader is the only place id_customer is enforced (see CP-R1-T06 section 3);
    // from the use case's perspective both causes collapse to the same `null`.
    const getCustomerOrderStatus = buildUseCase({ customerOrderStatusReader: orderReaderReturning(null) });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'SOMEONE-ELSES' });

    expect(result).toEqual({ status: 'order_not_found' });
  });

  it('is available with the resolved state name, direct_dispatch carrier and matching estimate', async () => {
    const getCustomerOrderStatus = buildUseCase({});

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({
      status: 'available',
      order: {
        orderId: 123,
        reference: 'ABC123XYZ',
        currentStateId: 4,
        currentStateName: 'Entregado a Transportista',
        deliveryMethod: 'direct_dispatch',
        deliveryEstimate: {
          status: 'applicable',
          minimumBusinessDays: 3,
          maximumBusinessDays: 5,
          startsFrom: 'dispatch',
        },
        lastRecordedUpdateAt: '2026-01-02T10:00:00.000Z',
        source: 'prestashop_current_state',
        isRealTimeTracking: false,
      },
      warnings: [],
    });
  });

  it('is available with currentStateName null and warning order_state_label_missing when the state has no catalog match', async () => {
    const getCustomerOrderStatus = buildUseCase({ orderStatesReader: orderStatesReaderReturning([]) });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.currentStateName).toBeNull();
    expect(result.warnings).toContain('order_state_label_missing');
  });

  it('resolves external_carrier with a 5-15 business day estimate', async () => {
    const externalOrder: CustomerOrderStatusRecord = { ...directDispatchOrder, carrierId: 3 };
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderReturning(externalOrder),
      carriersReader: carriersReaderReturning(externalCarrier),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('external_carrier');
    expect(result.order.deliveryEstimate).toEqual({
      status: 'applicable',
      minimumBusinessDays: 5,
      maximumBusinessDays: 15,
      startsFrom: 'dispatch',
    });
    expect(result.warnings).toEqual([]);
  });

  it('resolves a pickup carrier with a not_applicable estimate and no warnings', async () => {
    const pickupOrder: CustomerOrderStatusRecord = { ...directDispatchOrder, carrierId: 1 };
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderReturning(pickupOrder),
      carriersReader: carriersReaderReturning(storePickupCarrier),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('store_pickup');
    expect(result.order.deliveryEstimate.status).toBe('not_applicable');
    expect(result.warnings).toEqual([]);
  });

  it('resolves carrier 14 (present but unmapped) as deliveryMethod unknown with warning delivery_method_unknown, no carrier_not_found', async () => {
    const unmappedOrder: CustomerOrderStatusRecord = { ...directDispatchOrder, carrierId: 14 };
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderReturning(unmappedOrder),
      carriersReader: carriersReaderReturning(unmappedCarrier),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('unknown');
    expect(result.order.deliveryEstimate.status).toBe('unknown');
    expect(result.warnings).toEqual(['delivery_method_unknown']);
    expect(result.warnings).not.toContain('carrier_not_found');
  });

  it('resolves an order with carrierId 0 (no shipping / virtual order) as deliveryMethod unknown with warnings carrier_not_found and delivery_method_unknown', async () => {
    // id_carrier = 0 is a legitimate PrestaShop sentinel (see mysql-carriers-reader.ts):
    // the reader returns null for it without ever touching SQL, so from this use case's
    // perspective it behaves exactly like any other absent carrier.
    const noCarrierOrder: CustomerOrderStatusRecord = { ...directDispatchOrder, carrierId: 0 };
    const carriersReader = carriersReaderReturning(null);
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderReturning(noCarrierOrder),
      carriersReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('unknown');
    expect(result.warnings).toEqual(['carrier_not_found', 'delivery_method_unknown']);
    expect(carriersReader.findById).toHaveBeenCalledWith(0, carrierLanguageId, carrierShopId);
  });

  it('resolves a missing carrier row as deliveryMethod unknown with warnings carrier_not_found and delivery_method_unknown — never degrades the whole lookup', async () => {
    const getCustomerOrderStatus = buildUseCase({ carriersReader: carriersReaderReturning(null) });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.deliveryMethod).toBe('unknown');
    expect(result.warnings).toEqual(['carrier_not_found', 'delivery_method_unknown']);
  });

  it('never includes an id, reference or name inside a warning string', async () => {
    const getCustomerOrderStatus = buildUseCase({
      orderStatesReader: orderStatesReaderReturning([]),
      carriersReader: carriersReaderReturning(null),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    for (const warning of result.warnings) {
      expect(warning).not.toContain('123');
      expect(warning).not.toContain('ABC123XYZ');
    }
  });

  it('sets source and isRealTimeTracking as fixed constants', async () => {
    const getCustomerOrderStatus = buildUseCase({});

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.order.source).toBe('prestashop_current_state');
    expect(result.order.isRealTimeTracking).toBe(false);
  });

  it('is degraded / prestashop_timeout when the order reader times out, and never queries order states or carrier', async () => {
    const orderStatesReader = unreachableOrderStatesReader();
    const carriersReader = unreachableCarriersReader();
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderThrowing(new PrestashopTimeoutError('order timed out')),
      orderStatesReader,
      carriersReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
    expect(carriersReader.findById).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_unavailable when the order reader is unavailable', async () => {
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderThrowing(new PrestashopUnavailableError('order down')),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('propagates an unclassified order reader error instead of guessing a degraded reason', async () => {
    const getCustomerOrderStatus = buildUseCase({
      customerOrderStatusReader: orderReaderThrowing(new Error('order boom')),
    });

    await expect(getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' })).rejects.toThrow(
      'order boom',
    );
  });

  it('is degraded / prestashop_timeout when the order states reader times out, and never queries carrier', async () => {
    const carriersReader = unreachableCarriersReader();
    const getCustomerOrderStatus = buildUseCase({
      orderStatesReader: orderStatesReaderThrowing(new PrestashopTimeoutError('states timed out')),
      carriersReader,
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(carriersReader.findById).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_unavailable when the order states reader is unavailable', async () => {
    const getCustomerOrderStatus = buildUseCase({
      orderStatesReader: orderStatesReaderThrowing(new PrestashopUnavailableError('states down')),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('propagates an unclassified order states reader error instead of guessing a degraded reason', async () => {
    const getCustomerOrderStatus = buildUseCase({
      orderStatesReader: orderStatesReaderThrowing(new Error('states boom')),
    });

    await expect(getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' })).rejects.toThrow(
      'states boom',
    );
  });

  it('is degraded / prestashop_timeout when the carrier reader times out', async () => {
    const getCustomerOrderStatus = buildUseCase({
      carriersReader: carriersReaderThrowing(new PrestashopTimeoutError('carrier timed out')),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
  });

  it('is degraded / prestashop_unavailable when the carrier reader is unavailable', async () => {
    const getCustomerOrderStatus = buildUseCase({
      carriersReader: carriersReaderThrowing(new PrestashopUnavailableError('carrier down')),
    });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('propagates an unclassified carrier reader error instead of guessing a degraded reason', async () => {
    const getCustomerOrderStatus = buildUseCase({
      carriersReader: carriersReaderThrowing(new Error('carrier boom')),
    });

    await expect(getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' })).rejects.toThrow(
      'carrier boom',
    );
  });

  it('calls the order reader with the linked prestashopCustomerId and the raw orderReference', async () => {
    const customerOrderStatusReader = orderReaderReturning(directDispatchOrder);
    const getCustomerOrderStatus = buildUseCase({ customerOrderStatusReader });

    await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(customerOrderStatusReader.findByCustomerAndReference).toHaveBeenCalledWith(555, 'ABC123XYZ');
  });

  it('calls the order states reader with only the order currentStateId and the configured orderStateLanguageId', async () => {
    const orderStatesReader = orderStatesReaderReturning([stateShipped]);
    const getCustomerOrderStatus = createGetCustomerOrderStatus({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      customerOrderStatusReader: orderReaderReturning(directDispatchOrder),
      orderStatesReader,
      carriersReader: carriersReaderReturning(directDispatchCarrier),
      orderStateLanguageId: 7,
      carrierLanguageId,
      carrierShopId,
    });

    await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(orderStatesReader.findByIds).toHaveBeenCalledWith([4], 7);
  });

  it('calls the carrier reader with the order carrierId and the configured carrierLanguageId/carrierShopId', async () => {
    const carriersReader = carriersReaderReturning(directDispatchCarrier);
    const getCustomerOrderStatus = createGetCustomerOrderStatus({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      customerOrderStatusReader: orderReaderReturning(directDispatchOrder),
      orderStatesReader: orderStatesReaderReturning([stateShipped]),
      carriersReader,
      orderStateLanguageId,
      carrierLanguageId: 9,
      carrierShopId: 3,
    });

    await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    expect(carriersReader.findById).toHaveBeenCalledWith(2, 9, 3);
  });

  it('never uses ps_order_history, flags or keyword matching — deliveryMethod comes only from resolveDeliveryMethod(carrierId)', async () => {
    // The fake carrier record's name/delay would classify as "express"/"pickup" by
    // keyword if this use case ever looked at them — it must not.
    const misleadingNameCarrier: CarrierRecord = {
      carrierId: 2,
      referenceId: 2,
      name: 'Retiro rápido en tienda',
      delay: 'entrega en 1 día',
    };
    const getCustomerOrderStatus = buildUseCase({ carriersReader: carriersReaderReturning(misleadingNameCarrier) });

    const result = await getCustomerOrderStatus({ masterCustomerId: '1', orderReference: 'ABC123XYZ' });

    if (result.status !== 'available') throw new Error('expected available');
    // carrierId 2 maps to direct_dispatch regardless of the misleading name/delay text.
    expect(result.order.deliveryMethod).toBe('direct_dispatch');
  });
});
