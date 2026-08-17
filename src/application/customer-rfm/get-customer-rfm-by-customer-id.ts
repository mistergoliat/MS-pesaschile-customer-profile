import { RfmSchemaIncompatibleError, RfmTimeoutError, RfmUnavailableError } from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { CurrentRfmSnapshotReader } from './ports.js';
import {
  CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
  type CurrentPrestashopCustomerRfmLookup,
  type GetCustomerRfmByCustomerIdResult,
} from '../../domain/customer-rfm/index.js';

export type GetCustomerRfmByCustomerIdInput = {
  readonly customerId: number;
};

export type GetCustomerRfmByCustomerId = (
  input: GetCustomerRfmByCustomerIdInput,
) => Promise<GetCustomerRfmByCustomerIdResult>;

// Primary RFM path: customerId = ps_customer.id_customer. Deliberately takes no CRM/
// master_customer dependency — existence is checked against PrestaShop directly, the same
// source the other five endpoints already use, not against CRM. See
// docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md §7/§14/§18.
export function createGetCustomerRfmByCustomerId(deps: {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly currentRfmSnapshotReader: CurrentRfmSnapshotReader;
}): GetCustomerRfmByCustomerId {
  return async function getCustomerRfmByCustomerId(input) {
    const customerId = input.customerId;

    let lookup: CurrentPrestashopCustomerRfmLookup;
    try {
      lookup = await deps.currentRfmSnapshotReader.getCurrentPrestashopCustomerRfmLookup(customerId);
    } catch (error) {
      if (error instanceof RfmUnavailableError || error instanceof RfmTimeoutError || error instanceof RfmSchemaIncompatibleError) {
        return {
          status: 'degraded',
          customerId,
          reason: 'rfm_unavailable',
          contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
        };
      }
      throw error;
    }

    if (lookup.snapshot === null) {
      return {
        status: 'degraded',
        customerId,
        reason: 'no_published_rfm_snapshot',
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      };
    }

    if (lookup.record === null) {
      const identityResult = await deps.resolveCustomerIdentity(customerId);
      if (identityResult.status !== 'found') {
        return {
          status: 'customer_not_found',
          customerId,
          contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
        };
      }
      return {
        status: 'rfm_not_available',
        customerId,
        reason: 'no_current_rfm_record',
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      };
    }

    const record = lookup.record;
    return {
      status: 'available',
      customerId,
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
