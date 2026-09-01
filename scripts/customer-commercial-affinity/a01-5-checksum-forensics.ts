import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProductSemanticSnapshotConsumer } from '../../src/application/product-semantic-snapshot/consumer.js';
import { FileProductSemanticSnapshotSource } from '../../src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.js';
import type { CustomerCommercialAffinityRow } from '../../src/domain/customer-commercial-affinity/index.js';
import { sha256Stable, stableStringify } from '../../src/shared/stable-checksum.js';

const artifactPath = resolve(process.env.AFFINITY_FORENSICS_ARTIFACT_PATH ?? 'artifacts/customer-commercial-affinity/a01-4-population.json');
const semanticSnapshotDirectory = resolve(
  process.env.PRODUCT_SEMANTIC_SNAPSHOT_DIR ?? '../MS-pesaschile-catalog-service/data/product-semantic-snapshots',
);
const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
  readonly manifest: { readonly referenceTime: string };
  readonly rows: readonly CustomerCommercialAffinityRow[];
};
const semanticSnapshot = await createProductSemanticSnapshotConsumer(
  new FileProductSemanticSnapshotSource(semanticSnapshotDirectory),
).refresh();
const metadata = semanticSnapshot.metadata;
const canonicalRows = [...artifact.rows].sort(compareRows);
const fields = [
  'customerId', 'affinityAxis', 'affinityCode', 'score', 'supportingOrderCount',
  'supportingProductCount', 'supportingSpend', 'lastEvidenceAt', 'explicitEvidenceCoverage',
] as const;

console.log(JSON.stringify({
  artifactPath,
  referenceTime: artifact.manifest.referenceTime,
  rowCount: canonicalRows.length,
  ROW_ONLY_CHECKSUM: sha256Stable({ rows: canonicalRows }),
  SEMANTIC_METADATA_ONLY_CHECKSUM: sha256Stable({ semanticSnapshot: metadata }),
  REFERENCE_ONLY_CHECKSUM: sha256Stable(artifact.manifest.referenceTime),
  FULL_CHECKSUM: sha256Stable({ referenceTime: artifact.manifest.referenceTime, semanticSnapshot: metadata, rows: canonicalRows }),
  RUNTIME_METADATA_KEYS: Object.keys(metadata).sort(),
  RUNTIME_METADATA_VALUES: metadata,
  RUNTIME_METADATA_TOP_LEVEL_TYPES: Object.fromEntries(Object.keys(metadata).sort().map((key) => [key, typeOf(metadata[key as keyof typeof metadata])])),
  RUNTIME_METADATA_STABLE_SERIALIZED: stableStringify(metadata),
  CANONICAL_ROWS_FIRST_5: canonicalRows.slice(0, 5),
  CANONICAL_ROWS_LAST_5: canonicalRows.slice(-5),
  PER_FIELD_CHECKSUMS: Object.fromEntries(fields.map((field) => [field, sha256Stable(canonicalRows.map((row) => row[field]))])),
}, null, 2));

function compareRows(left: CustomerCommercialAffinityRow, right: CustomerCommercialAffinityRow): number {
  return left.customerId - right.customerId || left.affinityAxis.localeCompare(right.affinityAxis) || left.affinityCode.localeCompare(right.affinityCode);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
