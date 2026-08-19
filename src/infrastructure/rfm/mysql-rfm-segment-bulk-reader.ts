import type { QueryExecutor } from '../shared/query-executor.js';
import { mapRfmReadError } from './rfm-read-error.js';

export type RfmSegmentBulkRow = {
  readonly prestashopCustomerId: number;
  // null for historical rows predating migration 003 (task Section 25: never hidden, exposed
  // as-is so a cross-tab consumer can see coverage gaps explicitly).
  readonly segmentCode: string | null;
};

export type RfmSegmentBulkSnapshot = {
  readonly snapshotId: string;
  readonly referenceTime: Date;
};

// Bulk, cross-tab-only read path (task Section 23) — deliberately separate from
// mysql-rfm-snapshot-reader.ts's single-customer lookup methods, which are the tested,
// already-shipped serving path for GET /v1/customers/:customerId/rfm and must not be touched.
export interface RfmSegmentBulkReader {
  getLatestPublishedSnapshotSegments(): Promise<{
    readonly snapshot: RfmSegmentBulkSnapshot;
    readonly rows: readonly RfmSegmentBulkRow[];
  } | null>;
}

export function createMysqlRfmSegmentBulkReader(executor: QueryExecutor): RfmSegmentBulkReader {
  return {
    async getLatestPublishedSnapshotSegments() {
      try {
        const snapshotRows = await executor.execute(
          `
            SELECT id AS snapshotId, reference_time AS referenceTime
            FROM customer_rfm_snapshot
            WHERE status = 'published'
            ORDER BY published_at DESC, id DESC
            LIMIT 1
          `,
          [],
        );
        const snapshotRow = snapshotRows[0];
        if (!snapshotRow) {
          return null;
        }
        const snapshot: RfmSegmentBulkSnapshot = {
          snapshotId: String(snapshotRow.snapshotId),
          referenceTime: toDate(snapshotRow.referenceTime),
        };

        const segmentRows = await executor.execute(
          `SELECT prestashop_customer_id AS prestashopCustomerId, segment_code AS segmentCode FROM customer_rfm_snapshot_row WHERE snapshot_id = ?`,
          [snapshot.snapshotId],
        );
        return {
          snapshot,
          rows: segmentRows.map((row) => ({
            prestashopCustomerId: Number(row.prestashopCustomerId),
            segmentCode: row.segmentCode === null ? null : String(row.segmentCode),
          })),
        };
      } catch (error) {
        throw mapRfmReadError(error);
      }
    },
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid reference_time');
    return value;
  }
  if (typeof value !== 'string') throw new Error('Invalid reference_time');
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid reference_time');
  return parsed;
}
