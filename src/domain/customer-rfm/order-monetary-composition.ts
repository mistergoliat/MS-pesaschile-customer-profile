import { buildRfmSnapshotDataset } from './dataset.js';
import { buildRfmSnapshotWindow } from './date-window.js';
import { sha256Stable } from './checksum.js';
import type { RfmPopulationSourceRow, RfmSnapshotDiagnostics, RfmSnapshotRow } from './contracts.js';

const MONEY_SCALE = 6;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);

export const monetaryCompositionPolicyVersion = 'eligible-product-net-value-tax-incl-candidate-v1';

export type TechnicalLineClassification =
  | 'ELIGIBLE_COMMERCIAL_PRODUCT'
  | 'SELLER_SERVICE'
  | 'LOGISTICS_ARTIFACT'
  | 'REAL_COMMERCIAL_SERVICE'
  | 'UNRESOLVED';

export type CartRuleCategory =
  | 'PERCENT_PRODUCT_DISCOUNT'
  | 'FIXED_PRODUCT_DISCOUNT'
  | 'SPECIFIC_PRODUCT_DISCOUNT'
  | 'FREE_SHIPPING'
  | 'MIXED_PRODUCT_AND_SHIPPING'
  | 'GIFT_PRODUCT'
  | 'UNKNOWN';

export type DiscountAttributionStatus =
  | 'DISCOUNT_ATTRIBUTION_CONFIRMED'
  | 'DISCOUNT_ATTRIBUTION_PARTIAL'
  | 'DISCOUNT_ATTRIBUTION_UNRESOLVED';

export type ReconciliationStatus =
  | 'EXACT'
  | 'WITHIN_1_CLP'
  | 'WITHIN_10_CLP'
  | 'WITHIN_100_CLP'
  | 'WITHIN_1000_CLP'
  | 'OVER_1000_CLP';

export type LineValueSemanticsVerdict =
  | 'LINE_VALUE_SEMANTICS_CONFIRMED'
  | 'LINE_VALUE_SEMANTICS_PARTIAL'
  | 'LINE_VALUE_SEMANTICS_INCONSISTENT';

export type ManualTaxFormulaVerdict =
  | 'CORRECT_FOR_ALL_LINES'
  | 'CORRECT_FOR_MOST_LINES'
  | 'CORRECT_ONLY_FOR_19_PERCENT_LINES'
  | 'INCORRECT_OR_DUPLICATES_TAX';

export type MonetaryAuditVerdict =
  | 'MONETARY_POLICY_IDENTIFIED'
  | 'MONETARY_POLICY_IDENTIFIED_WITH_EXCEPTIONS'
  | 'PRODUCT_LINE_VALUES_ARE_CANONICAL'
  | 'ORDER_TOTALS_REQUIRE_RECONCILIATION'
  | 'ORDER_DISCOUNT_ATTRIBUTION_PARTIAL'
  | 'ORDER_DISCOUNT_ATTRIBUTION_UNRESOLVED'
  | 'CURRENT_RFM_MONETARY_IS_CONTAMINATED'
  | 'BLOCKED_BY_CART_RULE_SEMANTICS'
  | 'BLOCKED_BY_TECHNICAL_PRODUCT_IDENTIFICATION'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type MonetaryAuditCondition =
  | 'USE_TAX_INCL_AS_PRIMARY'
  | 'KEEP_TAX_EXCL_AS_AUXILIARY'
  | 'EXCLUDE_SELLER_SERVICE'
  | 'EXCLUDE_LOGISTICS_ARTIFACT'
  | 'ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY'
  | 'DO_NOT_ALLOCATE_FREE_SHIPPING'
  | 'RFM_REQUIRES_MONETARY_RECALCULATION'
  | 'T08_REQUIRES_VALUE_RECALCULATION'
  | 'T09_REQUIRES_SPEND_RECALCULATION';

export type MonetaryOrderLineInput = {
  readonly orderDetailId: number;
  readonly orderId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productQuantity: number;
  readonly unitPriceTaxExcl: string;
  readonly unitPriceTaxIncl: string;
  readonly totalPriceTaxExcl: string;
  readonly totalPriceTaxIncl: string;
  readonly productPrice: string;
  readonly reductionPercent: string;
  readonly reductionAmount: string;
  readonly reductionAmountTaxIncl: string;
  readonly reductionAmountTaxExcl: string;
  readonly groupReduction: string;
  readonly taxComputationMethod: number | null;
  readonly taxRulesGroupId: number | null;
};

export type MonetaryOrderInput = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly validOrderAt: string;
  readonly shopId: number;
  readonly module: string;
  readonly currencyId: number;
  readonly conversionRate: string;
  readonly totalProductsTaxExcl: string;
  readonly totalProductsTaxIncl: string;
  readonly totalDiscounts: string;
  readonly totalDiscountsTaxIncl: string;
  readonly totalDiscountsTaxExcl: string;
  readonly totalShippingTaxIncl: string;
  readonly totalShippingTaxExcl: string;
  readonly totalWrappingTaxIncl: string;
  readonly totalWrappingTaxExcl: string;
  readonly totalPaidTaxIncl: string;
  readonly totalPaidTaxExcl: string;
  readonly totalPaidReal: string;
  readonly roundMode: number | null;
  readonly roundType: number | null;
  readonly refundEvidence: boolean;
  readonly lines: readonly MonetaryOrderLineInput[];
  readonly cartRules: readonly MonetaryCartRuleInput[];
};

export type MonetaryCartRuleInput = {
  readonly orderId: number;
  readonly cartRuleId: number;
  readonly valueTaxIncl: string;
  readonly valueTaxExcl: string;
  readonly freeShipping: boolean;
  readonly reductionPercent: string;
  readonly reductionAmount: string;
  readonly reductionTax: boolean | null;
  readonly reductionProduct: number;
  readonly giftProduct: number;
};

export type MonetaryCompositionPolicy = {
  readonly policyVersion: typeof monetaryCompositionPolicyVersion;
  readonly confirmedSellerServiceProductIds: readonly number[];
  readonly confirmedLogisticsProductIds: readonly number[];
  readonly confirmedCommercialServiceProductIds: readonly number[];
  readonly unresolvedTechnicalProductIds: readonly number[];
  readonly allocateDiscountsWith: 'largest_remainder';
};

export type ClassifiedCartRule = MonetaryCartRuleInput & {
  readonly category: CartRuleCategory;
  readonly productApplicableTaxIncl: string;
  readonly productApplicableTaxExcl: string;
  readonly shippingDiscountTaxIncl: string;
  readonly shippingDiscountTaxExcl: string;
  readonly otherDiscountTaxIncl: string;
  readonly otherDiscountTaxExcl: string;
};

export type ComposedOrderLine = MonetaryOrderLineInput & {
  readonly classification: TechnicalLineClassification;
  readonly grossEligibleTaxIncl: string;
  readonly grossEligibleTaxExcl: string;
  readonly allocatedOrderDiscountTaxIncl: string;
  readonly allocatedOrderDiscountTaxExcl: string;
  readonly netEligibleTaxIncl: string;
  readonly netEligibleTaxExcl: string;
  readonly effectiveTaxRate: string | null;
  readonly reasonCodes: readonly string[];
};

export type OrderMonetaryComposition = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly validOrderAt: string;
  readonly grossEligibleProductValueTaxIncl: string;
  readonly grossEligibleProductValueTaxExcl: string;
  readonly productApplicableOrderDiscountTaxIncl: string;
  readonly productApplicableOrderDiscountTaxExcl: string;
  readonly shippingDiscountTaxIncl: string;
  readonly shippingDiscountTaxExcl: string;
  readonly otherDiscountTaxIncl: string;
  readonly otherDiscountTaxExcl: string;
  readonly netEligibleProductValueTaxIncl: string;
  readonly netEligibleProductValueTaxExcl: string;
  readonly excludedSellerServiceValueTaxIncl: string;
  readonly excludedSellerServiceValueTaxExcl: string;
  readonly excludedLogisticsValueTaxIncl: string;
  readonly excludedLogisticsValueTaxExcl: string;
  readonly unresolvedLineValueTaxIncl: string;
  readonly shippingValueTaxIncl: string;
  readonly wrappingValueTaxIncl: string;
  readonly detailVsOrderProductsTaxInclDelta: string;
  readonly detailVsOrderProductsTaxExclDelta: string;
  readonly paidTotalReconciliationDeltaTaxIncl: string;
  readonly paidTotalReconciliationDeltaTaxExcl: string;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly discountAttributionStatus: DiscountAttributionStatus;
  readonly cartRuleCategories: readonly CartRuleCategory[];
  readonly refundAdjustmentApplied: false;
  readonly refundEvidence: boolean;
  readonly lines: readonly ComposedOrderLine[];
  readonly cartRules: readonly ClassifiedCartRule[];
  readonly reasonCodes: readonly string[];
};

export type MonetaryPolicyComparison = {
  readonly policyA_totalPaidTaxIncl: MonetaryPolicySummary;
  readonly policyB_totalProductsWt: MonetaryPolicySummary;
  readonly policyC_grossEligibleProductValueTaxIncl: MonetaryPolicySummary;
  readonly policyD_netEligibleProductValueTaxIncl: MonetaryPolicySummary;
  readonly policyE_netEligibleProductValueTaxExcl: MonetaryPolicySummary;
};

export type MonetaryPolicySummary = {
  readonly orderCount: number;
  readonly customerCount: number;
  readonly totalMonetary: string;
  readonly averageOrderValue: string;
  readonly medianOrderValue: string | null;
  readonly p95OrderValue: string | null;
  readonly zeroValueOrderCount: number;
  readonly negativeValueOrderCount: number;
  readonly reconciliationDelta: string;
};

export type RfmMonetaryImpact = {
  readonly before: RfmImpactSummary;
  readonly after: RfmImpactSummary;
  readonly changedRfmCodeCount: number;
  readonly changedMonetaryScoreCount: number;
  readonly highGrossCohortCountBefore: number;
  readonly highGrossCohortCountAfter: number;
  readonly historicallyHighGrossInactiveCountBefore: number;
  readonly historicallyHighGrossInactiveCountAfter: number;
};

export type RfmImpactSummary = {
  readonly customerCount: number;
  readonly orderCount: number;
  readonly totalMonetary: string;
  readonly monetaryDistribution: Record<string, unknown>;
  readonly monetaryScoreDistribution: Record<string, number>;
  readonly rfmCodeDistribution: Record<string, number>;
};

export function normalizeMonetaryCompositionPolicy(input?: Partial<MonetaryCompositionPolicy>): MonetaryCompositionPolicy {
  return {
    policyVersion: monetaryCompositionPolicyVersion,
    confirmedSellerServiceProductIds: uniqueSorted(input?.confirmedSellerServiceProductIds ?? []),
    confirmedLogisticsProductIds: uniqueSorted(input?.confirmedLogisticsProductIds ?? []),
    confirmedCommercialServiceProductIds: uniqueSorted(input?.confirmedCommercialServiceProductIds ?? []),
    unresolvedTechnicalProductIds: uniqueSorted(input?.unresolvedTechnicalProductIds ?? []),
    allocateDiscountsWith: 'largest_remainder',
  };
}

export function composeOrderMonetary(
  order: MonetaryOrderInput,
  policy: MonetaryCompositionPolicy = normalizeMonetaryCompositionPolicy(),
): OrderMonetaryComposition {
  assertOrder(order);
  const normalizedPolicy = normalizeMonetaryCompositionPolicy(policy);
  const classifiedRules = order.cartRules.map(classifyCartRule);
  const grossEligibleProductValueTaxIncl = sumMoney(
    order.lines.filter((line) => isEligibleClassification(classifyLine(line, normalizedPolicy))).map((line) => line.totalPriceTaxIncl),
  );
  const grossEligibleProductValueTaxExcl = sumMoney(
    order.lines.filter((line) => isEligibleClassification(classifyLine(line, normalizedPolicy))).map((line) => line.totalPriceTaxExcl),
  );
  const productApplicableOrderDiscountTaxIncl = sumMoney(classifiedRules.map((rule) => rule.productApplicableTaxIncl));
  const productApplicableOrderDiscountTaxExcl = sumMoney(classifiedRules.map((rule) => rule.productApplicableTaxExcl));
  const shippingDiscountTaxIncl = sumMoney(classifiedRules.map((rule) => rule.shippingDiscountTaxIncl));
  const shippingDiscountTaxExcl = sumMoney(classifiedRules.map((rule) => rule.shippingDiscountTaxExcl));
  const otherDiscountTaxIncl = sumMoney(classifiedRules.map((rule) => rule.otherDiscountTaxIncl));
  const otherDiscountTaxExcl = sumMoney(classifiedRules.map((rule) => rule.otherDiscountTaxExcl));
  const lineClassifications = order.lines.map((line) => classifyLine(line, normalizedPolicy));
  const eligibleLines = order.lines.filter((line, index) => isEligibleClassification(lineClassifications[index]!));
  const allocatedIncl = allocateByLargestRemainder(
    productApplicableOrderDiscountTaxIncl,
    eligibleLines.map((line) => line.totalPriceTaxIncl),
  );
  const allocatedExcl = allocateByLargestRemainder(
    productApplicableOrderDiscountTaxExcl,
    eligibleLines.map((line) => line.totalPriceTaxExcl),
  );
  const eligibleAllocationByLine = new Map<number, { incl: string; excl: string }>();
  eligibleLines.forEach((line, index) => {
    eligibleAllocationByLine.set(line.orderDetailId, {
      incl: allocatedIncl[index] ?? '0.000000',
      excl: allocatedExcl[index] ?? '0.000000',
    });
  });

  const lines = order.lines.map((line, index) => {
    const classification = lineClassifications[index]!;
    const allocation = eligibleAllocationByLine.get(line.orderDetailId) ?? { incl: '0.000000', excl: '0.000000' };
    const grossEligibleTaxIncl = isEligibleClassification(classification) ? money(line.totalPriceTaxIncl) : '0.000000';
    const grossEligibleTaxExcl = isEligibleClassification(classification) ? money(line.totalPriceTaxExcl) : '0.000000';
    const netEligibleTaxIncl = maxZero(subMoney(grossEligibleTaxIncl, allocation.incl));
    const netEligibleTaxExcl = maxZero(subMoney(grossEligibleTaxExcl, allocation.excl));
    return {
      ...line,
      classification,
      grossEligibleTaxIncl,
      grossEligibleTaxExcl,
      allocatedOrderDiscountTaxIncl: allocation.incl,
      allocatedOrderDiscountTaxExcl: allocation.excl,
      netEligibleTaxIncl,
      netEligibleTaxExcl,
      effectiveTaxRate: effectiveTaxRate(line.totalPriceTaxIncl, line.totalPriceTaxExcl),
      reasonCodes: lineReasonCodes(line, classification),
    };
  });

  const sumDetailTaxIncl = sumMoney(order.lines.map((line) => line.totalPriceTaxIncl));
  const sumDetailTaxExcl = sumMoney(order.lines.map((line) => line.totalPriceTaxExcl));
  const detailVsOrderProductsTaxInclDelta = subMoney(sumDetailTaxIncl, order.totalProductsTaxIncl);
  const detailVsOrderProductsTaxExclDelta = subMoney(sumDetailTaxExcl, order.totalProductsTaxExcl);
  const netEligibleProductValueTaxIncl = sumMoney(lines.map((line) => line.netEligibleTaxIncl));
  const netEligibleProductValueTaxExcl = sumMoney(lines.map((line) => line.netEligibleTaxExcl));
  const paidCandidateTaxIncl = addMoney(
    addMoney(subMoney(order.totalProductsTaxIncl, order.totalDiscountsTaxIncl), order.totalShippingTaxIncl),
    order.totalWrappingTaxIncl,
  );
  const paidCandidateTaxExcl = addMoney(
    addMoney(subMoney(order.totalProductsTaxExcl, order.totalDiscountsTaxExcl), order.totalShippingTaxExcl),
    order.totalWrappingTaxExcl,
  );
  const paidTotalReconciliationDeltaTaxIncl = subMoney(paidCandidateTaxIncl, order.totalPaidTaxIncl);
  const paidTotalReconciliationDeltaTaxExcl = subMoney(paidCandidateTaxExcl, order.totalPaidTaxExcl);
  const discountAttributionStatus = resolveDiscountAttributionStatus(classifiedRules, order);
  const reasonCodes = orderReasonCodes({
    detailVsOrderProductsTaxInclDelta,
    detailVsOrderProductsTaxExclDelta,
    paidTotalReconciliationDeltaTaxIncl,
    discountAttributionStatus,
    refundEvidence: order.refundEvidence,
    lines,
    classifiedRules,
  });

  return {
    orderId: order.orderId,
    prestashopCustomerId: order.prestashopCustomerId,
    validOrderAt: order.validOrderAt,
    grossEligibleProductValueTaxIncl,
    grossEligibleProductValueTaxExcl,
    productApplicableOrderDiscountTaxIncl,
    productApplicableOrderDiscountTaxExcl,
    shippingDiscountTaxIncl,
    shippingDiscountTaxExcl,
    otherDiscountTaxIncl,
    otherDiscountTaxExcl,
    netEligibleProductValueTaxIncl,
    netEligibleProductValueTaxExcl,
    excludedSellerServiceValueTaxIncl: sumByClassification(lines, 'SELLER_SERVICE', 'totalPriceTaxIncl'),
    excludedSellerServiceValueTaxExcl: sumByClassification(lines, 'SELLER_SERVICE', 'totalPriceTaxExcl'),
    excludedLogisticsValueTaxIncl: sumByClassification(lines, 'LOGISTICS_ARTIFACT', 'totalPriceTaxIncl'),
    excludedLogisticsValueTaxExcl: sumByClassification(lines, 'LOGISTICS_ARTIFACT', 'totalPriceTaxExcl'),
    unresolvedLineValueTaxIncl: sumByClassification(lines, 'UNRESOLVED', 'totalPriceTaxIncl'),
    shippingValueTaxIncl: money(order.totalShippingTaxIncl),
    wrappingValueTaxIncl: money(order.totalWrappingTaxIncl),
    detailVsOrderProductsTaxInclDelta,
    detailVsOrderProductsTaxExclDelta,
    paidTotalReconciliationDeltaTaxIncl,
    paidTotalReconciliationDeltaTaxExcl,
    reconciliationStatus: reconciliationStatus(paidTotalReconciliationDeltaTaxIncl),
    discountAttributionStatus,
    cartRuleCategories: [...new Set(classifiedRules.map((rule) => rule.category))].sort(),
    refundAdjustmentApplied: false,
    refundEvidence: order.refundEvidence,
    lines,
    cartRules: classifiedRules,
    reasonCodes,
  };
}

export function classifyCartRule(rule: MonetaryCartRuleInput): ClassifiedCartRule {
  const valueTaxIncl = money(rule.valueTaxIncl);
  const valueTaxExcl = money(rule.valueTaxExcl);
  const hasValue = compareMoney(valueTaxIncl, '0.000000') > 0 || compareMoney(valueTaxExcl, '0.000000') > 0;
  const hasProductReduction =
    compareMoney(rule.reductionAmount, '0.000000') > 0 ||
    compareMoney(rule.reductionPercent, '0.000000') > 0 ||
    rule.reductionProduct > 0;
  let category: CartRuleCategory = 'UNKNOWN';
  if (rule.giftProduct > 0) {
    category = 'GIFT_PRODUCT';
  } else if (rule.freeShipping && hasProductReduction) {
    category = 'MIXED_PRODUCT_AND_SHIPPING';
  } else if (rule.freeShipping && !hasProductReduction) {
    category = 'FREE_SHIPPING';
  } else if (compareMoney(rule.reductionPercent, '0.000000') > 0) {
    category = rule.reductionProduct > 0 ? 'SPECIFIC_PRODUCT_DISCOUNT' : 'PERCENT_PRODUCT_DISCOUNT';
  } else if (compareMoney(rule.reductionAmount, '0.000000') > 0 || (hasValue && !rule.freeShipping)) {
    category = rule.reductionProduct > 0 ? 'SPECIFIC_PRODUCT_DISCOUNT' : 'FIXED_PRODUCT_DISCOUNT';
  }

  const productApplicable = [
    'PERCENT_PRODUCT_DISCOUNT',
    'FIXED_PRODUCT_DISCOUNT',
    'SPECIFIC_PRODUCT_DISCOUNT',
    'MIXED_PRODUCT_AND_SHIPPING',
  ].includes(category);
  const shippingOnly = category === 'FREE_SHIPPING';
  const unknown = category === 'UNKNOWN' || category === 'GIFT_PRODUCT';
  return {
    ...rule,
    category,
    productApplicableTaxIncl: productApplicable ? valueTaxIncl : '0.000000',
    productApplicableTaxExcl: productApplicable ? valueTaxExcl : '0.000000',
    shippingDiscountTaxIncl: shippingOnly ? valueTaxIncl : '0.000000',
    shippingDiscountTaxExcl: shippingOnly ? valueTaxExcl : '0.000000',
    otherDiscountTaxIncl: unknown ? valueTaxIncl : '0.000000',
    otherDiscountTaxExcl: unknown ? valueTaxExcl : '0.000000',
  };
}

export function allocateByLargestRemainder(discount: string, weights: readonly string[]): readonly string[] {
  const discountScaled = toScaled(discount);
  const weightScaled = weights.map(toScaled);
  const totalWeight = weightScaled.reduce((sum, value) => sum + value, 0n);
  if (discountScaled <= 0n || totalWeight <= 0n || weights.length === 0) {
    return weights.map(() => '0.000000');
  }
  const raw = weightScaled.map((weight, index) => {
    const numerator = discountScaled * weight;
    return {
      index,
      floor: numerator / totalWeight,
      remainder: numerator % totalWeight,
      weight,
    };
  });
  const floorTotal = raw.reduce((sum, item) => sum + item.floor, 0n);
  let residue = discountScaled - floorTotal;
  const sorted = [...raw].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.weight !== b.weight) return a.weight > b.weight ? -1 : 1;
    return a.index - b.index;
  });
  const allocations = raw.map((item) => item.floor);
  for (const item of sorted) {
    if (residue <= 0n) break;
    allocations[item.index] = allocations[item.index]! + 1n;
    residue -= 1n;
  }
  return allocations.map(fromScaled);
}

export function compareMonetaryPolicies(orders: readonly MonetaryOrderInput[], compositions: readonly OrderMonetaryComposition[]): MonetaryPolicyComparison {
  assertSameOrderSet(orders, compositions);
  return {
    policyA_totalPaidTaxIncl: summarizePolicy(orders, compositions, (order) => order.totalPaidTaxIncl),
    policyB_totalProductsWt: summarizePolicy(orders, compositions, (order) => order.totalProductsTaxIncl),
    policyC_grossEligibleProductValueTaxIncl: summarizePolicy(orders, compositions, (_order, composition) => composition.grossEligibleProductValueTaxIncl),
    policyD_netEligibleProductValueTaxIncl: summarizePolicy(orders, compositions, (_order, composition) => composition.netEligibleProductValueTaxIncl),
    policyE_netEligibleProductValueTaxExcl: summarizePolicy(orders, compositions, (_order, composition) => composition.netEligibleProductValueTaxExcl),
  };
}

export function buildRfmMonetaryImpact(
  referenceTime: string,
  calculationVersion: string,
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
): RfmMonetaryImpact {
  assertSameOrderSet(orders, compositions);
  const beforeRows = buildRfmRows(referenceTime, calculationVersion, orders, orders.map((order) => order.totalPaidTaxIncl));
  const afterRows = buildRfmRows(referenceTime, calculationVersion, orders, compositions.map((composition) => composition.netEligibleProductValueTaxIncl));
  const beforeByCustomer = new Map(beforeRows.rows.map((row) => [row.prestashopCustomerId, row]));
  const afterByCustomer = new Map(afterRows.rows.map((row) => [row.prestashopCustomerId, row]));
  const changedRfmCodeCount = Array.from(beforeByCustomer.entries()).filter(([id, before]) => afterByCustomer.get(id)?.rfmCode !== before.rfmCode).length;
  const changedMonetaryScoreCount = Array.from(beforeByCustomer.entries()).filter(([id, before]) => afterByCustomer.get(id)?.monetaryScore !== before.monetaryScore).length;
  return {
    before: toRfmImpactSummary(beforeRows.rows, beforeRows.manifest),
    after: toRfmImpactSummary(afterRows.rows, afterRows.manifest),
    changedRfmCodeCount,
    changedMonetaryScoreCount,
    highGrossCohortCountBefore: beforeRows.rows.filter((row) => row.monetaryScore === 5).length,
    highGrossCohortCountAfter: afterRows.rows.filter((row) => row.monetaryScore === 5).length,
    historicallyHighGrossInactiveCountBefore: 0,
    historicallyHighGrossInactiveCountAfter: 0,
  };
}

export function evaluateLineValueSemantics(orders: readonly MonetaryOrderInput[]): {
  readonly verdict: LineValueSemanticsVerdict;
  readonly checkedLineCount: number;
  readonly quantityTimesUnitTaxInclMatches: number;
  readonly quantityTimesUnitTaxExclMatches: number;
  readonly productPriceTaxExclCandidateMatches: number;
  readonly specificDiscountMetadataPresentCount: number;
  readonly totalPriceAlreadyNettedEvidenceCount: number;
} {
  let quantityTimesUnitTaxInclMatches = 0;
  let quantityTimesUnitTaxExclMatches = 0;
  let productPriceTaxExclCandidateMatches = 0;
  let specificDiscountMetadataPresentCount = 0;
  let totalPriceAlreadyNettedEvidenceCount = 0;
  const lines = orders.flatMap((order) => order.lines);
  for (const line of lines) {
    const quantity = BigInt(line.productQuantity);
    const expectedIncl = fromScaled(toScaled(line.unitPriceTaxIncl) * quantity);
    const expectedExcl = fromScaled(toScaled(line.unitPriceTaxExcl) * quantity);
    if (absScaled(subScaled(toScaled(expectedIncl), toScaled(line.totalPriceTaxIncl))) <= MONEY_FACTOR) {
      quantityTimesUnitTaxInclMatches += 1;
    }
    if (absScaled(subScaled(toScaled(expectedExcl), toScaled(line.totalPriceTaxExcl))) <= MONEY_FACTOR) {
      quantityTimesUnitTaxExclMatches += 1;
    }
    if (absScaled(subScaled(toScaled(line.productPrice), toScaled(line.unitPriceTaxExcl))) <= MONEY_FACTOR) {
      productPriceTaxExclCandidateMatches += 1;
    }
    const hasDiscountMetadata =
      compareMoney(line.reductionAmount, '0.000000') > 0 ||
      compareMoney(line.reductionAmountTaxIncl, '0.000000') > 0 ||
      compareMoney(line.reductionAmountTaxExcl, '0.000000') > 0 ||
      compareMoney(line.reductionPercent, '0.000000') > 0 ||
      compareMoney(line.groupReduction, '0.000000') > 0;
    if (hasDiscountMetadata) {
      specificDiscountMetadataPresentCount += 1;
      if (compareMoney(line.totalPriceTaxIncl, expectedIncl) <= 0) {
        totalPriceAlreadyNettedEvidenceCount += 1;
      }
    }
  }
  const checkedLineCount = lines.length;
  const inclShare = checkedLineCount === 0 ? 0 : quantityTimesUnitTaxInclMatches / checkedLineCount;
  const exclShare = checkedLineCount === 0 ? 0 : quantityTimesUnitTaxExclMatches / checkedLineCount;
  const verdict: LineValueSemanticsVerdict =
    inclShare >= 0.99 && exclShare >= 0.99
      ? 'LINE_VALUE_SEMANTICS_CONFIRMED'
      : inclShare >= 0.95 && exclShare >= 0.95
        ? 'LINE_VALUE_SEMANTICS_PARTIAL'
        : 'LINE_VALUE_SEMANTICS_INCONSISTENT';
  return {
    verdict,
    checkedLineCount,
    quantityTimesUnitTaxInclMatches,
    quantityTimesUnitTaxExclMatches,
    productPriceTaxExclCandidateMatches,
    specificDiscountMetadataPresentCount,
    totalPriceAlreadyNettedEvidenceCount,
  };
}

export function evaluateManualTaxFormula(orders: readonly MonetaryOrderInput[]): {
  readonly verdict: ManualTaxFormulaVerdict;
  readonly checkedLineCount: number;
  readonly nineteenPercentLineCount: number;
  readonly zeroPercentLineCount: number;
  readonly otherRateLineCount: number;
} {
  const rates = orders.flatMap((order) => order.lines).map((line) => effectiveTaxRate(line.totalPriceTaxIncl, line.totalPriceTaxExcl));
  const checked = rates.filter((rate): rate is string => rate !== null);
  const nineteenPercentLineCount = checked.filter((rate) => absScaled(subScaled(toScaled(rate), toScaled('0.190000'))) <= 1000n).length;
  const zeroPercentLineCount = checked.filter((rate) => absScaled(toScaled(rate)) <= 1000n).length;
  const otherRateLineCount = checked.length - nineteenPercentLineCount - zeroPercentLineCount;
  let verdict: ManualTaxFormulaVerdict = 'INCORRECT_OR_DUPLICATES_TAX';
  if (checked.length > 0 && nineteenPercentLineCount === checked.length) {
    verdict = 'CORRECT_FOR_ALL_LINES';
  } else if (checked.length > 0 && nineteenPercentLineCount / checked.length >= 0.95 && otherRateLineCount === 0) {
    verdict = 'CORRECT_FOR_MOST_LINES';
  } else if (nineteenPercentLineCount > 0) {
    verdict = 'CORRECT_ONLY_FOR_19_PERCENT_LINES';
  }
  return {
    verdict,
    checkedLineCount: checked.length,
    nineteenPercentLineCount,
    zeroPercentLineCount,
    otherRateLineCount,
  };
}

export function buildMonetaryAuditVerdict(input: {
  readonly compositions: readonly OrderMonetaryComposition[];
  readonly policyComparison: MonetaryPolicyComparison;
  readonly lineSemantics: { readonly verdict: LineValueSemanticsVerdict };
  readonly manualTaxFormula: { readonly verdict: ManualTaxFormulaVerdict };
}): { readonly primaryVerdict: MonetaryAuditVerdict; readonly conditions: readonly MonetaryAuditCondition[]; readonly policyVersion: string; readonly rationale: readonly string[] } {
  const hasPartialDiscounts = input.compositions.some((composition) => composition.discountAttributionStatus === 'DISCOUNT_ATTRIBUTION_PARTIAL');
  const hasUnresolvedDiscounts = input.compositions.some((composition) => composition.discountAttributionStatus === 'DISCOUNT_ATTRIBUTION_UNRESOLVED');
  const hasSeller = input.compositions.some((composition) => compareMoney(composition.excludedSellerServiceValueTaxIncl, '0.000000') > 0);
  const hasLogistics = input.compositions.some((composition) => compareMoney(composition.excludedLogisticsValueTaxIncl, '0.000000') > 0);
  const monetaryDelta = subMoney(
    input.policyComparison.policyA_totalPaidTaxIncl.totalMonetary,
    input.policyComparison.policyD_netEligibleProductValueTaxIncl.totalMonetary,
  );
  let primaryVerdict: MonetaryAuditVerdict = 'MONETARY_POLICY_IDENTIFIED_WITH_EXCEPTIONS';
  if (hasUnresolvedDiscounts) {
    primaryVerdict = 'ORDER_DISCOUNT_ATTRIBUTION_UNRESOLVED';
  } else if (hasPartialDiscounts) {
    primaryVerdict = 'ORDER_DISCOUNT_ATTRIBUTION_PARTIAL';
  } else if (compareMoney(absMoney(monetaryDelta), '0.000000') > 0) {
    primaryVerdict = 'CURRENT_RFM_MONETARY_IS_CONTAMINATED';
  } else if (input.lineSemantics.verdict === 'LINE_VALUE_SEMANTICS_CONFIRMED') {
    primaryVerdict = 'MONETARY_POLICY_IDENTIFIED';
  }
  return {
    primaryVerdict,
    conditions: [
      'USE_TAX_INCL_AS_PRIMARY',
      'KEEP_TAX_EXCL_AS_AUXILIARY',
      ...(hasSeller ? (['EXCLUDE_SELLER_SERVICE'] as const) : []),
      ...(hasLogistics ? (['EXCLUDE_LOGISTICS_ARTIFACT'] as const) : []),
      'ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY',
      'DO_NOT_ALLOCATE_FREE_SHIPPING',
      'RFM_REQUIRES_MONETARY_RECALCULATION',
      'T08_REQUIRES_VALUE_RECALCULATION',
      'T09_REQUIRES_SPEND_RECALCULATION',
    ],
    policyVersion: monetaryCompositionPolicyVersion,
    rationale: [
      'Current RFM Monetary uses total_paid_tax_incl, not eligible product value.',
      'PrestaShop persisted tax-incl/tax-excl line totals are preferred over manual tax reconstruction.',
      'Order-level discounts need explicit attribution before production query changes.',
    ],
  };
}

export function assertMonetaryAuditReportHasNoPii(report: unknown): void {
  assertNoPii(report, 'report');
}

export function money(value: string | number): string {
  return fromScaled(toScaled(String(value)));
}

export function addMoney(...values: readonly string[]): string {
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

export function subMoney(left: string, right: string): string {
  return fromScaled(toScaled(left) - toScaled(right));
}

export function sumMoney(values: readonly string[]): string {
  return addMoney(...values);
}

export function compareMoney(left: string, right: string): number {
  const l = toScaled(left);
  const r = toScaled(right);
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

export function absMoney(value: string): string {
  return fromScaled(absScaled(toScaled(value)));
}

function classifyLine(line: MonetaryOrderLineInput, policy: MonetaryCompositionPolicy): TechnicalLineClassification {
  if (policy.confirmedSellerServiceProductIds.includes(line.productId)) return 'SELLER_SERVICE';
  if (policy.confirmedLogisticsProductIds.includes(line.productId)) return 'LOGISTICS_ARTIFACT';
  if (policy.confirmedCommercialServiceProductIds.includes(line.productId)) return 'REAL_COMMERCIAL_SERVICE';
  if (policy.unresolvedTechnicalProductIds.includes(line.productId)) return 'UNRESOLVED';
  return 'ELIGIBLE_COMMERCIAL_PRODUCT';
}

function isEligibleClassification(classification: TechnicalLineClassification): boolean {
  return classification === 'ELIGIBLE_COMMERCIAL_PRODUCT' || classification === 'REAL_COMMERCIAL_SERVICE';
}

function resolveDiscountAttributionStatus(
  rules: readonly ClassifiedCartRule[],
  order: MonetaryOrderInput,
): DiscountAttributionStatus {
  if (rules.length === 0 && compareMoney(order.totalDiscountsTaxIncl, '0.000000') === 0) {
    return 'DISCOUNT_ATTRIBUTION_CONFIRMED';
  }
  if (rules.some((rule) => rule.category === 'UNKNOWN' || rule.category === 'GIFT_PRODUCT')) {
    return 'DISCOUNT_ATTRIBUTION_UNRESOLVED';
  }
  if (rules.some((rule) => rule.category === 'MIXED_PRODUCT_AND_SHIPPING')) {
    return 'DISCOUNT_ATTRIBUTION_PARTIAL';
  }
  return 'DISCOUNT_ATTRIBUTION_CONFIRMED';
}

function reconciliationStatus(delta: string): ReconciliationStatus {
  const abs = absScaled(toScaled(delta));
  if (abs === 0n) return 'EXACT';
  if (abs <= MONEY_FACTOR) return 'WITHIN_1_CLP';
  if (abs <= 10n * MONEY_FACTOR) return 'WITHIN_10_CLP';
  if (abs <= 100n * MONEY_FACTOR) return 'WITHIN_100_CLP';
  if (abs <= 1000n * MONEY_FACTOR) return 'WITHIN_1000_CLP';
  return 'OVER_1000_CLP';
}

function effectiveTaxRate(taxIncl: string, taxExcl: string): string | null {
  const excl = toScaled(taxExcl);
  if (excl <= 0n) return null;
  const incl = toScaled(taxIncl);
  return fromScaled(((incl - excl) * MONEY_FACTOR + excl / 2n) / excl);
}

function maxZero(value: string): string {
  return compareMoney(value, '0.000000') < 0 ? '0.000000' : value;
}

function sumByClassification(
  lines: readonly ComposedOrderLine[],
  classification: TechnicalLineClassification,
  key: 'totalPriceTaxIncl' | 'totalPriceTaxExcl',
): string {
  return sumMoney(lines.filter((line) => line.classification === classification).map((line) => line[key]));
}

function summarizePolicy(
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
  valueOf: (order: MonetaryOrderInput, composition: OrderMonetaryComposition) => string,
): MonetaryPolicySummary {
  const values = orders.map((order, index) => money(valueOf(order, compositions[index]!)));
  const sorted = [...values].sort(compareMoney);
  return {
    orderCount: orders.length,
    customerCount: new Set(orders.map((order) => order.prestashopCustomerId)).size,
    totalMonetary: sumMoney(values),
    averageOrderValue: divideMoney(sumMoney(values), orders.length),
    medianOrderValue: percentileMoney(sorted, 0.5),
    p95OrderValue: percentileMoney(sorted, 0.95),
    zeroValueOrderCount: values.filter((value) => compareMoney(value, '0.000000') === 0).length,
    negativeValueOrderCount: values.filter((value) => compareMoney(value, '0.000000') < 0).length,
    reconciliationDelta: sumMoney(compositions.map((composition) => composition.paidTotalReconciliationDeltaTaxIncl)),
  };
}

function buildRfmRows(referenceTime: string, calculationVersion: string, orders: readonly MonetaryOrderInput[], values: readonly string[]) {
  const window = buildRfmSnapshotWindow(referenceTime);
  const grouped = new Map<number, { orders: MonetaryOrderInput[]; values: string[] }>();
  orders.forEach((order, index) => {
    const group = grouped.get(order.prestashopCustomerId) ?? { orders: [], values: [] };
    group.orders.push(order);
    group.values.push(values[index] ?? '0.000000');
    grouped.set(order.prestashopCustomerId, group);
  });
  const sourceRows: RfmPopulationSourceRow[] = Array.from(grouped.entries()).map(([prestashopCustomerId, group]) => {
    const sorted = [...group.orders].sort((a, b) => a.validOrderAt.localeCompare(b.validOrderAt) || a.orderId - b.orderId);
    return {
      prestashopCustomerId,
      firstValidOrderAt: sorted[0]!.validOrderAt,
      lastValidOrderAt: sorted.at(-1)!.validOrderAt,
      frequencyOrders: sorted.length,
      grossOrderValueTaxIncl: sumMoney(group.values),
      distinctShopCount: new Set(sorted.map((order) => order.shopId)).size,
    };
  });
  return buildRfmSnapshotDataset({
    referenceTime,
    windowStartInclusive: window.windowStartInclusive,
    windowEndExclusive: window.windowEndExclusive,
    generatedAt: referenceTime,
    calculationVersion,
    sourceRows,
    diagnostics: diagnosticsForRows(sourceRows, orders),
  });
}

function diagnosticsForRows(rows: readonly RfmPopulationSourceRow[], orders: readonly MonetaryOrderInput[]): RfmSnapshotDiagnostics {
  return {
    historicalCustomerCount: rows.length,
    validOrderCount: orders.length,
    grossOrderValueTaxIncl: sumMoney(orders.map((order) => order.totalPaidTaxIncl)),
    currency: {
      distinctCurrencyCount: new Set(orders.map((order) => order.currencyId)).size || 1,
      currencyCode: 'CLP',
      distinctConversionRateCount: new Set(orders.map((order) => order.conversionRate)).size || 1,
    },
    refunds: {
      refundedLineCount: 0,
      partiallyRefundedOrderCount: orders.filter((order) => order.refundEvidence).length,
      partiallyRefundedAmountObserved: '0.000000',
    },
    shops: {
      distinctShopCount: new Set(orders.map((order) => order.shopId)).size || 1,
      perShop: Array.from(new Set(orders.map((order) => order.shopId))).map((shopId) => {
        const shopOrders = orders.filter((order) => order.shopId === shopId);
        return {
          shopId,
          customers: new Set(shopOrders.map((order) => order.prestashopCustomerId)).size,
          orders: shopOrders.length,
          grossOrderValueTaxIncl: sumMoney(shopOrders.map((order) => order.totalPaidTaxIncl)),
        };
      }),
      crossShopCustomers: 0,
    },
    exclusions: {
      invalidOrderExcludedCount: 0,
      futureOrderExcludedCount: 0,
      excludedZeroValueOrderCount: orders.filter((order) => compareMoney(order.totalPaidTaxIncl, '0.000000') === 0).length,
      excludedOperationalAccountCount: 0,
      excludedOperationalAccountOrderCount: 0,
      excludedOperationalAccountValueTaxIncl: '0.000000',
      unusableCustomerOrderCount: 0,
      missingPrestashopCustomerOrderCount: 0,
    },
    // This impact-comparison tool measures policies A-E against total_paid_tax_incl; it does
    // not itself compute the seller-service exclusion diagnostics that the production reader
    // does (see mysql-rfm-population-reader.ts), so this stays zeroed rather than duplicating
    // that logic here.
    sellerService: {
      policyVersion: 'not_applicable_to_this_audit_tool',
      confirmedProductIds: [],
      ordersWithSellerServiceCount: 0,
      sellerServiceLineCount: 0,
      excludedSellerServiceValueTaxIncl: '0.000000',
      grossOrderValueBeforeSellerServiceExclusion: sumMoney(orders.map((order) => order.totalPaidTaxIncl)),
      monetaryAfterSellerServiceExclusion: sumMoney(orders.map((order) => order.totalPaidTaxIncl)),
      productTargetedDiscountOrderCount: 0,
    },
  };
}

function toRfmImpactSummary(rows: readonly RfmSnapshotRow[], manifest: { readonly monetaryDistribution: Record<string, unknown>; readonly monetaryScoreDistribution: Record<string, number>; readonly rfmCodeDistribution: Record<string, number> }): RfmImpactSummary {
  return {
    customerCount: rows.length,
    orderCount: rows.reduce((sum, row) => sum + row.frequencyOrders, 0),
    totalMonetary: sumMoney(rows.map((row) => row.grossOrderValueTaxIncl)),
    monetaryDistribution: manifest.monetaryDistribution,
    monetaryScoreDistribution: manifest.monetaryScoreDistribution,
    rfmCodeDistribution: manifest.rfmCodeDistribution,
  };
}

function percentileMoney(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.ceil(Math.min(Math.max(fraction, 0), 1) * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function divideMoney(numerator: string, denominator: number): string {
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return '0.000000';
  return fromScaled((toScaled(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

function assertSameOrderSet(orders: readonly MonetaryOrderInput[], compositions: readonly OrderMonetaryComposition[]): void {
  if (orders.length !== compositions.length) {
    throw new Error('Policy comparison requires the same order count');
  }
  orders.forEach((order, index) => {
    if (compositions[index]?.orderId !== order.orderId) {
      throw new Error('Policy comparison requires matching order order');
    }
  });
}

function lineReasonCodes(line: MonetaryOrderLineInput, classification: TechnicalLineClassification): readonly string[] {
  return [
    classification,
    ...(compareMoney(line.totalPriceTaxIncl, '0.000000') === 0 ? ['ZERO_LINE_VALUE'] : []),
    ...(compareMoney(line.reductionPercent, '0.000000') > 0 ? ['SPECIFIC_PERCENT_REDUCTION_METADATA'] : []),
    ...(compareMoney(line.reductionAmountTaxIncl, '0.000000') > 0 ? ['SPECIFIC_FIXED_REDUCTION_METADATA'] : []),
  ];
}

function orderReasonCodes(input: {
  readonly detailVsOrderProductsTaxInclDelta: string;
  readonly detailVsOrderProductsTaxExclDelta: string;
  readonly paidTotalReconciliationDeltaTaxIncl: string;
  readonly discountAttributionStatus: DiscountAttributionStatus;
  readonly refundEvidence: boolean;
  readonly lines: readonly ComposedOrderLine[];
  readonly classifiedRules: readonly ClassifiedCartRule[];
}): readonly string[] {
  return [
    ...(reconciliationStatus(input.detailVsOrderProductsTaxInclDelta) === 'EXACT' ? ['DETAIL_MATCHES_ORDER_PRODUCTS_TAX_INCL'] : ['DETAIL_PRODUCTS_TAX_INCL_DELTA']),
    ...(reconciliationStatus(input.detailVsOrderProductsTaxExclDelta) === 'EXACT' ? ['DETAIL_MATCHES_ORDER_PRODUCTS_TAX_EXCL'] : ['DETAIL_PRODUCTS_TAX_EXCL_DELTA']),
    ...(reconciliationStatus(input.paidTotalReconciliationDeltaTaxIncl) === 'EXACT' ? ['PAID_TOTAL_RECONCILES'] : ['PAID_TOTAL_RECONCILIATION_DELTA']),
    input.discountAttributionStatus,
    ...(input.refundEvidence ? ['REFUND_EVIDENCE_NOT_APPLIED'] : []),
    ...(input.lines.some((line) => line.classification === 'SELLER_SERVICE') ? ['SELLER_SERVICE_EXCLUDED'] : []),
    ...(input.lines.some((line) => line.classification === 'LOGISTICS_ARTIFACT') ? ['LOGISTICS_ARTIFACT_EXCLUDED'] : []),
    ...(input.classifiedRules.some((rule) => rule.category === 'FREE_SHIPPING') ? ['FREE_SHIPPING_NOT_ALLOCATED_TO_PRODUCTS'] : []),
  ];
}

function assertOrder(order: MonetaryOrderInput): void {
  if (!Number.isSafeInteger(order.orderId) || order.orderId <= 0) throw new Error('Invalid orderId');
  if (!Number.isSafeInteger(order.prestashopCustomerId) || order.prestashopCustomerId <= 0) throw new Error('Invalid prestashopCustomerId');
  for (const value of [
    order.totalProductsTaxExcl,
    order.totalProductsTaxIncl,
    order.totalDiscounts,
    order.totalDiscountsTaxIncl,
    order.totalDiscountsTaxExcl,
    order.totalShippingTaxIncl,
    order.totalShippingTaxExcl,
    order.totalWrappingTaxIncl,
    order.totalWrappingTaxExcl,
    order.totalPaidTaxIncl,
    order.totalPaidTaxExcl,
    order.totalPaidReal,
    order.conversionRate,
  ]) {
    money(value);
  }
  for (const line of order.lines) {
    if (!Number.isSafeInteger(line.orderDetailId) || line.orderDetailId <= 0) throw new Error('Invalid orderDetailId');
    if (!Number.isSafeInteger(line.productId) || line.productId < 0) throw new Error('Invalid productId');
    if (!Number.isSafeInteger(line.productQuantity) || line.productQuantity < 0) throw new Error('Invalid productQuantity');
    money(line.unitPriceTaxExcl);
    money(line.unitPriceTaxIncl);
    money(line.totalPriceTaxExcl);
    money(line.totalPriceTaxIncl);
    money(line.productPrice);
    money(line.reductionPercent);
    money(line.reductionAmount);
    money(line.reductionAmountTaxIncl);
    money(line.reductionAmountTaxExcl);
    money(line.groupReduction);
  }
}

function uniqueSorted(values: readonly number[]): readonly number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value >= 0))].sort((a, b) => a - b);
}

function toScaled(value: string): bigint {
  const trimmed = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid money decimal: ${value}`);
  }
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const unsigned = trimmed.replace(/^-/, '');
  const [whole, fractional = ''] = unsigned.split('.');
  const raw = BigInt(`${whole}${fractional}`);
  const scale = fractional.length;
  if (scale === MONEY_SCALE) return sign * raw;
  if (scale < MONEY_SCALE) return sign * raw * 10n ** BigInt(MONEY_SCALE - scale);
  const divisor = 10n ** BigInt(scale - MONEY_SCALE);
  const quotient = raw / divisor;
  const remainder = raw % divisor;
  return sign * (remainder * 2n >= divisor ? quotient + 1n : quotient);
}

function fromScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(MONEY_SCALE + 1, '0');
  return `${sign}${raw.slice(0, -MONEY_SCALE)}.${raw.slice(-MONEY_SCALE)}`;
}

function subScaled(left: bigint, right: bigint): bigint {
  return left - right;
}

function absScaled(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function assertNoPii(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenReportKey(key)) {
        throw new Error(`Monetary audit report contains a forbidden field: ${path}.${key}`);
      }
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenReportString(value)) {
    throw new Error(`Monetary audit report contains a PII-shaped value at ${path}`);
  }
}

function isForbiddenReportKey(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return [
    'email',
    'phone',
    'telefono',
    'rut',
    'dni',
    'document',
    'firstname',
    'lastname',
    'address',
    'street',
    'payload',
    'card',
    'authorization',
  ].some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenReportString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^\-?\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{8,64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?(?:\.\d{3})?Z?$/.test(trimmed) ||
    /^[A-Z_]+$/.test(trimmed)
  ) {
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}

export function monetaryCompositionChecksum(value: unknown): string {
  return sha256Stable({ policyVersion: monetaryCompositionPolicyVersion, value });
}
