import { describe, expect, it, vi } from 'vitest';
import { createMysqlRfmSnapshotRunRepository } from '../../src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.js';
import type { Pool, PoolConnection } from 'mysql2/promise';

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

describe('createMysqlRfmSnapshotRunRepository', () => {
  it('allows only one active execution lock across concurrent workers', async () => {
    const { pool } = fakePool();
    const repository = createMysqlRfmSnapshotRunRepository(pool);

    const firstLock = await repository.tryAcquireExecutionLock();
    const secondLock = await repository.tryAcquireExecutionLock();

    expect(firstLock).not.toBeNull();
    expect(secondLock).toBeNull();

    await firstLock?.release();

    const thirdLock = await repository.tryAcquireExecutionLock();
    expect(thirdLock).not.toBeNull();
    await thirdLock?.release();
  });

  it('persists skipped or started/succeeded run transitions without storing raw error messages', async () => {
    const { pool, execute } = fakePool();
    const repository = createMysqlRfmSnapshotRunRepository(pool);

    const runId = await repository.createRun({
      triggerSource: 'scheduled',
      status: 'started',
      referenceTime: '2026-08-14T00:00:00.000Z',
      calculationVersion: 'rfm-population-v1',
      segmentVersion: 'rfm-commercial-v1',
      snapshotKey: 'snapshot-key',
      skipReason: null,
      startedAt: '2026-08-14T15:45:12.000Z',
      completedAt: null,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      summary: null,
    });

    await repository.completeRun({
      runId,
      status: 'failed',
      completedAt: '2026-08-14T15:45:13.000Z',
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
});
