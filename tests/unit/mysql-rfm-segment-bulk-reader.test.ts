import { describe, expect, it, vi } from 'vitest';
import { createMysqlRfmSegmentBulkReader } from '../../src/infrastructure/rfm/mysql-rfm-segment-bulk-reader.js';
import { RfmUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

describe('createMysqlRfmSegmentBulkReader', () => {
  it('returns null when no RFM snapshot has ever been published', async () => {
    const executor: QueryExecutor = { execute: vi.fn(async () => []) };
    const reader = createMysqlRfmSegmentBulkReader(executor);
    expect(await reader.getLatestPublishedSnapshotSegments()).toBeNull();
  });

  it('returns the snapshot metadata and rows, preserving a null segment_code', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ snapshotId: 9, referenceTime: '2026-08-18 00:00:00' }])
      .mockResolvedValueOnce([
        { prestashopCustomerId: 1, segmentCode: 'CHAMPION' },
        { prestashopCustomerId: 2, segmentCode: null },
      ]);
    const executor: QueryExecutor = { execute };
    const reader = createMysqlRfmSegmentBulkReader(executor);
    const result = await reader.getLatestPublishedSnapshotSegments();
    expect(result!.snapshot).toEqual({ snapshotId: '9', referenceTime: new Date('2026-08-18T00:00:00.000Z') });
    expect(result!.rows).toEqual([
      { prestashopCustomerId: 1, segmentCode: 'CHAMPION' },
      { prestashopCustomerId: 2, segmentCode: null },
    ]);
  });

  it('maps a connection failure to RfmUnavailableError', async () => {
    const executor: QueryExecutor = {
      execute: vi.fn(async () => {
        throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
      }),
    };
    const reader = createMysqlRfmSegmentBulkReader(executor);
    await expect(reader.getLatestPublishedSnapshotSegments()).rejects.toBeInstanceOf(RfmUnavailableError);
  });
});
