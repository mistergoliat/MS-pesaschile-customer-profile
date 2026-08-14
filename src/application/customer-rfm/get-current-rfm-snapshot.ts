import type { CurrentRfmSnapshotMetadata } from '../../domain/customer-rfm/index.js';
import type { CurrentRfmSnapshotReader } from './ports.js';

export type GetCurrentRfmSnapshot = () => Promise<CurrentRfmSnapshotMetadata | null>;

export function createGetCurrentRfmSnapshot(deps: {
  readonly currentRfmSnapshotReader: CurrentRfmSnapshotReader;
}): GetCurrentRfmSnapshot {
  return async function getCurrentRfmSnapshot() {
    return deps.currentRfmSnapshotReader.getCurrentSnapshot();
  };
}
