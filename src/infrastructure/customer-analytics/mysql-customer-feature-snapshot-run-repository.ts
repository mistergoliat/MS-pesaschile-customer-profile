import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { stableStringify } from '../../domain/customer-rfm/checksum.js';

const EXECUTION_LOCK_NAME = 'customer_feature_snapshot_execution_v1';

// No 'scheduled' trigger source: T01 is CLI-only, no cron/scheduler (task Section 29/60).
export type CustomerFeatureSnapshotRunTriggerSource = 'manual';
export type CustomerFeatureSnapshotRunStatus = 'started' | 'succeeded' | 'failed' | 'skipped';

export type CustomerFeatureSnapshotRunSummary = {
  readonly populationSize: number;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
};

export type CreateCustomerFeatureSnapshotRunInput = {
  readonly triggerSource: CustomerFeatureSnapshotRunTriggerSource;
  readonly status: CustomerFeatureSnapshotRunStatus;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly snapshotKey: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly snapshotId: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly skipReason: string | null;
  readonly summary: CustomerFeatureSnapshotRunSummary | null;
};

export type CompleteCustomerFeatureSnapshotRunInput = {
  readonly runId: string;
  readonly status: Exclude<CustomerFeatureSnapshotRunStatus, 'started'>;
  readonly completedAt: string;
  readonly snapshotId: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly skipReason: string | null;
  readonly summary: CustomerFeatureSnapshotRunSummary | null;
};

export type CustomerFeatureSnapshotExecutionLock = {
  release(): Promise<void>;
};

export type CustomerFeatureSnapshotRunRepository = {
  tryAcquireExecutionLock(): Promise<CustomerFeatureSnapshotExecutionLock | null>;
  createRun(input: CreateCustomerFeatureSnapshotRunInput): Promise<string>;
  completeRun(input: CompleteCustomerFeatureSnapshotRunInput): Promise<void>;
};

// Mirrors src/infrastructure/clustering/mysql-cluster-snapshot-run-repository.ts exactly,
// including the GET_LOCK-based execution lock that prevents two concurrent manual snapshot
// runs from racing.
export function createMysqlCustomerFeatureSnapshotRunRepository(pool: Pool): CustomerFeatureSnapshotRunRepository {
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
          INSERT INTO customer_feature_snapshot_run (
            trigger_source, status, reference_time, feature_version, snapshot_key, skip_reason,
            started_at, completed_at, snapshot_id, error_type, error_code, summary_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.triggerSource,
          input.status,
          toMysqlDateTime(input.referenceTime),
          input.featureVersion,
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
          UPDATE customer_feature_snapshot_run
          SET status = ?, completed_at = ?, snapshot_id = ?, error_type = ?, error_code = ?, skip_reason = ?, summary_json = ?
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
