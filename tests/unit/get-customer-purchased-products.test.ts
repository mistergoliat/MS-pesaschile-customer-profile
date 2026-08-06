import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type {
  PurchasedProductRecord,
  PurchasedProductsPageRecord,
  PurchasedProductsReader,
} from '../../src/application/customer-purchased-products/ports.js';
import { createResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CustomerIdentityRepository } from '../../src/application/customer-identity/ports.js';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';

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

function purchasedProductsReaderReturning(page: PurchasedProductsPageRecord): PurchasedProductsReader {
  return { findByCustomerId: vi.fn(async () => page) };
}

const clock = { now: () => new Date('2026-08-05T00:00:00.000Z') };

const productRecord: PurchasedProductRecord = {
  productId: 123,
  productAttributeId: 0,
  productName: 'Disco olimpico 20kg',
  productReference: 'DISC20',
  totalQuantityPurchased: 5,
  orderCount: 2,
  firstPurchasedAt: new Date('2026-01-02T10:00:00.000Z'),
  lastPurchasedAt: new Date('2026-01-05T12:30:00.000Z'),
  totalSpentTaxIncl: '99990.123456',
  catalogStatus: 'linked',
};

const deletedProductRecord: PurchasedProductRecord = {
  ...productRecord,
  productId: 456,
  catalogStatus: 'deleted_or_unavailable',
};

describe('getCustomerPurchasedProducts', () => {
  it('is customer_not_found when identity is missing', async () => {
    const reader = purchasedProductsReaderReturning({ products: [], hasMore: false });
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(false),
      }),
      purchasedProductsReader: reader,
      clock,
    });

    const result = await getCustomerPurchasedProducts({ customerId: 999, limit: 20, offset: 0 });

    expect(result).toEqual({ status: 'customer_not_found', customerId: 999 });
    expect(reader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('returns available products with provenance', async () => {
    const reader = purchasedProductsReaderReturning({ products: [productRecord], hasMore: true });
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      purchasedProductsReader: reader,
      clock,
    });

    const result = await getCustomerPurchasedProducts({ customerId: 1, limit: 1, offset: 10 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.customerId).toBe(1);
    expect(result.pagination).toEqual({ limit: 1, offset: 10, returned: 1, hasMore: true });
    expect(result.provenance.customerIdentity.externalCustomerId).toBe('1');
  });

  it('is available with an empty page (not degraded) when the customer has no purchased products yet', async () => {
    const reader = purchasedProductsReaderReturning({ products: [], hasMore: false });
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      purchasedProductsReader: reader,
      clock,
    });

    const result = await getCustomerPurchasedProducts({ customerId: 1, limit: 20, offset: 0 });

    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('expected available');
    expect(result.products).toEqual([]);
    expect(result.pagination).toEqual({ limit: 20, offset: 0, returned: 0, hasMore: false });
  });

  it('preserves catalogStatus (linked vs deleted_or_unavailable) per product', async () => {
    const reader = purchasedProductsReaderReturning({ products: [productRecord, deletedProductRecord], hasMore: false });
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      purchasedProductsReader: reader,
      clock,
    });

    const result = await getCustomerPurchasedProducts({ customerId: 1, limit: 20, offset: 0 });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.products.map((product) => product.catalogStatus)).toEqual(['linked', 'deleted_or_unavailable']);
  });

  it('calls the reader with the resolved identity customerId, limit and offset', async () => {
    const reader = purchasedProductsReaderReturning({ products: [], hasMore: false });
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      purchasedProductsReader: reader,
      clock,
    });

    await getCustomerPurchasedProducts({ customerId: 1, limit: 5, offset: 15 });

    expect(reader.findByCustomerId).toHaveBeenCalledWith({ prestashopCustomerId: 1, limit: 5, offset: 15 });
  });

  it('maps known PrestaShop failures to degraded results', async () => {
    const buildUseCase = (error: Error) =>
      createGetCustomerPurchasedProducts({
        resolveCustomerIdentity: createResolveCustomerIdentity({
          customerIdentityRepository: identityRepositoryReturning(true),
        }),
        purchasedProductsReader: { findByCustomerId: vi.fn(async () => Promise.reject(error)) },
        clock,
      });

    await expect(buildUseCase(new PrestashopTimeoutError('timeout'))({ customerId: 1, limit: 20, offset: 0 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(buildUseCase(new PrestashopUnavailableError('down'))({ customerId: 1, limit: 20, offset: 0 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    });
    await expect(buildUseCase(new PrestashopSchemaIncompatibleError('schema'))({ customerId: 1, limit: 20, offset: 0 })).resolves.toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    });
  });

  it('propagates unclassified errors instead of degrading', async () => {
    const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
      resolveCustomerIdentity: createResolveCustomerIdentity({
        customerIdentityRepository: identityRepositoryReturning(true),
      }),
      purchasedProductsReader: { findByCustomerId: vi.fn(async () => Promise.reject(new Error('boom'))) },
      clock,
    });

    await expect(getCustomerPurchasedProducts({ customerId: 1, limit: 20, offset: 0 })).rejects.toThrow('boom');
  });
});
