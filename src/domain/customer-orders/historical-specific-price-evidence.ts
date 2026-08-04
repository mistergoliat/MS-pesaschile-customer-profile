import { sha256Stable } from '../customer-rfm/checksum.js';

const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export const historicalSpecificPriceEvidenceAuditVersion = 'historical-specific-price-evidence-v1';

export type HistoricalSpecificPriceContextStatus =
  | 'CONTEXT_COMPLETE'
  | 'CONTEXT_PARTIAL'
  | 'CONTEXT_CURRENT_ONLY'
  | 'CONTEXT_UNAVAILABLE';

export type HistoricalBasePriceEvidenceStatus =
  | 'BASE_PRICE_OBSERVABLE'
  | 'BASE_PRICE_CURRENT_STATE_ONLY'
  | 'BASE_PRICE_UNAVAILABLE';

export type HistoricalSpecificPriceSelectionStatus =
  | 'NO_SPECIFIC_PRICE'
  | 'SPECIFIC_PRICE_SELECTED'
  | 'SPECIFIC_PRICE_SELECTION_PARTIAL'
  | 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
  | 'CONTEXT_INCOMPLETE';

export type HistoricalSpecificPriceTaxStatus =
  | 'TAX_RATE_CONFIRMED'
  | 'TAX_RATE_DERIVED_FROM_ORDER_DETAIL'
  | 'TAX_RATE_UNAVAILABLE'
  | 'TAX_RATE_INCONSISTENT';

export type HistoricalSpecificPriceComparisonClassification =
  | 'NO_SPECIFIC_PRICE_AND_ORDER_DETAIL_MATCHES_BASE'
  | 'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES'
  | 'SPECIFIC_PRICE_APPLIED_BUT_ORDER_DETAIL_DIFFERS'
  | 'ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED'
  | 'ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED'
  | 'ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED'
  | 'ROUNDING_ONLY'
  | 'CONTEXT_INCOMPLETE'
  | 'HISTORICAL_PRICE_NOT_PROVABLE';

export type HistoricalSpecificDiscountAuthorityVerdict =
  | 'HISTORICAL_SPECIFIC_DISCOUNT_RECONSTRUCTION_VALIDATED'
  | 'HISTORICAL_SPECIFIC_DISCOUNT_RECONSTRUCTION_VALIDATED_WITH_GAPS'
  | 'ORDER_DETAIL_ALREADY_REFLECTS_SPECIFIC_DISCOUNT'
  | 'ORDER_DETAIL_DOES_NOT_REFLECT_SPECIFIC_DISCOUNT'
  | 'HISTORICAL_SPECIFIC_DISCOUNT_NOT_RECOVERABLE'
  | 'BLOCKED_BY_HISTORICAL_BASE_PRICE'
  | 'BLOCKED_BY_CUSTOMER_GROUP_HISTORY'
  | 'BLOCKED_BY_SPECIFIC_PRICE_PRIORITY'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type HistoricalSpecificPriceLineInput = {
  readonly orderDetailId: number;
  readonly orderId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly quantity: number;
  readonly orderDate: string;
  readonly shopId: number;
  readonly currencyId: number;
  readonly customerId: number;
  readonly countryId: number | null;
  readonly customerGroupId: number | null;
  readonly customerGroupSource: 'historical' | 'current_default' | 'unavailable';
  readonly productActive: boolean | null;
  readonly productBasePriceTaxExcl: string | null;
  readonly combinationImpactTaxExcl: string | null;
  readonly basePriceSource: 'product_shop' | 'product' | 'current_state' | 'unavailable';
  readonly combinationImpactSource: 'product_attribute_shop' | 'product_attribute' | 'current_state' | 'not_applicable' | 'unavailable';
  readonly orderDetailUnitPriceTaxIncl: string;
  readonly orderDetailUnitPriceTaxExcl: string;
  readonly orderDetailTotalPriceTaxIncl: string;
  readonly orderDetailTotalPriceTaxExcl: string;
  readonly orderDetailTaxRate: string | null;
  readonly isSellerService: boolean;
  readonly isLogisticsArtifact: boolean;
};

export type HistoricalSpecificPriceCandidate = {
  readonly specificPriceId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly shopId: number;
  readonly currencyId: number;
  readonly countryId: number;
  readonly groupId: number;
  readonly customerId: number;
  readonly cartId: number;
  readonly price: string;
  readonly fromQuantity: number;
  readonly reduction: string;
  readonly reductionTax: boolean;
  readonly reductionType: 'amount' | 'percentage' | 'unknown';
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly priority?: number | null;
};

export type HistoricalSpecificPriceSelection = {
  readonly selected: HistoricalSpecificPriceCandidate | null;
  readonly candidateCount: number;
  readonly compatibleCandidateCount: number;
  readonly selectedSpecificPriceId: number | null;
  readonly selectionScore: readonly number[];
  readonly selectionReason: string;
  readonly matchedDimensions: readonly string[];
  readonly status: HistoricalSpecificPriceSelectionStatus;
};

export type HistoricalSpecificPriceTaxEvidence = {
  readonly status: HistoricalSpecificPriceTaxStatus;
  readonly taxRate: string | null;
  readonly source: 'order_detail_tax_rate' | 'order_detail_unit_prices' | 'unavailable' | 'inconsistent';
  readonly reasonCodes: readonly string[];
};

export type HistoricalSpecificPriceResolution = {
  readonly baseEvidenceStatus: HistoricalBasePriceEvidenceStatus;
  readonly historicalBaseUnitPriceTaxExcl: string | null;
  readonly historicalEffectiveUnitPriceTaxExcl: string | null;
  readonly historicalBaseUnitPriceTaxIncl: string | null;
  readonly historicalEffectiveUnitPriceTaxIncl: string | null;
  readonly historicalBaseLineValueTaxIncl: string | null;
  readonly historicalEffectiveLineValueTaxIncl: string | null;
  readonly reconstructedSpecificProductDiscountTaxIncl: string | null;
  readonly discountType: 'amount' | 'percentage' | 'price_override' | 'price_override_percentage' | 'price_override_amount' | null;
  readonly discountValue: string | null;
  readonly source: 'CATALOG_BASE_PRICE' | 'CATALOG_SPECIFIC_PRICE' | 'UNRESOLVED';
  readonly reasonCodes: readonly string[];
};

export type HistoricalSpecificPriceComparison = {
  readonly unitDeltaTaxIncl: string | null;
  readonly lineDeltaTaxIncl: string | null;
  readonly unitDeltaBucket: string;
  readonly lineDeltaBucket: string;
  readonly classification: HistoricalSpecificPriceComparisonClassification;
  readonly orderDetailAlreadyReflectsSpecificPrice: boolean | null;
};

export type HistoricalSpecificPriceLineEvidence = {
  readonly orderDetailId: number;
  readonly orderId: number;
  readonly productId: number;
  readonly productAttributeId: number;
  readonly quantity: number;
  readonly orderDate: string;
  readonly shopId: number;
  readonly currencyId: number;
  readonly contextStatus: HistoricalSpecificPriceContextStatus;
  readonly baseEvidenceStatus: HistoricalBasePriceEvidenceStatus;
  readonly taxEvidence: HistoricalSpecificPriceTaxEvidence;
  readonly selection: HistoricalSpecificPriceSelection;
  readonly resolution: HistoricalSpecificPriceResolution;
  readonly comparison: HistoricalSpecificPriceComparison;
  readonly isCommercialLine: boolean;
  readonly exclusionReason: 'SELLER_SERVICE' | 'LOGISTICS_ARTIFACT' | null;
  readonly reasonCodes: readonly string[];
};

export type HistoricalSpecificPriceAuditSummary = {
  readonly commercialLineCount: number;
  readonly linesWithSpecificPriceCandidate: number;
  readonly linesWithSelectedSpecificPrice: number;
  readonly linesWithPercentageReduction: number;
  readonly linesWithAmountReduction: number;
  readonly linesWithPriceOverride: number;
  readonly linesWithCombinationSpecificRule: number;
  readonly linesWithShopSpecificRule: number;
  readonly linesWithCustomerSpecificRule: number;
  readonly linesWithGroupSpecificRule: number;
  readonly linesWithCountrySpecificRule: number;
  readonly linesWithCurrencySpecificRule: number;
  readonly linesWithQuantityRule: number;
  readonly grossBaseValueTaxIncl: string;
  readonly reconstructedSpecificProductDiscountTaxIncl: string;
  readonly effectiveValueTaxIncl: string;
  readonly orderDetailMatchRate: string;
  readonly contextCompleteRate: string;
};

export type HistoricalSpecificPriceAuditVerdict = {
  readonly primaryVerdict: HistoricalSpecificDiscountAuthorityVerdict;
  readonly conditions: readonly string[];
  readonly rationale: readonly string[];
  readonly version: typeof historicalSpecificPriceEvidenceAuditVersion;
};

export function auditHistoricalSpecificPriceEvidence(input: {
  readonly lines: readonly HistoricalSpecificPriceLineInput[];
  readonly specificPrices: readonly HistoricalSpecificPriceCandidate[];
}): readonly HistoricalSpecificPriceLineEvidence[] {
  return input.lines.map((line) => auditHistoricalSpecificPriceLine(line, input.specificPrices));
}

export function auditHistoricalSpecificPriceLine(
  line: HistoricalSpecificPriceLineInput,
  allCandidates: readonly HistoricalSpecificPriceCandidate[],
): HistoricalSpecificPriceLineEvidence {
  assertLine(line);
  const candidates = allCandidates.filter((candidate) => candidate.productId === line.productId);
  candidates.forEach(assertCandidate);
  const contextStatus = contextStatusFor(line);
  const taxEvidence = taxEvidenceFor(line);
  const selection = selectHistoricalSpecificPriceForOrderDate(line, candidates, contextStatus);
  const resolution = resolveHistoricalSpecificPrice(line, selection, taxEvidence);
  const comparison = compareWithOrderDetail(line, contextStatus, selection, resolution);
  const exclusionReason = line.isSellerService ? 'SELLER_SERVICE' : line.isLogisticsArtifact ? 'LOGISTICS_ARTIFACT' : null;
  return {
    orderDetailId: line.orderDetailId,
    orderId: line.orderId,
    productId: line.productId,
    productAttributeId: line.productAttributeId,
    quantity: line.quantity,
    orderDate: line.orderDate,
    shopId: line.shopId,
    currencyId: line.currencyId,
    contextStatus,
    baseEvidenceStatus: resolution.baseEvidenceStatus,
    taxEvidence,
    selection,
    resolution,
    comparison,
    isCommercialLine: exclusionReason === null,
    exclusionReason,
    reasonCodes: [
      contextStatus,
      resolution.baseEvidenceStatus,
      taxEvidence.status,
      selection.status,
      comparison.classification,
      ...(line.productActive === false ? ['PRODUCT_CURRENTLY_INACTIVE'] : []),
      ...(exclusionReason ? [exclusionReason] : []),
    ],
  };
}

export function selectHistoricalSpecificPriceForOrderDate(
  line: HistoricalSpecificPriceLineInput,
  candidates: readonly HistoricalSpecificPriceCandidate[],
  contextStatus: HistoricalSpecificPriceContextStatus = contextStatusFor(line),
): HistoricalSpecificPriceSelection {
  const contextIncomplete = hasSelectionContextGap(line, candidates);
  const compatible = candidates.filter((candidate) => isCompatibleAtOrderDate(line, candidate));
  const scored = compatible.map((candidate) => ({
    candidate,
    score: catalogSpecificityScore(line, candidate),
  })).sort(compareScoredSpecificPrices);
  const selected = scored[0]?.candidate ?? null;
  const topScore = scored[0]?.score ?? [];
  const ambiguous = scored.length > 1 && selected !== null && sameCommercialScore(topScore, scored[1]!.score);
  const matchedDimensions = selected ? matchedDimensionsFor(line, selected) : [];
  const status: HistoricalSpecificPriceSelectionStatus = contextStatus === 'CONTEXT_UNAVAILABLE' || contextIncomplete
    ? 'CONTEXT_INCOMPLETE'
    : ambiguous
      ? 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
      : selected
        ? contextStatus === 'CONTEXT_COMPLETE'
          ? 'SPECIFIC_PRICE_SELECTED'
          : 'SPECIFIC_PRICE_SELECTION_PARTIAL'
        : 'NO_SPECIFIC_PRICE';
  return {
    selected,
    candidateCount: candidates.length,
    compatibleCandidateCount: compatible.length,
    selectedSpecificPriceId: selected?.specificPriceId ?? null,
    selectionScore: topScore,
    selectionReason: selected
      ? `catalog_score:${topScore.join(',')};matched:${matchedDimensions.join(',') || 'wildcard'}`
      : contextIncomplete
        ? 'context_incomplete_for_specific_price_dimensions'
        : 'no_specific_price_valid_at_order_date',
    matchedDimensions,
    status,
  };
}

export function resolveHistoricalSpecificPrice(
  line: HistoricalSpecificPriceLineInput,
  selection: HistoricalSpecificPriceSelection,
  taxEvidence: HistoricalSpecificPriceTaxEvidence = taxEvidenceFor(line),
): HistoricalSpecificPriceResolution {
  const baseEvidenceStatus = baseEvidenceStatusFor(line);
  if (line.isSellerService || line.isLogisticsArtifact) {
    return unresolvedResolution(baseEvidenceStatus, ['TECHNICAL_LINE_EXCLUDED']);
  }
  if (baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE' || taxEvidence.taxRate === null) {
    return unresolvedResolution(baseEvidenceStatus, [
      ...(baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE' ? ['BASE_PRICE_UNAVAILABLE'] : []),
      ...(taxEvidence.taxRate === null ? ['TAX_RATE_UNAVAILABLE'] : []),
    ]);
  }
  const baseTaxExcl = spMaxZero(spAdd(line.productBasePriceTaxExcl!, line.combinationImpactTaxExcl!));
  let effectiveTaxExcl = baseTaxExcl;
  let discountType: HistoricalSpecificPriceResolution['discountType'] = null;
  let discountValue: string | null = null;
  const selected = selection.selected;
  const reasonCodes: string[] = [];
  if (selected) {
    if (spCompare(selected.price, '0.000000') >= 0) {
      effectiveTaxExcl = spMaxZero(spAdd(selected.price, line.combinationImpactTaxExcl!));
      discountType = 'price_override';
      discountValue = spMoney(selected.price);
      reasonCodes.push('PRICE_OVERRIDE');
    }
    if (selected.reductionType === 'percentage' && spCompare(selected.reduction, '0.000000') > 0) {
      effectiveTaxExcl = spMaxZero(spMultiply(effectiveTaxExcl, spSub('1.000000', selected.reduction)));
      discountType = discountType === 'price_override' ? 'price_override_percentage' : 'percentage';
      discountValue = selected.reduction;
      reasonCodes.push('PERCENTAGE_REDUCTION');
    } else if (selected.reductionType === 'amount' && spCompare(selected.reduction, '0.000000') > 0) {
      const taxMultiplier = spAdd('1.000000', taxEvidence.taxRate);
      const reductionTaxExcl = selected.reductionTax ? spDivide(selected.reduction, taxMultiplier) : selected.reduction;
      effectiveTaxExcl = spMaxZero(spSub(effectiveTaxExcl, reductionTaxExcl));
      discountType = discountType === 'price_override' ? 'price_override_amount' : 'amount';
      discountValue = selected.reductionTax ? reductionTaxExcl : spMoney(selected.reduction);
      reasonCodes.push(selected.reductionTax ? 'AMOUNT_REDUCTION_TAX_INCL' : 'AMOUNT_REDUCTION_TAX_EXCL');
    } else if (selected.reductionType === 'unknown') {
      return unresolvedResolution(baseEvidenceStatus, ['UNKNOWN_REDUCTION_TYPE']);
    }
  }
  const baseTaxIncl = roundToClp(spMultiply(baseTaxExcl, spAdd('1.000000', taxEvidence.taxRate)));
  const effectiveTaxIncl = roundToClp(spMultiply(effectiveTaxExcl, spAdd('1.000000', taxEvidence.taxRate)));
  const baseLine = spMultiplyInt(baseTaxIncl, line.quantity);
  const effectiveLine = spMultiplyInt(effectiveTaxIncl, line.quantity);
  return {
    baseEvidenceStatus,
    historicalBaseUnitPriceTaxExcl: baseTaxExcl,
    historicalEffectiveUnitPriceTaxExcl: effectiveTaxExcl,
    historicalBaseUnitPriceTaxIncl: baseTaxIncl,
    historicalEffectiveUnitPriceTaxIncl: effectiveTaxIncl,
    historicalBaseLineValueTaxIncl: baseLine,
    historicalEffectiveLineValueTaxIncl: effectiveLine,
    reconstructedSpecificProductDiscountTaxIncl: spMaxZero(spSub(baseLine, effectiveLine)),
    discountType,
    discountValue,
    source: selected ? 'CATALOG_SPECIFIC_PRICE' : 'CATALOG_BASE_PRICE',
    reasonCodes: [
      ...(baseEvidenceStatus === 'BASE_PRICE_CURRENT_STATE_ONLY' ? ['BASE_PRICE_IS_CURRENT_STATE_ONLY'] : []),
      ...(selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS' ? ['SELECTION_AMBIGUOUS'] : []),
      ...reasonCodes,
    ],
  };
}

export function summarizeHistoricalSpecificPriceEvidence(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
): HistoricalSpecificPriceAuditSummary {
  const commercial = evidences.filter((line) => line.isCommercialLine);
  const selected = commercial.filter((line) => line.selection.selected !== null);
  const matches = commercial.filter((line) => (
    line.comparison.classification === 'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES' ||
    line.comparison.classification === 'NO_SPECIFIC_PRICE_AND_ORDER_DETAIL_MATCHES_BASE' ||
    line.comparison.classification === 'ROUNDING_ONLY'
  ));
  return {
    commercialLineCount: commercial.length,
    linesWithSpecificPriceCandidate: commercial.filter((line) => line.selection.candidateCount > 0).length,
    linesWithSelectedSpecificPrice: selected.length,
    linesWithPercentageReduction: selected.filter((line) => line.resolution.discountType === 'percentage' || line.resolution.discountType === 'price_override_percentage').length,
    linesWithAmountReduction: selected.filter((line) => line.resolution.discountType === 'amount' || line.resolution.discountType === 'price_override_amount').length,
    linesWithPriceOverride: selected.filter((line) => line.resolution.discountType?.startsWith('price_override') === true).length,
    linesWithCombinationSpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('combination')).length,
    linesWithShopSpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('shop')).length,
    linesWithCustomerSpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('customer')).length,
    linesWithGroupSpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('group')).length,
    linesWithCountrySpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('country')).length,
    linesWithCurrencySpecificRule: selected.filter((line) => line.selection.matchedDimensions.includes('currency')).length,
    linesWithQuantityRule: selected.filter((line) => line.selection.matchedDimensions.includes('quantity')).length,
    grossBaseValueTaxIncl: spSum(commercial.map((line) => line.resolution.historicalBaseLineValueTaxIncl ?? '0.000000')),
    reconstructedSpecificProductDiscountTaxIncl: spSum(commercial.map((line) => line.resolution.reconstructedSpecificProductDiscountTaxIncl ?? '0.000000')),
    effectiveValueTaxIncl: spSum(commercial.map((line) => line.resolution.historicalEffectiveLineValueTaxIncl ?? '0.000000')),
    orderDetailMatchRate: spRatio(matches.length, commercial.length),
    contextCompleteRate: spRatio(commercial.filter((line) => line.contextStatus === 'CONTEXT_COMPLETE').length, commercial.length),
  };
}

export function buildHistoricalSpecificPriceAuditVerdict(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
): HistoricalSpecificPriceAuditVerdict {
  const commercial = evidences.filter((line) => line.isCommercialLine);
  const summary = summarizeHistoricalSpecificPriceEvidence(evidences);
  const withSelected = commercial.filter((line) => line.selection.selected !== null);
  const selectedMatches = withSelected.filter((line) => line.comparison.classification === 'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES').length;
  const selectedBaseOnly = withSelected.filter((line) => line.comparison.classification === 'ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED').length;
  const unresolved = commercial.filter((line) => line.comparison.classification === 'HISTORICAL_PRICE_NOT_PROVABLE').length;
  const baseBlocked = commercial.filter((line) => line.baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE').length;
  const groupBlocked = commercial.filter((line) => line.contextStatus !== 'CONTEXT_COMPLETE').length;
  const ambiguous = commercial.filter((line) => line.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS').length;
  let primaryVerdict: HistoricalSpecificDiscountAuthorityVerdict = 'HISTORICAL_SPECIFIC_DISCOUNT_RECONSTRUCTION_VALIDATED_WITH_GAPS';
  if (baseBlocked / Math.max(commercial.length, 1) > 0.25) {
    primaryVerdict = 'BLOCKED_BY_HISTORICAL_BASE_PRICE';
  } else if (groupBlocked / Math.max(commercial.length, 1) > 0.5) {
    primaryVerdict = 'BLOCKED_BY_CUSTOMER_GROUP_HISTORY';
  } else if (ambiguous > 0) {
    primaryVerdict = 'BLOCKED_BY_SPECIFIC_PRICE_PRIORITY';
  } else if (unresolved / Math.max(commercial.length, 1) > 0.25) {
    primaryVerdict = 'HISTORICAL_SPECIFIC_DISCOUNT_NOT_RECOVERABLE';
  } else if (withSelected.length > 0 && selectedMatches / withSelected.length >= 0.95) {
    primaryVerdict = 'ORDER_DETAIL_ALREADY_REFLECTS_SPECIFIC_DISCOUNT';
  } else if (withSelected.length > 0 && selectedBaseOnly / withSelected.length >= 0.95) {
    primaryVerdict = 'ORDER_DETAIL_DOES_NOT_REFLECT_SPECIFIC_DISCOUNT';
  } else if (
    commercial.length > 0 &&
    Number(summary.orderDetailMatchRate) >= 0.95 &&
    Number(summary.contextCompleteRate) >= 0.95 &&
    baseBlocked === 0
  ) {
    primaryVerdict = 'HISTORICAL_SPECIFIC_DISCOUNT_RECONSTRUCTION_VALIDATED';
  }
  return {
    primaryVerdict,
    conditions: [
      'USE_ORDER_DATE_AS_EFFECTIVE_AT',
      'CATALOG_SPECIFIC_PRICE_PRIORITY_REPLICATED',
      'NO_PRODUCT_ACTIVE_FILTER_FOR_HISTORY',
      'DO_NOT_USE_CURRENT_PRICE_AS_HISTORICAL_AUTHORITY',
      'DO_NOT_MIX_ORDER_LEVEL_DISCOUNTS',
      ...(baseBlocked > 0 ? ['HISTORICAL_BASE_PRICE_GAPS'] : []),
      ...(groupBlocked > 0 ? ['CUSTOMER_GROUP_HISTORY_GAPS'] : []),
      ...(ambiguous > 0 ? ['SPECIFIC_PRICE_PRIORITY_NEEDS_BUSINESS_RULE'] : []),
    ],
    rationale: [
      `commercialLineCount=${commercial.length}`,
      `linesWithSelectedSpecificPrice=${summary.linesWithSelectedSpecificPrice}`,
      `orderDetailMatchRate=${summary.orderDetailMatchRate}`,
      `contextCompleteRate=${summary.contextCompleteRate}`,
      `unresolvedLineCount=${unresolved}`,
      `ambiguousSelectionCount=${ambiguous}`,
    ],
    version: historicalSpecificPriceEvidenceAuditVersion,
  };
}

export function countHistoricalSpecificPriceEvidenceBy<T extends string>(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
  keyOf: (line: HistoricalSpecificPriceLineEvidence) => T,
): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const evidence of evidences) {
    const key = keyOf(evidence);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) as Record<T, number>;
}

export function historicalSpecificPriceEvidenceChecksum(value: unknown): string {
  return sha256Stable({ version: historicalSpecificPriceEvidenceAuditVersion, value });
}

export function assertHistoricalSpecificPriceReportHasNoPii(value: unknown): void {
  assertNoPii(value, 'report');
}

function compareWithOrderDetail(
  line: HistoricalSpecificPriceLineInput,
  contextStatus: HistoricalSpecificPriceContextStatus,
  selection: HistoricalSpecificPriceSelection,
  resolution: HistoricalSpecificPriceResolution,
): HistoricalSpecificPriceComparison {
  if (contextStatus === 'CONTEXT_UNAVAILABLE' || selection.status === 'CONTEXT_INCOMPLETE') {
    return unresolvedComparison('CONTEXT_INCOMPLETE');
  }
  if (resolution.historicalEffectiveUnitPriceTaxIncl === null || resolution.historicalEffectiveLineValueTaxIncl === null) {
    return unresolvedComparison('HISTORICAL_PRICE_NOT_PROVABLE');
  }
  const unitDelta = spSub(line.orderDetailUnitPriceTaxIncl, resolution.historicalEffectiveUnitPriceTaxIncl);
  const lineDelta = spSub(line.orderDetailTotalPriceTaxIncl, resolution.historicalEffectiveLineValueTaxIncl);
  const unitBucket = deltaBucket(unitDelta);
  const lineBucket = deltaBucket(lineDelta);
  let classification: HistoricalSpecificPriceComparisonClassification;
  if (unitBucket === '0' && lineBucket === '0') {
    classification = selection.selected
      ? 'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES'
      : 'NO_SPECIFIC_PRICE_AND_ORDER_DETAIL_MATCHES_BASE';
  } else if ((unitBucket === '<=1 CLP' || unitBucket === '0') && (lineBucket === '<=1 CLP' || lineBucket === '0')) {
    classification = 'ROUNDING_ONLY';
  } else if (
    selection.selected &&
    resolution.historicalBaseUnitPriceTaxIncl !== null &&
    spCompare(spAbs(spSub(line.orderDetailUnitPriceTaxIncl, resolution.historicalBaseUnitPriceTaxIncl)), '0.000000') === 0
  ) {
    classification = 'ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED';
  } else if (spCompare(unitDelta, '0.000000') < 0 || spCompare(lineDelta, '0.000000') < 0) {
    classification = selection.selected ? 'ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED' : 'HISTORICAL_PRICE_NOT_PROVABLE';
  } else if (spCompare(unitDelta, '0.000000') > 0 || spCompare(lineDelta, '0.000000') > 0) {
    classification = selection.selected ? 'ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED' : 'HISTORICAL_PRICE_NOT_PROVABLE';
  } else {
    classification = selection.selected ? 'SPECIFIC_PRICE_APPLIED_BUT_ORDER_DETAIL_DIFFERS' : 'HISTORICAL_PRICE_NOT_PROVABLE';
  }
  if (selection.selected && ![
    'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES',
    'ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED',
    'ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED',
    'ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED',
    'ROUNDING_ONLY',
  ].includes(classification)) {
    classification = 'SPECIFIC_PRICE_APPLIED_BUT_ORDER_DETAIL_DIFFERS';
  }
  return {
    unitDeltaTaxIncl: unitDelta,
    lineDeltaTaxIncl: lineDelta,
    unitDeltaBucket: unitBucket,
    lineDeltaBucket: lineBucket,
    classification,
    orderDetailAlreadyReflectsSpecificPrice: selection.selected ? classification === 'SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES' || classification === 'ROUNDING_ONLY' : null,
  };
}

function taxEvidenceFor(line: HistoricalSpecificPriceLineInput): HistoricalSpecificPriceTaxEvidence {
  if (line.orderDetailTaxRate !== null) {
    const explicit = spMoney(line.orderDetailTaxRate);
    const derived = deriveTaxRateFromOrderDetail(line);
    if (derived !== null && spCompare(spAbs(spSub(explicit, derived)), '0.010000') > 0) {
      return {
        status: 'TAX_RATE_INCONSISTENT',
        taxRate: explicit,
        source: 'inconsistent',
        reasonCodes: ['ORDER_DETAIL_TAX_RATE_DIFFERS_FROM_UNIT_PRICES'],
      };
    }
    return {
      status: 'TAX_RATE_CONFIRMED',
      taxRate: explicit,
      source: 'order_detail_tax_rate',
      reasonCodes: ['ORDER_DETAIL_TAX_RATE_AVAILABLE'],
    };
  }
  const derived = deriveTaxRateFromOrderDetail(line);
  if (derived === null) {
    return {
      status: 'TAX_RATE_UNAVAILABLE',
      taxRate: null,
      source: 'unavailable',
      reasonCodes: ['ORDER_DETAIL_UNIT_TAX_EXCL_UNAVAILABLE_OR_ZERO'],
    };
  }
  return {
    status: 'TAX_RATE_DERIVED_FROM_ORDER_DETAIL',
    taxRate: derived,
    source: 'order_detail_unit_prices',
    reasonCodes: ['DERIVED_FROM_ORDER_DETAIL_UNIT_PRICES'],
  };
}

function deriveTaxRateFromOrderDetail(line: HistoricalSpecificPriceLineInput): string | null {
  if (spCompare(line.orderDetailUnitPriceTaxExcl, '0.000000') <= 0) return null;
  return spDivide(
    spSub(line.orderDetailUnitPriceTaxIncl, line.orderDetailUnitPriceTaxExcl),
    line.orderDetailUnitPriceTaxExcl,
  );
}

function baseEvidenceStatusFor(line: HistoricalSpecificPriceLineInput): HistoricalBasePriceEvidenceStatus {
  if (line.productBasePriceTaxExcl === null || line.combinationImpactTaxExcl === null) return 'BASE_PRICE_UNAVAILABLE';
  if (line.basePriceSource === 'current_state' || line.combinationImpactSource === 'current_state' || line.productActive === false) {
    return 'BASE_PRICE_CURRENT_STATE_ONLY';
  }
  return 'BASE_PRICE_OBSERVABLE';
}

function contextStatusFor(line: HistoricalSpecificPriceLineInput): HistoricalSpecificPriceContextStatus {
  if (
    !Number.isSafeInteger(line.shopId) ||
    !Number.isSafeInteger(line.currencyId) ||
    !Number.isSafeInteger(line.customerId) ||
    !Number.isSafeInteger(line.quantity) ||
    Number.isNaN(parseSourceDate(line.orderDate).getTime())
  ) {
    return 'CONTEXT_UNAVAILABLE';
  }
  if (line.customerGroupSource === 'current_default') return 'CONTEXT_CURRENT_ONLY';
  if (line.countryId === null || line.customerGroupId === null || line.customerGroupSource === 'unavailable') return 'CONTEXT_PARTIAL';
  return 'CONTEXT_COMPLETE';
}

function hasSelectionContextGap(
  line: HistoricalSpecificPriceLineInput,
  candidates: readonly HistoricalSpecificPriceCandidate[],
): boolean {
  return (
    (line.countryId === null && candidates.some((candidate) => candidate.countryId > 0)) ||
    (line.customerGroupId === null && candidates.some((candidate) => candidate.groupId > 0))
  );
}

function isCompatibleAtOrderDate(line: HistoricalSpecificPriceLineInput, candidate: HistoricalSpecificPriceCandidate): boolean {
  const effectiveAt = parseSourceDate(line.orderDate);
  return (
    candidate.cartId === 0 &&
    candidate.fromQuantity <= line.quantity &&
    [0, line.productAttributeId].includes(candidate.productAttributeId) &&
    [0, line.shopId].includes(candidate.shopId) &&
    [0, line.currencyId].includes(candidate.currencyId) &&
    (line.countryId === null ? candidate.countryId === 0 : [0, line.countryId].includes(candidate.countryId)) &&
    (line.customerGroupId === null ? candidate.groupId === 0 : [0, line.customerGroupId].includes(candidate.groupId)) &&
    [0, line.customerId].includes(candidate.customerId) &&
    dateWindowIncludes(candidate.validFrom, candidate.validTo, effectiveAt)
  );
}

function catalogSpecificityScore(line: HistoricalSpecificPriceLineInput, candidate: HistoricalSpecificPriceCandidate): readonly number[] {
  return [
    candidate.productAttributeId === line.productAttributeId ? 1 : 0,
    candidate.shopId === line.shopId ? 1 : 0,
    candidate.currencyId === line.currencyId ? 1 : 0,
    line.countryId !== null && candidate.countryId === line.countryId ? 1 : 0,
    line.customerGroupId !== null && candidate.groupId === line.customerGroupId ? 1 : 0,
    candidate.customerId === line.customerId ? 1 : 0,
    candidate.fromQuantity,
    candidate.priority ?? 0,
    -candidate.specificPriceId,
  ];
}

function compareScoredSpecificPrices(
  left: { readonly score: readonly number[] },
  right: { readonly score: readonly number[] },
): number {
  for (let index = 0; index < left.score.length; index += 1) {
    const diff = (right.score[index] ?? 0) - (left.score[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sameCommercialScore(left: readonly number[], right: readonly number[]): boolean {
  const size = Math.max(left.length, right.length) - 1;
  for (let index = 0; index < size; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return false;
  }
  return true;
}

function matchedDimensionsFor(line: HistoricalSpecificPriceLineInput, candidate: HistoricalSpecificPriceCandidate): readonly string[] {
  return [
    ...(candidate.productAttributeId === line.productAttributeId && line.productAttributeId > 0 ? ['combination'] : []),
    ...(candidate.shopId === line.shopId ? ['shop'] : []),
    ...(candidate.currencyId === line.currencyId ? ['currency'] : []),
    ...(line.countryId !== null && candidate.countryId === line.countryId ? ['country'] : []),
    ...(line.customerGroupId !== null && candidate.groupId === line.customerGroupId ? ['group'] : []),
    ...(candidate.customerId === line.customerId ? ['customer'] : []),
    ...(candidate.fromQuantity > 1 ? ['quantity'] : []),
  ];
}

function dateWindowIncludes(from: string | null, to: string | null, effectiveAt: Date): boolean {
  const fromDate = parseRangeDate(from);
  const toDate = parseRangeDate(to);
  if (fromDate === 'invalid' || toDate === 'invalid') return false;
  if (fromDate && fromDate.getTime() > effectiveAt.getTime()) return false;
  if (toDate && toDate.getTime() < effectiveAt.getTime()) return false;
  return true;
}

function parseRangeDate(value: string | null): Date | null | 'invalid' {
  if (value === null || value === '0000-00-00 00:00:00') return null;
  const parsed = parseSourceDate(value);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed;
}

function parseSourceDate(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function unresolvedResolution(
  baseEvidenceStatus: HistoricalBasePriceEvidenceStatus,
  reasonCodes: readonly string[],
): HistoricalSpecificPriceResolution {
  return {
    baseEvidenceStatus,
    historicalBaseUnitPriceTaxExcl: null,
    historicalEffectiveUnitPriceTaxExcl: null,
    historicalBaseUnitPriceTaxIncl: null,
    historicalEffectiveUnitPriceTaxIncl: null,
    historicalBaseLineValueTaxIncl: null,
    historicalEffectiveLineValueTaxIncl: null,
    reconstructedSpecificProductDiscountTaxIncl: null,
    discountType: null,
    discountValue: null,
    source: 'UNRESOLVED',
    reasonCodes,
  };
}

function unresolvedComparison(classification: 'CONTEXT_INCOMPLETE' | 'HISTORICAL_PRICE_NOT_PROVABLE'): HistoricalSpecificPriceComparison {
  return {
    unitDeltaTaxIncl: null,
    lineDeltaTaxIncl: null,
    unitDeltaBucket: 'UNRESOLVED',
    lineDeltaBucket: 'UNRESOLVED',
    classification,
    orderDetailAlreadyReflectsSpecificPrice: null,
  };
}

function deltaBucket(delta: string): string {
  const abs = Number(spAbs(delta));
  if (abs === 0) return '0';
  if (abs <= 1) return '<=1 CLP';
  if (abs <= 10) return '2-10 CLP';
  if (abs <= 100) return '11-100 CLP';
  if (abs <= 1000) return '101-1000 CLP';
  return '>1000 CLP';
}

function assertLine(line: HistoricalSpecificPriceLineInput): void {
  if (!Number.isSafeInteger(line.orderDetailId) || line.orderDetailId <= 0) throw new Error('Invalid orderDetailId');
  if (!Number.isSafeInteger(line.orderId) || line.orderId <= 0) throw new Error('Invalid orderId');
  if (!Number.isSafeInteger(line.productId) || line.productId < 0) throw new Error('Invalid productId');
  if (!Number.isSafeInteger(line.productAttributeId) || line.productAttributeId < 0) throw new Error('Invalid productAttributeId');
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new Error('Invalid quantity');
  if (Number.isNaN(parseSourceDate(line.orderDate).getTime())) throw new Error('Invalid orderDate');
  [
    line.orderDetailUnitPriceTaxIncl,
    line.orderDetailUnitPriceTaxExcl,
    line.orderDetailTotalPriceTaxIncl,
    line.orderDetailTotalPriceTaxExcl,
  ].forEach(spMoney);
  if (line.productBasePriceTaxExcl !== null) spMoney(line.productBasePriceTaxExcl);
  if (line.combinationImpactTaxExcl !== null) spMoney(line.combinationImpactTaxExcl);
  if (line.orderDetailTaxRate !== null) spMoney(line.orderDetailTaxRate);
}

function assertCandidate(candidate: HistoricalSpecificPriceCandidate): void {
  if (!Number.isSafeInteger(candidate.specificPriceId) || candidate.specificPriceId <= 0) throw new Error('Invalid specificPriceId');
  if (!Number.isSafeInteger(candidate.productId) || candidate.productId < 0) throw new Error('Invalid candidate productId');
  if (!Number.isSafeInteger(candidate.fromQuantity) || candidate.fromQuantity < 0) throw new Error('Invalid fromQuantity');
  spMoney(candidate.price);
  spMoney(candidate.reduction);
}

function spMoney(value: string | number): string {
  return fromScaled(toScaled(String(value)));
}

function spAdd(...values: readonly string[]): string {
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

function spSub(left: string, right: string): string {
  return fromScaled(toScaled(left) - toScaled(right));
}

function spSum(values: readonly string[]): string {
  return spAdd(...values);
}

function spAbs(value: string): string {
  const scaled = toScaled(value);
  return fromScaled(scaled < 0n ? -scaled : scaled);
}

function spMaxZero(value: string): string {
  return spCompare(value, '0.000000') < 0 ? '0.000000' : value;
}

function spCompare(left: string, right: string): number {
  const l = toScaled(left);
  const r = toScaled(right);
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

function spMultiply(left: string, right: string): string {
  return fromScaled((toScaled(left) * toScaled(right) + FACTOR / 2n) / FACTOR);
}

function spMultiplyInt(value: string, quantity: number): string {
  return fromScaled(toScaled(value) * BigInt(quantity));
}

function spDivide(numerator: string, denominator: string): string {
  const d = toScaled(denominator);
  if (d === 0n) return '0.000000';
  return fromScaled((toScaled(numerator) * FACTOR + d / 2n) / d);
}

function roundToClp(value: string): string {
  const scaled = toScaled(value);
  const sign = scaled < 0n ? -1n : 1n;
  const abs = scaled < 0n ? -scaled : scaled;
  return fromScaled(sign * ((abs + FACTOR / 2n) / FACTOR) * FACTOR);
}

function spRatio(numerator: number, denominator: number): string {
  return denominator <= 0 ? '0.000000' : (numerator / denominator).toFixed(6);
}

function toScaled(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error(`Invalid decimal: ${value}`);
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const unsigned = trimmed.replace(/^-/, '');
  const [whole, fractional = ''] = unsigned.split('.');
  const raw = BigInt(`${whole}${fractional}`);
  if (fractional.length === SCALE) return sign * raw;
  if (fractional.length < SCALE) return sign * raw * 10n ** BigInt(SCALE - fractional.length);
  const divisor = 10n ** BigInt(fractional.length - SCALE);
  const quotient = raw / divisor;
  const remainder = raw % divisor;
  return sign * (remainder * 2n >= divisor ? quotient + 1n : quotient);
}

function fromScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(SCALE + 1, '0');
  return `${sign}${raw.slice(0, -SCALE)}.${raw.slice(-SCALE)}`;
}

function assertNoPii(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenKey(key)) throw new Error(`Historical specific price report contains forbidden field: ${path}.${key}`);
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenString(value)) {
    throw new Error(`Historical specific price report contains PII-shaped value at ${path}`);
  }
}

function isForbiddenKey(key: string): boolean {
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

function isForbiddenString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^-?\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{8,64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}/.test(trimmed) ||
    /^[A-Z0-9_<>:,.-]+$/i.test(trimmed)
  ) {
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}
