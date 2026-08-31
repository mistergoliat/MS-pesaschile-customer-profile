import { compareDecimalAsc, formatDecimal } from '../../shared/decimal.js';
import {
  CUSTOMER_CLV_CURRENCY_ISO_CODE,
  CUSTOMER_CLV_ESTIMATE_SUPPORT_LEVELS,
  CUSTOMER_CLV_IDENTITY_AUTHORITY,
  CUSTOMER_CLV_SNAPSHOT_STATUSES,
  type CustomerClvRecord,
  type CustomerClvSnapshotHeader,
  type CustomerClvSnapshotRow,
  type CustomerClvTrainingMetadata,
  type CustomerClvValidationMetadata,
} from './contracts.js';
import { isCustomerClvV1Horizon } from './snapshot.js';

const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function assertValidCustomerClvRecord(record: CustomerClvRecord): void {
  assertPositiveInteger(record.customerId, 'customerId');
  assertV1Horizon(record.horizonMonths);
  assertNonNegativeDecimalString(record.expectedRevenueTaxIncl, 'expectedRevenueTaxIncl');
  assertClpCurrency(record.currencyIsoCode);
  assertNonEmptyString(record.modelVersion, 'modelVersion');
  assertIsoTimestamp(record.referenceTime, 'referenceTime');
  assertNonEmptyString(record.populationPolicyVersion, 'populationPolicyVersion');
  assertNonEmptyString(record.monetaryPolicyVersion, 'monetaryPolicyVersion');
  assertEstimateSupportLevel(record.estimateSupportLevel);
  if (record.expectedOrders !== undefined) {
    assertNonNegativeDecimalString(record.expectedOrders, 'expectedOrders');
  }
}

export function assertValidCustomerClvSnapshotRow(row: CustomerClvSnapshotRow): void {
  assertPositiveInteger(row.customerId, 'customerId');
  assertNonNegativeDecimalString(row.expectedRevenueTaxIncl, 'expectedRevenueTaxIncl');
  assertEstimateSupportLevel(row.estimateSupportLevel);
  if (row.expectedOrders !== undefined) {
    assertNonNegativeDecimalString(row.expectedOrders, 'expectedOrders');
  }
}

export function assertValidCustomerClvSnapshotHeader(header: CustomerClvSnapshotHeader): void {
  if (header.snapshotId !== null) {
    assertNonEmptyString(header.snapshotId, 'snapshotId');
  }
  assertNonEmptyString(header.snapshotKey, 'snapshotKey');
  assertSnapshotStatus(header.status);
  assertIsoTimestamp(header.referenceTime, 'referenceTime');
  assertIsoTimestamp(header.generatedAt, 'generatedAt');
  assertV1Horizon(header.horizonMonths);
  assertNonEmptyString(header.modelVersion, 'modelVersion');
  assertNonEmptyString(header.populationPolicyVersion, 'populationPolicyVersion');
  assertNonEmptyString(header.monetaryPolicyVersion, 'monetaryPolicyVersion');
  assertIdentityAuthority(header.identityAuthority);
  assertClpCurrency(header.currencyIsoCode);
  assertNonNegativeInteger(header.populationSize, 'populationSize');
  assertChecksum(header.datasetChecksum, 'datasetChecksum');
  assertChecksum(header.outputChecksum, 'outputChecksum');
  if (header.trainingMetadata !== undefined) {
    assertValidTrainingMetadata(header.trainingMetadata);
  }
  if (header.validationMetadata !== undefined) {
    assertValidValidationMetadata(header.validationMetadata);
  }
}

export function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: must be a positive integer`);
  }
}

export function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative integer`);
  }
}

export function assertV1Horizon(value: number): void {
  if (!isCustomerClvV1Horizon(value)) {
    throw new Error(`Invalid horizonMonths: CLV v1 requires 12 months`);
  }
}

export function assertClpCurrency(value: string): void {
  if (value !== CUSTOMER_CLV_CURRENCY_ISO_CODE) {
    throw new Error(`Invalid currencyIsoCode: CLV v1 requires CLP`);
  }
}

export function assertIdentityAuthority(value: string): void {
  if (value !== CUSTOMER_CLV_IDENTITY_AUTHORITY) {
    throw new Error(`Invalid identityAuthority: CLV uses prestashop_customer`);
  }
}

export function assertEstimateSupportLevel(value: string): void {
  if (!CUSTOMER_CLV_ESTIMATE_SUPPORT_LEVELS.includes(value as never)) {
    throw new Error(`Invalid estimateSupportLevel: ${value}`);
  }
}

export function assertSnapshotStatus(value: string): void {
  if (!CUSTOMER_CLV_SNAPSHOT_STATUSES.includes(value as never)) {
    throw new Error(`Invalid snapshot status: ${value}`);
  }
}

export function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${name}: must not be empty`);
  }
}

export function assertChecksum(value: string, name: string): void {
  assertNonEmptyString(value, name);
}

export function assertIsoTimestamp(value: string, name: string): void {
  if (typeof value !== 'string' || !ISO_UTC_TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${name}: must be a valid timestamp`);
  }
}

export function assertNonNegativeDecimalString(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() !== value || value.trim() === '') {
    throw new Error(`Invalid ${name}: must be a non-negative decimal string`);
  }
  let formatted: string;
  try {
    formatted = formatDecimal(value);
  } catch {
    throw new Error(`Invalid ${name}: must be a non-negative decimal string`);
  }
  if (compareDecimalAsc(formatted, '0') < 0) {
    throw new Error(`Invalid ${name}: must be non-negative`);
  }
}

function assertValidTrainingMetadata(metadata: CustomerClvTrainingMetadata): void {
  if (metadata.trainingCutoffStart !== undefined) assertIsoTimestamp(metadata.trainingCutoffStart, 'trainingCutoffStart');
  if (metadata.trainingCutoffEnd !== undefined) assertIsoTimestamp(metadata.trainingCutoffEnd, 'trainingCutoffEnd');
  if (metadata.trainingWindowCount !== undefined) assertNonNegativeInteger(metadata.trainingWindowCount, 'trainingWindowCount');
  if (metadata.modelFitVersion !== undefined) assertNonEmptyString(metadata.modelFitVersion, 'modelFitVersion');
}

function assertValidValidationMetadata(metadata: CustomerClvValidationMetadata): void {
  if (metadata.validationCutoff !== undefined) assertIsoTimestamp(metadata.validationCutoff, 'validationCutoff');
  if (metadata.maeRevenueTaxIncl !== undefined) assertNonNegativeDecimalString(metadata.maeRevenueTaxIncl, 'maeRevenueTaxIncl');
  if (metadata.medianAbsoluteErrorRevenueTaxIncl !== undefined) {
    assertNonNegativeDecimalString(metadata.medianAbsoluteErrorRevenueTaxIncl, 'medianAbsoluteErrorRevenueTaxIncl');
  }
  if (metadata.rankCorrelation !== undefined) assertSignedRatioDecimal(metadata.rankCorrelation, 'rankCorrelation');
  if (metadata.top10RevenueCapture !== undefined) assertRatioDecimal(metadata.top10RevenueCapture, 'top10RevenueCapture');
  if (metadata.calibrationRatio !== undefined) assertNonNegativeDecimalString(metadata.calibrationRatio, 'calibrationRatio');
}

function assertRatioDecimal(value: string, name: string): void {
  assertNonNegativeDecimalString(value, name);
  if (compareDecimalAsc(formatDecimal(value), '1') > 0) {
    throw new Error(`Invalid ${name}: must be within [0,1]`);
  }
}

function assertSignedRatioDecimal(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim() !== value || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid ${name}: must be a decimal string within [-1,1]`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1) {
    throw new Error(`Invalid ${name}: must be within [-1,1]`);
  }
}
