import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { ClusterModelMetrics, TemporalStabilityStatus } from '../../domain/customer-clustering/index.js';
import { mapClusterReadError } from './cluster-read-error.js';

export type ClusterAnalyticsSnapshotMeta = {
  readonly snapshotId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly algorithm: string;
  readonly k: number;
  readonly featureVersion: string;
  readonly preprocessingVersion: string;
  readonly temporalStabilityStatus: TemporalStabilityStatus;
  readonly metrics: ClusterModelMetrics;
  readonly status: 'published' | 'superseded';
  readonly referenceTime: Date;
  readonly publishedAt: Date;
  readonly populationSize: number;
};

export type ClusterAnalyticsInterpretation = {
  readonly label: string;
  readonly description: string;
  readonly interpretationVersion: string;
};

export type ClusterAnalyticsSnapshotRow = {
  readonly prestashopCustomerId: number;
  readonly clusterId: number;
  readonly distanceToCentroid: number;
};

// Read-only assembly of the analytics-facing snapshot/model provenance (task Section 17/28) —
// never used by the model-training or snapshot-publication pipeline. Deliberately separate from
// mysql-cluster-snapshot-reader.ts (the single-customer serving path), same precedent as
// clustering keeping its population reader independent from the experimental one.
export interface ClusterAnalyticsReader {
  getLatestPublishedSnapshot(): Promise<ClusterAnalyticsSnapshotMeta | null>;
  // Historical reproducibility (task Section 20): a snapshot that was once published and later
  // superseded is still viewable by id. building/validated/failed are never exposed here.
  getPublishedSnapshotById(snapshotId: string): Promise<ClusterAnalyticsSnapshotMeta | null>;
  getClusterSizeDistribution(snapshotId: string): Promise<ReadonlyMap<number, number>>;
  getInterpretations(modelId: string): Promise<ReadonlyMap<number, ClusterAnalyticsInterpretation>>;
  listSnapshotRows(snapshotId: string): Promise<readonly ClusterAnalyticsSnapshotRow[]>;
}

const BASE_SNAPSHOT_SELECT = `
  SELECT
    s.id AS snapshotId,
    s.model_id AS modelId,
    m.model_version AS modelVersion,
    m.algorithm AS algorithm,
    m.k AS k,
    m.feature_version AS featureVersion,
    m.preprocessing_version AS preprocessingVersion,
    m.temporal_stability_status AS temporalStabilityStatus,
    m.metrics_json AS metricsJson,
    s.status AS status,
    s.reference_time AS referenceTime,
    s.published_at AS publishedAt,
    s.population_size AS populationSize
  FROM customer_cluster_snapshot s
  INNER JOIN customer_cluster_model m ON m.id = s.model_id
`;

export function createMysqlClusterAnalyticsReader(pool: Pool): ClusterAnalyticsReader {
  return {
    async getLatestPublishedSnapshot() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `${BASE_SNAPSHOT_SELECT} WHERE s.status = 'published' ORDER BY s.published_at DESC, s.id DESC LIMIT 1`,
          [],
        );
        return rows[0] ? toSnapshotMeta(rows[0]) : null;
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },

    async getPublishedSnapshotById(snapshotId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`${BASE_SNAPSHOT_SELECT} WHERE s.id = ? LIMIT 1`, [snapshotId]);
        const row = rows[0];
        if (!row || (row.status !== 'published' && row.status !== 'superseded')) {
          return null;
        }
        return toSnapshotMeta(row);
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },

    async getClusterSizeDistribution(snapshotId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT cluster_id AS clusterId, COUNT(*) AS customerCount
            FROM customer_cluster_snapshot_row
            WHERE snapshot_id = ?
            GROUP BY cluster_id
            ORDER BY cluster_id ASC
          `,
          [snapshotId],
        );
        return new Map(rows.map((row) => [Number(row.clusterId), Number(row.customerCount)]));
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },

    async getInterpretations(modelId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT id, cluster_id AS clusterId, label, description, interpretation_version AS interpretationVersion
            FROM customer_cluster_interpretation
            WHERE model_id = ?
            ORDER BY id ASC
          `,
          [modelId],
        );
        // Last write wins per clusterId (rows are ORDER BY id ASC, so a later Map.set overwrites
        // an earlier interpretation_version) — mirrors the single-customer reader's own
        // "ORDER BY id DESC LIMIT 1" latest-wins semantics (task Section 19).
        const byCluster = new Map<number, ClusterAnalyticsInterpretation>();
        for (const row of rows) {
          byCluster.set(Number(row.clusterId), {
            label: String(row.label),
            description: String(row.description),
            interpretationVersion: String(row.interpretationVersion),
          });
        }
        return byCluster;
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },

    async listSnapshotRows(snapshotId) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT prestashop_customer_id AS prestashopCustomerId, cluster_id AS clusterId, distance_to_centroid AS distanceToCentroid
            FROM customer_cluster_snapshot_row
            WHERE snapshot_id = ?
          `,
          [snapshotId],
        );
        return rows.map((row) => ({
          prestashopCustomerId: Number(row.prestashopCustomerId),
          clusterId: Number(row.clusterId),
          distanceToCentroid: Number(row.distanceToCentroid),
        }));
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },
  };
}

function toSnapshotMeta(row: RowDataPacket): ClusterAnalyticsSnapshotMeta {
  const temporalStabilityStatus = row.temporalStabilityStatus;
  if (temporalStabilityStatus !== 'not_yet_validated' && temporalStabilityStatus !== 'preliminary' && temporalStabilityStatus !== 'validated') {
    throw new Error(`Invalid temporal_stability_status: ${String(temporalStabilityStatus)}`);
  }
  return {
    snapshotId: String(row.snapshotId),
    modelId: String(row.modelId),
    modelVersion: String(row.modelVersion),
    algorithm: String(row.algorithm),
    k: Number(row.k),
    featureVersion: String(row.featureVersion),
    preprocessingVersion: String(row.preprocessingVersion),
    temporalStabilityStatus,
    metrics: typeof row.metricsJson === 'string' ? JSON.parse(row.metricsJson) : row.metricsJson,
    status: row.status === 'superseded' ? 'superseded' : 'published',
    referenceTime: toDate(row.referenceTime, 'referenceTime'),
    publishedAt: toDate(row.publishedAt, 'publishedAt'),
    populationSize: Number(row.populationSize),
  };
}

function toDate(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${field}`);
    return value;
  }
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}
