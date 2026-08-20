import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';

describe('createMysqlSnapshotHeaderReader', () => {
  it('getPublishedRfmSnapshotHeaders reads only published headers from customer_rfm_snapshot', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM customer_rfm_snapshot')) {
        expect(sql).toContain("status = 'published'");
        expect(sql).not.toContain('customer_rfm_snapshot_row');
        return [[{ id: 1, reference_time: new Date('2026-08-18T00:00:00.000Z'), calculation_version: 'rfm-population-v1' }], []];
      }
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const headers = await createMysqlSnapshotHeaderReader(pool).getPublishedRfmSnapshotHeaders();
    expect(headers).toEqual([{ snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-population-v1' }]);
  });

  it('getPublishedClusterSnapshotHeaders joins customer_cluster_model for modelVersion, reads only from headers', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM customer_cluster_snapshot')) {
        expect(sql).toContain("s.status = 'published'");
        expect(sql).toContain('customer_cluster_model');
        expect(sql).not.toContain('customer_cluster_snapshot_row');
        return [
          [{ id: 1, reference_time: new Date('2026-08-18T00:00:00.000Z'), model_id: 1, model_version: 'behavioral-kmeans-k4-v1' }],
          [],
        ];
      }
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const headers = await createMysqlSnapshotHeaderReader(pool).getPublishedClusterSnapshotHeaders();
    expect(headers).toEqual([{ snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '1', modelVersion: 'behavioral-kmeans-k4-v1' }]);
  });

  it('returns an empty array when nothing has been published', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const reader = createMysqlSnapshotHeaderReader(pool);
    expect(await reader.getPublishedRfmSnapshotHeaders()).toEqual([]);
    expect(await reader.getPublishedClusterSnapshotHeaders()).toEqual([]);
  });

  it('maps a connection failure to AnalyticsUnavailableError', async () => {
    const pool = {
      execute: vi.fn(async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      }),
    } as unknown as Pool;
    const reader = createMysqlSnapshotHeaderReader(pool);
    await expect(reader.getPublishedRfmSnapshotHeaders()).rejects.toThrow(AnalyticsUnavailableError);
    await expect(reader.getPublishedClusterSnapshotHeaders()).rejects.toThrow(AnalyticsUnavailableError);
  });
});
