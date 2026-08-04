import { describe, expect, it } from 'vitest';
import {
  assertOnlineScopeReportHasNoPii,
  buildOnlineScopeVerdict,
  buildRfmDiagnosticsFromOrders,
  buildRfmSnapshotDataset,
  buildRfmSnapshotWindow,
  buildRfmSourceRowsFromOrders,
  buildSignalCrossMatrix,
  buildT08ScopeImpactSummary,
  classifySalesChannelOrder,
  classifySalesChannelOrders,
  compareScope,
  normalizeSalesChannelPolicy,
  onlineSalesScopePolicyVersion,
  summarizeAmbiguousOrders,
  summarizeClassifications,
  type SalesChannelOrder,
  type SalesChannelPolicy,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = '2026-08-03T00:00:00.000Z';

function policy(overrides: Partial<SalesChannelPolicy> = {}): SalesChannelPolicy {
  return {
    policyVersion: onlineSalesScopePolicyVersion,
    confirmedOnlineShopIds: [1],
    confirmedOnlineModules: ['webpay'],
    confirmedStoreShopIds: [2],
    confirmedStoreModules: ['pos'],
    confirmedSellerServiceProductIds: [999],
    confirmedGenericCustomerIds: [777],
    ambiguousOrderPolicy: 'quarantine',
    ...overrides,
  };
}

function order(overrides: Partial<SalesChannelOrder> = {}): SalesChannelOrder {
  return {
    orderId: 1,
    prestashopCustomerId: 10,
    shopId: 1,
    shopGroupId: 1,
    module: 'webpay',
    payment: 'Webpay',
    carrierId: 4,
    validOrderAt: '2026-07-01 10:00:00',
    grossOrderValueTaxIncl: '100.000000',
    lines: [
      {
        productId: 100,
        productAttributeId: 0,
        productReference: 'P-100',
        quantity: 1,
        unitPriceTaxIncl: '100.000000',
        totalPriceTaxIncl: '100.000000',
      },
    ],
    ...overrides,
  };
}

describe('online sales scope classification', () => {
  it('classifies confirmed online orders through stable shop and module ids', () => {
    expect(classifySalesChannelOrder(order(), policy())).toMatchObject({
      classifiedSalesChannel: 'online',
      classificationReason: 'ONLINE_CONFIRMED',
    });
  });

  it('classifies store signals and preserves deterministic reason priority', () => {
    expect(classifySalesChannelOrder(order({ shopId: 2 }), policy()).classificationReason).toBe('STORE_CONFIRMED_BY_SHOP');
    expect(classifySalesChannelOrder(order({ module: 'POS' }), policy()).classificationReason).toBe('STORE_CONFIRMED_BY_MODULE');
    expect(
      classifySalesChannelOrder(
        order({
          lines: [{ ...order().lines[0]!, productId: 999, unitPriceTaxIncl: '1.000000', totalPriceTaxIncl: '1.000000' }],
        }),
        policy(),
      ).classificationReason,
    ).toBe('STORE_CONFIRMED_BY_SELLER_SERVICE');
    expect(classifySalesChannelOrder(order({ prestashopCustomerId: 777 }), policy()).classificationReason).toBe(
      'STORE_CONFIRMED_BY_GENERIC_CUSTOMER',
    );
    expect(
      classifySalesChannelOrder(
        order({
          shopId: 2,
          module: 'pos',
          prestashopCustomerId: 777,
          lines: [{ ...order().lines[0]!, productId: 999 }],
        }),
        policy(),
      ).classificationReason,
    ).toBe('STORE_CONFIRMED_BY_SHOP');
  });

  it('marks unknown modalities as ambiguous when online allowlist is explicit', () => {
    expect(classifySalesChannelOrder(order({ module: 'new_gateway' }), policy())).toMatchObject({
      classifiedSalesChannel: 'ambiguous',
      classificationReason: 'AMBIGUOUS',
    });
  });

  it('supports empty diagnostic configuration and normalizes duplicate ids/modules', () => {
    const normalized = normalizeSalesChannelPolicy({
      policyVersion: onlineSalesScopePolicyVersion,
      confirmedOnlineShopIds: [],
      confirmedOnlineModules: [],
      confirmedStoreShopIds: [2, 2],
      confirmedStoreModules: ['POS', ' pos '],
      confirmedSellerServiceProductIds: [999, 999],
      confirmedGenericCustomerIds: [777, 777],
      ambiguousOrderPolicy: 'fail_open',
    });

    expect(normalized.confirmedStoreShopIds).toEqual([2]);
    expect(normalized.confirmedStoreModules).toEqual(['pos']);
    expect(normalized.confirmedSellerServiceProductIds).toEqual([999]);
    expect(classifySalesChannelOrder(order({ module: 'new_gateway' }), { ...normalized, confirmedOnlineModules: [] })).toMatchObject({
      classifiedSalesChannel: 'online',
      classificationReason: 'ONLINE_CONFIRMED',
    });
    expect(() => normalizeSalesChannelPolicy({ ...normalized, policyVersion: '' })).toThrow(/policyVersion/);
  });
});

describe('online sales scope comparison', () => {
  function fixtureOrders(): readonly SalesChannelOrder[] {
    return [
      order({ orderId: 1, prestashopCustomerId: 1, grossOrderValueTaxIncl: '100.000000' }),
      order({ orderId: 2, prestashopCustomerId: 2, module: 'pos', grossOrderValueTaxIncl: '200.000000' }),
      order({
        orderId: 3,
        prestashopCustomerId: 777,
        grossOrderValueTaxIncl: '1.000000',
        lines: [{ ...order().lines[0]!, productId: 999, unitPriceTaxIncl: '1.000000', totalPriceTaxIncl: '1.000000' }],
      }),
      order({ orderId: 4, prestashopCustomerId: 3, module: 'new_gateway', grossOrderValueTaxIncl: '300.000000' }),
    ];
  }

  it('computes before/after order, customer and monetary impact with reason aggregates', () => {
    const classified = classifySalesChannelOrders(fixtureOrders(), policy());
    const comparison = compareScope(classified);
    const summary = summarizeClassifications(classified);

    expect(comparison).toMatchObject({
      includedOrderCount: 1,
      excludedOrderCount: 3,
      includedCustomerCount: 1,
      ordersClassifiedOnline: 1,
      ordersClassifiedStore: 2,
      ordersAmbiguous: 1,
    });
    expect(comparison.includedGrossAmount).toBe('100.000000');
    expect(comparison.excludedGrossAmount).toBe('501.000000');
    expect(summary.byReason.STORE_CONFIRMED_BY_MODULE.orderCount).toBe(1);
    expect(summary.byReason.STORE_CONFIRMED_BY_SELLER_SERVICE.orderCount).toBe(1);
    expect(summarizeAmbiguousOrders(classified, policy()).ambiguousOrderCount).toBe(1);
  });

  it('builds seller-service by generic-customer matrix without PII', () => {
    const matrix = buildSignalCrossMatrix(fixtureOrders(), policy());

    expect(matrix.sellerServiceAndGenericCustomer.orderCount).toBe(1);
    expect(matrix.sellerServiceAndNonGenericCustomer.orderCount).toBe(0);
    expect(matrix.noSellerServiceAndNonGenericCustomer.orderCount).toBe(3);
    expect(JSON.stringify(matrix)).not.toMatch(/email|phone|rut|address/i);
  });

  it('recalculates RFM source rows and removes a configured outlier without frequency thresholds', () => {
    const outlierOrders = Array.from({ length: 5 }, (_, index) =>
      order({
        orderId: 100 + index,
        prestashopCustomerId: 777,
        grossOrderValueTaxIncl: '1.000000',
        lines: [{ ...order().lines[0]!, productId: 999, unitPriceTaxIncl: '1.000000', totalPriceTaxIncl: '1.000000' }],
      }),
    );
    const orders = [order({ orderId: 1, prestashopCustomerId: 1, grossOrderValueTaxIncl: '100.000000' }), ...outlierOrders];
    const onlineOrders = classifySalesChannelOrders(orders, policy())
      .filter((entry) => entry.classifiedSalesChannel === 'online');

    const beforeRows = buildRfmSourceRowsFromOrders(referenceTime, orders);
    const afterRows = buildRfmSourceRowsFromOrders(referenceTime, onlineOrders);
    expect(beforeRows.find((entry) => entry.prestashopCustomerId === 777)?.frequencyOrders).toBe(5);
    expect(afterRows.find((entry) => entry.prestashopCustomerId === 777)).toBeUndefined();

    const window = buildRfmSnapshotWindow(referenceTime);
    const before = buildRfmSnapshotDataset({
      ...window,
      generatedAt: referenceTime,
      calculationVersion: 'rfm-v1',
      sourceRows: beforeRows,
      diagnostics: buildRfmDiagnosticsFromOrders(referenceTime, orders),
    });
    const after = buildRfmSnapshotDataset({
      ...window,
      generatedAt: referenceTime,
      calculationVersion: 'rfm-v1',
      sourceRows: afterRows,
      diagnostics: buildRfmDiagnosticsFromOrders(referenceTime, onlineOrders),
    });

    expect(before.manifest.frequencyDistribution.max).toBe(5);
    expect(after.manifest.frequencyDistribution.max).toBe(1);
  });

  it('summarizes T08 seller service impact and online scope verdict conditions', () => {
    const orders = fixtureOrders();
    const onlineOrders = classifySalesChannelOrders(orders, policy()).filter((entry) => entry.classifiedSalesChannel === 'online');
    const t08 = buildT08ScopeImpactSummary(orders, onlineOrders, policy());
    const verdict = buildOnlineScopeVerdict(classifySalesChannelOrders(orders, policy()), policy());

    expect(t08.sellerServiceLineCount).toBe(1);
    expect(t08.sellerServiceGrossAmount).toBe('1.000000');
    expect(t08.customersWithPurchasedProductsAfter).toBe(1);
    expect(verdict.conditions).toContain('T08_REQUIRES_SCOPE_UPDATE');
    expect(verdict.conditions).toContain('RFM_REQUIRES_RECALCULATION');
  });
});

describe('online sales scope safety', () => {
  it('blocks PII-shaped report fields and keeps public reports aggregate-only', () => {
    expect(() => assertOnlineScopeReportHasNoPii({ note: 'ana@example.com' })).toThrow(/PII-shaped/);
    expect(() => assertOnlineScopeReportHasNoPii({ firstName: 'Ana' })).toThrow(/forbidden field/);
    const publicReport = {
      shopAlias: 'shop_1',
      orderCount: 10,
      grossOrderValueTaxIncl: '100.000000',
      checksum: 'a'.repeat(64),
    };
    expect(() => assertOnlineScopeReportHasNoPii(publicReport)).not.toThrow();
    expect(JSON.stringify(publicReport)).not.toMatch(/customer|orderId|email|phone|rut/i);
  });
});
