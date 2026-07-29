import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type {
  CommercialOrdersSummaryReader,
  CommercialOrdersSummaryRecord,
  CommercialProductsSummaryReader,
  CommercialProductsSummaryRecord,
} from '../../src/application/customer-commercial-summary/ports.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { MasterCustomerReader } from '../../src/application/customer-profile/ports.js';
import type { MasterCustomerRecord } from '../../src/domain/customer-profile/index.js';

const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };

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

const emptyOrders: CommercialOrdersSummaryRecord = {
  totalOrders: 0,
  totalSpentTaxIncl: '0.000000',
  firstOrderAt: null,
  lastOrderAt: null,
  cancelledOrderCount: 0,
  refundedOrderCount: 0,
};

const emptyProducts: CommercialProductsSummaryRecord = {
  totalUnitsPurchased: 0,
  distinctProductsPurchased: 0,
};

function masterReaderReturning(record: MasterCustomerRecord | null): MasterCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function ordersReaderReturning(record: CommercialOrdersSummaryRecord): CommercialOrdersSummaryReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

function ordersReaderThrowing(error: unknown): CommercialOrdersSummaryReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw error;
    }),
  };
}

function productsReaderReturning(record: CommercialProductsSummaryRecord): CommercialProductsSummaryReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

function productsReaderThrowing(error: unknown): CommercialProductsSummaryReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachableOrdersReader(): CommercialOrdersSummaryReader {
  return ordersReaderThrowing(new Error('orders must not be queried'));
}

function unreachableProductsReader(): CommercialProductsSummaryReader {
  return productsReaderThrowing(new Error('products must not be queried'));
}

function buildUseCase(overrides: {
  masterCustomerReader?: MasterCustomerReader;
  commercialOrdersSummaryReader?: CommercialOrdersSummaryReader;
  commercialProductsSummaryReader?: CommercialProductsSummaryReader;
} = {}) {
  return createGetCustomerCommercialSummary({
    masterCustomerReader: overrides.masterCustomerReader ?? masterReaderReturning(linkedMasterCustomer),
    commercialOrdersSummaryReader: overrides.commercialOrdersSummaryReader ?? ordersReaderReturning(emptyOrders),
    commercialProductsSummaryReader: overrides.commercialProductsSummaryReader ?? productsReaderReturning(emptyProducts),
    clock,
  });
}

describe('getCustomerCommercialSummary', () => {
  it('is customer_not_found and never queries PrestaShop when master_customer does not exist', async () => {
    const commercialOrdersSummaryReader = unreachableOrdersReader();
    const commercialProductsSummaryReader = unreachableProductsReader();
    const getCustomerCommercialSummary = buildUseCase({
      masterCustomerReader: masterReaderReturning(null),
      commercialOrdersSummaryReader,
      commercialProductsSummaryReader,
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '999' });

    expect(result).toEqual({ status: 'customer_not_found' });
    expect(commercialOrdersSummaryReader.findByCustomerId).not.toHaveBeenCalled();
    expect(commercialProductsSummaryReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('is customer_not_linked and never queries PrestaShop when master_customer has no link', async () => {
    const commercialOrdersSummaryReader = unreachableOrdersReader();
    const getCustomerCommercialSummary = buildUseCase({
      masterCustomerReader: masterReaderReturning(unlinkedMasterCustomer),
      commercialOrdersSummaryReader,
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({ status: 'customer_not_linked' });
    expect(commercialOrdersSummaryReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('returns the documented empty summary for linked customers without valid orders', async () => {
    const getCustomerCommercialSummary = buildUseCase();

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({
      status: 'available',
      summary: {
        totalOrders: 0,
        totalSpentTaxIncl: '0.000000',
        averageOrderValueTaxIncl: '0.000000',
        firstOrderAt: null,
        lastOrderAt: null,
        daysSinceLastOrder: null,
        purchaseFrequencyDays: null,
        totalUnitsPurchased: 0,
        distinctProductsPurchased: 0,
        cancelledOrderCount: 0,
        refundedOrderCount: 0,
        currencyIsoCode: 'CLP',
      },
    });
  });

  it('keeps cancellation and refund counts even when there are no valid purchases', async () => {
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader: ordersReaderReturning({
        ...emptyOrders,
        cancelledOrderCount: 2,
        refundedOrderCount: 1,
      }),
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toMatchObject({
      status: 'available',
      summary: {
        totalOrders: 0,
        cancelledOrderCount: 2,
        refundedOrderCount: 1,
      },
    });
  });

  it('builds a commercial summary with money, recency, frequency, units and distinct products', async () => {
    const orders: CommercialOrdersSummaryRecord = {
      totalOrders: 3,
      totalSpentTaxIncl: '300.000000',
      firstOrderAt: new Date('2026-07-20T12:00:00.000Z'),
      lastOrderAt: new Date('2026-07-26T12:00:00.000Z'),
      cancelledOrderCount: 1,
      refundedOrderCount: 2,
    };
    const products: CommercialProductsSummaryRecord = {
      totalUnitsPurchased: 7,
      distinctProductsPurchased: 4,
    };
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader: ordersReaderReturning(orders),
      commercialProductsSummaryReader: productsReaderReturning(products),
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({
      status: 'available',
      summary: {
        totalOrders: 3,
        totalSpentTaxIncl: '300.000000',
        averageOrderValueTaxIncl: '100.000000',
        firstOrderAt: '2026-07-20T12:00:00.000Z',
        lastOrderAt: '2026-07-26T12:00:00.000Z',
        daysSinceLastOrder: 3,
        purchaseFrequencyDays: 3,
        totalUnitsPurchased: 7,
        distinctProductsPurchased: 4,
        cancelledOrderCount: 1,
        refundedOrderCount: 2,
        currencyIsoCode: 'CLP',
      },
    });
  });

  it('calls both PrestaShop readers with the linked customer id', async () => {
    const commercialOrdersSummaryReader = ordersReaderReturning(emptyOrders);
    const commercialProductsSummaryReader = productsReaderReturning(emptyProducts);
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader,
      commercialProductsSummaryReader,
    });

    await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(commercialOrdersSummaryReader.findByCustomerId).toHaveBeenCalledWith(555);
    expect(commercialProductsSummaryReader.findByCustomerId).toHaveBeenCalledWith(555);
  });

  it('is degraded / prestashop_timeout when the orders reader times out and never calls products', async () => {
    const commercialProductsSummaryReader = productsReaderReturning({
      totalUnitsPurchased: 99,
      distinctProductsPurchased: 9,
    });
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader: ordersReaderThrowing(new PrestashopTimeoutError('orders timed out')),
      commercialProductsSummaryReader,
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(result).not.toHaveProperty('summary');
    expect(commercialProductsSummaryReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_unavailable when the orders reader is unavailable and never calls products', async () => {
    const commercialProductsSummaryReader = productsReaderReturning(emptyProducts);
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader: ordersReaderThrowing(new PrestashopUnavailableError('orders down')),
      commercialProductsSummaryReader,
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
    expect(commercialProductsSummaryReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('is degraded / prestashop_timeout when the products reader times out after orders succeeds', async () => {
    const commercialOrdersSummaryReader = ordersReaderReturning(emptyOrders);
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader,
      commercialProductsSummaryReader: productsReaderThrowing(new PrestashopTimeoutError('products timed out')),
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(commercialOrdersSummaryReader.findByCustomerId).toHaveBeenCalledWith(555);
  });

  it('is degraded / prestashop_unavailable when the products reader is unavailable after orders succeeds', async () => {
    const commercialOrdersSummaryReader = ordersReaderReturning(emptyOrders);
    const getCustomerCommercialSummary = buildUseCase({
      commercialOrdersSummaryReader,
      commercialProductsSummaryReader: productsReaderThrowing(new PrestashopUnavailableError('products down')),
    });

    const result = await getCustomerCommercialSummary({ masterCustomerId: '1' });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
    expect(commercialOrdersSummaryReader.findByCustomerId).toHaveBeenCalledWith(555);
  });

  it('propagates an unknown products reader error after orders succeeds', async () => {
    await expect(
      buildUseCase({
        commercialOrdersSummaryReader: ordersReaderReturning(emptyOrders),
        commercialProductsSummaryReader: productsReaderThrowing(new Error('products unknown')),
      })({ masterCustomerId: '1' }),
    ).rejects.toThrow('products unknown');
  });

  it('propagates unknown errors and contractual invalid dates', async () => {
    await expect(
      buildUseCase({
        commercialOrdersSummaryReader: ordersReaderThrowing(new Error('unknown')),
      })({ masterCustomerId: '1' }),
    ).rejects.toThrow('unknown');

    await expect(
      buildUseCase({
        commercialOrdersSummaryReader: ordersReaderReturning({
          ...emptyOrders,
          totalOrders: 1,
          firstOrderAt: new Date('2026-07-30T00:00:00.000Z'),
          lastOrderAt: new Date('2026-07-30T00:00:00.000Z'),
        }),
      })({ masterCustomerId: '1' }),
    ).rejects.toThrow();
  });
});
