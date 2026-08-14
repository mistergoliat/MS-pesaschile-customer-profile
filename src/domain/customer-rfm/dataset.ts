import {
  addRfmDecimals,
  compareRfmDecimalAsc,
  divideRfmDecimal,
  formatRfmDecimal,
} from './decimal.js';
import { recencyCalendarDays } from './date-window.js';
import { sha256Stable } from './checksum.js';
import { operationalAccountExclusionPolicyVersion } from './operational-account-exclusion-policy.js';
import { sellerServiceExclusionPolicyVersion } from './seller-service-policy.js';
import {
  buildRfmCode,
  defaultFrequencyThresholds,
  frequencyScoringPolicyVersion,
  scoreFrequencyThresholds,
  scoreMonetaryTieSafe,
  scoreRecencyTieSafe,
  type FrequencyThresholds,
  type RfmScore,
} from './scoring.js';
import {
  classifyRfmCommercialSegment,
  rfmCommercialSegmentCodes,
  rfmCommercialSegmentVersion,
  type RfmCommercialSegmentCode,
} from './segmentation.js';
import type {
  CanonicalIdentityCoverageSummary,
  CanonicalIdentityResolution,
  DecimalDistributionSummary,
  DistributionSummary,
  RfmPopulationSourceRow,
  RfmSnapshotDiagnostics,
  RfmSnapshotManifest,
  RfmSnapshotRow,
} from './contracts.js';

export const rfmCalculationVersionDefault = 'rfm-population-v1';
export const identityAuthority = 'prestashop_customer';
export const identityAuthorityVersion = 'prestashop-customer-v1';
export const populationScope = 'all_valid_prestashop_shops';
// v2: population now also requires total_paid_tax_incl > 0 (excludes neutralized/free
// orders) and excludes the 4 confirmed operational accounts — see
// docs/releases/CP-R1-T11A4-approved-monetary-policy.md.
export const populationPolicyVersion = 'active-365-valid-prestashop-customer-v2';
// v2: same total_paid_tax_incl base as v1 (shipping/wrapping/discounts/IVA stay included),
// minus the net value of confirmed seller-service lines, floored at 0.
export const monetaryPolicyVersion = 'gross-order-value-tax-incl-minus-seller-service-v2';
export const monetaryDefinition = 'total_paid_tax_incl (IVA y shipping incluidos) menos el valor historico de lineas seller-service confirmadas, sin bajar de 0';
export const refundPolicyVersion = 'gross-valid-orders-v1';
export const currencyPolicyVersion = 'single-source-currency-v1';
export const scoringPolicyVersion = `r-tie-safe-percent-rank-v1__${frequencyScoringPolicyVersion}__m-tie-safe-percent-rank-v1`;
export const checksumVersion = 'rfm-checksum-canonical-json-v1';
export { operationalAccountExclusionPolicyVersion, sellerServiceExclusionPolicyVersion };

export type BuildRfmSnapshotInput = {
  readonly referenceTime: string;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
  readonly generatedAt: string;
  readonly calculationVersion: string;
  readonly sourceRows: readonly RfmPopulationSourceRow[];
  readonly diagnostics: RfmSnapshotDiagnostics;
  readonly canonicalIdentityResolutions?: readonly CanonicalIdentityResolution[];
  readonly canonicalIdentityCoverage?: CanonicalIdentityCoverageSummary;
  readonly frequencyThresholds?: FrequencyThresholds;
  readonly snapshotId?: string | null;
};

export type BuiltRfmSnapshot = {
  readonly snapshotKey: string;
  readonly rows: readonly RfmSnapshotRow[];
  readonly manifest: RfmSnapshotManifest;
  readonly sourceChecksum: string;
  readonly datasetChecksum: string;
};

export function buildRfmSnapshotDataset(input: BuildRfmSnapshotInput): BuiltRfmSnapshot {
  const frequencyThresholds = input.frequencyThresholds ?? defaultFrequencyThresholds;
  assertCurrencyGuardrails(input.diagnostics);
  assertNoDuplicateCustomers(input.sourceRows);

  const normalizedSourceRows = input.sourceRows
    .map(normalizeSourceRow)
    .sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
  const canonicalIdentity = resolveCanonicalIdentity(normalizedSourceRows, input);
  const recencyValues = normalizedSourceRows.map((row) => recencyCalendarDays(input.referenceTime, row.lastValidOrderAt));
  const monetaryValues = normalizedSourceRows.map((row) => row.grossOrderValueTaxIncl);
  const recencyScores = scoreRecencyTieSafe(recencyValues);
  const monetaryScores = scoreMonetaryTieSafe(monetaryValues);

  const rows = normalizedSourceRows.map((row, index) => {
    const recencyDays = recencyValues[index];
    if (recencyDays === undefined) {
      throw new Error('Missing recency value');
    }
    const recencyScore = recencyScores.get(recencyDays);
    const monetaryScore = monetaryScores.get(row.grossOrderValueTaxIncl);
    if (!recencyScore || !monetaryScore) {
      throw new Error('Missing RFM score');
    }
    const frequencyScore = scoreFrequencyThresholds(row.frequencyOrders, frequencyThresholds);
    const averageOrderValueTaxIncl = divideRfmDecimal(row.grossOrderValueTaxIncl, row.frequencyOrders);
    const segment = classifyRfmCommercialSegment({
      recencyScore,
      frequencyScore,
      monetaryScore,
    });
    const identityResolution = canonicalIdentity.byPrestashopCustomerId.get(row.prestashopCustomerId);
    if (!identityResolution) {
      throw new Error(`Missing canonical identity resolution for prestashopCustomerId ${String(row.prestashopCustomerId)}`);
    }
    return {
      ...row,
      masterCustomerId: identityResolution.masterCustomerId,
      identityResolutionStatus: 'provisional',
      recencyDays,
      averageOrderValueTaxIncl,
      recencyScore,
      frequencyScore,
      monetaryScore,
      rfmCode: buildRfmCode(recencyScore, frequencyScore, monetaryScore),
      segmentCode: segment.segmentCode,
      segmentVersion: segment.segmentVersion,
    } satisfies RfmSnapshotRow;
  });

  assertScoreGuardrails(rows);
  assertTieSafeScores(rows);

  const sourceChecksum = sha256Stable({
    referenceTime: input.referenceTime,
    windowStartInclusive: input.windowStartInclusive,
    windowEndExclusive: input.windowEndExclusive,
    rows: normalizedSourceRows,
  });
  const datasetChecksum = sha256Stable({
    calculationVersion: input.calculationVersion,
    identityAuthority,
    identityAuthorityVersion,
    populationPolicyVersion,
    monetaryPolicyVersion,
    refundPolicyVersion,
    currencyPolicyVersion,
    scoringPolicyVersion,
    checksumVersion,
    populationScope,
    rows,
  });
  const grossOrderValueTaxIncl = addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl));
  const currencyCode = input.diagnostics.currency.currencyCode;
  if (!currencyCode) {
    throw new Error('currency ISO code is required');
  }

  const manifest: RfmSnapshotManifest = {
    snapshotId: input.snapshotId ?? null,
    referenceTime: input.referenceTime,
    windowStartInclusive: input.windowStartInclusive,
    windowEndExclusive: input.windowEndExclusive,
    generatedAt: input.generatedAt,
    identityAuthority,
    identityAuthorityVersion,
    populationScope,
    populationPolicyVersion,
    monetaryPolicyVersion,
    refundPolicyVersion,
    currencyPolicyVersion,
    scoringPolicyVersion,
    checksumVersion,
    sourceDateTimeStorage: 'mysql_datetime',
    timezoneStatus: 'UNVERIFIED',
    sourceTimezone: 'UNVERIFIED',
    calculationTimezone: 'UTC',
    referenceTimeTimezone: 'UTC',
    recencyCalendarPolicy: 'utc-calendar-days-v1',
    monetaryDefinition,
    shippingIncluded: true,
    sellerServiceExcluded: true,
    sellerServiceExclusionPolicyVersion,
    operationalAccountPolicyVersion: operationalAccountExclusionPolicyVersion,
    historicalCustomerCount: input.diagnostics.historicalCustomerCount,
    activeCustomerCount: rows.length,
    scoredCustomerCount: rows.length,
    excludedCustomerCount: Math.max(0, input.diagnostics.historicalCustomerCount - rows.length),
    excludedOperationalAccountCount: input.diagnostics.exclusions.excludedOperationalAccountCount,
    validOrderCount: input.diagnostics.validOrderCount,
    grossOrderValueTaxIncl,
    currencyCode,
    distinctCurrencyCount: input.diagnostics.currency.distinctCurrencyCount,
    distinctShopCount: input.diagnostics.shops.distinctShopCount,
    excludedZeroValueOrderCount: input.diagnostics.exclusions.excludedZeroValueOrderCount,
    futureOrderExcludedCount: input.diagnostics.exclusions.futureOrderExcludedCount,
    invalidOrderExcludedCount: input.diagnostics.exclusions.invalidOrderExcludedCount,
    partiallyRefundedOrderCount: input.diagnostics.refunds.partiallyRefundedOrderCount,
    partiallyRefundedAmountObserved: input.diagnostics.refunds.partiallyRefundedAmountObserved,
    ordersWithSellerServiceCount: input.diagnostics.sellerService.ordersWithSellerServiceCount,
    sellerServiceLineCount: input.diagnostics.sellerService.sellerServiceLineCount,
    excludedSellerServiceValueTaxIncl: input.diagnostics.sellerService.excludedSellerServiceValueTaxIncl,
    grossOrderValueBeforeSellerServiceExclusion: input.diagnostics.sellerService.grossOrderValueBeforeSellerServiceExclusion,
    monetaryAfterSellerServiceExclusion: input.diagnostics.sellerService.monetaryAfterSellerServiceExclusion,
    recencyDistribution: describeNumberDistribution(rows.map((row) => row.recencyDays)),
    frequencyDistribution: describeNumberDistribution(rows.map((row) => row.frequencyOrders)),
    monetaryDistribution: describeDecimalDistribution(rows.map((row) => row.grossOrderValueTaxIncl)),
    recencyScoreDistribution: countScores(rows.map((row) => row.recencyScore)),
    frequencyScoreDistribution: countScores(rows.map((row) => row.frequencyScore)),
    monetaryScoreDistribution: countScores(rows.map((row) => row.monetaryScore)),
    rfmCodeDistribution: countStrings(rows.map((row) => row.rfmCode)),
    frequencyOutlierDiagnostics: buildFrequencyOutlierDiagnostics(rows, frequencyThresholds),
    scoreCutoffs: {
      recency: summarizeNumberValuesByScore(rows.map((row) => [row.recencyScore, row.recencyDays] as const)),
      monetary: summarizeStringValuesByScore(rows.map((row) => [row.monetaryScore, row.grossOrderValueTaxIncl] as const)),
    },
    frequencyThresholds,
    sourceChecksum,
    datasetChecksum,
    canonicalIdentitySource: 'master_customer.prestashop_customer_id',
    canonicalMatchedCount: canonicalIdentity.coverage.canonicalMatchedCount,
    canonicalUnmatchedCount: canonicalIdentity.coverage.canonicalUnmatchedCount,
    canonicalAmbiguousCount: canonicalIdentity.coverage.canonicalAmbiguousCount,
    canonicalCoveragePct: canonicalIdentity.coverage.canonicalCoveragePct,
    segmentVersion: rfmCommercialSegmentVersion,
    segmentCounts: countSegments(rows),
    segmentPercentages: summarizeSegmentPercentages(rows),
  };

  assertRfmManifestHasNoPii(manifest);
  return {
    snapshotKey: buildSnapshotKey(input.referenceTime, input.calculationVersion),
    rows,
    manifest,
    sourceChecksum,
    datasetChecksum,
  };
}

export function buildSnapshotKey(referenceTime: string, calculationVersion: string): string {
  return [
    calculationVersion,
    identityAuthorityVersion,
    populationPolicyVersion,
    monetaryPolicyVersion,
    refundPolicyVersion,
    scoringPolicyVersion,
    referenceTime.replace(/[:.]/g, '-'),
  ].join('__');
}

function normalizeSourceRow(row: RfmPopulationSourceRow): RfmPopulationSourceRow {
  if (!Number.isSafeInteger(row.prestashopCustomerId) || row.prestashopCustomerId <= 0) {
    throw new Error('RFM dataset contains an unusable PrestaShop customer id');
  }
  if (!Number.isSafeInteger(row.frequencyOrders) || row.frequencyOrders <= 0) {
    throw new Error('RFM dataset contains invalid frequencyOrders');
  }
  if (!Number.isSafeInteger(row.distinctShopCount) || row.distinctShopCount <= 0) {
    throw new Error('RFM dataset contains invalid distinctShopCount');
  }
  return {
    ...row,
    grossOrderValueTaxIncl: formatRfmDecimal(row.grossOrderValueTaxIncl),
  };
}

function resolveCanonicalIdentity(
  rows: readonly RfmPopulationSourceRow[],
  input: BuildRfmSnapshotInput,
): {
  readonly byPrestashopCustomerId: Map<number, CanonicalIdentityResolution>;
  readonly coverage: CanonicalIdentityCoverageSummary;
} {
  const resolutions = input.canonicalIdentityResolutions ?? rows.map((row) => ({
    prestashopCustomerId: row.prestashopCustomerId,
    status: 'unmatched' as const,
    masterCustomerId: null,
  }));

  const byPrestashopCustomerId = new Map<number, CanonicalIdentityResolution>();
  for (const resolution of resolutions) {
    if (!Number.isSafeInteger(resolution.prestashopCustomerId) || resolution.prestashopCustomerId <= 0) {
      throw new Error('RFM dataset contains invalid canonical identity prestashopCustomerId');
    }
    if (!['matched', 'unmatched', 'ambiguous'].includes(resolution.status)) {
      throw new Error('RFM dataset contains invalid canonical identity status');
    }
    if (resolution.status === 'matched' && !resolution.masterCustomerId) {
      throw new Error('Matched canonical identity resolution requires masterCustomerId');
    }
    if (resolution.status !== 'matched' && resolution.masterCustomerId !== null) {
      throw new Error('Non-matched canonical identity resolution must not carry masterCustomerId');
    }
    if (byPrestashopCustomerId.has(resolution.prestashopCustomerId)) {
      throw new Error('RFM dataset contains duplicate canonical identity resolutions');
    }
    byPrestashopCustomerId.set(resolution.prestashopCustomerId, resolution);
  }

  for (const row of rows) {
    if (!byPrestashopCustomerId.has(row.prestashopCustomerId)) {
      throw new Error(`Missing canonical identity resolution for prestashopCustomerId ${String(row.prestashopCustomerId)}`);
    }
  }

  const coverage =
    input.canonicalIdentityCoverage ??
    summarizeCanonicalIdentityCoverage(Array.from(byPrestashopCustomerId.values()), rows.length);

  if (coverage.populationSize !== rows.length) {
    throw new Error('Canonical identity coverage population size must match RFM population size');
  }
  if (
    coverage.canonicalMatchedCount + coverage.canonicalUnmatchedCount + coverage.canonicalAmbiguousCount !==
    coverage.populationSize
  ) {
    throw new Error('Canonical identity coverage counts do not add up to the RFM population size');
  }

  return { byPrestashopCustomerId, coverage };
}

function summarizeCanonicalIdentityCoverage(
  resolutions: readonly CanonicalIdentityResolution[],
  populationSize: number,
): CanonicalIdentityCoverageSummary {
  const canonicalMatchedCount = resolutions.filter((resolution) => resolution.status === 'matched').length;
  const canonicalUnmatchedCount = resolutions.filter((resolution) => resolution.status === 'unmatched').length;
  const canonicalAmbiguousCount = resolutions.filter((resolution) => resolution.status === 'ambiguous').length;

  return {
    populationSize,
    canonicalMatchedCount,
    canonicalUnmatchedCount,
    canonicalAmbiguousCount,
    canonicalCoveragePct: populationSize === 0 ? '0.000000' : ((canonicalMatchedCount / populationSize) * 100).toFixed(6),
  };
}

function assertCurrencyGuardrails(diagnostics: RfmSnapshotDiagnostics): void {
  if (diagnostics.currency.distinctCurrencyCount !== 1) {
    throw new Error('RFM snapshot requires exactly one source currency');
  }
  if (!diagnostics.currency.currencyCode || diagnostics.currency.currencyCode.trim() === '') {
    throw new Error('RFM snapshot currency ISO code is missing');
  }
  if (diagnostics.currency.distinctConversionRateCount !== 1) {
    throw new Error('RFM snapshot requires one compatible conversion rate');
  }
}

function assertNoDuplicateCustomers(rows: readonly RfmPopulationSourceRow[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.prestashopCustomerId)) {
      throw new Error('RFM dataset contains duplicate prestashopCustomerId rows');
    }
    seen.add(row.prestashopCustomerId);
  }
}

function assertScoreGuardrails(rows: readonly RfmSnapshotRow[]): void {
  for (const row of rows) {
    for (const score of [row.recencyScore, row.frequencyScore, row.monetaryScore]) {
      if (![1, 2, 3, 4, 5].includes(score)) {
        throw new Error('RFM score out of range');
      }
    }
  }
}

function assertTieSafeScores(rows: readonly RfmSnapshotRow[]): void {
  assertSameValueSameScore(rows, (row) => row.recencyDays, (row) => row.recencyScore, 'recency');
  assertSameValueSameScore(rows, (row) => row.grossOrderValueTaxIncl, (row) => row.monetaryScore, 'monetary');
}

function assertSameValueSameScore<T>(
  rows: readonly RfmSnapshotRow[],
  valueOf: (row: RfmSnapshotRow) => T,
  scoreOf: (row: RfmSnapshotRow) => RfmScore,
  name: string,
): void {
  const seen = new Map<T, RfmScore>();
  for (const row of rows) {
    const value = valueOf(row);
    const previous = seen.get(value);
    if (previous !== undefined && previous !== scoreOf(row)) {
      throw new Error(`${name} tie-safe score violation`);
    }
    seen.set(value, scoreOf(row));
  }
}

function describeNumberDistribution(values: readonly number[]): DistributionSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const histogram = new Map<number, number>();
  for (const value of sorted) histogram.set(value, (histogram.get(value) ?? 0) + 1);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    average: sorted.length === 0 ? null : (sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(6),
    p20: percentile(sorted, 0.2),
    p40: percentile(sorted, 0.4),
    p60: percentile(sorted, 0.6),
    p80: percentile(sorted, 0.8),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    uniqueValueCount: histogram.size,
    tieValueCount: Array.from(histogram.values()).filter((count) => count > 1).length,
  };
}

function describeDecimalDistribution(values: readonly string[]): DecimalDistributionSummary {
  const sorted = [...values].sort(compareRfmDecimalAsc);
  const histogram = new Map<string, number>();
  for (const value of sorted) histogram.set(value, (histogram.get(value) ?? 0) + 1);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    average: sorted.length === 0 ? null : divideRfmDecimal(addRfmDecimals(sorted), sorted.length),
    p20: percentile(sorted, 0.2),
    p40: percentile(sorted, 0.4),
    p60: percentile(sorted, 0.6),
    p80: percentile(sorted, 0.8),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    uniqueValueCount: histogram.size,
    tieValueCount: Array.from(histogram.values()).filter((count) => count > 1).length,
  };
}

function percentile<T>(sortedAscending: readonly T[], fraction: number): T | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.ceil(Math.min(Math.max(fraction, 0), 1) * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function countScores(scores: readonly RfmScore[]): Record<string, number> {
  return {
    '1': scores.filter((score) => score === 1).length,
    '2': scores.filter((score) => score === 2).length,
    '3': scores.filter((score) => score === 3).length,
    '4': scores.filter((score) => score === 4).length,
    '5': scores.filter((score) => score === 5).length,
  };
}

function buildFrequencyOutlierDiagnostics(
  rows: readonly RfmSnapshotRow[],
  frequencyThresholds: FrequencyThresholds,
): RfmSnapshotManifest['frequencyOutlierDiagnostics'] {
  const frequencies = rows.map((row) => row.frequencyOrders).sort((a, b) => a - b);
  const totalFrequency = frequencies.reduce((sum, value) => sum + value, 0);
  const descending = [...frequencies].sort((a, b) => b - a);
  return {
    maximumFrequencyOrders: frequencies.at(-1) ?? null,
    frequencyOutlierCount: rows.filter((row) => row.frequencyOrders > 100).length,
    frequencyP95: percentile(frequencies, 0.95),
    frequencyP99: percentile(frequencies, 0.99),
    frequencyP99_5: rows.length >= 200 ? percentile(frequencies, 0.995) : null,
    top1CustomerFrequencyShare: frequencyShare(descending, totalFrequency, 1),
    top5CustomerFrequencyShare: frequencyShare(descending, totalFrequency, 5),
    top10CustomerFrequencyShare: frequencyShare(descending, totalFrequency, 10),
    customersAbove100Orders: rows.filter((row) => row.frequencyOrders > 100).length,
    customersAbove500Orders: rows.filter((row) => row.frequencyOrders > 500).length,
    scoreDistributionExcludingAbove100Orders: countScores(
      rows
        .filter((row) => row.frequencyOrders <= 100)
        .map((row) => scoreFrequencyThresholds(row.frequencyOrders, frequencyThresholds)),
    ),
    scoreDistributionExcludingAbove500Orders: countScores(
      rows
        .filter((row) => row.frequencyOrders <= 500)
        .map((row) => scoreFrequencyThresholds(row.frequencyOrders, frequencyThresholds)),
    ),
  };
}

function frequencyShare(sortedDescending: readonly number[], total: number, count: number): string {
  if (total === 0) return '0.000000';
  const selected = sortedDescending.slice(0, count).reduce((sum, value) => sum + value, 0);
  return (selected / total).toFixed(6);
}

function countStrings(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countSegments(rows: readonly RfmSnapshotRow[]): Record<RfmCommercialSegmentCode, number> {
  const counts = Object.fromEntries(rfmCommercialSegmentCodes.map((segmentCode: RfmCommercialSegmentCode) => [segmentCode, 0])) as Record<
    RfmCommercialSegmentCode,
    number
  >;
  for (const row of rows) {
    counts[row.segmentCode] = (counts[row.segmentCode] ?? 0) + 1;
  }
  return counts;
}

function summarizeSegmentPercentages(rows: readonly RfmSnapshotRow[]): Record<RfmCommercialSegmentCode, string> {
  const counts = countSegments(rows);
  const total = rows.length;
  return Object.fromEntries(
    rfmCommercialSegmentCodes.map((segmentCode: RfmCommercialSegmentCode) => [
      segmentCode,
      total === 0 ? '0.000000' : ((counts[segmentCode] / total) * 100).toFixed(6),
    ]),
  ) as Record<RfmCommercialSegmentCode, string>;
}

function summarizeNumberValuesByScore(values: readonly (readonly [RfmScore, number])[]): Record<string, { readonly min: number | null; readonly max: number | null; readonly uniqueValueCount: number }> {
  const grouped: Record<string, Set<number>> = { '1': new Set(), '2': new Set(), '3': new Set(), '4': new Set(), '5': new Set() };
  for (const [score, value] of values) grouped[String(score)]!.add(value);
  return Object.fromEntries(
    Object.entries(grouped).map(([score, set]) => {
      const sorted = Array.from(set).sort((a, b) => a - b);
      return [score, { min: sorted[0] ?? null, max: sorted.at(-1) ?? null, uniqueValueCount: sorted.length }];
    }),
  );
}

function summarizeStringValuesByScore(values: readonly (readonly [RfmScore, string])[]): Record<string, { readonly min: string | null; readonly max: string | null; readonly uniqueValueCount: number }> {
  const grouped: Record<string, Set<string>> = { '1': new Set(), '2': new Set(), '3': new Set(), '4': new Set(), '5': new Set() };
  for (const [score, value] of values) grouped[String(score)]!.add(value);
  return Object.fromEntries(
    Object.entries(grouped).map(([score, set]) => {
      const sorted = Array.from(set).sort(compareRfmDecimalAsc);
      return [score, { min: sorted[0] ?? null, max: sorted.at(-1) ?? null, uniqueValueCount: sorted.length }];
    }),
  );
}

export function assertRfmManifestHasNoPii(manifest: unknown): void {
  assertNoPiiValue(manifest, 'manifest');
}

function assertNoPiiValue(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPiiValue(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenManifestKey(key)) {
        throw new Error(`RFM manifest contains a PII-shaped field: ${path}.${key}`);
      }
      assertNoPiiValue(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenManifestString(value)) {
    throw new Error(`RFM manifest contains a PII-shaped value at ${path}`);
  }
}

function isForbiddenManifestKey(key: string): boolean {
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
    'name',
    'address',
    'street',
    'payment',
    'card',
    'customerpayload',
    'orderpayload',
  ].some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenManifestString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trimmed) ||
    /^[A-Za-z0-9_.-]+(__[A-Za-z0-9_.-]+)+$/.test(trimmed)
  ) {
    return false;
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed)) {
    return true;
  }
  if ((trimmed.startsWith('+') || /[\s().-]/.test(trimmed)) && /\d(?:\D*\d){7,}/.test(trimmed)) {
    return true;
  }
  if (/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed)) {
    return true;
  }
  return false;
}
