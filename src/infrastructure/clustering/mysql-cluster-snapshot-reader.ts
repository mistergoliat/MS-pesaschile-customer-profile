import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { CurrentClusterCustomerLookup, CurrentClusterSnapshotMetadata } from '../../domain/customer-clustering/index.js';
import type { CurrentClusterSnapshotReader } from '../../application/customer-clustering/ports.js';
import { mapClusterReadError } from './cluster-read-error.js';

const SELECT_CURRENT_SNAPSHOT_SQL = `
  SELECT
    s.id AS snapshotId,
    s.model_id AS modelId,
    m.model_version AS modelVersion,
    m.algorithm AS algorithm,
    m.k AS k,
    m.feature_version AS featureVersion,
    m.preprocessing_version AS preprocessingVersion,
    s.reference_time AS referenceTime,
    s.published_at AS publishedAt,
    s.population_size AS populationSize
  FROM customer_cluster_snapshot s
  INNER JOIN customer_cluster_model m ON m.id = s.model_id
  WHERE s.status = 'published'
  ORDER BY s.published_at DESC, s.id DESC
  LIMIT 1
`;

const SELECT_CUSTOMER_ROW_SQL = `
  SELECT cluster_id AS clusterId, distance_to_centroid AS distanceToCentroid
  FROM customer_cluster_snapshot_row
  WHERE snapshot_id = ?
    AND prestashop_customer_id = ?
  LIMIT 1
`;

const SELECT_INTERPRETATION_SQL = `
  SELECT label, description, interpretation_version AS interpretationVersion
  FROM customer_cluster_interpretation
  WHERE model_id = ?
    AND cluster_id = ?
  ORDER BY id DESC
  LIMIT 1
`;

export function createMysqlClusterSnapshotReader(pool: Pool): CurrentClusterSnapshotReader {
  return {
    async getCurrentCustomerClusterLookup(prestashopCustomerId) {
      try {
        const snapshot = await getCurrentSnapshot(pool);
        if (snapshot === null) {
          return { snapshot: null, record: null } satisfies CurrentClusterCustomerLookup;
        }

        const [rows] = await pool.execute<RowDataPacket[]>(SELECT_CUSTOMER_ROW_SQL, [snapshot.snapshotId, prestashopCustomerId]);
        const row = rows[0];
        if (!row) {
          return { snapshot, record: null } satisfies CurrentClusterCustomerLookup;
        }

        const clusterId = coerceNonNegativeInt(row.clusterId, 'clusterId');
        const [interpretationRows] = await pool.execute<RowDataPacket[]>(SELECT_INTERPRETATION_SQL, [
          snapshot.modelId,
          clusterId,
        ]);
        const interpretation = interpretationRows[0];

        return {
          snapshot,
          record: {
            prestashopCustomerId,
            clusterId,
            distanceToCentroid: Number(row.distanceToCentroid),
            interpretationLabel: interpretation ? String(interpretation.label) : null,
            interpretationDescription: interpretation ? String(interpretation.description) : null,
            interpretationVersion: interpretation ? String(interpretation.interpretationVersion) : null,
            snapshot,
          },
        } satisfies CurrentClusterCustomerLookup;
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },
  };
}

async function getCurrentSnapshot(pool: Pool): Promise<CurrentClusterSnapshotMetadata | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(SELECT_CURRENT_SNAPSHOT_SQL, []);
  const row = rows[0];
  if (!row) return null;
  return {
    snapshotId: String(row.snapshotId),
    modelId: String(row.modelId),
    modelVersion: String(row.modelVersion),
    algorithm: String(row.algorithm),
    k: coerceNonNegativeInt(row.k, 'k'),
    featureVersion: String(row.featureVersion),
    preprocessingVersion: String(row.preprocessingVersion),
    referenceTime: parseRequiredUtcDateTime(row.referenceTime, 'referenceTime'),
    publishedAt: parseRequiredUtcDateTime(row.publishedAt, 'publishedAt'),
    populationSize: coerceNonNegativeInt(row.populationSize, 'populationSize'),
  };
}

function coerceNonNegativeInt(value: unknown, field: string): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function parseRequiredUtcDateTime(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${field}`);
    return value;
  }
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}
