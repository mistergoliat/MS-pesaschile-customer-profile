import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlClusterSnapshotProfileRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import type { ClusterSnapshotProfile } from '../../src/domain/customer-clustering/index.js';

function profileFixture(clusterId: number, checksum: string): ClusterSnapshotProfile {
  return {
    snapshotId: '1',
    clusterId,
    customerCount: 5,
    featureProfile: {} as ClusterSnapshotProfile['featureProfile'],
    commercialProfile: {} as ClusterSnapshotProfile['commercialProfile'],
    distanceProfile: { medianDistance: 0.5, p95Distance: 0.9, maxDistance: 1.2 },
    profileChecksum: checksum,
    generatedAt: '2026-08-19T00:00:00.000Z',
  };
}

describe('createMysqlClusterSnapshotProfileRepository', () => {
  it('getProfiles parses JSON columns back into typed profiles', async () => {
    const execute = vi.fn(async () => [
      [
        {
          snapshotId: 1,
          clusterId: 0,
          customerCount: 5,
          featureProfileJson: JSON.stringify({ distinctProducts: { mean: 1, median: 1, p25: 1, p75: 1 } }),
          commercialProfileJson: JSON.stringify({}),
          distanceProfileJson: JSON.stringify({ medianDistance: 0.5, p95Distance: 0.9, maxDistance: 1.2 }),
          profileChecksum: 'abc',
          generatedAt: '2026-08-19 00:00:00',
        },
      ],
      [],
    ]);
    const pool = { execute } as unknown as Pool;
    const repository = createMysqlClusterSnapshotProfileRepository(pool);
    const profiles = await repository.getProfiles('1');
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.featureProfile).toEqual({ distinctProducts: { mean: 1, median: 1, p25: 1, p75: 1 } });
    expect(profiles[0]!.profileChecksum).toBe('abc');
  });

  it('upsertProfiles skips a cluster whose stored checksum already matches (idempotent)', async () => {
    let selectCalls = 0;
    const execute = vi.fn(async (sql: string) => {
      if (sql.trim().startsWith('SELECT')) {
        selectCalls += 1;
        return [
          [
            {
              snapshotId: 1,
              clusterId: 0,
              customerCount: 5,
              featureProfileJson: '{}',
              commercialProfileJson: '{}',
              distanceProfileJson: '{}',
              profileChecksum: 'same-checksum',
              generatedAt: '2026-08-19 00:00:00',
            },
          ],
          [],
        ];
      }
      return [{ affectedRows: 1 }, []];
    });
    const pool = { execute } as unknown as Pool;
    const repository = createMysqlClusterSnapshotProfileRepository(pool);
    const result = await repository.upsertProfiles([profileFixture(0, 'same-checksum')]);
    expect(result).toEqual({ upserted: 0, skipped: 1 });
    expect(selectCalls).toBe(1);
    // Only the SELECT ran — no INSERT for the unchanged cluster.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('upsertProfiles writes a cluster whose checksum differs from what is stored', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.trim().startsWith('SELECT')) {
        return [
          [
            {
              snapshotId: 1,
              clusterId: 0,
              customerCount: 5,
              featureProfileJson: '{}',
              commercialProfileJson: '{}',
              distanceProfileJson: '{}',
              profileChecksum: 'old-checksum',
              generatedAt: '2026-08-19 00:00:00',
            },
          ],
          [],
        ];
      }
      return [{ affectedRows: 2 }, []];
    });
    const pool = { execute } as unknown as Pool;
    const repository = createMysqlClusterSnapshotProfileRepository(pool);
    const result = await repository.upsertProfiles([profileFixture(0, 'new-checksum')]);
    expect(result).toEqual({ upserted: 1, skipped: 0 });
  });

  it('returns immediately for an empty profile list without querying the DB', async () => {
    const execute = vi.fn();
    const pool = { execute } as unknown as Pool;
    const repository = createMysqlClusterSnapshotProfileRepository(pool);
    const result = await repository.upsertProfiles([]);
    expect(result).toEqual({ upserted: 0, skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});
