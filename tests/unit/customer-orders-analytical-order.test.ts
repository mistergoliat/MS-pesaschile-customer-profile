import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyticalOrderContractVersion,
  assertAnalyticalOrderReportHasNoPii,
  buildAnalyticalOrder,
  buildCanonicalAnalyticalOrderVerdict,
  defaultAnalyticalOrderPolicies,
  summarizeAnalyticalOrders,
  type RawPrestaShopOrder,
  type RawPrestaShopOrderDiscount,
  type RawPrestaShopOrderLine,
} from '../../src/domain/customer-orders/index.js';

describe('CP-R1-T11A3.3 canonical analytical order contract', () => {
  it('builds an included online candidate order with product discount allocation', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder(),
      lines: [
        makeLine({ orderDetailId: 1, productId: 10, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000' }),
        makeLine({ orderDetailId: 2, productId: 11, totalPriceTaxIncl: '200.000000', totalPriceTaxExcl: '160.000000' }),
      ],
      discounts: [discount({ classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '30.000000', valueTaxExcl: '24.000000' })],
    });

    expect(order.inclusionStatus).toBe('INCLUDED');
    expect(order.salesChannel).toBe('ONLINE_CANDIDATE');
    expect(order.identity).toBe('INDIVIDUAL_CUSTOMER_CANDIDATE');
    expect(order.grossEligibleProductValueTaxIncl).toBe('300.000000');
    expect(order.productApplicableOrderDiscountTaxIncl).toBe('30.000000');
    expect(order.netEligibleProductValueTaxIncl).toBe('270.000000');
    expect(order.lines.map((line) => line.allocatedOrderDiscountTaxIncl)).toEqual(['10.000000', '20.000000']);
    expect(order.reconciliation.status).toBe('RECONCILED');
  });

  it('excludes generic and technical accounts from customer analysis', () => {
    const generic = buildAnalyticalOrder(baseInput({ prestashopCustomerId: 99 }), defaultAnalyticalOrderPolicies({ genericCustomerIds: [99] }));
    const technical = buildAnalyticalOrder(baseInput({ prestashopCustomerId: 100 }), defaultAnalyticalOrderPolicies({ technicalCustomerIds: [100] }));

    expect(generic.identity).toBe('GENERIC_CUSTOMER');
    expect(generic.inclusionStatus).toBe('EXCLUDED');
    expect(generic.exclusionReasons).toContain('GENERIC_CUSTOMER');
    expect(technical.identity).toBe('TECHNICAL_ACCOUNT');
    expect(technical.exclusionReasons).toContain('TECHNICAL_CUSTOMER');
  });

  it('represents store, POS and ambiguous channel signals without name-based rules', () => {
    const store = buildAnalyticalOrder(baseInput({ shopId: 2 }), defaultAnalyticalOrderPolicies({ storeShopIds: [2] }));
    const pos = buildAnalyticalOrder(baseInput({ module: 'prestapos' }), defaultAnalyticalOrderPolicies({ posModules: ['prestapos'] }));
    const ambiguous = buildAnalyticalOrder(baseInput({ module: null }), defaultAnalyticalOrderPolicies({ storeModules: ['prestapos'], ambiguousOrderPolicy: 'QUARANTINE' }));

    expect(store.salesChannel).toBe('STORE_CONFIRMED');
    expect(store.exclusionReasons).toContain('STORE_SHOP');
    expect(pos.salesChannel).toBe('POS_CONFIRMED');
    expect(pos.exclusionReasons).toContain('POS_MODULE');
    expect(ambiguous.salesChannel).toBe('AMBIGUOUS');
    expect(ambiguous.inclusionStatus).toBe('QUARANTINED');
  });

  it('carries multiple exclusion reasons when order and line policies overlap', () => {
    const order = buildAnalyticalOrder(
      {
        order: makeOrder({ prestashopCustomerId: 99 }),
        lines: [makeLine({ productId: 444 })],
        discounts: [],
      },
      defaultAnalyticalOrderPolicies({ genericCustomerIds: [99], sellerServiceProductIds: [444] }),
    );

    expect(order.exclusionReasons).toEqual(expect.arrayContaining(['GENERIC_CUSTOMER', 'SELLER_SERVICE_MARKER', 'NO_ELIGIBLE_LINES']));
    expect(order.lines[0]?.classification).toBe('SELLER_SERVICE');
    expect(order.lines[0]?.inclusionStatus).toBe('EXCLUDED');
  });

  it('classifies commercial products, services, seller service, logistics artifacts and unresolved lines', () => {
    const order = buildAnalyticalOrder(
      {
        order: makeOrder({ totalProductsTaxIncl: '500.000000', totalProductsTaxExcl: '400.000000', totalPaidTaxIncl: '500.000000', totalPaidTaxExcl: '400.000000' }),
        lines: [
          makeLine({ orderDetailId: 1, productId: 10, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000' }),
          makeLine({ orderDetailId: 2, productId: 20, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000' }),
          makeLine({ orderDetailId: 3, productId: 30, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000' }),
          makeLine({ orderDetailId: 4, productId: 40, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000' }),
          makeLine({ orderDetailId: 5, productId: 50, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '80.000000', productActive: false }),
        ],
        discounts: [],
      },
      defaultAnalyticalOrderPolicies({
        commercialServiceProductIds: [20],
        sellerServiceProductIds: [30],
        logisticsArtifactProductIds: [40],
        unresolvedProductIds: [50],
      }),
    );

    expect(order.lines.map((line) => line.classification)).toEqual([
      'COMMERCIAL_PRODUCT',
      'COMMERCIAL_SERVICE',
      'SELLER_SERVICE',
      'LOGISTICS_ARTIFACT',
      'UNRESOLVED',
    ]);
    expect(order.lines[4]?.productActive).toBe(false);
    expect(order.unresolvedLineValueTaxIncl).toBe('100.000000');
    expect(order.excludedTechnicalValueTaxIncl).toBe('200.000000');
  });

  it('uses order_detail persisted values and does not let Catalog diagnostics overwrite price', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder({ totalProductsTaxIncl: '80.000000', totalProductsTaxExcl: '64.000000', totalPaidTaxIncl: '80.000000', totalPaidTaxExcl: '64.000000' }),
      lines: [makeLine({ unitPriceTaxIncl: '80.000000', unitPriceTaxExcl: '64.000000', totalPriceTaxIncl: '80.000000', totalPriceTaxExcl: '64.000000' })],
      discounts: [],
      historicalCatalogDiagnostics: [{
        orderDetailId: 1,
        status: 'MISMATCH',
        reconstructedUnitPriceTaxIncl: '100.000000',
        deltaTaxIncl: '-20.000000',
      }],
    });

    expect(order.lines[0]?.historicalPriceSource).toBe('ORDER_DETAIL_PERSISTED');
    expect(order.lines[0]?.unitValueTaxIncl).toBe('80.000000');
    expect(order.lines[0]?.grossLineValueTaxIncl).toBe('80.000000');
    expect(order.lines[0]?.historicalCatalogDiagnostic?.reconstructedUnitPriceTaxIncl).toBe('100.000000');
  });

  it('does not allocate free shipping to products', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '10.000000', totalDiscountsTaxExcl: '8.000000', totalShippingTaxIncl: '10.000000', totalShippingTaxExcl: '8.000000' }),
      lines: [makeLine()],
      discounts: [discount({ classification: 'FREE_SHIPPING', valueTaxIncl: '10.000000', valueTaxExcl: '8.000000' })],
    });

    expect(order.shippingDiscountTaxIncl).toBe('10.000000');
    expect(order.productApplicableOrderDiscountTaxIncl).toBe('0.000000');
    expect(order.lines[0]?.allocatedOrderDiscountTaxIncl).toBe('0.000000');
    expect(order.netEligibleProductValueTaxIncl).toBe('300.000000');
  });

  it('keeps mixed and unknown discounts explicit instead of silently distributing them', () => {
    const mixed = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '30.000000', totalDiscountsTaxExcl: '24.000000' }),
      lines: [makeLine()],
      discounts: [discount({ classification: 'MIXED_PRODUCT_AND_SHIPPING', valueTaxIncl: '30.000000', valueTaxExcl: '24.000000' })],
    });
    const unknown = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '30.000000', totalDiscountsTaxExcl: '24.000000' }),
      lines: [makeLine()],
      discounts: [discount({ classification: 'UNKNOWN', valueTaxIncl: '30.000000', valueTaxExcl: '24.000000' })],
    });

    expect(mixed.unresolvedDiscountTaxIncl).toBe('30.000000');
    expect(mixed.reconciliation.status).toBe('PARTIAL');
    expect(unknown.unresolvedDiscountTaxIncl).toBe('30.000000');
    expect(unknown.reconciliation.status).toBe('UNRESOLVED');
  });

  it('distributes only confirmed product value from mixed rules', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '30.000000', totalDiscountsTaxExcl: '24.000000' }),
      lines: [makeLine()],
      discounts: [discount({
        classification: 'MIXED_PRODUCT_AND_SHIPPING',
        valueTaxIncl: '30.000000',
        valueTaxExcl: '24.000000',
        productApplicableValueTaxIncl: '12.000000',
        productApplicableValueTaxExcl: '9.600000',
        shippingDiscountTaxIncl: '18.000000',
        shippingDiscountTaxExcl: '14.400000',
      })],
    });

    expect(order.productApplicableOrderDiscountTaxIncl).toBe('12.000000');
    expect(order.shippingDiscountTaxIncl).toBe('18.000000');
    expect(order.unresolvedDiscountTaxIncl).toBe('0.000000');
    expect(order.netEligibleProductValueTaxIncl).toBe('288.000000');
  });

  it('handles multiple rules, full product discount and discount greater than eligible subtotal deterministically', () => {
    const full = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '300.000000', totalDiscountsTaxExcl: '240.000000', totalPaidTaxIncl: '0.000000', totalPaidTaxExcl: '0.000000' }),
      lines: [makeLine()],
      discounts: [discount({ classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '300.000000', valueTaxExcl: '240.000000' })],
    });
    const greater = buildAnalyticalOrder({
      order: makeOrder({ totalDiscountsTaxIncl: '400.000000', totalDiscountsTaxExcl: '320.000000', totalPaidTaxIncl: '-100.000000', totalPaidTaxExcl: '-80.000000' }),
      lines: [makeLine()],
      discounts: [
        discount({ sourceOrderCartRuleId: 1, classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '250.000000', valueTaxExcl: '200.000000' }),
        discount({ sourceOrderCartRuleId: 2, classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '150.000000', valueTaxExcl: '120.000000' }),
      ],
    });

    expect(full.netEligibleProductValueTaxIncl).toBe('0.000000');
    expect(greater.lines[0]?.allocatedOrderDiscountTaxIncl).toBe('400.000000');
    expect(greater.netEligibleProductValueTaxIncl).toBe('0.000000');
    expect(Number(greater.lines[0]?.netLineValueTaxIncl)).toBeGreaterThanOrEqual(0);
  });

  it('does not allocate product discounts when eligible subtotal is zero', () => {
    const order = buildAnalyticalOrder(
      {
        order: makeOrder({ totalProductsTaxIncl: '300.000000', totalProductsTaxExcl: '240.000000', totalDiscountsTaxIncl: '30.000000', totalDiscountsTaxExcl: '24.000000' }),
        lines: [makeLine({ productId: 444 })],
        discounts: [discount({ classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '30.000000', valueTaxExcl: '24.000000' })],
      },
      defaultAnalyticalOrderPolicies({ sellerServiceProductIds: [444] }),
    );

    expect(order.grossEligibleProductValueTaxIncl).toBe('0.000000');
    expect(order.lines[0]?.allocatedOrderDiscountTaxIncl).toBe('0.000000');
    expect(order.unresolvedDiscountTaxIncl).toBe('30.000000');
  });

  it('uses largest remainder allocation with deterministic residue', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder({
        totalProductsTaxIncl: '2.000000',
        totalProductsTaxExcl: '2.000000',
        totalDiscountsTaxIncl: '0.000001',
        totalDiscountsTaxExcl: '0.000001',
        totalPaidTaxIncl: '1.999999',
        totalPaidTaxExcl: '1.999999',
      }),
      lines: [
        makeLine({ orderDetailId: 1, productId: 10, unitPriceTaxIncl: '1.000000', unitPriceTaxExcl: '1.000000', totalPriceTaxIncl: '1.000000', totalPriceTaxExcl: '1.000000' }),
        makeLine({ orderDetailId: 2, productId: 11, unitPriceTaxIncl: '1.000000', unitPriceTaxExcl: '1.000000', totalPriceTaxIncl: '1.000000', totalPriceTaxExcl: '1.000000' }),
      ],
      discounts: [discount({ classification: 'PRODUCT_DISCOUNT', valueTaxIncl: '0.000001', valueTaxExcl: '0.000001' })],
    });

    expect(order.lines.map((line) => line.allocatedOrderDiscountTaxIncl)).toEqual(['0.000001', '0.000000']);
    expect(order.netEligibleProductValueTaxIncl).toBe('1.999999');
  });

  it('keeps shipping outside Monetary even when total paid includes it', () => {
    const order = buildAnalyticalOrder({
      order: makeOrder({
        totalDiscountsTaxIncl: '0.000000',
        totalDiscountsTaxExcl: '0.000000',
        totalShippingTaxIncl: '50.000000',
        totalShippingTaxExcl: '40.000000',
        totalPaidTaxIncl: '350.000000',
        totalPaidTaxExcl: '280.000000',
      }),
      lines: [makeLine()],
      discounts: [],
    });

    expect(order.shippingValueTaxIncl).toBe('50.000000');
    expect(order.netEligibleProductValueTaxIncl).toBe('300.000000');
    expect(order.reconciliation.totalPaidTaxInclDelta).toBe('0.000000');
  });

  it('classifies reconciliation as rounding, partial or unresolved', () => {
    const rounding = buildAnalyticalOrder({
      order: makeOrder({
        totalDiscountsTaxIncl: '0.000000',
        totalDiscountsTaxExcl: '0.000000',
        totalPaidTaxIncl: '350.500000',
        totalPaidTaxExcl: '280.500000',
        totalShippingTaxIncl: '50.000000',
        totalShippingTaxExcl: '40.000000',
      }),
      lines: [makeLine()],
      discounts: [],
    });
    const partial = buildAnalyticalOrder({
      order: makeOrder({
        totalDiscountsTaxIncl: '0.000000',
        totalDiscountsTaxExcl: '0.000000',
        totalPaidTaxIncl: '360.000000',
        totalPaidTaxExcl: '290.000000',
        totalShippingTaxIncl: '50.000000',
        totalShippingTaxExcl: '40.000000',
      }),
      lines: [makeLine()],
      discounts: [],
    });
    const unresolved = buildAnalyticalOrder({
      order: makeOrder(),
      lines: [makeLine({ productId: 777 })],
      discounts: [],
    }, defaultAnalyticalOrderPolicies({ unresolvedProductIds: [777] }));

    expect(rounding.reconciliation.status).toBe('ROUNDING_ONLY');
    expect(partial.reconciliation.status).toBe('PARTIAL');
    expect(unresolved.reconciliation.status).toBe('UNRESOLVED');
  });

  it('requires all policy versions and produces a deterministic contract version', () => {
    const order = buildAnalyticalOrder(baseInput());
    const verdict = buildCanonicalAnalyticalOrderVerdict([order]);
    const summary = summarizeAnalyticalOrders([order]);

    expect(order.policyVersions.analyticalOrderContractVersion).toBe(analyticalOrderContractVersion);
    expect(Object.values(order.policyVersions).every((value) => value.length > 0)).toBe(true);
    expect(verdict.conditions).toEqual(expect.arrayContaining([
      'ORDER_DETAIL_IS_HISTORICAL_AUTHORITY',
      'USE_TAX_INCL_AS_PRIMARY',
      'KEEP_TAX_EXCL_AS_AUXILIARY',
      'ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY',
      'DO_NOT_ALLOCATE_FREE_SHIPPING',
    ]));
    expect(summary.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('guards report outputs against PII-shaped content', () => {
    expect(() => assertAnalyticalOrderReportHasNoPii({ orderId: 1, status: 'OK' })).not.toThrow();
    expect(() => assertAnalyticalOrderReportHasNoPii({ email: 'person@example.com' })).toThrow(/forbidden field/);
  });

  it('keeps implementation free from DB writes, NOW, manual tax constants and product-name authority', () => {
    const domain = readFileSync('src/domain/customer-orders/analytical-order.ts', 'utf8');
    const script = readFileSync('scripts/snapshots/rfm-canonical-analytical-order.ts', 'utf8');
    const combined = `${domain}\n${script}`;

    expect(combined).not.toMatch(/\bNOW\s*\(/i);
    expect(combined).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
    expect(combined).not.toContain('1.19');
    expect(combined).not.toMatch(/product[_\s-]?name/i);
  });
});

function baseInput(orderOverrides: Partial<RawPrestaShopOrder> = {}) {
  return {
    order: makeOrder(orderOverrides),
    lines: [makeLine()],
    discounts: [] as readonly RawPrestaShopOrderDiscount[],
  };
}

function makeOrder(overrides: Partial<RawPrestaShopOrder> = {}): RawPrestaShopOrder {
  return {
    orderId: 1,
    prestashopCustomerId: 123,
    orderDate: '2026-07-01 00:00:00',
    shopId: 1,
    currencyId: 1,
    module: 'webpay',
    totalProductsTaxIncl: '300.000000',
    totalProductsTaxExcl: '240.000000',
    totalDiscountsTaxIncl: '30.000000',
    totalDiscountsTaxExcl: '24.000000',
    totalShippingTaxIncl: '10.000000',
    totalShippingTaxExcl: '8.000000',
    totalWrappingTaxIncl: '0.000000',
    totalWrappingTaxExcl: '0.000000',
    totalPaidTaxIncl: '280.000000',
    totalPaidTaxExcl: '224.000000',
    ...overrides,
  };
}

function makeLine(overrides: Partial<RawPrestaShopOrderLine> = {}): RawPrestaShopOrderLine {
  return {
    orderDetailId: 1,
    productId: 10,
    productAttributeId: 0,
    quantity: 1,
    productActive: true,
    unitPriceTaxIncl: '300.000000',
    unitPriceTaxExcl: '240.000000',
    totalPriceTaxIncl: '300.000000',
    totalPriceTaxExcl: '240.000000',
    ...overrides,
  };
}

function discount(overrides: Partial<RawPrestaShopOrderDiscount> = {}): RawPrestaShopOrderDiscount {
  return {
    sourceOrderCartRuleId: 1,
    classification: 'PRODUCT_DISCOUNT',
    valueTaxIncl: '30.000000',
    valueTaxExcl: '24.000000',
    ...overrides,
  };
}
