import { describe, expect, it } from 'vitest';
import {
  allocateByLargestRemainder,
  assertMonetaryAuditReportHasNoPii,
  buildMonetaryAuditVerdict,
  buildRfmMonetaryImpact,
  classifyCartRule,
  compareMonetaryPolicies,
  composeOrderMonetary,
  evaluateLineValueSemantics,
  evaluateManualTaxFormula,
  monetaryCompositionChecksum,
  normalizeMonetaryCompositionPolicy,
  type MonetaryCartRuleInput,
  type MonetaryOrderInput,
  type MonetaryOrderLineInput,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = '2026-08-03T00:00:00.000Z';
const calculationVersion = 'rfm-population-v1';

describe('CP-R1-T11A3.2 order monetary composition', () => {
  it('uses persisted tax-incl line totals without applying manual IVA again', () => {
    const order = makeOrder({
      lines: [
        makeLine({
          productQuantity: 2,
          unitPriceTaxExcl: '100.000000',
          unitPriceTaxIncl: '119.000000',
          totalPriceTaxExcl: '200.000000',
          totalPriceTaxIncl: '238.000000',
          productPrice: '100.000000',
        }),
      ],
      totalProductsTaxExcl: '200.000000',
      totalProductsTaxIncl: '238.000000',
      totalPaidTaxExcl: '200.000000',
      totalPaidTaxIncl: '238.000000',
    });

    const composition = composeOrderMonetary(order);

    expect(composition.grossEligibleProductValueTaxIncl).toBe('238.000000');
    expect(composition.netEligibleProductValueTaxIncl).toBe('238.000000');
    expect(composition.lines[0]!.effectiveTaxRate).toBe('0.190000');
  });

  it('treats product-specific discount metadata as metadata when total_price is already netted', () => {
    const order = makeOrder({
      lines: [
        makeLine({
          unitPriceTaxExcl: '80.000000',
          unitPriceTaxIncl: '95.200000',
          totalPriceTaxExcl: '80.000000',
          totalPriceTaxIncl: '95.200000',
          productPrice: '100.000000',
          reductionPercent: '20.000000',
          reductionAmountTaxIncl: '23.800000',
          reductionAmountTaxExcl: '20.000000',
        }),
      ],
      totalProductsTaxExcl: '80.000000',
      totalProductsTaxIncl: '95.200000',
      totalPaidTaxExcl: '80.000000',
      totalPaidTaxIncl: '95.200000',
    });

    const composition = composeOrderMonetary(order);

    expect(composition.lines[0]!.reasonCodes).toContain('SPECIFIC_PERCENT_REDUCTION_METADATA');
    expect(composition.lines[0]!.reasonCodes).toContain('SPECIFIC_FIXED_REDUCTION_METADATA');
    expect(composition.netEligibleProductValueTaxIncl).toBe('95.200000');
  });

  it('supports fixed line discount metadata and quantity greater than one', () => {
    const order = makeOrder({
      lines: [
        makeLine({
          productQuantity: 3,
          unitPriceTaxExcl: '90.000000',
          unitPriceTaxIncl: '107.100000',
          totalPriceTaxExcl: '270.000000',
          totalPriceTaxIncl: '321.300000',
          productPrice: '100.000000',
          reductionAmount: '10.000000',
          reductionAmountTaxExcl: '10.000000',
          reductionAmountTaxIncl: '11.900000',
        }),
      ],
      totalProductsTaxExcl: '270.000000',
      totalProductsTaxIncl: '321.300000',
      totalPaidTaxExcl: '270.000000',
      totalPaidTaxIncl: '321.300000',
    });

    const semantics = evaluateLineValueSemantics([order]);

    expect(semantics.quantityTimesUnitTaxInclMatches).toBe(1);
    expect(semantics.specificDiscountMetadataPresentCount).toBe(1);
    expect(semantics.totalPriceAlreadyNettedEvidenceCount).toBe(1);
  });

  it('detects 19%, 0% and different tax rates without assuming one global rate', () => {
    const orders = [
      makeOrder({
        orderId: 1,
        lines: [makeLine({ orderId: 1, totalPriceTaxExcl: '100.000000', totalPriceTaxIncl: '119.000000' })],
      }),
      makeOrder({
        orderId: 2,
        lines: [makeLine({ orderId: 2, totalPriceTaxExcl: '100.000000', totalPriceTaxIncl: '100.000000' })],
        totalProductsTaxExcl: '100.000000',
        totalProductsTaxIncl: '100.000000',
        totalPaidTaxExcl: '100.000000',
        totalPaidTaxIncl: '100.000000',
      }),
      makeOrder({
        orderId: 3,
        lines: [makeLine({ orderId: 3, totalPriceTaxExcl: '100.000000', totalPriceTaxIncl: '110.000000' })],
        totalProductsTaxExcl: '100.000000',
        totalProductsTaxIncl: '110.000000',
        totalPaidTaxExcl: '100.000000',
        totalPaidTaxIncl: '110.000000',
      }),
    ];

    const audit = evaluateManualTaxFormula(orders);

    expect(audit.nineteenPercentLineCount).toBe(1);
    expect(audit.zeroPercentLineCount).toBe(1);
    expect(audit.otherRateLineCount).toBe(1);
    expect(audit.verdict).toBe('CORRECT_ONLY_FOR_19_PERCENT_LINES');
  });

  it('excludes seller service and logistics artifacts but keeps commercial services eligible', () => {
    const policy = normalizeMonetaryCompositionPolicy({
      confirmedSellerServiceProductIds: [444],
      confirmedLogisticsProductIds: [555],
      confirmedCommercialServiceProductIds: [777],
      unresolvedTechnicalProductIds: [888],
    });
    const order = makeOrder({
      lines: [
        makeLine({ orderDetailId: 1, productId: 444, totalPriceTaxIncl: '1.000000', totalPriceTaxExcl: '0.840336' }),
        makeLine({ orderDetailId: 2, productId: 555, totalPriceTaxIncl: '10.000000', totalPriceTaxExcl: '8.403361' }),
        makeLine({ orderDetailId: 3, productId: 777, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '84.033613' }),
        makeLine({ orderDetailId: 4, productId: 888, totalPriceTaxIncl: '50.000000', totalPriceTaxExcl: '42.016807' }),
      ],
      totalProductsTaxIncl: '161.000000',
      totalProductsTaxExcl: '135.294117',
      totalPaidTaxIncl: '161.000000',
      totalPaidTaxExcl: '135.294117',
    });

    const composition = composeOrderMonetary(order, policy);

    expect(composition.excludedSellerServiceValueTaxIncl).toBe('1.000000');
    expect(composition.excludedLogisticsValueTaxIncl).toBe('10.000000');
    expect(composition.grossEligibleProductValueTaxIncl).toBe('100.000000');
    expect(composition.unresolvedLineValueTaxIncl).toBe('50.000000');
  });

  it('classifies product, fixed, specific, free shipping, mixed and gift cart rules', () => {
    expect(classifyCartRule(makeRule({ reductionPercent: '20.000000' })).category).toBe('PERCENT_PRODUCT_DISCOUNT');
    expect(classifyCartRule(makeRule({ reductionAmount: '10.000000' })).category).toBe('FIXED_PRODUCT_DISCOUNT');
    expect(classifyCartRule(makeRule({ reductionAmount: '10.000000', reductionProduct: 100 })).category).toBe('SPECIFIC_PRODUCT_DISCOUNT');
    expect(classifyCartRule(makeRule({ freeShipping: true, valueTaxIncl: '5.000000' })).category).toBe('FREE_SHIPPING');
    expect(classifyCartRule(makeRule({ freeShipping: true, reductionAmount: '10.000000' })).category).toBe('MIXED_PRODUCT_AND_SHIPPING');
    expect(classifyCartRule(makeRule({ giftProduct: 123 })).category).toBe('GIFT_PRODUCT');
  });

  it('allocates a 20% order discount proportionally and preserves the exact total', () => {
    const order = makeOrder({
      lines: [
        makeLine({ orderDetailId: 1, totalPriceTaxIncl: '100.000000', totalPriceTaxExcl: '84.033613' }),
        makeLine({ orderDetailId: 2, productId: 101, totalPriceTaxIncl: '300.000000', totalPriceTaxExcl: '252.100840' }),
      ],
      cartRules: [makeRule({ valueTaxIncl: '80.000000', valueTaxExcl: '67.226891', reductionPercent: '20.000000' })],
      totalProductsTaxIncl: '400.000000',
      totalProductsTaxExcl: '336.134453',
      totalDiscountsTaxIncl: '80.000000',
      totalDiscountsTaxExcl: '67.226891',
      totalDiscounts: '80.000000',
      totalPaidTaxIncl: '320.000000',
      totalPaidTaxExcl: '268.907562',
    });

    const composition = composeOrderMonetary(order);

    expect(composition.lines.map((line) => line.allocatedOrderDiscountTaxIncl)).toEqual(['20.000000', '60.000000']);
    expect(composition.netEligibleProductValueTaxIncl).toBe('320.000000');
    expect(composition.discountAttributionStatus).toBe('DISCOUNT_ATTRIBUTION_CONFIRMED');
  });

  it('uses largest remainder deterministically for rounding residue', () => {
    const allocations = allocateByLargestRemainder('1.000000', ['1.000000', '1.000000', '1.000000']);

    expect(allocations).toEqual(['0.333334', '0.333333', '0.333333']);
  });

  it('does not allocate free shipping discount to products', () => {
    const order = makeOrder({
      cartRules: [makeRule({ valueTaxIncl: '10.000000', valueTaxExcl: '8.403361', freeShipping: true })],
      totalShippingTaxIncl: '10.000000',
      totalShippingTaxExcl: '8.403361',
      totalDiscounts: '10.000000',
      totalDiscountsTaxIncl: '10.000000',
      totalDiscountsTaxExcl: '8.403361',
    });

    const composition = composeOrderMonetary(order);

    expect(composition.productApplicableOrderDiscountTaxIncl).toBe('0.000000');
    expect(composition.shippingDiscountTaxIncl).toBe('10.000000');
    expect(composition.netEligibleProductValueTaxIncl).toBe('119.000000');
  });

  it('marks mixed cart rules as partial attribution and unknown/gift as unresolved', () => {
    const mixed = composeOrderMonetary(makeOrder({
      cartRules: [makeRule({ valueTaxIncl: '10.000000', valueTaxExcl: '8.403361', freeShipping: true, reductionAmount: '5.000000' })],
      totalDiscounts: '10.000000',
      totalDiscountsTaxIncl: '10.000000',
      totalDiscountsTaxExcl: '8.403361',
    }));
    const gift = composeOrderMonetary(makeOrder({
      cartRules: [makeRule({ valueTaxIncl: '10.000000', valueTaxExcl: '8.403361', giftProduct: 1 })],
      totalDiscounts: '10.000000',
      totalDiscountsTaxIncl: '10.000000',
      totalDiscountsTaxExcl: '8.403361',
    }));

    expect(mixed.discountAttributionStatus).toBe('DISCOUNT_ATTRIBUTION_PARTIAL');
    expect(gift.discountAttributionStatus).toBe('DISCOUNT_ATTRIBUTION_UNRESOLVED');
  });

  it('caps net eligible value at zero when discount exceeds eligible subtotal', () => {
    const composition = composeOrderMonetary(makeOrder({
      cartRules: [makeRule({ valueTaxIncl: '200.000000', valueTaxExcl: '168.067227', reductionAmount: '200.000000' })],
      totalDiscounts: '200.000000',
      totalDiscountsTaxIncl: '200.000000',
      totalDiscountsTaxExcl: '168.067227',
      totalPaidTaxIncl: '0.000000',
      totalPaidTaxExcl: '0.000000',
    }));

    expect(composition.netEligibleProductValueTaxIncl).toBe('0.000000');
    expect(composition.lines[0]!.allocatedOrderDiscountTaxIncl).toBe('200.000000');
  });

  it('reconciles products and paid totals with exact, one CLP and larger deltas', () => {
    const exact = composeOrderMonetary(makeOrder());
    const onePeso = composeOrderMonetary(makeOrder({ totalPaidTaxIncl: '118.000000' }));
    const over = composeOrderMonetary(makeOrder({ totalPaidTaxIncl: '1000.000000' }));

    expect(exact.detailVsOrderProductsTaxInclDelta).toBe('0.000000');
    expect(exact.reconciliationStatus).toBe('EXACT');
    expect(onePeso.reconciliationStatus).toBe('WITHIN_1_CLP');
    expect(over.reconciliationStatus).toBe('WITHIN_1000_CLP');
  });

  it('compares monetary policies A/B/C/D/E', () => {
    const orders = [
      makeOrder({
        orderId: 1,
        totalPaidTaxIncl: '129.000000',
        totalShippingTaxIncl: '10.000000',
      }),
      makeOrder({
        orderId: 2,
        prestashopCustomerId: 20,
        lines: [makeLine({ orderId: 2, productId: 444, totalPriceTaxIncl: '1.000000', totalPriceTaxExcl: '0.840336' })],
        totalProductsTaxIncl: '1.000000',
        totalProductsTaxExcl: '0.840336',
        totalPaidTaxIncl: '1.000000',
        totalPaidTaxExcl: '0.840336',
      }),
    ];
    const policy = normalizeMonetaryCompositionPolicy({ confirmedSellerServiceProductIds: [444] });
    const compositions = orders.map((order) => composeOrderMonetary(order, policy));

    const comparison = compareMonetaryPolicies(orders, compositions);

    expect(comparison.policyA_totalPaidTaxIncl.totalMonetary).toBe('130.000000');
    expect(comparison.policyB_totalProductsWt.totalMonetary).toBe('120.000000');
    expect(comparison.policyC_grossEligibleProductValueTaxIncl.totalMonetary).toBe('119.000000');
    expect(comparison.policyD_netEligibleProductValueTaxIncl.totalMonetary).toBe('119.000000');
    expect(comparison.policyE_netEligibleProductValueTaxExcl.totalMonetary).toBe('100.000000');
  });

  it('measures RFM monetary impact without mutating productive scoring policy', () => {
    const orders = [
      makeOrder({ orderId: 1, prestashopCustomerId: 1, validOrderAt: '2026-07-01 10:00:00', totalPaidTaxIncl: '1000.000000' }),
      makeOrder({ orderId: 2, prestashopCustomerId: 2, validOrderAt: '2026-07-02 10:00:00', totalPaidTaxIncl: '2000.000000' }),
      makeOrder({
        orderId: 3,
        prestashopCustomerId: 3,
        validOrderAt: '2026-07-03 10:00:00',
        lines: [makeLine({ orderId: 3, productId: 444, totalPriceTaxIncl: '1.000000', totalPriceTaxExcl: '0.840336' })],
        totalProductsTaxIncl: '1.000000',
        totalProductsTaxExcl: '0.840336',
        totalPaidTaxIncl: '999999.000000',
        totalPaidTaxExcl: '840335.294118',
      }),
    ];
    const policy = normalizeMonetaryCompositionPolicy({ confirmedSellerServiceProductIds: [444] });
    const compositions = orders.map((order) => composeOrderMonetary(order, policy));

    const impact = buildRfmMonetaryImpact(referenceTime, calculationVersion, orders, compositions);

    expect(impact.before.totalMonetary).toBe('1002999.000000');
    expect(impact.after.totalMonetary).toBe('238.000000');
    expect(impact.changedMonetaryScoreCount).toBeGreaterThan(0);
  });

  it('emits a monetary audit verdict with recalculation conditions', () => {
    const orders = [makeOrder({ totalPaidTaxIncl: '129.000000', totalShippingTaxIncl: '10.000000' })];
    const compositions = orders.map((order) => composeOrderMonetary(order));
    const comparison = compareMonetaryPolicies(orders, compositions);

    const verdict = buildMonetaryAuditVerdict({
      compositions,
      policyComparison: comparison,
      lineSemantics: evaluateLineValueSemantics(orders),
      manualTaxFormula: evaluateManualTaxFormula(orders),
    });

    expect(verdict.primaryVerdict).toBe('CURRENT_RFM_MONETARY_IS_CONTAMINATED');
    expect(verdict.conditions).toContain('RFM_REQUIRES_MONETARY_RECALCULATION');
    expect(verdict.conditions).toContain('T08_REQUIRES_VALUE_RECALCULATION');
  });

  it('has deterministic checksums and rejects PII-shaped report content', () => {
    const report = { total: '100.000000', status: 'OK' };

    expect(monetaryCompositionChecksum(report)).toBe(monetaryCompositionChecksum({ status: 'OK', total: '100.000000' }));
    expect(() => assertMonetaryAuditReportHasNoPii(report)).not.toThrow();
    expect(() => assertMonetaryAuditReportHasNoPii({ email: 'x@example.com' })).toThrow(/forbidden field/);
  });
});

function makeOrder(overrides: Partial<MonetaryOrderInput> = {}): MonetaryOrderInput {
  const orderId = overrides.orderId ?? 1;
  return {
    orderId,
    prestashopCustomerId: overrides.prestashopCustomerId ?? 10,
    validOrderAt: overrides.validOrderAt ?? '2026-07-01 10:00:00',
    shopId: overrides.shopId ?? 1,
    module: overrides.module ?? 'webpay',
    currencyId: overrides.currencyId ?? 1,
    conversionRate: overrides.conversionRate ?? '1.000000',
    totalProductsTaxExcl: overrides.totalProductsTaxExcl ?? '100.000000',
    totalProductsTaxIncl: overrides.totalProductsTaxIncl ?? '119.000000',
    totalDiscounts: overrides.totalDiscounts ?? '0.000000',
    totalDiscountsTaxIncl: overrides.totalDiscountsTaxIncl ?? '0.000000',
    totalDiscountsTaxExcl: overrides.totalDiscountsTaxExcl ?? '0.000000',
    totalShippingTaxIncl: overrides.totalShippingTaxIncl ?? '0.000000',
    totalShippingTaxExcl: overrides.totalShippingTaxExcl ?? '0.000000',
    totalWrappingTaxIncl: overrides.totalWrappingTaxIncl ?? '0.000000',
    totalWrappingTaxExcl: overrides.totalWrappingTaxExcl ?? '0.000000',
    totalPaidTaxIncl: overrides.totalPaidTaxIncl ?? '119.000000',
    totalPaidTaxExcl: overrides.totalPaidTaxExcl ?? '100.000000',
    totalPaidReal: overrides.totalPaidReal ?? overrides.totalPaidTaxIncl ?? '119.000000',
    roundMode: overrides.roundMode ?? null,
    roundType: overrides.roundType ?? null,
    refundEvidence: overrides.refundEvidence ?? false,
    lines: overrides.lines ?? [makeLine({ orderId })],
    cartRules: overrides.cartRules ?? [],
  };
}

function makeLine(overrides: Partial<MonetaryOrderLineInput> = {}): MonetaryOrderLineInput {
  return {
    orderDetailId: overrides.orderDetailId ?? 1,
    orderId: overrides.orderId ?? 1,
    productId: overrides.productId ?? 100,
    productAttributeId: overrides.productAttributeId ?? 0,
    productQuantity: overrides.productQuantity ?? 1,
    unitPriceTaxExcl: overrides.unitPriceTaxExcl ?? overrides.totalPriceTaxExcl ?? '100.000000',
    unitPriceTaxIncl: overrides.unitPriceTaxIncl ?? overrides.totalPriceTaxIncl ?? '119.000000',
    totalPriceTaxExcl: overrides.totalPriceTaxExcl ?? '100.000000',
    totalPriceTaxIncl: overrides.totalPriceTaxIncl ?? '119.000000',
    productPrice: overrides.productPrice ?? overrides.unitPriceTaxExcl ?? '100.000000',
    reductionPercent: overrides.reductionPercent ?? '0.000000',
    reductionAmount: overrides.reductionAmount ?? '0.000000',
    reductionAmountTaxIncl: overrides.reductionAmountTaxIncl ?? '0.000000',
    reductionAmountTaxExcl: overrides.reductionAmountTaxExcl ?? '0.000000',
    groupReduction: overrides.groupReduction ?? '0.000000',
    taxComputationMethod: overrides.taxComputationMethod ?? null,
    taxRulesGroupId: overrides.taxRulesGroupId ?? 1,
  };
}

function makeRule(overrides: Partial<MonetaryCartRuleInput> = {}): MonetaryCartRuleInput {
  return {
    orderId: overrides.orderId ?? 1,
    cartRuleId: overrides.cartRuleId ?? 1,
    valueTaxIncl: overrides.valueTaxIncl ?? '10.000000',
    valueTaxExcl: overrides.valueTaxExcl ?? '8.403361',
    freeShipping: overrides.freeShipping ?? false,
    reductionPercent: overrides.reductionPercent ?? '0.000000',
    reductionAmount: overrides.reductionAmount ?? '0.000000',
    reductionTax: overrides.reductionTax ?? true,
    reductionProduct: overrides.reductionProduct ?? 0,
    giftProduct: overrides.giftProduct ?? 0,
  };
}
