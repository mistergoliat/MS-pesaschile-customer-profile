import type { CurrentPrestashopCustomerRfmRecord } from '../../domain/customer-rfm/index.js';
import type { CurrentRfmSnapshotReader } from './ports.js';

export type GetCurrentPrestashopCustomerRfmInput = {
  readonly prestashopCustomerId: number;
};

export type GetCurrentPrestashopCustomerRfm = (
  input: GetCurrentPrestashopCustomerRfmInput,
) => Promise<CurrentPrestashopCustomerRfmRecord | null>;

export function createGetCurrentPrestashopCustomerRfm(deps: {
  readonly currentRfmSnapshotReader: CurrentRfmSnapshotReader;
}): GetCurrentPrestashopCustomerRfm {
  return async function getCurrentPrestashopCustomerRfm(input) {
    const prestashopCustomerId = resolvePrestashopCustomerId(input.prestashopCustomerId);
    return deps.currentRfmSnapshotReader.getCurrentPrestashopCustomerRfm(prestashopCustomerId);
  };
}

function resolvePrestashopCustomerId(prestashopCustomerId: number): number {
  if (!Number.isSafeInteger(prestashopCustomerId) || prestashopCustomerId <= 0) {
    throw new Error(`Invalid PrestaShop customer id: ${String(prestashopCustomerId)}`);
  }
  return prestashopCustomerId;
}
