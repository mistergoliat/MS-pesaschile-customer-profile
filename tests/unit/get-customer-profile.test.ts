import { describe, expect, it, vi } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createGetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import type {
  Clock,
  CustomerOrdersReader,
  MasterCustomerReader,
  OrderStatesReader,
  PrestashopCustomerReader,
} from '../../src/application/customer-profile/ports.js';
import type { CustomerOrderRecord } from '../../src/domain/customer-profile/customer-order-record.js';
import type { MasterCustomerRecord } from '../../src/domain/customer-profile/master-customer-record.js';
import type { OrderStateRecord } from '../../src/domain/customer-profile/order-state-record.js';
import type { PrestashopCustomerRecord } from '../../src/domain/customer-profile/prestashop-customer-record.js';

const fixedClock: Clock = { now: () => new Date('2026-07-27T00:00:00.000Z') };
const recentOrdersLimit = 10;
const orderStateLanguageId = 1;

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

const olderOrder: CustomerOrderRecord = {
  orderId: 100,
  reference: 'REF100',
  customerId: 555,
  currentStateId: 4,
  valid: true,
  createdAt: '2026-01-01 10:00:00',
  updatedAt: '2026-01-02 10:00:00',
  totalPaidTaxIncl: '10000.000000',
  totalProductsTaxIncl: '9500.000000',
  currencyId: 1,
};

const newerOrder: CustomerOrderRecord = {
  orderId: 101,
  reference: 'REF101',
  customerId: 555,
  currentStateId: 2,
  valid: false,
  createdAt: '2026-02-01 10:00:00',
  updatedAt: '2026-02-01 10:00:00',
  totalPaidTaxIncl: '25990.500000',
  totalProductsTaxIncl: '24000.000000',
  currencyId: 1,
};

const stateShipped: OrderStateRecord = { stateId: 4, name: 'Enviado' };
const statePreparing: OrderStateRecord = { stateId: 2, name: 'Preparando pedido' };

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

function ordersReaderReturning(records: readonly CustomerOrderRecord[]): CustomerOrdersReader {
  return { findByCustomerId: vi.fn(async () => records) };
}

function ordersReaderThrowing(error: unknown): CustomerOrdersReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachableOrdersReader(): CustomerOrdersReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw new Error('Orders must not be queried for this case');
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

describe('getCustomerProfile', () => {
  it('is not_found and never calls PrestaShop, orders or order states when master_customer does not exist', async () => {
    const prestashopCustomerReader = unreachablePrestashopReader();
    const customerOrdersReader = unreachableOrdersReader();
    const orderStatesReader = unreachableOrderStatesReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(null),
      prestashopCustomerReader,
      customerOrdersReader,
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '999' });

    expect(result.status).toBe('not_found');
    expect(prestashopCustomerReader.findById).not.toHaveBeenCalled();
    expect(customerOrdersReader.findByCustomerId).not.toHaveBeenCalled();
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is partial and never calls PrestaShop, orders or order states when master_customer exists without a link', async () => {
    const prestashopCustomerReader = unreachablePrestashopReader();
    const customerOrdersReader = unreachableOrdersReader();
    const orderStatesReader = unreachableOrderStatesReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(unlinkedMasterCustomer),
      prestashopCustomerReader,
      customerOrdersReader,
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'partial', linkStatus: 'not_linked' });
    expect(prestashopCustomerReader.findById).not.toHaveBeenCalled();
    expect(customerOrdersReader.findByCustomerId).not.toHaveBeenCalled();
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is available when master_customer is linked and PrestaShop is found', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'available', linkStatus: 'linked', prestashopCustomerId: 555 });
  });

  it('is degraded / prestashop_customer_not_found and never queries orders or order states when linked but ps_customer is missing', async () => {
    const customerOrdersReader = unreachableOrdersReader();
    const orderStatesReader = unreachableOrderStatesReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(null),
      customerOrdersReader,
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_customer_not_found' });
    expect(customerOrdersReader.findByCustomerId).not.toHaveBeenCalled();
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_timeout on a PrestashopTimeoutError from the customer reader', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new PrestashopTimeoutError('timed out')),
      customerOrdersReader: unreachableOrdersReader(),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_timeout' });
  });

  it('is degraded / prestashop_unavailable on a PrestashopUnavailableError from the customer reader', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new PrestashopUnavailableError('down')),
      customerOrdersReader: unreachableOrdersReader(),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: throwingClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'profile_build_failed' });
  });

  it('propagates unclassified PrestaShop reader errors instead of guessing a degraded reason', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderThrowing(new Error('boom')),
      customerOrdersReader: unreachableOrdersReader(),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: unreachableOrdersReader(),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
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
      customerOrdersReader: ordersReaderReturning([]),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.customer.email).toBe(linkedMasterCustomer.email);
    expect(result.profile.customer.firstname).toBe(linkedMasterCustomer.firstname);
  });

  // --- CP-R1-T04: recentOrders ---

  it('is available with recentOrders = [] when ps_customer exists and has no orders (empty is not an error, order states never queried)', async () => {
    const customerOrdersReader = ordersReaderReturning([]);
    const orderStatesReader = unreachableOrderStatesReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader,
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders).toEqual([]);
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('preserves the order returned by the reader instead of re-sorting (paid/unpaid, valid/invalid alike)', async () => {
    // newerOrder.valid === false, olderOrder.valid === true: order is preserved
    // regardless of `valid` — this snapshot never filters or re-sorts by it.
    const customerOrdersReader = ordersReaderReturning([newerOrder, olderOrder]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader,
      orderStatesReader: orderStatesReaderReturning([stateShipped, statePreparing]),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders.map((order) => order.orderId)).toEqual([
      newerOrder.orderId,
      olderOrder.orderId,
    ]);
  });

  it('calls the orders reader with the exact linked prestashopCustomerId and the configured recentOrdersLimit', async () => {
    const customerOrdersReader = ordersReaderReturning([]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader,
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit: 25,
      orderStateLanguageId,
    });

    await getCustomerProfile({ masterCustomerId: '1' });

    expect(customerOrdersReader.findByCustomerId).toHaveBeenCalledTimes(1);
    expect(customerOrdersReader.findByCustomerId).toHaveBeenCalledWith(555, { limit: 25 });
  });

  it('is degraded / prestashop_timeout on a PrestashopTimeoutError from the orders reader', async () => {
    const orderStatesReader = unreachableOrderStatesReader();
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderThrowing(new PrestashopTimeoutError('orders timed out')),
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(orderStatesReader.findByIds).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_unavailable on a PrestashopUnavailableError from the orders reader', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderThrowing(new PrestashopUnavailableError('orders down')),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('propagates unclassified orders reader errors instead of guessing a degraded reason', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderThrowing(new Error('orders boom')),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    await expect(getCustomerProfile({ masterCustomerId: '1' })).rejects.toThrow('orders boom');
  });

  it('never returns available with a non-empty warnings-only fallback when the orders read fails (degrades instead)', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderThrowing(new PrestashopUnavailableError('orders down')),
      orderStatesReader: unreachableOrderStatesReader(),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).not.toBe('available');
    expect(result.profile).toBeNull();
  });

  // --- CP-R1-T05: order state context ---

  it('is available with currentState resolved + name when a single order has a state found in the catalog', async () => {
    const orderStatesReader = orderStatesReaderReturning([stateShipped]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders).toEqual([
      expect.objectContaining({
        orderId: olderOrder.orderId,
        currentStateId: 4,
        currentState: { stateId: 4, name: 'Enviado', resolution: 'resolved' },
      }),
    ]);
  });

  it('calls the order states reader with a single deduplicated id when several orders share the same currentStateId', async () => {
    const sameStateOrder: CustomerOrderRecord = { ...newerOrder, orderId: 102, currentStateId: 4 };
    const orderStatesReader = orderStatesReaderReturning([stateShipped]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([sameStateOrder, olderOrder]),
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    await getCustomerProfile({ masterCustomerId: '1' });

    expect(orderStatesReader.findByIds).toHaveBeenCalledTimes(1);
    expect(orderStatesReader.findByIds).toHaveBeenCalledWith([4], orderStateLanguageId);
  });

  it('passes the configured orderStateLanguageId through to the order states reader', async () => {
    const orderStatesReader = orderStatesReaderReturning([stateShipped]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId: 2,
    });

    await getCustomerProfile({ masterCustomerId: '1' });

    expect(orderStatesReader.findByIds).toHaveBeenCalledWith([4], 2);
  });

  it('maps distinct currentStateIds correctly without changing recentOrders order', async () => {
    const orderStatesReader = orderStatesReaderReturning([stateShipped, statePreparing]);
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([newerOrder, olderOrder]),
      orderStatesReader,
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders.map((order) => [order.orderId, order.currentState.name])).toEqual([
      [newerOrder.orderId, 'Preparando pedido'],
      [olderOrder.orderId, 'Enviado'],
    ]);
  });

  it('is available with currentState unknown and warning order_state_label_missing when a state is absent from the catalog', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderReturning([]),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders).toEqual([
      expect.objectContaining({
        currentStateId: 4,
        currentState: { stateId: 4, name: null, resolution: 'unknown' },
      }),
    ]);
    expect(result.profile.warnings).toContain('order_state_label_missing');
  });

  it('adds the order_state_label_missing warning only once even when several orders have an unresolved state', async () => {
    const anotherUnresolvedOrder: CustomerOrderRecord = { ...newerOrder, orderId: 103, currentStateId: 7 };
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder, anotherUnresolvedOrder]),
      orderStatesReader: orderStatesReaderReturning([]),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.recentOrders.every((order) => order.currentState.resolution === 'unknown')).toBe(true);
    expect(result.profile.warnings.filter((warning) => warning === 'order_state_label_missing')).toHaveLength(1);
  });

  it('does not put the stateId inside the order_state_label_missing warning string', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderReturning([]),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.profile.warnings).toEqual(['order_state_label_missing']);
  });

  it('is degraded / prestashop_timeout on a PrestashopTimeoutError from the order states reader', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderThrowing(new PrestashopTimeoutError('order states timed out')),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(result.profile).toBeNull();
  });

  it('is degraded / prestashop_unavailable on a PrestashopUnavailableError from the order states reader', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderThrowing(new PrestashopUnavailableError('order states down')),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_unavailable' });
    expect(result.profile).toBeNull();
  });

  it('propagates unclassified order states reader errors instead of guessing a degraded reason', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderThrowing(new Error('order states boom')),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    await expect(getCustomerProfile({ masterCustomerId: '1' })).rejects.toThrow('order states boom');
  });

  it('never returns available with recentOrders labeled as if resolved when the order states read fails entirely', async () => {
    const getCustomerProfile = createGetCustomerProfile({
      masterCustomerReader: masterReaderReturning(linkedMasterCustomer),
      prestashopCustomerReader: prestashopReaderReturning(matchingPrestashopCustomer),
      customerOrdersReader: ordersReaderReturning([olderOrder]),
      orderStatesReader: orderStatesReaderThrowing(new PrestashopUnavailableError('order states down')),
      clock: fixedClock,
      recentOrdersLimit,
      orderStateLanguageId,
    });

    const result = await getCustomerProfile({ masterCustomerId: '1' });

    expect(result.status).not.toBe('available');
  });
});
