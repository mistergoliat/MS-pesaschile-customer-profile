import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ClusterSnapshotProfile } from '../../domain/customer-clustering/index.js';
import { mapClusterReadError } from './cluster-read-error.js';

export interface ClusterSnapshotProfileRepository {
  getProfiles(snapshotId: string): Promise<readonly ClusterSnapshotProfile[]>;
  // Idempotent (task Section 41): a row whose profile_checksum already matches is left
  // untouched (skip/reuse) rather than rewritten — INSERT ... ON DUPLICATE KEY UPDATE only
  // actually changes stored bytes when the checksum genuinely differs.
  upsertProfiles(profiles: readonly ClusterSnapshotProfile[]): Promise<{ readonly upserted: number; readonly skipped: number }>;
}

export function createMysqlClusterSnapshotProfileRepository(pool: Pool): ClusterSnapshotProfileRepository {
  return {
    getProfiles: (snapshotId) => queryProfiles(pool, snapshotId),

    async upsertProfiles(profiles) {
      if (profiles.length === 0) {
        return { upserted: 0, skipped: 0 };
      }
      try {
        const existing = await queryProfiles(pool, profiles[0]!.snapshotId);
        const existingByCluster = new Map(existing.map((profile) => [profile.clusterId, profile]));

        let upserted = 0;
        let skipped = 0;
        for (const profile of profiles) {
          if (existingByCluster.get(profile.clusterId)?.profileChecksum === profile.profileChecksum) {
            skipped += 1;
            continue;
          }
          await pool.execute(
            `
              INSERT INTO customer_cluster_snapshot_profile (
                snapshot_id, cluster_id, customer_count,
                feature_profile_json, commercial_profile_json, distance_profile_json,
                profile_checksum, generated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
                customer_count = VALUES(customer_count),
                feature_profile_json = VALUES(feature_profile_json),
                commercial_profile_json = VALUES(commercial_profile_json),
                distance_profile_json = VALUES(distance_profile_json),
                profile_checksum = VALUES(profile_checksum),
                generated_at = VALUES(generated_at)
            `,
            [
              profile.snapshotId,
              profile.clusterId,
              profile.customerCount,
              JSON.stringify(profile.featureProfile),
              JSON.stringify(profile.commercialProfile),
              JSON.stringify(profile.distanceProfile),
              profile.profileChecksum,
              toMysqlDateTime(profile.generatedAt),
            ],
          );
          upserted += 1;
        }
        return { upserted, skipped };
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },
  };
}

async function queryProfiles(pool: Pool, snapshotId: string): Promise<readonly ClusterSnapshotProfile[]> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `
        SELECT
          snapshot_id AS snapshotId,
          cluster_id AS clusterId,
          customer_count AS customerCount,
          feature_profile_json AS featureProfileJson,
          commercial_profile_json AS commercialProfileJson,
          distance_profile_json AS distanceProfileJson,
          profile_checksum AS profileChecksum,
          generated_at AS generatedAt
        FROM customer_cluster_snapshot_profile
        WHERE snapshot_id = ?
        ORDER BY cluster_id ASC
      `,
      [snapshotId],
    );
    return rows.map(toProfile);
  } catch (error) {
    throw mapClusterReadError(error);
  }
}

function toProfile(row: RowDataPacket): ClusterSnapshotProfile {
  return {
    snapshotId: String(row.snapshotId),
    clusterId: Number(row.clusterId),
    customerCount: Number(row.customerCount),
    featureProfile: parseJsonColumn(row.featureProfileJson),
    commercialProfile: parseJsonColumn(row.commercialProfileJson),
    distanceProfile: parseJsonColumn(row.distanceProfileJson),
    profileChecksum: String(row.profileChecksum),
    generatedAt: toIso(row.generatedAt),
  };
}

function parseJsonColumn<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
  throw new Error(`Invalid generated_at: ${String(value)}`);
}
