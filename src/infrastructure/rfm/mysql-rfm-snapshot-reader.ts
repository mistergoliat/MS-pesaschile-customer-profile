import type { RowDataPacket } from 'mysql2/promise';
import type { CurrentRfmSnapshotReader } from '../../application/customer-rfm/ports.js';
import {
  type CurrentMasterCustomerRfmLookup,
  formatRfmDecimal,
  type CurrentMasterCustomerRfmRecord,
  type CurrentPrestashopCustomerRfmRecord,
  type CurrentRfmSnapshotMetadata,
  type IdentityResolutionStatus,
  type RfmCommercialSegmentCode,
  type RfmScore,
} from '../../domain/customer-rfm/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';

interface CurrentSnapshotRow extends RowDataPacket {
  snapshot_id: string | number;
  snapshot_key: string;
  status: string;
  calculation_version: string;
  identity_authority: string;
  identity_authority_version: string;
  reference_time: string | Date;
  generated_at: string | Date;
  published_at: string | Date | null;
  population_size: string | number | null;
  currency_code: string;
  dataset_checksum: string;
}

interface SnapshotCustomerRow extends RowDataPacket {
  prestashop_customer_id: string | number;
  master_customer_id: string | number | null;
  identity_resolution_status: string;
  first_valid_order_at: string | Date;
  last_valid_order_at: string | Date;
  recency_days: string | number | null;
  frequency_orders: string | number | null;
  gross_order_value_tax_incl: string | number | null;
  average_order_value_tax_incl: string | number | null;
  distinct_shop_count: string | number | null;
  recency_score: string | number | null;
  frequency_score: string | number | null;
  monetary_score: string | number | null;
  rfm_code: string;
  segment_code: string | null;
  segment_version: string | null;
}

const SELECT_CURRENT_SNAPSHOT_SQL = `
  SELECT
    id AS snapshot_id,
    snapshot_key,
    status,
    calculation_version,
    identity_authority,
    identity_authority_version,
    reference_time,
    generated_at,
    published_at,
    population_size,
    currency_code,
    dataset_checksum
  FROM customer_rfm_snapshot
  WHERE status = 'published'
  ORDER BY published_at DESC, id DESC
  LIMIT 1
`;

const SELECT_CURRENT_SNAPSHOT_CUSTOMER_SQL = `
  SELECT
    prestashop_customer_id,
    master_customer_id,
    identity_resolution_status,
    first_valid_order_at,
    last_valid_order_at,
    recency_days,
    frequency_orders,
    gross_order_value_tax_incl,
    average_order_value_tax_incl,
    distinct_shop_count,
    recency_score,
    frequency_score,
    monetary_score,
    rfm_code,
    segment_code,
    segment_version
  FROM customer_rfm_snapshot_row
  WHERE snapshot_id = ?
    AND prestashop_customer_id = ?
  LIMIT 1
`;

const SELECT_CURRENT_SNAPSHOT_MASTER_CUSTOMER_SQL = `
  SELECT
    prestashop_customer_id,
    master_customer_id,
    identity_resolution_status,
    first_valid_order_at,
    last_valid_order_at,
    recency_days,
    frequency_orders,
    gross_order_value_tax_incl,
    average_order_value_tax_incl,
    distinct_shop_count,
    recency_score,
    frequency_score,
    monetary_score,
    rfm_code,
    segment_code,
    segment_version
  FROM customer_rfm_snapshot_row
  WHERE snapshot_id = ?
    AND master_customer_id = ?
  LIMIT 2
`;

export function createMysqlRfmSnapshotReader(executor: QueryExecutor): CurrentRfmSnapshotReader {
  return {
    async getCurrentSnapshot() {
      const rows = await executor.execute(SELECT_CURRENT_SNAPSHOT_SQL, []);
      return toCurrentSnapshotMetadata(rows[0] as CurrentSnapshotRow | undefined);
    },

    async getCurrentPrestashopCustomerRfm(prestashopCustomerId) {
      const safeCustomerId = resolvePrestashopCustomerId(prestashopCustomerId);
      const currentSnapshot = await this.getCurrentSnapshot();
      if (currentSnapshot === null) {
        return null;
      }

      const rows = await executor.execute(SELECT_CURRENT_SNAPSHOT_CUSTOMER_SQL, [
        currentSnapshot.snapshotId,
        safeCustomerId,
      ]);

      return toCurrentPrestashopCustomerRfm(rows[0] as SnapshotCustomerRow | undefined, currentSnapshot);
    },

    async getCurrentMasterCustomerRfm(masterCustomerId) {
      const lookup = await this.getCurrentMasterCustomerRfmLookup(masterCustomerId);
      return lookup.record;
    },

    async getCurrentMasterCustomerRfmLookup(masterCustomerId) {
      const safeMasterCustomerId = resolveMasterCustomerId(masterCustomerId);
      const currentSnapshot = await this.getCurrentSnapshot();
      if (currentSnapshot === null) {
        return {
          snapshot: null,
          record: null,
        } satisfies CurrentMasterCustomerRfmLookup;
      }

      const rows = await executor.execute(SELECT_CURRENT_SNAPSHOT_MASTER_CUSTOMER_SQL, [
        currentSnapshot.snapshotId,
        safeMasterCustomerId,
      ]);

      return {
        snapshot: currentSnapshot,
        record: toCurrentMasterCustomerRfm(rows as SnapshotCustomerRow[], currentSnapshot, safeMasterCustomerId),
      } satisfies CurrentMasterCustomerRfmLookup;
    },
  };
}

function toCurrentSnapshotMetadata(row: CurrentSnapshotRow | undefined): CurrentRfmSnapshotMetadata | null {
  if (!row) {
    return null;
  }

  const status = parsePublishedStatus(row.status, 'status');
  return {
    snapshotId: parsePositiveIdString(row.snapshot_id, 'snapshot_id'),
    snapshotKey: parseNonEmptyString(row.snapshot_key, 'snapshot_key'),
    status,
    calculationVersion: parseNonEmptyString(row.calculation_version, 'calculation_version'),
    identityAuthority: parseNonEmptyString(row.identity_authority, 'identity_authority'),
    identityAuthorityVersion: parseNonEmptyString(row.identity_authority_version, 'identity_authority_version'),
    referenceTime: parseRequiredUtcDateTime(row.reference_time, 'reference_time'),
    generatedAt: parseRequiredUtcDateTime(row.generated_at, 'generated_at'),
    publishedAt: parseRequiredUtcDateTime(row.published_at, 'published_at'),
    populationSize: parseNonNegativeSafeInteger(row.population_size, 'population_size'),
    currencyCode: parseCurrencyCode(row.currency_code),
    datasetChecksum: parseChecksum(row.dataset_checksum, 'dataset_checksum'),
  };
}

function toCurrentPrestashopCustomerRfm(
  row: SnapshotCustomerRow | undefined,
  snapshot: CurrentRfmSnapshotMetadata,
): CurrentPrestashopCustomerRfmRecord | null {
  if (!row) {
    return null;
  }

  return {
    prestashopCustomerId: parsePositiveSafeInteger(row.prestashop_customer_id, 'prestashop_customer_id'),
    masterCustomerId: parseNullablePositiveIdString(row.master_customer_id, 'master_customer_id'),
    identityResolutionStatus: parseIdentityResolutionStatus(row.identity_resolution_status),
    firstValidOrderAt: parseRequiredUtcDateTime(row.first_valid_order_at, 'first_valid_order_at'),
    lastValidOrderAt: parseRequiredUtcDateTime(row.last_valid_order_at, 'last_valid_order_at'),
    recencyDays: parseNonNegativeSafeInteger(row.recency_days, 'recency_days'),
    frequencyOrders: parseNonNegativeSafeInteger(row.frequency_orders, 'frequency_orders'),
    grossOrderValueTaxIncl: parseRfmDecimal(row.gross_order_value_tax_incl, 'gross_order_value_tax_incl'),
    averageOrderValueTaxIncl: parseRfmDecimal(row.average_order_value_tax_incl, 'average_order_value_tax_incl'),
    distinctShopCount: parseNonNegativeSafeInteger(row.distinct_shop_count, 'distinct_shop_count'),
    recencyScore: parseRfmScore(row.recency_score, 'recency_score'),
    frequencyScore: parseRfmScore(row.frequency_score, 'frequency_score'),
    monetaryScore: parseRfmScore(row.monetary_score, 'monetary_score'),
    rfmCode: parseNonEmptyString(row.rfm_code, 'rfm_code'),
    segmentCode: parseNullableSegmentCode(row.segment_code),
    segmentVersion: parseNullableNonEmptyString(row.segment_version),
    snapshot,
  };
}

function toCurrentMasterCustomerRfm(
  rows: readonly SnapshotCustomerRow[],
  snapshot: CurrentRfmSnapshotMetadata,
  masterCustomerId: string,
): CurrentMasterCustomerRfmRecord | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length > 1) {
    throw new Error(`Current RFM snapshot contains multiple rows for master_customer_id ${masterCustomerId}`);
  }

  const record = toCurrentPrestashopCustomerRfm(rows[0], snapshot);
  if (!record || record.masterCustomerId === null) {
    throw new Error(`Current RFM snapshot row for master_customer_id ${masterCustomerId} is missing canonical identity`);
  }
  return {
    ...record,
    masterCustomerId: record.masterCustomerId,
  };
}

function resolvePrestashopCustomerId(prestashopCustomerId: number): number {
  if (!Number.isSafeInteger(prestashopCustomerId) || prestashopCustomerId <= 0) {
    throw new Error(`Invalid PrestaShop customer id: ${String(prestashopCustomerId)}`);
  }
  return prestashopCustomerId;
}

function resolveMasterCustomerId(masterCustomerId: string): string {
  if (typeof masterCustomerId !== 'string') {
    throw new Error(`Invalid master customer id: ${String(masterCustomerId)}`);
  }
  const normalized = masterCustomerId.trim();
  if (!/^[0-9]+$/.test(normalized) || /^0+$/.test(normalized) || normalized.length === 0 || normalized.length > 20) {
    throw new Error(`Invalid master customer id: ${String(masterCustomerId)}`);
  }
  return normalized;
}

function parsePublishedStatus(value: unknown, field: string): 'published' {
  if (value !== 'published') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return 'published';
}

function parseIdentityResolutionStatus(value: unknown): IdentityResolutionStatus {
  if (value !== 'provisional') {
    throw new Error(`Invalid identity_resolution_status: ${String(value)}`);
  }
  return 'provisional';
}

function parseRfmScore(value: unknown, field: string): RfmScore {
  const numeric = parseNonNegativeSafeInteger(value, field);
  if (numeric < 1 || numeric > 5) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric as RfmScore;
}

function parseRequiredUtcDateTime(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${field}`);
    }
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}`);
  }

  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const numeric = parseNonNegativeSafeInteger(value, field);
  if (numeric <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  let numericValue: number;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    numericValue = Number(value);
  } else if (typeof value === 'number') {
    numericValue = value;
  } else {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }

  if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numericValue;
}

function parsePositiveIdString(value: unknown, field: string): string {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  throw new Error(`Invalid ${field}: ${String(value)}`);
}

function parseNullablePositiveIdString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parsePositiveIdString(value, field);
}

function parseNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}

function parseNullableNonEmptyString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid nullable string: ${String(value)}`);
  }
  return value;
}

function parseNullableSegmentCode(value: unknown): RfmCommercialSegmentCode | null {
  const parsed = parseNullableNonEmptyString(value);
  if (parsed === null) {
    return null;
  }
  if (
    ![
      'CHAMPION',
      'LOYAL',
      'POTENTIAL_LOYAL',
      'RECENT_HIGH_VALUE',
      'RECENT_ONE_TIME',
      'NEEDS_ATTENTION',
      'AT_RISK_HIGH_VALUE',
      'HIBERNATING',
    ].includes(parsed)
  ) {
    throw new Error(`Invalid segment_code: ${String(value)}`);
  }
  return parsed as RfmCommercialSegmentCode;
}

function parseCurrencyCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new Error(`Invalid currency_code: ${String(value)}`);
  }
  return value;
}

function parseChecksum(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}

function parseRfmDecimal(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return formatRfmDecimal(value);
}
