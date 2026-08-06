import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type {
  CustomerProductBehaviorReader,
  CustomerProductBehaviorRecord,
  ProductBehaviorVariantRecord,
} from '../../src/application/customer-purchase-behavior/ports.js';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import type { Clock } from '../../src/application/customer-profile/ports.js';

const fixedClock: Clock = { now: () => new Date('2026-01-10T00:00:00.000Z') };

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

function behaviorReaderReturning(record: CustomerProductBehaviorRecord): CustomerProductBehaviorReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

const variantA: ProductBehaviorVariantRecord = {
  productId: 10,
  productAttributeId: 0,
  productName: 'Barra 20kg',
  productReference: 'BAR20',
  orderCount: 2,
  totalQuantityPurchased: 3,
  totalSpentTaxIncl: '60.000000',
  firstPurchasedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastPurchasedAt: new Date('2026-01-05T00:00:00.000Z'),
  productOrderCount: 2,
  productFirstPurchasedAt: new Date('2026-01-01T00:00:00.000Z'),
  productLastPurchasedAt: new Date('2026-01-05T00:00:00.000Z'),
  latestObservedProductName: 'Barra 20kg latest',
  latestObservedProductReference: 'BAR20-L',
};

const variantB: ProductBehaviorVariantRecord = {
  ...variantA,
  productId: 20,
  productAttributeId: 0,
  productName: 'Mancuerna 10kg',
  productReference: 'MAN10',
  orderCount: 1,
  totalQuantityPurchased: 1,
  totalSpentTaxIncl: '20.000000',
  productOrderCount: 1,
  latestObservedProductName: 'Mancuerna 10kg latest',
  latestObservedProductReference: 'MAN10-L',
};

const emptyBehavior: CustomerProductBehaviorRecord = {
  validOrderCount: 0,
  totalProductUnitsPurchased: 0,
  totalProductSpentTaxIncl: '0.000000',
  variants: [],
};

describe('getCustomerPurchaseBehavior', () => {
  it('short-circuits customer_not_found without querying PrestaShop', async () => {
    const reader = behaviorReaderReturning(emptyBehavior);
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(false),
      }),
      customerProductBehaviorReader: reader,
      clock: fixedClock,
    });

    const result = await getCustomerPurchaseBehavior({ customerId: 999, topProducts: 10, topVariants: 10 });

    expect(result).toEqual({ status: 'customer_not_found', customerId: 999 });
    expect(reader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('returns the documented available behavior and provenance', async () => {
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      customerProductBehaviorReader: behaviorReaderReturning({
        validOrderCount: 2,
        totalProductUnitsPurchased: 3,
        totalProductSpentTaxIncl: '60.000000',
        variants: [variantA],
      }),
      clock: fixedClock,
    });

    const result = await getCustomerPurchaseBehavior({ customerId: 1, topProducts: 10, topVariants: 10 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.customerId).toBe(1);
    expect(result.provenance.customerIdentity.externalCustomerId).toBe('1');
    expect(result.topProducts).toHaveLength(1);
  });

  it('is available with zero-value summary and empty top lists when the customer has no purchase history yet', async () => {
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      customerProductBehaviorReader: behaviorReaderReturning(emptyBehavior),
      clock: fixedClock,
    });

    const result = await getCustomerPurchaseBehavior({ customerId: 1, topProducts: 10, topVariants: 10 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.summary.validOrderCount).toBe(0);
    expect(result.summary.distinctProductCount).toBe(0);
    expect(result.topProducts).toEqual([]);
    expect(result.topVariants).toEqual([]);
  });

  it('limits topProducts and topVariants to the requested count without dropping the summary totals', async () => {
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      customerProductBehaviorReader: behaviorReaderReturning({
        validOrderCount: 3,
        totalProductUnitsPurchased: 4,
        totalProductSpentTaxIncl: '80.000000',
        variants: [variantA, variantB],
      }),
      clock: fixedClock,
    });

    const result = await getCustomerPurchaseBehavior({ customerId: 1, topProducts: 1, topVariants: 1 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.topProducts).toHaveLength(1);
    expect(result.topVariants).toHaveLength(1);
    expect(result.summary.distinctProductCount).toBe(2);
    expect(result.summary.distinctVariantCount).toBe(2);
  });

  it('maps known PrestaShop failures to degraded results', async () => {
    const makeUseCase = (error: Error) =>
      createGetCustomerPurchaseBehavior({
        resolveCustomerIdentity: createResolveCustomerIdentity({
          customerIdentityRepository: identityRepositoryReturning(true),
        }),
        customerProductBehaviorReader: { findByCustomerId: vi.fn(async () => Promise.reject(error)) },
        clock: fixedClock,
      });

    await expect(makeUseCase(new PrestashopTimeoutError('timeout'))({ customerId: 1, topProducts: 10, topVariants: 10 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(makeUseCase(new PrestashopUnavailableError('down'))({ customerId: 1, topProducts: 10, topVariants: 10 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(makeUseCase(new PrestashopSchemaIncompatibleError('schema'))({ customerId: 1, topProducts: 10, topVariants: 10 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    });
  });

  it('propagates unclassified errors instead of degrading', async () => {
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      customerProductBehaviorReader: { findByCustomerId: vi.fn(async () => Promise.reject(new Error('boom'))) },
      clock: fixedClock,
    });

    await expect(getCustomerPurchaseBehavior({ customerId: 1, topProducts: 10, topVariants: 10 })).rejects.toThrow('boom');
  });

  it('calls the behavior reader with the resolved identity customerId', async () => {
    const reader = behaviorReaderReturning(emptyBehavior);
    const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      customerProductBehaviorReader: reader,
      clock: fixedClock,
    });

    await getCustomerPurchaseBehavior({ customerId: 1, topProducts: 10, topVariants: 10 });

    expect(reader.findByCustomerId).toHaveBeenCalledWith({ prestashopCustomerId: 1 });
  });
});
