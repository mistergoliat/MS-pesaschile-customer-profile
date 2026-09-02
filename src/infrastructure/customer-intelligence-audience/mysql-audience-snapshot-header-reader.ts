import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AudienceSnapshotHeaderReader, AudienceRfmSnapshotHeader, AudienceClusterSnapshotHeader, AudienceClvSnapshotHeader, AudienceAffinitySnapshotHeader } from '../../application/customer-intelligence-audience/ports.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

// Header-only reads. Selection is deliberately performed by the neutral application resolver
// so every component is anchored to the feature reference time, including CLV and affinity.
export function createMysqlAudienceSnapshotHeaderReader(pool: Pool): AudienceSnapshotHeaderReader {
  return {
    async getPublishedRfmSnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`SELECT s.id, s.reference_time AS referenceTime, s.calculation_version AS calculationVersion, s.dataset_checksum AS datasetChecksum, (SELECT MAX(rr.segment_version) FROM customer_rfm_snapshot_row rr WHERE rr.snapshot_id = s.id) AS segmentVersion FROM customer_rfm_snapshot s WHERE s.status = 'published' ORDER BY s.reference_time DESC, s.id DESC`, []);
        return rows.map((row) => ({ snapshotId: String(row.id), referenceTime: toIso(row.referenceTime), calculationVersion: String(row.calculationVersion), segmentVersion: nullableString(row.segmentVersion), ...(row.datasetChecksum === undefined ? {} : { datasetChecksum: String(row.datasetChecksum) }) })) satisfies readonly AudienceRfmSnapshotHeader[];
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
    async getPublishedClusterSnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`SELECT s.id, s.reference_time AS referenceTime, s.model_id AS modelId, m.model_version AS modelVersion, s.population_policy_version AS populationPolicyVersion, s.assignment_checksum AS assignmentChecksum FROM customer_cluster_snapshot s INNER JOIN customer_cluster_model m ON m.id = s.model_id WHERE s.status = 'published' ORDER BY s.reference_time DESC, s.id DESC`, []);
        return rows.map((row) => ({ snapshotId: String(row.id), referenceTime: toIso(row.referenceTime), modelId: String(row.modelId), modelVersion: String(row.modelVersion), populationPolicyVersion: String(row.populationPolicyVersion), assignmentChecksum: String(row.assignmentChecksum) })) satisfies readonly AudienceClusterSnapshotHeader[];
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
    async getPublishedClvSnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id, snapshot_key AS snapshotKey, reference_time AS referenceTime, generated_at AS generatedAt, model_version AS modelVersion, estimator_policy_version AS estimatorPolicyVersion, horizon_months AS horizonMonths, currency_iso_code AS currencyIsoCode, output_checksum AS outputChecksum FROM customer_clv_snapshot WHERE status = 'published' ORDER BY reference_time DESC, id DESC`, []);
        return rows.map((row) => ({ snapshotId: String(row.id), snapshotKey: String(row.snapshotKey), referenceTime: toIso(row.referenceTime), generatedAt: toIso(row.generatedAt), modelVersion: String(row.modelVersion), estimatorPolicyVersion: String(row.estimatorPolicyVersion), horizonMonths: 12, currencyIsoCode: 'CLP', ...(row.outputChecksum === undefined ? {} : { outputChecksum: String(row.outputChecksum) }) })) satisfies readonly AudienceClvSnapshotHeader[];
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
    async getPublishedAffinitySnapshotHeaders() {
      try {
        const [rows] = await pool.execute<RowDataPacket[]>(`SELECT id, reference_time AS referenceTime, calculation_version AS calculationVersion, product_semantic_snapshot_id AS productSemanticSnapshotId, product_semantic_schema_version AS productSemanticSchemaVersion, ontology_version AS ontologyVersion, ontology_hash AS ontologyHash, source_semantic_checksum AS sourceSemanticChecksum, consumer_semantic_checksum AS consumerSemanticChecksum, affinity_dataset_checksum AS affinityDatasetChecksum, eligible_population_checksum AS populationChecksum FROM customer_commercial_affinity_snapshot WHERE status = 'published' ORDER BY reference_time DESC, id DESC`, []);
        return rows.filter((row) => row.populationChecksum !== null && row.populationChecksum !== undefined).map((row) => ({ snapshotId: String(row.id), referenceTime: toIso(row.referenceTime), calculationVersion: String(row.calculationVersion), productSemanticSnapshotId: String(row.productSemanticSnapshotId), productSemanticSchemaVersion: String(row.productSemanticSchemaVersion), ontologyVersion: String(row.ontologyVersion), ontologyHash: String(row.ontologyHash), sourceSemanticChecksum: String(row.sourceSemanticChecksum), consumerSemanticChecksum: String(row.consumerSemanticChecksum), affinityDatasetChecksum: String(row.affinityDatasetChecksum), populationChecksum: String(row.populationChecksum) })) satisfies readonly AudienceAffinitySnapshotHeader[];
      } catch (error) { throw mapAnalyticsReadError(error); }
    },
  };
}
function nullableString(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : String(value); }
function toIso(value: unknown): string { if (value instanceof Date) { if (Number.isNaN(value.getTime())) throw new Error('Invalid snapshot reference time'); return value.toISOString(); } if (typeof value !== 'string') throw new Error('Invalid snapshot reference time'); const parsed = new Date(`${value.replace(' ', 'T')}Z`); if (Number.isNaN(parsed.getTime())) throw new Error('Invalid snapshot reference time'); return parsed.toISOString(); }
