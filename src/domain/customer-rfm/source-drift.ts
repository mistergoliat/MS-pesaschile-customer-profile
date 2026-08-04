import { formatRfmDecimal, addRfmDecimals } from './decimal.js';
import { sha256Stable } from './checksum.js';

export const rowChecksumVersion = 'rfm-source-row-canonical-v1';
export const sourceFingerprintVersion = 'rfm-source-fingerprint-v1';

export type RfmSourceArtifactRowInput = {
  readonly prestashopCustomerId: number;
  readonly firstValidOrderAtInWindow: string;
  readonly lastValidOrderAtInWindow: string;
  readonly frequencyOrders: number;
  readonly grossOrderValueTaxIncl: string | number;
  readonly averageOrderValueTaxIncl: string | number;
  readonly distinctShopCount: number;
};

export type RfmSourceArtifactRow = {
  readonly prestashopCustomerId: number;
  readonly firstValidOrderAtInWindow: string;
  readonly lastValidOrderAtInWindow: string;
  readonly frequencyOrders: number;
  readonly grossOrderValueTaxIncl: string;
  readonly averageOrderValueTaxIncl: string;
  readonly distinctShopCount: number;
  readonly rowChecksum: string;
};

export type RfmSourceFingerprintInput = {
  readonly referenceTime: string;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
  readonly rows: readonly RfmSourceArtifactRow[];
  readonly validOrderCount: number;
  readonly minOrderDateAdd: string | null;
  readonly maxOrderDateAdd: string | null;
  readonly maxOrderDateUpd: string | null;
  readonly distinctShopCount: number;
  readonly distinctCurrencyCount: number;
  readonly distinctConversionRateCount: number;
  readonly zeroAmountOrderCount: number;
  readonly ordersUpdatedAfterReferenceTime: number;
  readonly sourceChecksum: string;
};

export type RfmSourceFingerprint = Omit<RfmSourceFingerprintInput, 'rows'> & {
  readonly activeCustomerCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly checksumVersion: typeof sourceFingerprintVersion;
};

export type RfmDatasetComparison = {
  readonly baselineCustomerCount: number;
  readonly candidateCustomerCount: number;
  readonly addedCustomers: number;
  readonly removedCustomers: number;
  readonly changedCustomers: number;
  readonly unchangedCustomers: number;
  readonly frequencyChangedCount: number;
  readonly monetaryChangedCount: number;
  readonly lastOrderChangedCount: number;
  readonly shopCountChangedCount: number;
  readonly totalFrequencyDelta: number;
  readonly totalMonetaryDelta: string;
  readonly affectedPrestashopCustomerIds: readonly number[];
};

export type BaselineComparability = 'ROW_ARTIFACT' | 'AGGREGATE_ONLY' | 'NOT_COMPARABLE';

export function buildRfmSourceArtifactRow(input: RfmSourceArtifactRowInput): RfmSourceArtifactRow {
  const normalized = normalizeSourceArtifactRow(input);
  return {
    ...normalized,
    rowChecksum: calculateRfmSourceRowChecksum(normalized),
  };
}

export function calculateRfmSourceRowChecksum(input: RfmSourceArtifactRowInput): string {
  const row = normalizeSourceArtifactRow(input);
  return sha256Stable({
    rowChecksumVersion,
    prestashopCustomerId: row.prestashopCustomerId,
    firstValidOrderAtInWindow: row.firstValidOrderAtInWindow,
    lastValidOrderAtInWindow: row.lastValidOrderAtInWindow,
    frequencyOrders: row.frequencyOrders,
    grossOrderValueTaxIncl: row.grossOrderValueTaxIncl,
    averageOrderValueTaxIncl: row.averageOrderValueTaxIncl,
    distinctShopCount: row.distinctShopCount,
  });
}

export function normalizeSourceArtifactRow(input: RfmSourceArtifactRowInput): Omit<RfmSourceArtifactRow, 'rowChecksum'> {
  assertPositiveInteger(input.prestashopCustomerId, 'prestashopCustomerId');
  assertPositiveInteger(input.frequencyOrders, 'frequencyOrders');
  assertPositiveInteger(input.distinctShopCount, 'distinctShopCount');
  return {
    prestashopCustomerId: input.prestashopCustomerId,
    firstValidOrderAtInWindow: canonicalMysqlDateTime(input.firstValidOrderAtInWindow),
    lastValidOrderAtInWindow: canonicalMysqlDateTime(input.lastValidOrderAtInWindow),
    frequencyOrders: input.frequencyOrders,
    grossOrderValueTaxIncl: formatRfmDecimal(input.grossOrderValueTaxIncl),
    averageOrderValueTaxIncl: formatRfmDecimal(input.averageOrderValueTaxIncl),
    distinctShopCount: input.distinctShopCount,
  };
}

export function buildRfmSourceFingerprint(input: RfmSourceFingerprintInput): RfmSourceFingerprint {
  return {
    referenceTime: input.referenceTime,
    windowStartInclusive: input.windowStartInclusive,
    windowEndExclusive: input.windowEndExclusive,
    activeCustomerCount: input.rows.length,
    validOrderCount: input.validOrderCount,
    grossOrderValueTaxIncl: addRfmDecimals(input.rows.map((row) => row.grossOrderValueTaxIncl)),
    minOrderDateAdd: input.minOrderDateAdd === null ? null : canonicalMysqlDateTime(input.minOrderDateAdd),
    maxOrderDateAdd: input.maxOrderDateAdd === null ? null : canonicalMysqlDateTime(input.maxOrderDateAdd),
    maxOrderDateUpd: input.maxOrderDateUpd === null ? null : canonicalMysqlDateTime(input.maxOrderDateUpd),
    distinctShopCount: input.distinctShopCount,
    distinctCurrencyCount: input.distinctCurrencyCount,
    distinctConversionRateCount: input.distinctConversionRateCount,
    zeroAmountOrderCount: input.zeroAmountOrderCount,
    ordersUpdatedAfterReferenceTime: input.ordersUpdatedAfterReferenceTime,
    sourceChecksum: input.sourceChecksum,
    checksumVersion: sourceFingerprintVersion,
  };
}

export function compareRfmSourceArtifacts(
  baseline: readonly RfmSourceArtifactRow[],
  candidate: readonly RfmSourceArtifactRow[],
): RfmDatasetComparison {
  const baselineById = new Map(baseline.map((row) => [row.prestashopCustomerId, row]));
  const candidateById = new Map(candidate.map((row) => [row.prestashopCustomerId, row]));
  let changedCustomers = 0;
  let unchangedCustomers = 0;
  let frequencyChangedCount = 0;
  let monetaryChangedCount = 0;
  let lastOrderChangedCount = 0;
  let shopCountChangedCount = 0;
  let totalFrequencyDelta = 0;
  const monetaryDeltas: string[] = [];
  const affected = new Set<number>();

  for (const [customerId, baselineRow] of baselineById) {
    const candidateRow = candidateById.get(customerId);
    if (!candidateRow) {
      affected.add(customerId);
      totalFrequencyDelta -= baselineRow.frequencyOrders;
      monetaryDeltas.push(`-${baselineRow.grossOrderValueTaxIncl}`);
      continue;
    }
    if (baselineRow.rowChecksum === candidateRow.rowChecksum) {
      unchangedCustomers += 1;
      continue;
    }
    changedCustomers += 1;
    affected.add(customerId);
    if (baselineRow.frequencyOrders !== candidateRow.frequencyOrders) frequencyChangedCount += 1;
    if (baselineRow.grossOrderValueTaxIncl !== candidateRow.grossOrderValueTaxIncl) monetaryChangedCount += 1;
    if (baselineRow.lastValidOrderAtInWindow !== candidateRow.lastValidOrderAtInWindow) lastOrderChangedCount += 1;
    if (baselineRow.distinctShopCount !== candidateRow.distinctShopCount) shopCountChangedCount += 1;
    totalFrequencyDelta += candidateRow.frequencyOrders - baselineRow.frequencyOrders;
    monetaryDeltas.push(subtractDecimal(candidateRow.grossOrderValueTaxIncl, baselineRow.grossOrderValueTaxIncl));
  }

  for (const [customerId, candidateRow] of candidateById) {
    if (baselineById.has(customerId)) continue;
    affected.add(customerId);
    totalFrequencyDelta += candidateRow.frequencyOrders;
    monetaryDeltas.push(candidateRow.grossOrderValueTaxIncl);
  }

  return {
    baselineCustomerCount: baseline.length,
    candidateCustomerCount: candidate.length,
    addedCustomers: candidate.filter((row) => !baselineById.has(row.prestashopCustomerId)).length,
    removedCustomers: baseline.filter((row) => !candidateById.has(row.prestashopCustomerId)).length,
    changedCustomers,
    unchangedCustomers,
    frequencyChangedCount,
    monetaryChangedCount,
    lastOrderChangedCount,
    shopCountChangedCount,
    totalFrequencyDelta,
    totalMonetaryDelta: addSignedDecimals(monetaryDeltas),
    affectedPrestashopCustomerIds: Array.from(affected).sort((a, b) => a - b),
  };
}

export function classifyBaselineComparability(value: unknown): BaselineComparability {
  if (Array.isArray(value) && value.every(isRfmSourceArtifactRowLike)) {
    return 'ROW_ARTIFACT';
  }
  if (value && typeof value === 'object') {
    return 'AGGREGATE_ONLY';
  }
  return 'NOT_COMPARABLE';
}

function isRfmSourceArtifactRowLike(value: unknown): value is RfmSourceArtifactRow {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'prestashopCustomerId' in value &&
      'rowChecksum' in value &&
      'frequencyOrders' in value &&
      'grossOrderValueTaxIncl' in value,
  );
}

function canonicalMysqlDateTime(value: string): string {
  const normalized = value.trim().replace(' ', 'T').replace(/Z$/, '').replace(/\.\d+$/, '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Invalid source datetime: ${value}`);
  }
  return `${normalized}.000Z`;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
}

function subtractDecimal(left: string, right: string): string {
  const result = toScaled(left) - toScaled(right);
  return formatSignedScaled(result);
}

function addSignedDecimals(values: readonly string[]): string {
  return formatSignedScaled(values.reduce((sum, value) => sum + toScaled(value), 0n));
}

function toScaled(value: string): bigint {
  const sign = value.startsWith('-') ? -1n : 1n;
  const unsigned = value.replace(/^-/, '');
  const [whole, fractional = ''] = formatRfmDecimal(unsigned).split('.');
  return sign * BigInt(`${whole}${fractional}`);
}

function formatSignedScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(7, '0');
  return `${sign}${raw.slice(0, -6)}.${raw.slice(-6)}`;
}
