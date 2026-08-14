import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { stableStringify, type RfmCommercialSegmentCode } from '../../domain/customer-rfm/index.js';

const EXECUTION_LOCK_NAME = 'customer_rfm_snapshot_execution_v1';

export type RfmSnapshotRunTriggerSource = 'manual' | 'scheduled';

export type RfmSnapshotRunStatus = 'started' | 'succeeded' | 'failed' | 'skipped';

export type RfmSnapshotRunSummary = {
  readonly populationSize: number;
  readonly canonicalMatchedCount: number;
  readonly canonicalUnmatchedCount: number;
  readonly canonicalAmbiguousCount: number;
  readonly canonicalCoveragePct: string;
  readonly segmentCounts: Record<RfmCommercialSegmentCode, number>;
};

export type CreateRfmSnapshotRunInput = {
  readonly triggerSource: RfmSnapshotRunTriggerSource;
  readonly status: RfmSnapshotRunStatus;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly segmentVersion: string;
  readonly snapshotKey: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly snapshotId: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly skipReason: string | null;
  readonly summary: RfmSnapshotRunSummary | null;
};

export type CompleteRfmSnapshotRunInput = {
  readonly runId: string;
  readonly status: Exclude<RfmSnapshotRunStatus, 'started'>;
  readonly completedAt: string;
  readonly snapshotId: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly skipReason: string | null;
  readonly summary: RfmSnapshotRunSummary | null;
};

export type RfmSnapshotExecutionLock = {
  release(): Promise<void>;
};

export type RfmSnapshotRunRepository = {
  tryAcquireExecutionLock(): Promise<RfmSnapshotExecutionLock | null>;
  createRun(input: CreateRfmSnapshotRunInput): Promise<string>;
  completeRun(input: CompleteRfmSnapshotRunInput): Promise<void>;
};

export function createMysqlRfmSnapshotRunRepository(pool: Pool): RfmSnapshotRunRepository {
  return {
    async tryAcquireExecutionLock() {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS lockGranted', [
          EXECUTION_LOCK_NAME,
        ]);
        const granted = Number(rows[0]?.lockGranted ?? 0) === 1;
        if (!granted) {
          connection.release();
          return null;
        }
        return {
          async release() {
            try {
              await connection.query('DO RELEASE_LOCK(?)', [EXECUTION_LOCK_NAME]);
            } finally {
              connection.release();
            }
          },
        };
      } catch (error) {
        connection.release();
        throw error;
      }
    },

    async createRun(input) {
      const [result] = await pool.execute<ResultSetHeader>(
        `
          INSERT INTO customer_rfm_snapshot_run (
            trigger_source,
            status,
            reference_time,
            calculation_version,
            segment_version,
            snapshot_key,
            skip_reason,
            started_at,
            completed_at,
            snapshot_id,
            error_type,
            error_code,
            summary_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.triggerSource,
          input.status,
          toMysqlDateTime(input.referenceTime),
          input.calculationVersion,
          input.segmentVersion,
          input.snapshotKey,
          input.skipReason,
          toMysqlDateTime(input.startedAt),
          input.completedAt ? toMysqlDateTime(input.completedAt) : null,
          input.snapshotId,
          input.errorType,
          input.errorCode,
          input.summary ? stableStringify(input.summary) : null,
        ],
      );
      return String(result.insertId);
    },

    async completeRun(input) {
      await pool.execute(
        `
          UPDATE customer_rfm_snapshot_run
          SET
            status = ?,
            completed_at = ?,
            snapshot_id = ?,
            error_type = ?,
            error_code = ?,
            skip_reason = ?,
            summary_json = ?
          WHERE id = ?
            AND status = 'started'
        `,
        [
          input.status,
          toMysqlDateTime(input.completedAt),
          input.snapshotId,
          input.errorType,
          input.errorCode,
          input.skipReason,
          input.summary ? stableStringify(input.summary) : null,
          input.runId,
        ],
      );
    },
  };
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
