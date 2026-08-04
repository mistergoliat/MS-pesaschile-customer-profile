import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertHistoricalSpecificPriceReportHasNoPii,
  auditHistoricalSpecificPriceLine,
  buildHistoricalSpecificPriceAuditVerdict,
  selectHistoricalSpecificPriceForOrderDate,
  summarizeHistoricalSpecificPriceEvidence,
  type HistoricalSpecificPriceCandidate,
  type HistoricalSpecificPriceLineInput,
} from '../../src/domain/customer-orders/index.js';

describe('CP-R1-T11A3.3A historical product specific discount evidence audit', () => {
  it('reconstructs product base price with tax and matches order detail when no rule exists', () => {
    const evidence = auditHistoricalSpecificPriceLine(line(), []);

    expect(evidence.selection.status).toBe('NO_SPECIFIC_PRICE');
    expect(evidence.resolution.historicalBaseUnitPriceTaxExcl).toBe('100.000000');
    expect(evidence.resolution.historicalBaseUnitPriceTaxIncl).toBe('119.000000');
    expect(evidence.comparison.classification).toBe('NO_SPECIFIC_PRICE_AND_ORDER_DETAIL_MATCHES_BASE');
  });

  it('uses shop and combination current values as observable evidence but not historical authority', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({
      productAttributeId: 20,
      productBasePriceTaxExcl: '80.000000',
      combinationImpactTaxExcl: '20.000000',
      basePriceSource: 'product_shop',
      combinationImpactSource: 'product_attribute_shop',
    }), []);

    expect(evidence.baseEvidenceStatus).toBe('BASE_PRICE_OBSERVABLE');
    expect(evidence.resolution.historicalBaseUnitPriceTaxExcl).toBe('100.000000');
  });

  it('flags current-state-only base evidence for inactive products', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({ productActive: false }), []);

    expect(evidence.baseEvidenceStatus).toBe('BASE_PRICE_CURRENT_STATE_ONLY');
    expect(evidence.reasonCodes).toContain('PRODUCT_CURRENTLY_INACTIVE');
  });

  it('marks missing base price as not provable', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({ productBasePriceTaxExcl: null }), []);

    expect(evidence.baseEvidenceStatus).toBe('BASE_PRICE_UNAVAILABLE');
    expect(evidence.resolution.source).toBe('UNRESOLVED');
    expect(evidence.comparison.classification).toBe('HISTORICAL_PRICE_NOT_PROVABLE');
  });

  it('applies percentage reduction active at the order date', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({
      orderDetailUnitPriceTaxIncl: '107.000000',
      orderDetailTotalPriceTaxIncl: '214.000000',
      quantity: 2,
    }), [specific({ reduction: '0.100000', reductionType: 'percentage' })]);

    expect(evidence.selection.status).toBe('SPECIFIC_PRICE_SELECTED');
    expect(evidence.resolution.discountType).toBe('percentage');
    expect(evidence.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('107.000000');
    expect(evidence.resolution.reconstructedSpecificProductDiscountTaxIncl).toBe('24.000000');
    expect(evidence.comparison.classification).toBe('SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES');
  });

  it('applies fixed amount reductions stored tax-included', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({
      orderDetailUnitPriceTaxIncl: '95.000000',
      orderDetailTotalPriceTaxIncl: '95.000000',
    }), [specific({ reduction: '24.000000', reductionType: 'amount', reductionTax: true })]);

    expect(evidence.resolution.discountType).toBe('amount');
    expect(evidence.resolution.discountValue).toBe('20.168067');
    expect(evidence.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('95.000000');
  });

  it('applies fixed amount reductions stored tax-excluded', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({
      orderDetailUnitPriceTaxIncl: '95.000000',
      orderDetailTotalPriceTaxIncl: '95.000000',
    }), [specific({ reduction: '20.000000', reductionType: 'amount', reductionTax: false })]);

    expect(evidence.resolution.discountType).toBe('amount');
    expect(evidence.resolution.discountValue).toBe('20.000000');
    expect(evidence.resolution.historicalEffectiveUnitPriceTaxIncl).toBe('95.000000');
  });

  it('applies price override and keeps combination impact', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({
      productAttributeId: 9,
      productBasePriceTaxExcl: '100.000000',
      combinationImpactTaxExcl: '10.000000',
      orderDetailUnitPriceTaxIncl: '107.000000',
      orderDetailTotalPriceTaxIncl: '107.000000',
    }), [specific({ productAttributeId: 9, price: '80.000000' })]);

    expect(evidence.selection.matchedDimensions).toContain('combination');
    expect(evidence.resolution.discountType).toBe('price_override');
    expect(evidence.resolution.historicalEffectiveUnitPriceTaxExcl).toBe('90.000000');
  });

  it('filters future and expired rules using the order date', () => {
    const evidence = auditHistoricalSpecificPriceLine(line(), [
      specific({ specificPriceId: 11, validFrom: '2025-01-01 00:00:00' }),
      specific({ specificPriceId: 12, validTo: '2023-12-31 23:59:59' }),
    ]);

    expect(evidence.selection.selectedSpecificPriceId).toBeNull();
    expect(evidence.selection.status).toBe('NO_SPECIFIC_PRICE');
  });

  it('selects by Catalog priority across exact dimensions and quantity', () => {
    const selection = selectHistoricalSpecificPriceForOrderDate(line({
      productAttributeId: 5,
      shopId: 2,
      currencyId: 3,
      countryId: 4,
      customerGroupId: 6,
      customerId: 7,
      quantity: 10,
    }), [
      specific({ specificPriceId: 30, productAttributeId: 0, shopId: 2, currencyId: 3, countryId: 4, groupId: 6, customerId: 7, fromQuantity: 10 }),
      specific({ specificPriceId: 31, productAttributeId: 5, shopId: 0, currencyId: 3, countryId: 4, groupId: 6, customerId: 7, fromQuantity: 10 }),
    ]);

    expect(selection.selectedSpecificPriceId).toBe(31);
    expect(selection.selectionScore.slice(0, 7)).toEqual([1, 0, 1, 1, 1, 1, 10]);
  });

  it('uses the Catalog technical tie-breaker deterministically and reports commercial ambiguity', () => {
    const selection = selectHistoricalSpecificPriceForOrderDate(line(), [
      specific({ specificPriceId: 10 }),
      specific({ specificPriceId: 11 }),
    ]);

    expect(selection.selectedSpecificPriceId).toBe(10);
    expect(selection.status).toBe('SPECIFIC_PRICE_SELECTION_AMBIGUOUS');
  });

  it('marks selection context incomplete when group history is unavailable and group rules exist', () => {
    const evidence = auditHistoricalSpecificPriceLine(line({ customerGroupId: null, customerGroupSource: 'unavailable' }), [
      specific({ specificPriceId: 20, groupId: 4 }),
    ]);

    expect(evidence.contextStatus).toBe('CONTEXT_PARTIAL');
    expect(evidence.selection.status).toBe('CONTEXT_INCOMPLETE');
    expect(evidence.comparison.classification).toBe('CONTEXT_INCOMPLETE');
  });

  it('confirms, derives, and rejects tax evidence without a global fixed rate', () => {
    expect(auditHistoricalSpecificPriceLine(line({ orderDetailTaxRate: '0.190000' }), []).taxEvidence.status).toBe('TAX_RATE_CONFIRMED');
    expect(auditHistoricalSpecificPriceLine(line({
      orderDetailTaxRate: null,
      orderDetailUnitPriceTaxIncl: '100.000000',
      orderDetailUnitPriceTaxExcl: '100.000000',
      orderDetailTotalPriceTaxIncl: '100.000000',
      orderDetailTotalPriceTaxExcl: '100.000000',
    }), []).taxEvidence.taxRate).toBe('0.000000');
    expect(auditHistoricalSpecificPriceLine(line({
      orderDetailTaxRate: null,
      orderDetailUnitPriceTaxIncl: '125.000000',
      orderDetailUnitPriceTaxExcl: '100.000000',
      orderDetailTotalPriceTaxIncl: '125.000000',
      orderDetailTotalPriceTaxExcl: '100.000000',
    }), []).taxEvidence.taxRate).toBe('0.250000');
    expect(auditHistoricalSpecificPriceLine(line({
      orderDetailTaxRate: null,
      orderDetailUnitPriceTaxIncl: '0.000000',
      orderDetailUnitPriceTaxExcl: '0.000000',
      orderDetailTotalPriceTaxIncl: '0.000000',
      orderDetailTotalPriceTaxExcl: '0.000000',
    }), []).taxEvidence.status).toBe('TAX_RATE_UNAVAILABLE');
  });

  it('classifies order detail as base-only when a selected specific price differs', () => {
    const evidence = auditHistoricalSpecificPriceLine(line(), [
      specific({ reduction: '0.100000', reductionType: 'percentage' }),
    ]);

    expect(evidence.comparison.classification).toBe('ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED');
    expect(evidence.comparison.orderDetailAlreadyReflectsSpecificPrice).toBe(false);
  });

  it('classifies lower, higher and rounding-only deltas', () => {
    expect(auditHistoricalSpecificPriceLine(line({ orderDetailUnitPriceTaxIncl: '100.000000', orderDetailTotalPriceTaxIncl: '100.000000' }), []).comparison.classification)
      .toBe('HISTORICAL_PRICE_NOT_PROVABLE');
    expect(auditHistoricalSpecificPriceLine(line({ orderDetailUnitPriceTaxIncl: '130.000000', orderDetailTotalPriceTaxIncl: '130.000000' }), []).comparison.classification)
      .toBe('HISTORICAL_PRICE_NOT_PROVABLE');
    expect(auditHistoricalSpecificPriceLine(line({ orderDetailUnitPriceTaxIncl: '119.500000', orderDetailTotalPriceTaxIncl: '119.500000' }), []).comparison.classification)
      .toBe('ROUNDING_ONLY');
  });

  it('separates specific product discount from order-level discount inputs', () => {
    const evidences = [
      auditHistoricalSpecificPriceLine(line({
        orderDetailUnitPriceTaxIncl: '107.000000',
        orderDetailTotalPriceTaxIncl: '107.000000',
      }), [specific({ reduction: '0.100000', reductionType: 'percentage' })]),
    ];
    const summary = summarizeHistoricalSpecificPriceEvidence(evidences);

    expect(summary.grossBaseValueTaxIncl).toBe('119.000000');
    expect(summary.reconstructedSpecificProductDiscountTaxIncl).toBe('12.000000');
    expect(summary.effectiveValueTaxIncl).toBe('107.000000');
  });

  it('excludes seller service from commercial aggregates', () => {
    const summary = summarizeHistoricalSpecificPriceEvidence([
      auditHistoricalSpecificPriceLine(line({ productId: 444, isSellerService: true }), []),
      auditHistoricalSpecificPriceLine(line({ productId: 20 }), []),
    ]);

    expect(summary.commercialLineCount).toBe(1);
    expect(summary.grossBaseValueTaxIncl).toBe('119.000000');
  });

  it('emits a blocking verdict when base or group evidence is insufficient', () => {
    const baseBlocked = buildHistoricalSpecificPriceAuditVerdict([
      auditHistoricalSpecificPriceLine(line({ productBasePriceTaxExcl: null }), []),
      auditHistoricalSpecificPriceLine(line({ productBasePriceTaxExcl: null, orderDetailId: 2 }), []),
    ]);

    expect(baseBlocked.primaryVerdict).toBe('BLOCKED_BY_HISTORICAL_BASE_PRICE');
  });

  it('keeps reports free of PII-shaped fields', () => {
    expect(() => assertHistoricalSpecificPriceReportHasNoPii({ summary: summarizeHistoricalSpecificPriceEvidence([auditHistoricalSpecificPriceLine(line(), [])]) })).not.toThrow();
    expect(() => assertHistoricalSpecificPriceReportHasNoPii({ email: 'buyer@example.test' })).toThrow(/forbidden field/i);
  });

  it('keeps the new audit read-only and independent from current-time pricing shortcuts', () => {
    const domain = readFileSync('src/domain/customer-orders/historical-specific-price-evidence.ts', 'utf8');
    const script = readFileSync('scripts/snapshots/rfm-historical-specific-price-evidence.ts', 'utf8');
    const combined = `${domain}\n${script}`;

    expect(combined).not.toMatch(/\bNOW\s*\(/i);
    expect(combined).not.toContain('Date.now');
    expect(combined).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP|ALTER)\b/i);
    expect(combined).not.toContain('1.19');
    expect(combined).not.toMatch(/product_name|productName|nombre/i);
  });
});

function line(overrides: Partial<HistoricalSpecificPriceLineInput> = {}): HistoricalSpecificPriceLineInput {
  return {
    orderDetailId: 1,
    orderId: 100,
    productId: 10,
    productAttributeId: 0,
    quantity: 1,
    orderDate: '2024-06-15 12:00:00',
    shopId: 1,
    currencyId: 1,
    customerId: 50,
    countryId: 68,
    customerGroupId: 3,
    customerGroupSource: 'historical',
    productActive: true,
    productBasePriceTaxExcl: '100.000000',
    combinationImpactTaxExcl: '0.000000',
    basePriceSource: 'current_state',
    combinationImpactSource: 'current_state',
    orderDetailUnitPriceTaxIncl: '119.000000',
    orderDetailUnitPriceTaxExcl: '100.000000',
    orderDetailTotalPriceTaxIncl: '119.000000',
    orderDetailTotalPriceTaxExcl: '100.000000',
    orderDetailTaxRate: '0.190000',
    isSellerService: false,
    isLogisticsArtifact: false,
    ...overrides,
  };
}

function specific(overrides: Partial<HistoricalSpecificPriceCandidate> = {}): HistoricalSpecificPriceCandidate {
  return {
    specificPriceId: 1,
    productId: 10,
    productAttributeId: 0,
    shopId: 0,
    currencyId: 0,
    countryId: 0,
    groupId: 0,
    customerId: 0,
    cartId: 0,
    price: '-1.000000',
    fromQuantity: 1,
    reduction: '0.000000',
    reductionTax: false,
    reductionType: 'amount',
    validFrom: '2024-01-01 00:00:00',
    validTo: '2024-12-31 23:59:59',
    ...overrides,
  };
}
