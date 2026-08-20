import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ClusterSnapshotHeader, RfmSnapshotHeader, SnapshotHeaderReader } from '../../application/customer-intelligence/ports.js';
// Reuses CP-R3-T01's ANALYTICS_DB_* error mapper directly (task Section 27: no second
// definition) — Customer Intelligence reads through the same pool/credential family.
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

// New, header-only queries (see ports.ts's own header comment for why these don't belong in
// RFM's or clustering's existing readers) — reads customer_rfm_snapshot/
// customer_cluster_snapshot only, never the *_row tables. The number of ever-published
// snapshots is small (single/low-double digits over the capability's lifetime so far), so
// fetching every published header and selecting in application code (task Section 44's
// selectLatestSnapshotAtOrBefore) is simple and cheap — no need to push the temporal filter
// into SQL.
const SELECT_PUBLISHED_RFM_HEADERS_SQL = `
  SELECT id, reference_time, calculation_version
  FROM customer_rfm_snapshot
  WHERE status = 'published'
  ORDER BY reference_time DESC, id DESC
`;

const SELECT_PUBLISHED_CLUSTER_HEADERS_SQL = `
  SELECT s.id, s.reference_time, s.model_id, m.model_version
  FROM customer_cluster_snapshot s
  INNER JOIN customer_cluster_model m ON m.id = s.model_id
  WHERE s.status = 'published'
  ORDER BY s.reference_time DESC, s.id DESC
`;

export function createMysqlSnapshotHeaderReader(pool: Pool): SnapshotHeaderReader {
  return {
    async getPublishedRfmSnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_PUBLISHED_RFM_HEADERS_SQL, []);
        return rows.map(toRfmHeader);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },

    async getPublishedClusterSnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_PUBLISHED_CLUSTER_HEADERS_SQL, []);
        return rows.map(toClusterHeader);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}

function toRfmHeader(row: RowDataPacket): RfmSnapshotHeader {
  return {
    snapshotId: String(row.id),
    referenceTime: toIso(row.reference_time),
    calculationVersion: String(row.calculation_version),
  };
}

function toClusterHeader(row: RowDataPacket): ClusterSnapshotHeader {
  return {
    snapshotId: String(row.id),
    referenceTime: toIso(row.reference_time),
    modelId: String(row.model_id),
    modelVersion: String(row.model_version),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid reference_time');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new Error('Invalid reference_time');
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid reference_time');
  return parsed.toISOString();
}
