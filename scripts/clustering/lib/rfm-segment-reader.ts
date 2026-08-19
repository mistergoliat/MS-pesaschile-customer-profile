import type { Pool, RowDataPacket } from 'mysql2/promise';

// Read-only lookup against Customer Profile's OWN local RFM snapshot store (RFM_SNAPSHOT_DB_*
// — not the PrestaShop RDS). This is Customer Profile's own persistence layer, so SELECT here
// is not subject to the PrestaShop-RDS-is-read-only constraint (Section 5) — this module still
// only ever SELECTs, never writes. Used exclusively for the post-hoc RFM cross-tab (Section 33)
// — rfmCode/segmentCode are never fed into feature extraction or model training.
export type RfmSegmentRow = {
  readonly customerId: number;
  readonly rfmCode: string;
  readonly segmentCode: string | null;
};

export type RfmSegmentSnapshotInfo = {
  readonly snapshotId: number;
  readonly referenceTime: string;
  readonly publishedAt: string;
  readonly populationSize: number;
} | null;

export type RfmSegmentReader = {
  readCurrentSnapshotInfo(): Promise<RfmSegmentSnapshotInfo>;
  readCurrentSegments(): Promise<readonly RfmSegmentRow[]>;
};

export function createRfmSegmentReader(pool: Pool): RfmSegmentReader {
  return {
    async readCurrentSnapshotInfo() {
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT id, reference_time, published_at, population_size
        FROM customer_rfm_snapshot
        WHERE status = 'published'
        ORDER BY published_at DESC, id DESC
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return null;
      return {
        snapshotId: Number(row.id),
        referenceTime: toIso(row.reference_time),
        publishedAt: toIso(row.published_at),
        populationSize: Number(row.population_size),
      };
    },

    async readCurrentSegments() {
      const info = await this.readCurrentSnapshotInfo();
      if (!info) return [];
      const [rows] = await pool.execute<RowDataPacket[]>(
        `
          SELECT prestashop_customer_id AS customerId, rfm_code AS rfmCode, segment_code AS segmentCode
          FROM customer_rfm_snapshot_row
          WHERE snapshot_id = ?
        `,
        [info.snapshotId],
      );
      return rows.map((row) => ({
        customerId: Number(row.customerId),
        rfmCode: String(row.rfmCode),
        segmentCode: row.segmentCode === null ? null : String(row.segmentCode),
      }));
    },
  };
}

function toIso(value: unknown): string {
  if (typeof value === 'string') {
    return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new Error(`Invalid datetime value: ${String(value)}`);
}
