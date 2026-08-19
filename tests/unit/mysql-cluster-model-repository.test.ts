import { describe, expect, it, vi } from 'vitest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createMysqlClusterModelRepository } from '../../src/infrastructure/clustering/mysql-cluster-model-repository.js';
import { assertValidClusterModelArtifact } from '../../src/domain/customer-clustering/artifact.js';
import { stableStringify } from '../../src/domain/customer-rfm/checksum.js';
import {
  algorithm,
  artifactVersion,
  featureOrder,
  featureVersion,
  k,
  modelVersion,
  operationalAccountExclusionPolicyVersion,
  populationPolicyVersion,
  populationScope,
  preprocessingVersion,
  trainingSeed,
} from '../../src/domain/customer-clustering/model-version.js';

function buildArtifact() {
  const transforms = Object.fromEntries(featureOrder.map((feature) => [feature, { kind: 'clip01' as const }]));
  const centroids = Array.from({ length: k }, (_, id) => featureOrder.map(() => id));
  return assertValidClusterModelArtifact({
    artifactVersion,
    modelVersion,
    algorithm,
    k,
    trainingSeed,
    featureVersion,
    preprocessingVersion,
    populationPolicyVersion,
    operationalAccountExclusionPolicyVersion,
    shopScope: populationScope,
    featureOrder,
    transforms,
    centroids,
    trainingReferenceTime: '2026-08-19T00:00:00.000Z',
    trainingPopulationSize: 10145,
    trainingDatasetChecksum: 'a'.repeat(64),
    metrics: { silhouette: 0.2, daviesBouldin: 1.3, calinskiHarabasz: 2000, seedAriMean: 0.99, seedAriMin: 0.98, resampleAriMean: 0.98, resampleAriMin: 0.96 },
    temporalStabilityStatus: 'not_yet_validated',
    interpretationMapping: Array.from({ length: k }, (_, id) => ({ clusterId: id, label: `L${id}`, matchedReferenceLabel: `L${id}`, matchDistance: 0 })),
    trainedAt: '2026-08-19T00:00:05.000Z',
  });
}

describe('createMysqlClusterModelRepository', () => {
  it('inserts a new model row keyed by modelVersion', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO customer_cluster_model')) return [{ insertId: 3 }, []];
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const artifact = buildArtifact();
    const result = await createMysqlClusterModelRepository(pool).insertModel(artifact);
    expect(result.modelId).toBe('3');
  });

  it('maps a duplicate model_version insert to a clear error', async () => {
    const execute = vi.fn(async () => {
      throw { code: 'ER_DUP_ENTRY' };
    });
    const pool = { execute } as unknown as Pool;
    await expect(createMysqlClusterModelRepository(pool).insertModel(buildArtifact())).rejects.toThrow(/already registered/);
  });

  it('finds and re-validates a stored model by version', async () => {
    const artifact = buildArtifact();
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, artifact_json, status')) {
        return [[{ id: 3, artifact_json: stableStringify(artifact), status: 'published' } as unknown as RowDataPacket], []];
      }
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const found = await createMysqlClusterModelRepository(pool).findByModelVersion(artifact.modelVersion);
    expect(found?.modelId).toBe('3');
    expect(found?.artifact.modelVersion).toBe(artifact.modelVersion);
    expect(found?.status).toBe('published');
  });

  it('returns null when no model is registered for the version', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const found = await createMysqlClusterModelRepository(pool).findByModelVersion('nonexistent-v1');
    expect(found).toBeNull();
  });

  it('throws (fails closed) if the stored artifact_json has been corrupted', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, artifact_json, status')) {
        return [[{ id: 3, artifact_json: JSON.stringify({ not: 'a valid artifact' }), status: 'published' } as unknown as RowDataPacket], []];
      }
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    await expect(createMysqlClusterModelRepository(pool).findByModelVersion('behavioral-kmeans-k4-v1')).rejects.toThrow();
  });
});
