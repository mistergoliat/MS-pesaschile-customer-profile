import { CLUSTER_ANALYTICS_CONTRACT_VERSION, type GetRfmClusterCrossTabResult } from '../../domain/customer-clustering/index.js';
import {
  ClusterSchemaIncompatibleError,
  ClusterTimeoutError,
  ClusterUnavailableError,
  RfmSchemaIncompatibleError,
  RfmTimeoutError,
  RfmUnavailableError,
} from '../customer-profile/errors.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { RfmSegmentBulkReader } from '../../infrastructure/rfm/mysql-rfm-segment-bulk-reader.js';

const UNSEGMENTED = 'UNSEGMENTED';

export type GetRfmClusterCrossTabInput = {
  // null => latest published cluster snapshot. The RFM side always uses its own latest
  // published snapshot regardless (task Section 24, option B: "latest published RFM snapshot
  // independientemente") — simpler and never hides a mismatch, since both referenceTimes are
  // always returned explicitly in the response for the caller to judge comparability.
  readonly snapshotId: string | null;
};

export type GetRfmClusterCrossTab = (input: GetRfmClusterCrossTabInput) => Promise<GetRfmClusterCrossTabResult>;

// Join key is prestashop_customer_id only (task Section 44) — never master_customer, no CRM
// dependency. Both snapshot sources are read locally (task Section 5/39) — no PrestaShop RDS
// access, no recomputation. Missing RFM never degrades cluster analytics as a whole (task
// Section 45) — only this cross-tab endpoint reports no_compatible_rfm_snapshot.
export function createGetRfmClusterCrossTab(deps: {
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
  readonly rfmSegmentBulkReader: RfmSegmentBulkReader;
}): GetRfmClusterCrossTab {
  return async function getRfmClusterCrossTab(input) {
    let clusterMeta;
    try {
      clusterMeta =
        input.snapshotId === null
          ? await deps.clusterAnalyticsReader.getLatestPublishedSnapshot()
          : await deps.clusterAnalyticsReader.getPublishedSnapshotById(input.snapshotId);
    } catch (error) {
      if (isClusterUnavailable(error)) return degraded('cluster_analytics_unavailable');
      throw error;
    }

    if (!clusterMeta) {
      if (input.snapshotId === null) {
        return { status: 'no_published_cluster_snapshot', contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION };
      }
      return {
        status: 'cluster_snapshot_not_found',
        snapshotId: input.snapshotId,
        contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
      };
    }

    const clusterSnapshotRef = { snapshotId: clusterMeta.snapshotId, referenceTime: clusterMeta.referenceTime.toISOString() };

    let clusterRows;
    try {
      clusterRows = await deps.clusterAnalyticsReader.listSnapshotRows(clusterMeta.snapshotId);
    } catch (error) {
      if (isClusterUnavailable(error)) return degraded('cluster_analytics_unavailable');
      throw error;
    }

    let rfmData;
    try {
      rfmData = await deps.rfmSegmentBulkReader.getLatestPublishedSnapshotSegments();
    } catch (error) {
      if (isRfmUnavailable(error)) return degraded('rfm_unavailable');
      throw error;
    }

    if (!rfmData) {
      return { status: 'no_compatible_rfm_snapshot', clusterSnapshot: clusterSnapshotRef, contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION };
    }

    const segmentByCustomer = new Map(rfmData.rows.map((row) => [row.prestashopCustomerId, row.segmentCode]));
    const clusterPopulation = clusterRows.length;
    const cellCounts = new Map<string, number>();
    const clusterTotals = new Map<number, number>();
    const segmentTotals = new Map<string, number>();
    let comparablePopulation = 0;

    for (const row of clusterRows) {
      const segmentCode = segmentByCustomer.get(row.prestashopCustomerId);
      if (segmentCode === undefined) continue; // not present in the RFM snapshot at all
      comparablePopulation += 1;
      const rfmSegment = segmentCode ?? UNSEGMENTED;
      const cellKey = `${row.clusterId}|${rfmSegment}`;
      cellCounts.set(cellKey, (cellCounts.get(cellKey) ?? 0) + 1);
      clusterTotals.set(row.clusterId, (clusterTotals.get(row.clusterId) ?? 0) + 1);
      segmentTotals.set(rfmSegment, (segmentTotals.get(rfmSegment) ?? 0) + 1);
    }

    const rows = [...cellCounts.entries()]
      .map(([cellKey, customerCount]) => {
        const separatorIndex = cellKey.indexOf('|');
        const clusterId = Number(cellKey.slice(0, separatorIndex));
        const rfmSegment = cellKey.slice(separatorIndex + 1);
        const clusterTotal = clusterTotals.get(clusterId) ?? 0;
        const segmentTotal = segmentTotals.get(rfmSegment) ?? 0;
        return {
          clusterId,
          rfmSegment,
          customerCount,
          pctWithinCluster: clusterTotal > 0 ? round2((customerCount / clusterTotal) * 100) : 0,
          pctWithinRfmSegment: segmentTotal > 0 ? round2((customerCount / segmentTotal) * 100) : 0,
        };
      })
      .sort((a, b) => a.clusterId - b.clusterId || a.rfmSegment.localeCompare(b.rfmSegment));

    return {
      status: 'available',
      contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
      clusterSnapshot: clusterSnapshotRef,
      rfmSnapshot: { snapshotId: rfmData.snapshot.snapshotId, referenceTime: rfmData.snapshot.referenceTime.toISOString() },
      coverage: {
        clusterPopulation,
        comparablePopulation,
        unmatchedPopulation: clusterPopulation - comparablePopulation,
        coveragePct: clusterPopulation > 0 ? round2((comparablePopulation / clusterPopulation) * 100) : 0,
      },
      rows,
    };
  };
}

function degraded(reason: 'cluster_analytics_unavailable' | 'rfm_unavailable'): GetRfmClusterCrossTabResult {
  return { status: 'degraded', reason, contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION };
}

function isClusterUnavailable(error: unknown): boolean {
  return error instanceof ClusterUnavailableError || error instanceof ClusterTimeoutError || error instanceof ClusterSchemaIncompatibleError;
}

function isRfmUnavailable(error: unknown): boolean {
  return error instanceof RfmUnavailableError || error instanceof RfmTimeoutError || error instanceof RfmSchemaIncompatibleError;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
