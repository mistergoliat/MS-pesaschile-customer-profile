import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type {
  CustomerProductBehaviorReader,
  CustomerProductBehaviorRecord,
  ProductBehaviorVariantRecord,
} from '../../src/application/customer-purchase-behavior/ports.js';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { Clock, MasterCustomerReader } from '../../src/application/customer-profile/ports.js';
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

const fixedClock: Clock = {
  now: () => new Date('2026-01-10T00:00:00.000Z'),
};

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
  productId: 20,
  productAttributeId: 1,
  productName: 'Disco rojo',
  productReference: null,
  orderCount: 1,
  totalQuantityPurchased: 2,
  totalSpentTaxIncl: '40.000000',
  firstPurchasedAt: new Date('2026-01-02T00:00:00.000Z'),
  lastPurchasedAt: new Date('2026-01-02T00:00:00.000Z'),
  productOrderCount: 1,
  productFirstPurchasedAt: new Date('2026-01-02T00:00:00.000Z'),
  productLastPurchasedAt: new Date('2026-01-02T00:00:00.000Z'),
  latestObservedProductName: 'Disco rojo',
  latestObservedProductReference: null,
};

const variantCSharedOrderDifferentVariant: ProductBehaviorVariantRecord = {
  ...variantB,
  productAttributeId: 2,
  productName: 'Disco azul',
  orderCount: 1,
  totalQuantityPurchased: 1,
  totalSpentTaxIncl: '10.000000',
  lastPurchasedAt: new Date('2026-01-04T00:00:00.000Z'),
  productOrderCount: 1,
  productLastPurchasedAt: new Date('2026-01-04T00:00:00.000Z'),
  latestObservedProductName: 'Disco azul',
};

function masterReaderReturning(record: MasterCustomerRecord | null): MasterCustomerReader {
  return { findById: vi.fn(async () => record) };
}

function behaviorReaderReturning(record: CustomerProductBehaviorRecord): CustomerProductBehaviorReader {
  return { findByCustomerId: vi.fn(async () => record) };
}

function behaviorReaderThrowing(error: unknown): CustomerProductBehaviorReader {
  return {
    findByCustomerId: vi.fn(async () => {
      throw error;
    }),
  };
}

function buildUseCase(overrides: {
  masterCustomerReader?: MasterCustomerReader;
  customerProductBehaviorReader?: CustomerProductBehaviorReader;
} = {}) {
  return createGetCustomerPurchaseBehavior({
    masterCustomerReader: overrides.masterCustomerReader ?? masterReaderReturning(linkedMasterCustomer),
    customerProductBehaviorReader:
      overrides.customerProductBehaviorReader ??
      behaviorReaderReturning({
        validOrderCount: 0,
        totalProductUnitsPurchased: 0,
        totalProductSpentTaxIncl: '0.000000',
        variants: [],
      }),
    clock: fixedClock,
  });
}

describe('getCustomerPurchaseBehavior', () => {
  it('short-circuits customer_not_found and customer_not_linked without querying PrestaShop', async () => {
    const reader = behaviorReaderThrowing(new Error('must not be called'));

    await expect(
      buildUseCase({ masterCustomerReader: masterReaderReturning(null), customerProductBehaviorReader: reader })({
        masterCustomerId: '999',
        topProducts: 10,
        topVariants: 10,
      }),
    ).resolves.toEqual({ status: 'customer_not_found' });
    expect(reader.findByCustomerId).not.toHaveBeenCalled();

    await expect(
      buildUseCase({
        masterCustomerReader: masterReaderReturning({ ...linkedMasterCustomer, prestashopCustomerId: null }),
        customerProductBehaviorReader: reader,
      })({ masterCustomerId: '1', topProducts: 10, topVariants: 10 }),
    ).resolves.toEqual({ status: 'customer_not_linked' });
  });

  it('returns the documented empty behavior for linked customers without valid purchases', async () => {
    await expect(buildUseCase()({ masterCustomerId: '1', topProducts: 10, topVariants: 10 })).resolves.toEqual({
      status: 'available',
      currencyIsoCode: 'CLP',
      calculatedAt: '2026-01-10T00:00:00.000Z',
      summary: {
        validOrderCount: 0,
        distinctProductCount: 0,
        distinctVariantCount: 0,
        repeatedProductCount: 0,
        repeatedVariantCount: 0,
        repeatProductRate: '0.000000',
        repeatVariantRate: '0.000000',
        repeatedVariantSpendShare: '0.000000',
        productSpendConcentration: emptyConcentration(),
        variantSpendConcentration: emptyConcentration(),
      },
      topProducts: [],
      topVariants: [],
    });
  });

  it('computes shares, repetition, concentration, diversity and recency from the full universe', async () => {
    const getCustomerPurchaseBehavior = buildUseCase({
      customerProductBehaviorReader: behaviorReaderReturning({
        validOrderCount: 3,
        totalProductUnitsPurchased: 5,
        totalProductSpentTaxIncl: '100.000000',
        variants: [variantA, variantB],
      }),
    });

    const result = await getCustomerPurchaseBehavior({ masterCustomerId: '1', topProducts: 1, topVariants: 1 });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.summary).toMatchObject({
      distinctProductCount: 2,
      distinctVariantCount: 2,
      repeatedProductCount: 1,
      repeatedVariantCount: 1,
      repeatProductRate: '0.500000',
      repeatVariantRate: '0.500000',
      repeatedVariantSpendShare: '0.600000',
      productSpendConcentration: {
        top1Share: '0.600000',
        top3Share: '1.000000',
        hhi: '0.520000',
        effectiveDiversity: '1.923077',
      },
    });
    expect(result.topProducts).toHaveLength(1);
    expect(result.topVariants).toHaveLength(1);
    expect(result.topVariants[0]).toMatchObject({
      productId: 10,
      productAttributeId: 0,
      spendShare: '0.600000',
      orderShare: '0.666667',
      quantityShare: '0.600000',
      daysSinceLastPurchase: 5,
      isRepeated: true,
    });
  });

  it('uses product SQL orderCount for rollup instead of summing variant order counts', async () => {
    const result = await buildUseCase({
      customerProductBehaviorReader: behaviorReaderReturning({
        validOrderCount: 1,
        totalProductUnitsPurchased: 3,
        totalProductSpentTaxIncl: '50.000000',
        variants: [variantB, variantCSharedOrderDifferentVariant],
      }),
    })({ masterCustomerId: '1', topProducts: 10, topVariants: 10 });

    if (result.status !== 'available') throw new Error('expected available');
    expect(result.summary.repeatedProductCount).toBe(0);
    expect(result.summary.repeatedVariantCount).toBe(0);
    expect(result.topProducts[0]).toMatchObject({
      productId: 20,
      variantCountPurchased: 2,
      orderCount: 1,
      totalQuantityPurchased: 3,
      totalSpentTaxIncl: '50.000000',
      latestObservedProductName: 'Disco azul',
    });
  });

  it('maps known PrestaShop errors to degraded and propagates unknown or contractual invalid data', async () => {
    await expect(
      buildUseCase({ customerProductBehaviorReader: behaviorReaderThrowing(new PrestashopTimeoutError('timeout')) })({
        masterCustomerId: '1',
        topProducts: 10,
        topVariants: 10,
      }),
    ).resolves.toEqual({ status: 'degraded', reason: 'prestashop_timeout' });

    await expect(
      buildUseCase({ customerProductBehaviorReader: behaviorReaderThrowing(new PrestashopUnavailableError('down')) })({
        masterCustomerId: '1',
        topProducts: 10,
        topVariants: 10,
      }),
    ).resolves.toEqual({ status: 'degraded', reason: 'prestashop_unavailable' });

    await expect(
      buildUseCase({ customerProductBehaviorReader: behaviorReaderThrowing(new Error('unknown')) })({
        masterCustomerId: '1',
        topProducts: 10,
        topVariants: 10,
      }),
    ).rejects.toThrow('unknown');

    await expect(
      buildUseCase({
        customerProductBehaviorReader: behaviorReaderReturning({
          validOrderCount: 2,
          totalProductUnitsPurchased: 3,
          totalProductSpentTaxIncl: '60.000000',
          variants: [{ ...variantA, lastPurchasedAt: new Date('2026-02-01T00:00:00.000Z') }],
        }),
      })({ masterCustomerId: '1', topProducts: 10, topVariants: 10 }),
    ).rejects.toThrow('future');
  });
});

function emptyConcentration() {
  return {
    top1Share: '0.000000',
    top3Share: '0.000000',
    hhi: '0.000000',
    effectiveDiversity: '0.000000',
  };
}
