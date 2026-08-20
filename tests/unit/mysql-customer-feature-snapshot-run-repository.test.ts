import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { createMysqlCustomerFeatureSnapshotRunRepository } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-run-repository.js';

function fakePool() {
  let lockHeld = false;
  const execute = vi.fn(async () => [{ insertId: 501 }, []]);
  const connections: PoolConnection[] = [];

  const pool = {
    getConnection: vi.fn(async () => {
      const connection = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('GET_LOCK')) {
            if (lockHeld) {
              return [[{ lockGranted: 0 }], []];
            }
            lockHeld = true;
            return [[{ lockGranted: 1 }], []];
          }
          if (sql.includes('RELEASE_LOCK')) {
            lockHeld = false;
            return [[], []];
          }
          return [[], []];
        }),
        release: vi.fn(),
      } as unknown as PoolConnection;
      connections.push(connection);
      return connection;
    }),
    execute,
  } as unknown as Pool;

  return { pool, execute, connections };
}

describe('createMysqlCustomerFeatureSnapshotRunRepository', () => {
  it('allows only one active execution lock across concurrent workers (task Section 26 concurrency safety)', async () => {
    const { pool } = fakePool();
    const repository = createMysqlCustomerFeatureSnapshotRunRepository(pool);

    const firstLock = await repository.tryAcquireExecutionLock();
    const secondLock = await repository.tryAcquireExecutionLock();

    expect(firstLock).not.toBeNull();
    expect(secondLock).toBeNull();

    await firstLock?.release();

    const thirdLock = await repository.tryAcquireExecutionLock();
    expect(thirdLock).not.toBeNull();
    await thirdLock?.release();
  });

  it('persists started/failed run transitions without storing raw connection secrets', async () => {
    const { pool, execute } = fakePool();
    const repository = createMysqlCustomerFeatureSnapshotRunRepository(pool);

    const runId = await repository.createRun({
      triggerSource: 'manual',
      status: 'started',
      referenceTime: '2026-08-19T00:00:00.000Z',
      featureVersion: 'customer-analytics-features-v1',
      snapshotKey: 'snapshot-key',
      skipReason: null,
      startedAt: '2026-08-19T15:45:12.000Z',
      completedAt: null,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      summary: null,
    });

    await repository.completeRun({
      runId,
      status: 'failed',
      completedAt: '2026-08-19T15:45:13.000Z',
      snapshotId: null,
      errorType: 'Error',
      errorCode: 'ECONNREFUSED',
      skipReason: null,
      summary: null,
    });

    expect(runId).toBe('501');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(execute.mock.calls)).not.toContain('secret-host');
  });

  it('serializes a non-null summary as stable JSON', async () => {
    const { pool, execute } = fakePool();
    const repository = createMysqlCustomerFeatureSnapshotRunRepository(pool);

    await repository.createRun({
      triggerSource: 'manual',
      status: 'succeeded',
      referenceTime: '2026-08-19T00:00:00.000Z',
      featureVersion: 'customer-analytics-features-v1',
      snapshotKey: 'snapshot-key',
      skipReason: null,
      startedAt: '2026-08-19T15:45:12.000Z',
      completedAt: '2026-08-19T15:45:13.000Z',
      snapshotId: '9',
      errorType: null,
      errorCode: null,
      summary: { populationSize: 44935, sourceDatasetChecksum: 'a'.repeat(64), featureDatasetChecksum: 'b'.repeat(64) },
    });

    const call = execute.mock.calls[0] as unknown as [string, unknown[]];
    const params = call[1];
    const summaryJson = params[params.length - 1] as string;
    expect(JSON.parse(summaryJson)).toEqual({ populationSize: 44935, sourceDatasetChecksum: 'a'.repeat(64), featureDatasetChecksum: 'b'.repeat(64) });
  });
});
