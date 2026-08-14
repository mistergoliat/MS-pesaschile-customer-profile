import type { CurrentMasterCustomerRfmRecord } from '../../domain/customer-rfm/index.js';
import type { CurrentRfmSnapshotReader } from './ports.js';

export type GetCurrentMasterCustomerRfmInput = {
  readonly masterCustomerId: string;
};

export type GetCurrentMasterCustomerRfm = (
  input: GetCurrentMasterCustomerRfmInput,
) => Promise<CurrentMasterCustomerRfmRecord | null>;

export function createGetCurrentMasterCustomerRfm(deps: {
  readonly currentRfmSnapshotReader: CurrentRfmSnapshotReader;
}): GetCurrentMasterCustomerRfm {
  return async function getCurrentMasterCustomerRfm(input) {
    const masterCustomerId = resolveMasterCustomerId(input.masterCustomerId);
    return deps.currentRfmSnapshotReader.getCurrentMasterCustomerRfm(masterCustomerId);
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
