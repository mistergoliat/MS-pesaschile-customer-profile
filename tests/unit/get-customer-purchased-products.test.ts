import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type {
  PurchasedProductRecord,
  PurchasedProductsPageRecord,
  PurchasedProductsReader,
} from '../../src/application/customer-purchased-products/ports.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { MasterCustomerReader } from '../../src/application/customer-profile/ports.js';
import type { MasterCustomerRecord } from '../../src/domain/customer-profile/index.js';

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

function masterReaderReturning(record: MasterCustomerRecord | null): MasterCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function purchasedProductsReaderReturning(page: PurchasedProductsPageRecord): PurchasedProductsReader {
  return { findByCustomerId: vi.fn(async () => page) };
}

function purchasedProductsReaderThrowing(error: unknown): PurchasedProductsReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw error;
    }),
  };
}

function unreachablePurchasedProductsReader(): PurchasedProductsReader {
  return purchasedProductsReaderThrowing(new Error('purchased products must not be queried'));
}

function buildUseCase(overrides: {
  masterCustomerReader?: MasterCustomerReader;
  purchasedProductsReader?: PurchasedProductsReader;
} = {}) {
  return createGetCustomerPurchasedProducts({
    masterCustomerReader: overrides.masterCustomerReader ?? masterReaderReturning(linkedMasterCustomer),
    purchasedProductsReader:
      overrides.purchasedProductsReader ?? purchasedProductsReaderReturning({ products: [], hasMore: false }),
  });
}

describe('getCustomerPurchasedProducts', () => {
  it('is customer_not_found and never queries PrestaShop when master_customer does not exist', async () => {
    const purchasedProductsReader = unreachablePurchasedProductsReader();
    const getCustomerPurchasedProducts = buildUseCase({
      masterCustomerReader: masterReaderReturning(null),
      purchasedProductsReader,
    });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '999', limit: 20, offset: 0 });

    expect(result).toEqual({ status: 'customer_not_found' });
    expect(purchasedProductsReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('is customer_not_linked and never queries PrestaShop when master_customer has no link', async () => {
    const purchasedProductsReader = unreachablePurchasedProductsReader();
    const getCustomerPurchasedProducts = buildUseCase({
      masterCustomerReader: masterReaderReturning(unlinkedMasterCustomer),
      purchasedProductsReader,
    });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 20, offset: 0 });

    expect(result).toEqual({ status: 'customer_not_linked' });
    expect(purchasedProductsReader.findByCustomerId).not.toHaveBeenCalled();
  });

  it('returns an empty available page for linked customers without valid purchases', async () => {
    const getCustomerPurchasedProducts = buildUseCase();

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 20, offset: 0 });

    expect(result).toEqual({
      status: 'available',
      products: [],
      pagination: {
        limit: 20,
        offset: 0,
        returned: 0,
        hasMore: false,
      },
    });
  });

  it('maps one product with ISO UTC dates and pagination', async () => {
    const getCustomerPurchasedProducts = buildUseCase({
      purchasedProductsReader: purchasedProductsReaderReturning({ products: [productRecord], hasMore: true }),
    });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 1, offset: 10 });

    expect(result).toEqual({
      status: 'available',
      products: [
        {
          productId: 123,
          productAttributeId: 0,
          productName: 'Disco olimpico 20kg',
          productReference: 'DISC20',
          totalQuantityPurchased: 5,
          orderCount: 2,
          firstPurchasedAt: '2026-01-02T10:00:00.000Z',
          lastPurchasedAt: '2026-01-05T12:30:00.000Z',
          totalSpentTaxIncl: '99990.123456',
          catalogStatus: 'linked',
        },
      ],
      pagination: {
        limit: 1,
        offset: 10,
        returned: 1,
        hasMore: true,
      },
    });
  });

  it('maps multiple products and calls the reader with the linked PrestaShop customer id', async () => {
    const purchasedProductsReader = purchasedProductsReaderReturning({
      products: [
        productRecord,
        {
          ...productRecord,
          productId: 124,
          productAttributeId: 3,
          productReference: null,
          catalogStatus: 'deleted_or_unavailable',
        },
      ],
      hasMore: false,
    });
    const getCustomerPurchasedProducts = buildUseCase({ purchasedProductsReader });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 20, offset: 5 });

    expect(result).toMatchObject({ status: 'available', pagination: { returned: 2, hasMore: false } });
    expect(purchasedProductsReader.findByCustomerId).toHaveBeenCalledWith({
      prestashopCustomerId: 555,
      limit: 20,
      offset: 5,
    });
  });

  it('is degraded / prestashop_timeout when the reader times out and returns no partial data', async () => {
    const getCustomerPurchasedProducts = buildUseCase({
      purchasedProductsReader: purchasedProductsReaderThrowing(new PrestashopTimeoutError('timed out')),
    });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 20, offset: 0 });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(result).not.toHaveProperty('products');
  });

  it('is degraded / prestashop_unavailable when the reader is unavailable', async () => {
    const getCustomerPurchasedProducts = buildUseCase({
      purchasedProductsReader: purchasedProductsReaderThrowing(new PrestashopUnavailableError('down')),
    });

    const result = await getCustomerPurchasedProducts({ masterCustomerId: '1', limit: 20, offset: 0 });

    expect(result).toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });
  });

  it('propagates unknown reader errors and contractual invalid dates', async () => {
    await expect(
      buildUseCase({
        purchasedProductsReader: purchasedProductsReaderThrowing(new Error('unknown')),
      })({ masterCustomerId: '1', limit: 20, offset: 0 }),
    ).rejects.toThrow('unknown');

    await expect(
      buildUseCase({
        purchasedProductsReader: purchasedProductsReaderReturning({
          products: [{ ...productRecord, lastPurchasedAt: new Date('not-a-date') }],
          hasMore: false,
        }),
      })({ masterCustomerId: '1', limit: 20, offset: 0 }),
    ).rejects.toThrow();
  });
});
