import { sha256Stable } from './checksum.js';

const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

export const historicalCatalogPriceAuditVersion = 'historical-catalog-price-reconciliation-v1';

export type HistoricalPricingContextStatus =
  | 'CONTEXT_COMPLETE'
  | 'CONTEXT_PARTIAL'
  | 'CONTEXT_CURRENT_ONLY'
  | 'CONTEXT_UNAVAILABLE';

export type SpecificPriceSelectionStatus =
  | 'SPECIFIC_PRICE_SELECTION_CONFIRMED'
  | 'SPECIFIC_PRICE_SELECTION_PARTIAL'
  | 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
  | 'SPECIFIC_PRICE_SELECTION_INCORRECT';

export type HistoricalRuleEvidenceStatus =
  | 'HISTORICAL_RULE_PRESENT'
  | 'HISTORICAL_RULE_PRESENT_BUT_AMBIGUOUS'
  | 'HISTORICAL_RULE_MISSING'
  | 'HISTORICAL_CONTEXT_MISSING'
  | 'HISTORICAL_RECONSTRUCTION_NOT_PROVABLE';

export type HistoricalPriceAuthorityVerdict =
  | 'ORDER_DETAIL_IS_HISTORICAL_AUTHORITY'
  | 'CATALOG_HISTORICAL_RESOLUTION_IS_AUTHORITY'
  | 'HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED'
  | 'HISTORICAL_PRICE_NOT_RECONSTRUCTABLE_RELIABLY'
  | 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
  | 'BLOCKED_BY_HISTORICAL_CONTEXT'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type HistoricalPriceCondition =
  | 'USE_ORDER_DATE_AS_EFFECTIVE_AT'
  | 'REMOVE_ACTIVE_PRODUCT_REQUIREMENT_FOR_HISTORY'
  | 'DO_NOT_USE_CURRENT_PRICE_AS_HISTORY'
  | 'USE_ORDER_DETAIL_AS_FALLBACK'
  | 'CATALOG_REQUIRES_HISTORICAL_MODE'
  | 'SPECIFIC_PRICE_PRIORITY_REQUIRES_FIX'
  | 'RFM_REQUIRES_PRICE_RECALCULATION'
  | 'T08_REQUIRES_PRICE_SOURCE_REVIEW'
  | 'T09_REQUIRES_SPEND_RECALCULATION';

export type HistoricalLineClassification =
  | 'ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE'
  | 'ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY'
  | 'ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED'
  | 'ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED'
  | 'HISTORICAL_SPECIFIC_PRICE_RECONSTRUCTED'
  | 'HISTORICAL_SPECIFIC_PRICE_NOT_FOUND'
  | 'HISTORICAL_SPECIFIC_PRICE_NOT_RECOVERABLE'
  | 'PRICING_CONTEXT_INCOMPLETE'
  | 'PRICING_SELECTION_AMBIGUOUS'
  | 'PRICING_ALGORITHM_MISMATCH'
  | 'ROUNDING_ONLY'
  | 'CURRENTLY_INACTIVE_PRODUCT'
  | 'TECHNICAL_LINE_EXCLUDED';

export type TaxReconciliationStatus =
  | 'TAX_MATCH'
  | 'TAX_ROUNDING_DIFFERENCE'
  | 'TAX_RATE_UNAVAILABLE'
  | 'TAX_RATE_MISMATCH';

export type HistoricalPriceLineInput = {
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
  readonly module: string;
  readonly productActive: boolean | null;
  readonly productBasePriceTaxExcl: string | null;
  readonly combinationImpactTaxExcl: string | null;
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
};

export type HistoricalSpecificPriceSelection = {
  readonly selected: HistoricalSpecificPriceCandidate | null;
  readonly candidateSpecificPriceCount: number;
  readonly compatibleCandidateCount: number;
  readonly selectedSpecificPriceId: number | null;
  readonly selectionPriority: readonly number[];
  readonly matchedDimensions: readonly string[];
  readonly selectionReason: string;
  readonly status: SpecificPriceSelectionStatus;
};

export type HistoricalPriceResolution = {
  readonly historicalBaseUnitPriceTaxExcl: string | null;
  readonly historicalEffectiveUnitPriceTaxExcl: string | null;
  readonly historicalBaseUnitPriceTaxIncl: string | null;
  readonly historicalEffectiveUnitPriceTaxIncl: string | null;
  readonly historicalEffectiveLineValueTaxIncl: string | null;
  readonly historicalEffectiveLineValueTaxExcl: string | null;
  readonly taxRateUsed: string | null;
  readonly historicalPriceSource: 'CATALOG_SPECIFIC_PRICE' | 'CATALOG_BASE_PRICE' | 'ORDER_DETAIL_FALLBACK' | 'UNRESOLVED';
  readonly ruleEvidenceStatus: HistoricalRuleEvidenceStatus;
};

export type HistoricalPriceLineReconciliation = {
  readonly lineAlias: string;
  readonly productAlias: string;
  readonly productAttributeAlias: string;
  readonly orderMonth: string;
  readonly shopAlias: string;
  readonly module: string;
  readonly contextStatus: HistoricalPricingContextStatus;
  readonly selection: HistoricalSpecificPriceSelection;
  readonly resolution: HistoricalPriceResolution;
  readonly unitPriceDeltaTaxIncl: string | null;
  readonly lineValueDeltaTaxIncl: string | null;
  readonly unitDeltaBucket: string;
  readonly lineDeltaBucket: string;
  readonly taxStatus: TaxReconciliationStatus;
  readonly classifications: readonly HistoricalLineClassification[];
};

export type HistoricalPricePolicyComparison = {
  readonly policyA_orderDetailPersistedValue: HistoricalPricePolicySummary;
  readonly policyB_catalogHistoricalResolvedValue: HistoricalPricePolicySummary;
  readonly policyC_hybridValue: HistoricalPricePolicySummary;
};

export type HistoricalPricePolicySummary = {
  readonly resolvedLineCount: number;
  readonly fallbackLineCount: number;
  readonly unresolvedLineCount: number;
  readonly totalValue: string;
  readonly averageLineValue: string;
  readonly medianLineValue: string | null;
  readonly p95LineValue: string | null;
  readonly reconciliationWithTotalProductsWt: string;
};

export function reconcileHistoricalCatalogPrices(input: {
  readonly lines: readonly HistoricalPriceLineInput[];
  readonly specificPrices: readonly HistoricalSpecificPriceCandidate[];
}): readonly HistoricalPriceLineReconciliation[] {
  return input.lines.map((line, index) => reconcileLine(line, input.specificPrices, index + 1));
}

export function reconcileLine(
  line: HistoricalPriceLineInput,
  allCandidates: readonly HistoricalSpecificPriceCandidate[],
  sequence = 1,
): HistoricalPriceLineReconciliation {
  assertLine(line);
  const contextStatus = contextStatusForLine(line);
  const candidates = allCandidates.filter((candidate) => candidate.productId === line.productId);
  const selection = selectHistoricalSpecificPrice(line, candidates);
  const resolution = resolveHistoricalPrice(line, selection);
  const unitPriceDeltaTaxIncl = resolution.historicalEffectiveUnitPriceTaxIncl === null
    ? null
    : subMoney(line.orderDetailUnitPriceTaxIncl, resolution.historicalEffectiveUnitPriceTaxIncl);
  const expectedLineValue = resolution.historicalEffectiveUnitPriceTaxIncl === null
    ? null
    : multiplyMoneyByInteger(resolution.historicalEffectiveUnitPriceTaxIncl, line.quantity);
  const lineValueDeltaTaxIncl = expectedLineValue === null
    ? null
    : subMoney(line.orderDetailTotalPriceTaxIncl, expectedLineValue);
  const classifications = classifyReconciliation(line, contextStatus, selection, resolution, unitPriceDeltaTaxIncl, lineValueDeltaTaxIncl);
  return {
    lineAlias: `line_${sequence}`,
    productAlias: `product_${line.productId}`,
    productAttributeAlias: line.productAttributeId === 0 ? 'base' : `combination_${line.productAttributeId}`,
    orderMonth: line.orderDate.slice(0, 7),
    shopAlias: `shop_${line.shopId}`,
    module: line.module,
    contextStatus,
    selection,
    resolution,
    unitPriceDeltaTaxIncl,
    lineValueDeltaTaxIncl,
    unitDeltaBucket: unitPriceDeltaTaxIncl === null ? 'UNRESOLVED' : deltaBucket(unitPriceDeltaTaxIncl),
    lineDeltaBucket: lineValueDeltaTaxIncl === null ? 'UNRESOLVED' : deltaBucket(lineValueDeltaTaxIncl),
    taxStatus: taxStatus(line, resolution),
    classifications,
  };
}

export function selectHistoricalSpecificPrice(
  line: HistoricalPriceLineInput,
  candidates: readonly HistoricalSpecificPriceCandidate[],
): HistoricalSpecificPriceSelection {
  const compatible = candidates.filter((candidate) => isCandidateCompatible(line, candidate));
  const scored = compatible.map((candidate) => ({
    candidate,
    priority: specificityPriority(line, candidate),
  })).sort(compareScoredCandidates);
  const selected = scored[0]?.candidate ?? null;
  const second = scored[1];
  const ambiguous = selected && second && comparePriorityWithoutId(scored[0]!.priority, second.priority) === 0;
  const matchedDimensions = selected ? matchedDimensionsFor(line, selected) : [];
  return {
    selected,
    candidateSpecificPriceCount: candidates.length,
    compatibleCandidateCount: compatible.length,
    selectedSpecificPriceId: selected?.specificPriceId ?? null,
    selectionPriority: scored[0]?.priority ?? [],
    matchedDimensions,
    selectionReason: selected
      ? `selected_by_${matchedDimensions.join('_') || 'general'}`
      : 'no_compatible_specific_price_at_order_date',
    status: ambiguous
      ? 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
      : selected
        ? 'SPECIFIC_PRICE_SELECTION_CONFIRMED'
        : candidates.length > 0
          ? 'SPECIFIC_PRICE_SELECTION_PARTIAL'
          : 'SPECIFIC_PRICE_SELECTION_PARTIAL',
  };
}

export function resolveHistoricalPrice(
  line: HistoricalPriceLineInput,
  selection: HistoricalSpecificPriceSelection,
): HistoricalPriceResolution {
  const taxRate = effectiveTaxRateForLine(line);
  if (line.isSellerService || line.isLogisticsArtifact) {
    return {
      historicalBaseUnitPriceTaxExcl: null,
      historicalEffectiveUnitPriceTaxExcl: null,
      historicalBaseUnitPriceTaxIncl: null,
      historicalEffectiveUnitPriceTaxIncl: null,
      historicalEffectiveLineValueTaxIncl: null,
      historicalEffectiveLineValueTaxExcl: null,
      taxRateUsed: taxRate,
      historicalPriceSource: 'UNRESOLVED',
      ruleEvidenceStatus: 'HISTORICAL_CONTEXT_MISSING',
    };
  }
  if (line.productBasePriceTaxExcl === null || line.combinationImpactTaxExcl === null || taxRate === null) {
    return orderDetailFallback(line, 'HISTORICAL_CONTEXT_MISSING');
  }
  const catalogBaseTaxExcl = maxZero(addMoney(line.productBasePriceTaxExcl, line.combinationImpactTaxExcl));
  let effectiveTaxExcl = catalogBaseTaxExcl;
  let source: HistoricalPriceResolution['historicalPriceSource'] = 'CATALOG_BASE_PRICE';
  const selected = selection.selected;
  if (selected) {
    source = 'CATALOG_SPECIFIC_PRICE';
    if (compareMoney(selected.price, '0.000000') >= 0) {
      effectiveTaxExcl = maxZero(addMoney(selected.price, line.combinationImpactTaxExcl));
    }
    if (selected.reductionType === 'percentage' && compareMoney(selected.reduction, '0.000000') > 0) {
      effectiveTaxExcl = maxZero(multiplyMoneyByRate(effectiveTaxExcl, subMoney('1.000000', selected.reduction)));
    } else if (selected.reductionType === 'amount' && compareMoney(selected.reduction, '0.000000') > 0) {
      const reductionTaxExcl = selected.reductionTax
        ? divideMoney(selected.reduction, addMoney('1.000000', taxRate))
        : selected.reduction;
      effectiveTaxExcl = maxZero(subMoney(effectiveTaxExcl, reductionTaxExcl));
    } else if (selected.reductionType === 'unknown') {
      return orderDetailFallback(line, 'HISTORICAL_RECONSTRUCTION_NOT_PROVABLE');
    }
  }
  const baseTaxIncl = taxIncl(catalogBaseTaxExcl, taxRate);
  const effectiveTaxIncl = taxIncl(effectiveTaxExcl, taxRate);
  return {
    historicalBaseUnitPriceTaxExcl: catalogBaseTaxExcl,
    historicalEffectiveUnitPriceTaxExcl: effectiveTaxExcl,
    historicalBaseUnitPriceTaxIncl: baseTaxIncl,
    historicalEffectiveUnitPriceTaxIncl: effectiveTaxIncl,
    historicalEffectiveLineValueTaxIncl: multiplyMoneyByInteger(effectiveTaxIncl, line.quantity),
    historicalEffectiveLineValueTaxExcl: multiplyMoneyByInteger(effectiveTaxExcl, line.quantity),
    taxRateUsed: taxRate,
    historicalPriceSource: source,
    ruleEvidenceStatus: selected
      ? selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS'
        ? 'HISTORICAL_RULE_PRESENT_BUT_AMBIGUOUS'
        : 'HISTORICAL_RULE_PRESENT'
      : 'HISTORICAL_RULE_MISSING',
  };
}

export function compareHistoricalPricePolicies(input: {
  readonly lines: readonly HistoricalPriceLineInput[];
  readonly reconciliations: readonly HistoricalPriceLineReconciliation[];
  readonly totalProductsWt: string;
}): HistoricalPricePolicyComparison {
  assertSameLineCount(input.lines, input.reconciliations);
  const policyA = input.lines.map((line) => line.orderDetailTotalPriceTaxIncl);
  const policyB = input.reconciliations.map((row) => row.resolution.historicalEffectiveLineValueTaxIncl);
  const policyC = input.reconciliations.map((row, index) => row.resolution.historicalEffectiveLineValueTaxIncl ?? input.lines[index]!.orderDetailTotalPriceTaxIncl);
  const policyCFallbackCount = input.reconciliations.filter(
    (row) => row.resolution.historicalEffectiveLineValueTaxIncl === null || row.resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK',
  ).length;
  return {
    policyA_orderDetailPersistedValue: summarizePolicy(policyA, input.totalProductsWt),
    policyB_catalogHistoricalResolvedValue: summarizePolicy(policyB, input.totalProductsWt),
    policyC_hybridValue: summarizePolicy(policyC, input.totalProductsWt, policyCFallbackCount),
  };
}

export function buildHistoricalPriceAuthorityVerdict(input: {
  readonly reconciliations: readonly HistoricalPriceLineReconciliation[];
  readonly policyComparison: HistoricalPricePolicyComparison;
}): { readonly primaryVerdict: HistoricalPriceAuthorityVerdict; readonly conditions: readonly HistoricalPriceCondition[]; readonly rationale: readonly string[]; readonly version: string } {
  const total = input.reconciliations.length;
  const commercial = input.reconciliations.filter((row) => !row.classifications.includes('TECHNICAL_LINE_EXCLUDED'));
  const matches = commercial.filter((row) => row.classifications.includes('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE')).length;
  const unresolved = commercial.filter((row) => row.resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK' || row.resolution.historicalPriceSource === 'UNRESOLVED').length;
  const ambiguous = commercial.filter((row) => row.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS').length;
  const matchRate = commercial.length === 0 ? 0 : matches / commercial.length;
  let primaryVerdict: HistoricalPriceAuthorityVerdict = 'HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED';
  if (ambiguous / Math.max(commercial.length, 1) > 0.01) {
    primaryVerdict = 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS';
  } else if (unresolved / Math.max(commercial.length, 1) > 0.25) {
    primaryVerdict = 'HISTORICAL_PRICE_NOT_RECONSTRUCTABLE_RELIABLY';
  } else if (matchRate >= 0.95) {
    primaryVerdict = 'ORDER_DETAIL_IS_HISTORICAL_AUTHORITY';
  }
  return {
    primaryVerdict,
    conditions: [
      'USE_ORDER_DATE_AS_EFFECTIVE_AT',
      'REMOVE_ACTIVE_PRODUCT_REQUIREMENT_FOR_HISTORY',
      'DO_NOT_USE_CURRENT_PRICE_AS_HISTORY',
      'USE_ORDER_DETAIL_AS_FALLBACK',
      'CATALOG_REQUIRES_HISTORICAL_MODE',
      ...(ambiguous > 0 ? (['SPECIFIC_PRICE_PRIORITY_REQUIRES_FIX'] as const) : []),
      'RFM_REQUIRES_PRICE_RECALCULATION',
      'T08_REQUIRES_PRICE_SOURCE_REVIEW',
      'T09_REQUIRES_SPEND_RECALCULATION',
    ],
    rationale: [
      `commercialLineCount=${commercial.length}`,
      `matchRate=${ratio(matches, commercial.length)}`,
      `unresolvedShare=${ratio(unresolved, commercial.length)}`,
      `ambiguousShare=${ratio(ambiguous, commercial.length)}`,
      `totalLineCount=${total}`,
    ],
    version: historicalCatalogPriceAuditVersion,
  };
}

export function summarizeHistoricalPriceReconciliations(
  reconciliations: readonly HistoricalPriceLineReconciliation[],
): Record<string, unknown> {
  const commercial = reconciliations.filter((row) => !row.classifications.includes('TECHNICAL_LINE_EXCLUDED'));
  const matchCount = commercial.filter((row) => row.classifications.includes('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE')).length;
  const unresolvedCount = commercial.filter((row) => row.resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK' || row.resolution.historicalPriceSource === 'UNRESOLVED').length;
  return {
    lineCount: reconciliations.length,
    commercialLineCount: commercial.length,
    matchCount,
    mismatchCount: commercial.length - matchCount - unresolvedCount,
    unresolvedCount,
    matchRate: ratio(matchCount, commercial.length),
    contextStatusDistribution: countBy(reconciliations, (row) => row.contextStatus),
    selectionStatusDistribution: countBy(reconciliations, (row) => row.selection.status),
    sourceDistribution: countBy(reconciliations, (row) => row.resolution.historicalPriceSource),
    classificationDistribution: countBy(reconciliations.flatMap((row) => row.classifications), (value) => value),
  };
}

export function assertHistoricalPriceReportHasNoPii(report: unknown): void {
  assertNoPii(report, 'report');
}

export function historicalPriceChecksum(value: unknown): string {
  return sha256Stable({ version: historicalCatalogPriceAuditVersion, value });
}

function classifyReconciliation(
  line: HistoricalPriceLineInput,
  contextStatus: HistoricalPricingContextStatus,
  selection: HistoricalSpecificPriceSelection,
  resolution: HistoricalPriceResolution,
  unitDelta: string | null,
  lineDelta: string | null,
): readonly HistoricalLineClassification[] {
  const classifications: HistoricalLineClassification[] = [];
  if (line.isSellerService || line.isLogisticsArtifact) {
    classifications.push('TECHNICAL_LINE_EXCLUDED');
  }
  if (contextStatus !== 'CONTEXT_COMPLETE') classifications.push('PRICING_CONTEXT_INCOMPLETE');
  if (line.productActive === false) classifications.push('CURRENTLY_INACTIVE_PRODUCT');
  if (selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS') classifications.push('PRICING_SELECTION_AMBIGUOUS');
  if (selection.selected) classifications.push('HISTORICAL_SPECIFIC_PRICE_RECONSTRUCTED');
  if (!selection.selected && selection.candidateSpecificPriceCount > 0) classifications.push('HISTORICAL_SPECIFIC_PRICE_NOT_FOUND');
  if (resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK') classifications.push('HISTORICAL_SPECIFIC_PRICE_NOT_RECOVERABLE');
  const isCatalogReconstructed =
    resolution.historicalPriceSource === 'CATALOG_BASE_PRICE' || resolution.historicalPriceSource === 'CATALOG_SPECIFIC_PRICE';
  if (isCatalogReconstructed && unitDelta !== null && lineDelta !== null) {
    if (deltaBucket(unitDelta) === '0' && deltaBucket(lineDelta) === '0') {
      classifications.push('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE');
    } else if (deltaBucket(unitDelta) === '<=1' && deltaBucket(lineDelta) === '<=1') {
      classifications.push('ROUNDING_ONLY');
    } else if (
      resolution.historicalBaseUnitPriceTaxIncl !== null &&
      absMoney(subMoney(line.orderDetailUnitPriceTaxIncl, resolution.historicalBaseUnitPriceTaxIncl)) === '0.000000'
    ) {
      classifications.push('ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY');
    } else if (compareMoney(unitDelta, '0.000000') < 0) {
      classifications.push('ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED');
    } else if (compareMoney(unitDelta, '0.000000') > 0) {
      classifications.push('ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED');
    }
  }
  if (classifications.length === 0) classifications.push('HISTORICAL_SPECIFIC_PRICE_NOT_FOUND');
  return classifications;
}

function contextStatusForLine(line: HistoricalPriceLineInput): HistoricalPricingContextStatus {
  if (line.productBasePriceTaxExcl === null || line.combinationImpactTaxExcl === null || line.countryId === null) {
    return 'CONTEXT_PARTIAL';
  }
  if (line.customerGroupSource === 'current_default') {
    return 'CONTEXT_CURRENT_ONLY';
  }
  if (line.customerGroupId === null || line.orderDetailTaxRate === null) {
    return 'CONTEXT_PARTIAL';
  }
  return 'CONTEXT_COMPLETE';
}

function isCandidateCompatible(line: HistoricalPriceLineInput, candidate: HistoricalSpecificPriceCandidate): boolean {
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

function specificityPriority(line: HistoricalPriceLineInput, candidate: HistoricalSpecificPriceCandidate): readonly number[] {
  const contextSpecificity = [
    candidate.currencyId === line.currencyId ? 1 : 0,
    line.countryId !== null && candidate.countryId === line.countryId ? 1 : 0,
    line.customerGroupId !== null && candidate.groupId === line.customerGroupId ? 1 : 0,
    candidate.customerId === line.customerId ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0);
  return [
    candidate.productAttributeId === line.productAttributeId && line.productAttributeId > 0 ? 1 : 0,
    candidate.shopId === line.shopId ? 1 : 0,
    candidate.fromQuantity,
    contextSpecificity,
    fromTime(candidate.validFrom),
    candidate.specificPriceId,
  ];
}

function compareScoredCandidates(
  left: { readonly priority: readonly number[] },
  right: { readonly priority: readonly number[] },
): number {
  for (let index = 0; index < left.priority.length; index += 1) {
    const diff = right.priority[index]! - left.priority[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function comparePriorityWithoutId(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length - 1; index += 1) {
    const diff = right[index]! - left[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function matchedDimensionsFor(line: HistoricalPriceLineInput, candidate: HistoricalSpecificPriceCandidate): readonly string[] {
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
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized);
}

function fromTime(value: string | null): number {
  const parsed = parseRangeDate(value);
  return parsed instanceof Date ? parsed.getTime() : 0;
}

function effectiveTaxRateForLine(line: HistoricalPriceLineInput): string | null {
  if (line.orderDetailTaxRate !== null) return money(line.orderDetailTaxRate);
  if (compareMoney(line.orderDetailUnitPriceTaxExcl, '0.000000') <= 0) return null;
  return divideMoney(subMoney(line.orderDetailUnitPriceTaxIncl, line.orderDetailUnitPriceTaxExcl), line.orderDetailUnitPriceTaxExcl);
}

function taxIncl(taxExcl: string, taxRate: string): string {
  return roundToClp(multiplyMoneyByRate(taxExcl, addMoney('1.000000', taxRate)));
}

function orderDetailFallback(
  line: HistoricalPriceLineInput,
  status: HistoricalRuleEvidenceStatus,
): HistoricalPriceResolution {
  return {
    historicalBaseUnitPriceTaxExcl: null,
    historicalEffectiveUnitPriceTaxExcl: line.orderDetailUnitPriceTaxExcl,
    historicalBaseUnitPriceTaxIncl: null,
    historicalEffectiveUnitPriceTaxIncl: line.orderDetailUnitPriceTaxIncl,
    historicalEffectiveLineValueTaxIncl: line.orderDetailTotalPriceTaxIncl,
    historicalEffectiveLineValueTaxExcl: line.orderDetailTotalPriceTaxExcl,
    taxRateUsed: effectiveTaxRateForLine(line),
    historicalPriceSource: 'ORDER_DETAIL_FALLBACK',
    ruleEvidenceStatus: status,
  };
}

function taxStatus(line: HistoricalPriceLineInput, resolution: HistoricalPriceResolution): TaxReconciliationStatus {
  if (resolution.taxRateUsed === null) return 'TAX_RATE_UNAVAILABLE';
  const lineRate = effectiveTaxRateForLine(line);
  if (lineRate === null) return 'TAX_RATE_UNAVAILABLE';
  const delta = absMoney(subMoney(lineRate, resolution.taxRateUsed));
  if (compareMoney(delta, '0.000000') === 0) return 'TAX_MATCH';
  if (compareMoney(delta, '0.001000') <= 0) return 'TAX_ROUNDING_DIFFERENCE';
  return 'TAX_RATE_MISMATCH';
}

function summarizePolicy(
  values: readonly (string | null)[],
  totalProductsWt: string,
  fallbackLineCount = 0,
): HistoricalPricePolicySummary {
  const resolved = values.filter((value): value is string => value !== null);
  const sorted = [...resolved].sort(compareMoney);
  const totalValue = sumMoney(resolved);
  return {
    resolvedLineCount: resolved.length,
    fallbackLineCount,
    unresolvedLineCount: values.filter((value) => value === null).length,
    totalValue,
    averageLineValue: divideMoneyByInteger(totalValue, resolved.length),
    medianLineValue: percentile(sorted, 0.5),
    p95LineValue: percentile(sorted, 0.95),
    reconciliationWithTotalProductsWt: subMoney(totalValue, totalProductsWt),
  };
}

function assertSameLineCount(lines: readonly unknown[], reconciliations: readonly unknown[]): void {
  if (lines.length !== reconciliations.length) {
    throw new Error('Historical price policy comparison requires matching line counts');
  }
}

function assertLine(line: HistoricalPriceLineInput): void {
  if (!Number.isSafeInteger(line.orderDetailId) || line.orderDetailId <= 0) throw new Error('Invalid orderDetailId');
  if (!Number.isSafeInteger(line.orderId) || line.orderId <= 0) throw new Error('Invalid orderId');
  if (!Number.isSafeInteger(line.productId) || line.productId < 0) throw new Error('Invalid productId');
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new Error('Invalid quantity');
  if (Number.isNaN(parseSourceDate(line.orderDate).getTime())) throw new Error('Invalid orderDate');
  money(line.orderDetailUnitPriceTaxIncl);
  money(line.orderDetailUnitPriceTaxExcl);
  money(line.orderDetailTotalPriceTaxIncl);
  money(line.orderDetailTotalPriceTaxExcl);
  if (line.productBasePriceTaxExcl !== null) money(line.productBasePriceTaxExcl);
  if (line.combinationImpactTaxExcl !== null) money(line.combinationImpactTaxExcl);
  if (line.orderDetailTaxRate !== null) money(line.orderDetailTaxRate);
}

function money(value: string | number): string {
  return fromScaled(toScaled(String(value)));
}

function addMoney(...values: readonly string[]): string {
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

function subMoney(left: string, right: string): string {
  return fromScaled(toScaled(left) - toScaled(right));
}

function sumMoney(values: readonly string[]): string {
  return addMoney(...values);
}

function absMoney(value: string): string {
  return fromScaled(absScaled(toScaled(value)));
}

function maxZero(value: string): string {
  return compareMoney(value, '0.000000') < 0 ? '0.000000' : value;
}

function compareMoney(left: string, right: string): number {
  const l = toScaled(left);
  const r = toScaled(right);
  if (l === r) return 0;
  return l < r ? -1 : 1;
}

function multiplyMoneyByInteger(value: string, quantity: number): string {
  return fromScaled(toScaled(value) * BigInt(quantity));
}

function multiplyMoneyByRate(value: string, rate: string): string {
  return fromScaled((toScaled(value) * toScaled(rate) + FACTOR / 2n) / FACTOR);
}

function divideMoney(numerator: string, denominator: string): string {
  const denominatorScaled = toScaled(denominator);
  if (denominatorScaled === 0n) return '0.000000';
  return fromScaled((toScaled(numerator) * FACTOR + denominatorScaled / 2n) / denominatorScaled);
}

function divideMoneyByInteger(numerator: string, denominator: number): string {
  if (!Number.isSafeInteger(denominator) || denominator <= 0) return '0.000000';
  return fromScaled((toScaled(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

function roundToClp(value: string): string {
  const scaled = toScaled(value);
  const sign = scaled < 0n ? -1n : 1n;
  const abs = absScaled(scaled);
  return fromScaled(sign * ((abs + FACTOR / 2n) / FACTOR) * FACTOR);
}

function deltaBucket(delta: string): string {
  const abs = Number(absMoney(delta));
  if (abs === 0) return '0';
  if (abs <= 1) return '<=1';
  if (abs <= 10) return '2-10';
  if (abs <= 100) return '11-100';
  if (abs <= 1000) return '101-1000';
  return '>1000';
}

function percentile(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.ceil(Math.min(Math.max(fraction, 0), 1) * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function countBy<T>(values: readonly T[], keyOf: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function ratio(numerator: number, denominator: number): string {
  return denominator <= 0 ? '0.000000' : (numerator / denominator).toFixed(6);
}

function toScaled(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error(`Invalid money decimal: ${value}`);
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
      if (isForbiddenKey(key)) throw new Error(`Historical price report contains forbidden field: ${path}.${key}`);
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenString(value)) {
    throw new Error(`Historical price report contains PII-shaped value at ${path}`);
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
  ].some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^-?\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{8,64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}/.test(trimmed) ||
    /^[A-Z0-9_<>:-]+$/i.test(trimmed)
  ) {
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}
