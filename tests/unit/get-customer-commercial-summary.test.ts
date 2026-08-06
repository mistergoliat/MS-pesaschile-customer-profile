import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type {
  CommercialOrdersSummaryReader,
  CommercialOrdersSummaryRecord,
  CommercialProductsSummaryReader,
  CommercialProductsSummaryRecord,
} from '../../src/application/customer-commercial-summary/ports.js';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';

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

function ordersReaderReturning(record: CommercialOrdersSummaryRecord): CommercialOrdersSummaryReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

function productsReaderReturning(record: CommercialProductsSummaryRecord): CommercialProductsSummaryReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

const emptyOrders: CommercialOrdersSummaryRecord = {
  totalOrders: 0,
  totalSpentTaxIncl: '0.000000',
  firstOrderAt: null,
  lastOrderAt: null,
  cancelledOrderCount: 0,
  refundedOrderCount: 0,
};

const emptyProducts: CommercialProductsSummaryRecord = { totalUnitsPurchased: 0, distinctProductsPurchased: 0 };

describe('getCustomerCommercialSummary', () => {
  it('is customer_not_found and never queries PrestaShop when identity is missing', async () => {
    const ordersReader = ordersReaderReturning(emptyOrders);
    const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(false),
      }),
      commercialOrdersSummaryReader: ordersReader,
      commercialProductsSummaryReader: productsReaderReturning(emptyProducts),
      clock,
    });

    const result = await getCustomerCommercialSummary({ customerId: 999 });

    expect(result).toEqual({ status: 'customer_not_found', customerId: 999 });
    expect(ordersReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('returns the documented available summary and provenance', async () => {
    const ordersReader = ordersReaderReturning({
      totalOrders: 3,
      totalSpentTaxIncl: '300.000000',
      firstOrderAt: new Date('2026-07-20T12:00:00.000Z'),
      lastOrderAt: new Date('2026-07-26T12:00:00.000Z'),
      cancelledOrderCount: 1,
      refundedOrderCount: 2,
    });
    const productsReader = productsReaderReturning({ totalUnitsPurchased: 7, distinctProductsPurchased: 4 });
    const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      commercialOrdersSummaryReader: ordersReader,
      commercialProductsSummaryReader: productsReader,
      clock,
    });

    const result = await getCustomerCommercialSummary({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.customerId).toBe(1);
    expect(result.summary.averageOrderValueTaxIncl).toBe('100.000000');
    expect(result.provenance.customerIdentity.externalCustomerId).toBe('1');
    expect(ordersReader.findByCustomerId).toHaveBeenCalledWith(1);
    expect(productsReader.findByCustomerId).toHaveBeenCalledWith(1);
  });

  it('is available with zero-value metrics (not degraded) when the customer has no valid orders yet', async () => {
    const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      commercialOrdersSummaryReader: ordersReaderReturning(emptyOrders),
      commercialProductsSummaryReader: productsReaderReturning(emptyProducts),
      clock,
    });

    const result = await getCustomerCommercialSummary({ customerId: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.summary).toMatchObject({
      totalOrders: 0,
      totalSpentTaxIncl: '0.000000',
      averageOrderValueTaxIncl: '0.000000',
      firstOrderAt: null,
      lastOrderAt: null,
      daysSinceLastOrder: null,
      purchaseFrequencyDays: null,
    });
  });

  it('maps known PrestaShop failures to degraded results', async () => {
    const makeUseCase = (error: Error) =>
      createGetCustomerCommercialSummary({
        resolveCustomerIdentity: createResolveCustomerIdentity({
          customerIdentityRepository: identityRepositoryReturning(true),
        }),
        commercialOrdersSummaryReader: { findByCustomerId: vi.fn(async () => Promise.reject(error)) },
        commercialProductsSummaryReader: productsReaderReturning(emptyProducts),
        clock,
      });

    await expect(makeUseCase(new PrestashopTimeoutError('timeout'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(makeUseCase(new PrestashopUnavailableError('down'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(makeUseCase(new PrestashopSchemaIncompatibleError('schema'))({ customerId: 1 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    });
  });

  it('is degraded when the products summary reader fails (distinct from the orders reader failing)', async () => {
    const ordersReader = ordersReaderReturning({
      totalOrders: 1,
      totalSpentTaxIncl: '100.000000',
      firstOrderAt: new Date('2026-07-20T12:00:00.000Z'),
      lastOrderAt: new Date('2026-07-20T12:00:00.000Z'),
      cancelledOrderCount: 0,
      refundedOrderCount: 0,
    });
    const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      commercialOrdersSummaryReader: ordersReader,
      commercialProductsSummaryReader: { findByCustomerId: vi.fn(async () => Promise.reject(new PrestashopUnavailableError('down'))) },
      clock,
    });

    const result = await getCustomerCommercialSummary({ customerId: 1 });

    expect(result).toEqual({ status: 'degraded', customerId: 1, reason: 'prestashop_unavailable' });
    expect(ordersReader.findByCustomerId).toHaveBeenCalledWith(1);
  });

  it('propagates unclassified errors instead of degrading', async () => {
    const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      commercialOrdersSummaryReader: { findByCustomerId: vi.fn(async () => Promise.reject(new Error('boom'))) },
      commercialProductsSummaryReader: productsReaderReturning(emptyProducts),
      clock,
    });

    await expect(getCustomerCommercialSummary({ customerId: 1 })).rejects.toThrow('boom');
  });
});
