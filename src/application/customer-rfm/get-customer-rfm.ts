import type { MasterCustomerReader } from '../customer-profile/ports.js';
import type { CurrentRfmSnapshotReader } from './ports.js';
import {
  CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
  type GetCustomerRfmResult,
} from '../../domain/customer-rfm/index.js';

export type GetCustomerRfmInput = {
  readonly masterCustomerId: string;
};

export type GetCustomerRfm = (input: GetCustomerRfmInput) => Promise<GetCustomerRfmResult>;

export function createGetCustomerRfm(deps: {
  readonly masterCustomerReader: MasterCustomerReader;
  readonly currentRfmSnapshotReader: CurrentRfmSnapshotReader;
}): GetCustomerRfm {
  return async function getCustomerRfm(input) {
    const masterCustomerId = resolveMasterCustomerId(input.masterCustomerId);
    const currentLookup = await deps.currentRfmSnapshotReader.getCurrentMasterCustomerRfmLookup(masterCustomerId);

    if (currentLookup.snapshot === null) {
      return {
        status: 'degraded',
        masterCustomerId,
        reason: 'no_published_rfm_snapshot',
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      };
    }

    if (currentLookup.record === null) {
      const masterCustomer = await deps.masterCustomerReader.findById(masterCustomerId);
      if (masterCustomer === null) {
        return {
          status: 'customer_not_found',
          masterCustomerId,
          contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
        };
      }
      return {
        status: 'rfm_not_available',
        masterCustomerId,
        reason: 'no_current_rfm_record',
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      };
    }

    const record = currentLookup.record;
    return {
      status: 'available',
      masterCustomerId,
      snapshot: {
        snapshotId: record.snapshot.snapshotId,
        calculationVersion: record.snapshot.calculationVersion,
        referenceTime: record.snapshot.referenceTime.toISOString(),
        publishedAt: record.snapshot.publishedAt.toISOString(),
        currencyCode: record.snapshot.currencyCode,
      },
      rfm: {
        recencyDays: record.recencyDays,
        frequencyOrders: record.frequencyOrders,
        grossOrderValueTaxIncl: record.grossOrderValueTaxIncl,
        averageOrderValueTaxIncl: record.averageOrderValueTaxIncl,
        recencyScore: record.recencyScore,
        frequencyScore: record.frequencyScore,
        monetaryScore: record.monetaryScore,
        rfmCode: record.rfmCode,
      },
      segment: {
        code: record.segmentCode,
        version: record.segmentVersion,
      },
      contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
    };
  };
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
