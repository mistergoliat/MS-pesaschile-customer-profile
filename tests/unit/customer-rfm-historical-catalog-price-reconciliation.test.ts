import { describe, expect, it } from 'vitest';
import {
  assertHistoricalPriceReportHasNoPii,
  buildHistoricalPriceAuthorityVerdict,
  compareHistoricalPricePolicies,
  historicalPriceChecksum,
  reconcileHistoricalCatalogPrices,
  reconcileLine,
  resolveHistoricalPrice,
  selectHistoricalSpecificPrice,
  summarizeHistoricalPriceReconciliations,
  type HistoricalPriceLineInput,
  type HistoricalSpecificPriceCandidate,
} from '../../src/domain/customer-rfm/index.js';

describe('CP-R1-T11A3.2A historical catalog price reconciliation', () => {
  it('uses orderDate as effectiveAt for active, expired, future and open-ended promotions', () => {
    const line = makeLine({ orderDate: '2026-06-15 10:00:00' });
    const selected = selectHistoricalSpecificPrice(line, [
      specific({ specificPriceId: 1, validTo: '2026-01-01 00:00:00' }),
      specific({ specificPriceId: 2, validFrom: '2026-07-01 00:00:00' }),
      specific({ specificPriceId: 3, validFrom: '2026-01-01 00:00:00', validTo: '2026-12-31 23:59:59' }),
      specific({ specificPriceId: 4, validFrom: null, validTo: null, fromQuantity: 1 }),
    ]);

    expect(selected.selectedSpecificPriceId).toBe(3);
    expect(selected.status).toBe('SPECIFIC_PRICE_SELECTION_CONFIRMED');
  });

  it('accepts zero-date ranges as open historical ranges', () => {
    const selected = selectHistoricalSpecificPrice(makeLine(), [
      specific({ specificPriceId: 7, validFrom: '0000-00-00 00:00:00', validTo: '0000-00-00 00:00:00' }),
    ]);

    expect(selected.selectedSpecificPriceId).toBe(7);
  });

  it('prefers deterministic specificity: combination, shop, quantity, context, recent from and id', () => {
    const line = makeLine({
      productAttributeId: 20,
      shopId: 2,
      currencyId: 1,
      countryId: 44,
      customerGroupId: 3,
      customerGroupSource: 'historical',
      customerId: 999,
      quantity: 5,
    });
    const selected = selectHistoricalSpecificPrice(line, [
      specific({ specificPriceId: 1 }),
      specific({ specificPriceId: 2, productAttributeId: 20 }),
      specific({ specificPriceId: 3, productAttributeId: 20, shopId: 2, fromQuantity: 5 }),
      specific({ specificPriceId: 4, productAttributeId: 20, shopId: 2, fromQuantity: 5, countryId: 44, groupId: 3 }),
      specific({ specificPriceId: 5, productAttributeId: 20, shopId: 2, fromQuantity: 5, countryId: 44, groupId: 3, customerId: 999 }),
    ]);

    expect(selected.selectedSpecificPriceId).toBe(5);
    expect(selected.matchedDimensions).toEqual(['combination', 'shop', 'country', 'group', 'customer', 'quantity']);
  });

  it('flags ambiguous selection when only the technical id breaks a tie', () => {
    const selected = selectHistoricalSpecificPrice(makeLine(), [
      specific({ specificPriceId: 10 }),
      specific({ specificPriceId: 11 }),
    ]);

    expect(selected.selectedSpecificPriceId).toBe(11);
    expect(selected.status).toBe('SPECIFIC_PRICE_SELECTION_AMBIGUOUS');
  });

  it('resolves base plus combination impact with line-derived tax rate', () => {
    const line = makeLine({
      productAttributeId: 20,
      productBasePriceTaxExcl: '1000.000000',
      combinationImpactTaxExcl: '100.000000',
      orderDetailUnitPriceTaxExcl: '1100.000000',
      orderDetailUnitPriceTaxIncl: '1309.000000',
      orderDetailTotalPriceTaxExcl: '2200.000000',
      orderDetailTotalPriceTaxIncl: '2618.000000',
      quantity: 2,
    });

    const reconciliation = reconcileLine(line, []);

    expect(reconciliation.resolution.historicalBaseUnitPriceTaxIncl).toBe('1309.000000');
    expect(reconciliation.resolution.historicalEffectiveLineValueTaxIncl).toBe('2618.000000');
    expect(reconciliation.classifications).toContain('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE');
  });

  it('applies specific price override plus combination impact', () => {
    const line = makeLine({
      productAttributeId: 20,
      productBasePriceTaxExcl: '1000.000000',
      combinationImpactTaxExcl: '100.000000',
      orderDetailUnitPriceTaxIncl: '714.000000',
      orderDetailTotalPriceTaxIncl: '714.000000',
    });
    const selected = selectHistoricalSpecificPrice(line, [specific({ productAttributeId: 20, price: '500.000000' })]);
    const resolved = resolveHistoricalPrice(line, selected);

    expect(resolved.historicalEffectiveUnitPriceTaxExcl).toBe('600.000000');
    expect(resolved.historicalEffectiveUnitPriceTaxIncl).toBe('714.000000');
  });

  it('applies percentage reductions without creating negative values', () => {
    const reconciliation = reconcileLine(makeLine({
      productBasePriceTaxExcl: '1000.000000',
      orderDetailUnitPriceTaxIncl: '952.000000',
      orderDetailTotalPriceTaxIncl: '952.000000',
    }), [specific({ reductionType: 'percentage', reduction: '0.200000' })]);

    expect(reconciliation.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('952.000000');
    expect(reconciliation.classifications).toContain('HISTORICAL_SPECIFIC_PRICE_RECONSTRUCTED');
  });

  it('applies amount reductions with reduction_tax = true as tax-included amounts', () => {
    const reconciliation = reconcileLine(makeLine({
      productBasePriceTaxExcl: '1000.000000',
      orderDetailUnitPriceTaxIncl: '1000.000000',
      orderDetailTotalPriceTaxIncl: '1000.000000',
    }), [specific({ reductionType: 'amount', reduction: '190.000000', reductionTax: true })]);

    expect(reconciliation.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('1000.000000');
  });

  it('applies amount reductions with reduction_tax = false as tax-excluded amounts', () => {
    const reconciliation = reconcileLine(makeLine({
      productBasePriceTaxExcl: '1000.000000',
      orderDetailUnitPriceTaxIncl: '1071.000000',
      orderDetailTotalPriceTaxIncl: '1071.000000',
    }), [specific({ reductionType: 'amount', reduction: '100.000000', reductionTax: false })]);

    expect(reconciliation.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('1071.000000');
  });

  it('supports 0% and non-19% tax rates from order detail', () => {
    const zeroTax = reconcileLine(makeLine({
      productBasePriceTaxExcl: '100.000000',
      orderDetailTaxRate: '0.000000',
      orderDetailUnitPriceTaxExcl: '100.000000',
      orderDetailUnitPriceTaxIncl: '100.000000',
      orderDetailTotalPriceTaxExcl: '100.000000',
      orderDetailTotalPriceTaxIncl: '100.000000',
    }), []);
    const tenTax = reconcileLine(makeLine({
      productBasePriceTaxExcl: '100.000000',
      orderDetailTaxRate: '0.100000',
      orderDetailUnitPriceTaxExcl: '100.000000',
      orderDetailUnitPriceTaxIncl: '110.000000',
      orderDetailTotalPriceTaxExcl: '100.000000',
      orderDetailTotalPriceTaxIncl: '110.000000',
    }), []);

    expect(zeroTax.taxStatus).toBe('TAX_MATCH');
    expect(tenTax.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('110.000000');
  });

  it('classifies exact, one-peso rounding, base-only and lower-than-reconstructed cases', () => {
    const exact = reconcileLine(makeLine(), []);
    const rounding = reconcileLine(makeLine({ orderDetailUnitPriceTaxIncl: '1191.000000', orderDetailTotalPriceTaxIncl: '1191.000000' }), []);
    const baseOnly = reconcileLine(makeLine({
      orderDetailUnitPriceTaxIncl: '1190.000000',
      orderDetailTotalPriceTaxIncl: '1190.000000',
    }), [specific({ reductionType: 'percentage', reduction: '0.100000' })]);
    const lower = reconcileLine(makeLine({ orderDetailUnitPriceTaxIncl: '1000.000000', orderDetailTotalPriceTaxIncl: '1000.000000' }), []);

    expect(exact.classifications).toContain('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE');
    expect(rounding.classifications).toContain('ROUNDING_ONLY');
    expect(baseOnly.classifications).toContain('ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY');
    expect(lower.classifications).toContain('ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED');
  });

  it('marks incomplete context and uses order detail fallback without using current price as history', () => {
    const reconciliation = reconcileLine(makeLine({
      productBasePriceTaxExcl: null,
      combinationImpactTaxExcl: null,
    }), []);

    expect(reconciliation.contextStatus).toBe('CONTEXT_PARTIAL');
    expect(reconciliation.resolution.historicalPriceSource).toBe('ORDER_DETAIL_FALLBACK');
    expect(reconciliation.classifications).toContain('PRICING_CONTEXT_INCOMPLETE');
  });

  it('marks current-only group context separately from complete historical context', () => {
    const currentOnly = reconcileLine(makeLine({ customerGroupId: 3, customerGroupSource: 'current_default' }), []);

    expect(currentOnly.contextStatus).toBe('CONTEXT_CURRENT_ONLY');
    expect(currentOnly.classifications).toContain('PRICING_CONTEXT_INCOMPLETE');
  });

  it('keeps inactive products in the audit instead of dropping historical lines', () => {
    const reconciliation = reconcileLine(makeLine({ productActive: false }), []);

    expect(reconciliation.classifications).toContain('CURRENTLY_INACTIVE_PRODUCT');
  });

  it('excludes seller service from commercial reconciliation', () => {
    const reconciliation = reconcileLine(makeLine({ isSellerService: true }), []);

    expect(reconciliation.classifications).toContain('TECHNICAL_LINE_EXCLUDED');
    expect(reconciliation.resolution.historicalPriceSource).toBe('UNRESOLVED');
  });

  it('compares policies A, B and C with order-detail fallback', () => {
    const lines = [
      makeLine({ orderDetailId: 1, orderDetailTotalPriceTaxIncl: '1190.000000' }),
      makeLine({ orderDetailId: 2, productBasePriceTaxExcl: null, orderDetailTotalPriceTaxIncl: '500.000000' }),
    ];
    const reconciliations = reconcileHistoricalCatalogPrices({ lines, specificPrices: [] });

    const comparison = compareHistoricalPricePolicies({
      lines,
      reconciliations,
      totalProductsWt: '1690.000000',
    });

    expect(comparison.policyA_orderDetailPersistedValue.totalValue).toBe('1690.000000');
    expect(comparison.policyB_catalogHistoricalResolvedValue.totalValue).toBe('1690.000000');
    expect(comparison.policyC_hybridValue.totalValue).toBe('1690.000000');
  });

  it('builds summary and authority verdict from match and unresolved rates', () => {
    const lines = [makeLine({ orderDetailId: 1 }), makeLine({ orderDetailId: 2, productBasePriceTaxExcl: null })];
    const reconciliations = reconcileHistoricalCatalogPrices({ lines, specificPrices: [] });
    const policyComparison = compareHistoricalPricePolicies({ lines, reconciliations, totalProductsWt: '2380.000000' });

    const summary = summarizeHistoricalPriceReconciliations(reconciliations);
    const verdict = buildHistoricalPriceAuthorityVerdict({ reconciliations, policyComparison });

    expect(summary.lineCount).toBe(2);
    expect(verdict.conditions).toContain('USE_ORDER_DATE_AS_EFFECTIVE_AT');
    expect(verdict.conditions).toContain('DO_NOT_USE_CURRENT_PRICE_AS_HISTORY');
  });

  it('has deterministic checksums and rejects PII-shaped report content', () => {
    const value = { status: 'OK', matchRate: '1.000000' };

    expect(historicalPriceChecksum(value)).toBe(historicalPriceChecksum({ matchRate: '1.000000', status: 'OK' }));
    expect(() => assertHistoricalPriceReportHasNoPii(value)).not.toThrow();
    expect(() => assertHistoricalPriceReportHasNoPii({ email: 'x@example.com' })).toThrow(/forbidden field/);
  });
});

function makeLine(overrides: Partial<HistoricalPriceLineInput> = {}): HistoricalPriceLineInput {
  return {
    orderDetailId: overrides.orderDetailId ?? 1,
    orderId: overrides.orderId ?? 1,
    productId: overrides.productId ?? 100,
    productAttributeId: overrides.productAttributeId ?? 0,
    quantity: overrides.quantity ?? 1,
    orderDate: overrides.orderDate ?? '2026-06-15 10:00:00',
    shopId: overrides.shopId ?? 1,
    currencyId: overrides.currencyId ?? 1,
    customerId: overrides.customerId ?? 10,
    countryId: overrides.countryId ?? 44,
    customerGroupId: overrides.customerGroupId ?? 3,
    customerGroupSource: overrides.customerGroupSource ?? 'historical',
    module: overrides.module ?? 'webpay',
    productActive: overrides.productActive ?? true,
    productBasePriceTaxExcl: overrides.productBasePriceTaxExcl === undefined ? '1000.000000' : overrides.productBasePriceTaxExcl,
    combinationImpactTaxExcl: overrides.combinationImpactTaxExcl === undefined ? '0.000000' : overrides.combinationImpactTaxExcl,
    orderDetailUnitPriceTaxIncl: overrides.orderDetailUnitPriceTaxIncl ?? '1190.000000',
    orderDetailUnitPriceTaxExcl: overrides.orderDetailUnitPriceTaxExcl ?? '1000.000000',
    orderDetailTotalPriceTaxIncl: overrides.orderDetailTotalPriceTaxIncl ?? '1190.000000',
    orderDetailTotalPriceTaxExcl: overrides.orderDetailTotalPriceTaxExcl ?? '1000.000000',
    orderDetailTaxRate: overrides.orderDetailTaxRate ?? '0.190000',
    isSellerService: overrides.isSellerService ?? false,
    isLogisticsArtifact: overrides.isLogisticsArtifact ?? false,
  };
}

function specific(overrides: Partial<HistoricalSpecificPriceCandidate> = {}): HistoricalSpecificPriceCandidate {
  return {
    specificPriceId: overrides.specificPriceId ?? 1,
    productId: overrides.productId ?? 100,
    productAttributeId: overrides.productAttributeId ?? 0,
    shopId: overrides.shopId ?? 0,
    currencyId: overrides.currencyId ?? 0,
    countryId: overrides.countryId ?? 0,
    groupId: overrides.groupId ?? 0,
    customerId: overrides.customerId ?? 0,
    cartId: overrides.cartId ?? 0,
    price: overrides.price ?? '-1.000000',
    fromQuantity: overrides.fromQuantity ?? 1,
    reduction: overrides.reduction ?? '0.000000',
    reductionTax: overrides.reductionTax ?? false,
    reductionType: overrides.reductionType ?? 'percentage',
    validFrom: overrides.validFrom === undefined ? null : overrides.validFrom,
    validTo: overrides.validTo === undefined ? null : overrides.validTo,
  };
}
