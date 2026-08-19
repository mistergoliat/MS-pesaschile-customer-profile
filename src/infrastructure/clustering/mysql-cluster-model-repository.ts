import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertValidClusterModelArtifact, type ClusterModelArtifact } from '../../domain/customer-clustering/index.js';
import { stableStringify } from '../../domain/customer-rfm/checksum.js';
import type { ClusterModelRepository, StoredClusterModel } from '../../application/customer-clustering/ports.js';
import { mapClusterReadError } from './cluster-read-error.js';

export function createMysqlClusterModelRepository(pool: Pool): ClusterModelRepository {
  return {
    async findByModelVersion(modelVersion) {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(
          `
            SELECT id, artifact_json, status
            FROM customer_cluster_model
            WHERE model_version = ?
            ORDER BY id DESC
            LIMIT 1
          `,
          [modelVersion],
        );
        const row = rows[0];
        if (!row) return null;
        return toStoredModel(row);
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },

    async insertModel(artifact: ClusterModelArtifact) {
      try {
        const [result] = await pool.execute<ResultSetHeader>(
          `
            INSERT INTO customer_cluster_model (
              model_version, algorithm, k, training_seed, feature_version, preprocessing_version,
              population_policy_version, operational_exclusion_policy_version, shop_scope,
              training_reference_time, training_population_size, training_dataset_checksum,
              artifact_json, artifact_checksum, hyperparameters_json, metrics_json,
              temporal_stability_status, status, trained_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
          `,
          [
            artifact.modelVersion,
            artifact.algorithm,
            artifact.k,
            artifact.trainingSeed,
            artifact.featureVersion,
            artifact.preprocessingVersion,
            artifact.populationPolicyVersion,
            artifact.operationalAccountExclusionPolicyVersion,
            artifact.shopScope,
            toMysqlDateTime(artifact.trainingReferenceTime),
            artifact.trainingPopulationSize,
            artifact.trainingDatasetChecksum,
            stableStringify(artifact),
            artifact.artifactChecksum,
            stableStringify({ algorithm: artifact.algorithm, k: artifact.k, trainingSeed: artifact.trainingSeed }),
            stableStringify(artifact.metrics),
            artifact.temporalStabilityStatus,
            toMysqlDateTime(artifact.trainedAt),
          ],
        );
        return { modelId: String(result.insertId) };
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          throw new Error(`Cluster model version already registered: ${artifact.modelVersion}`);
        }
        throw mapClusterReadError(error);
      }
    },
  };
}

function toStoredModel(row: RowDataPacket): StoredClusterModel {
  const rawArtifact = typeof row.artifact_json === 'string' ? JSON.parse(row.artifact_json) : row.artifact_json;
  const artifact = assertValidClusterModelArtifact(rawArtifact);
  const status = row.status;
  if (status !== 'building' && status !== 'validated' && status !== 'published' && status !== 'failed' && status !== 'superseded') {
    throw new Error(`Invalid customer_cluster_model.status: ${String(status)}`);
  }
  return { modelId: String(row.id), artifact, status };
}

function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY');
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
