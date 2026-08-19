import type { Pool } from 'mysql2/promise';
import type { ClusterInterpretationRepository } from '../../application/customer-clustering/ports.js';
import { mapClusterReadError } from './cluster-read-error.js';

// UNIQUE (model_id, cluster_id, interpretation_version) lets a label/description be corrected
// (new interpretation_version) without retraining (task Section 19) — INSERT ... ON DUPLICATE
// KEY UPDATE keeps re-registering the same version idempotent.
export function createMysqlClusterInterpretationRepository(pool: Pool): ClusterInterpretationRepository {
  return {
    async upsertInterpretations(modelId, interpretationVersion, entries) {
      try {
        for (const entry of entries) {
          await pool.execute(
            `
              INSERT INTO customer_cluster_interpretation (model_id, cluster_id, interpretation_version, label, description)
              VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description)
            `,
            [modelId, entry.clusterId, interpretationVersion, entry.label, entry.description],
          );
        }
      } catch (error) {
        throw mapClusterReadError(error);
      }
    },
  };
}
