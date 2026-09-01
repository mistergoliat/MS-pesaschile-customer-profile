import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProductSemanticSnapshotConsumer } from '../../src/application/product-semantic-snapshot/consumer.js';
import { FileProductSemanticSnapshotSource } from '../../src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.js';

const snapshotDirectory = process.env.PRODUCT_SEMANTIC_SNAPSHOT_DIR
  ? resolve(process.env.PRODUCT_SEMANTIC_SNAPSHOT_DIR)
  : resolve(process.cwd(), '..', 'MS-pesaschile-catalog-service', 'data', 'product-semantic-snapshots');
const consumer = createProductSemanticSnapshotConsumer(new FileProductSemanticSnapshotSource(snapshotDirectory));
const startedAt = performance.now();

try {
  const consumed = await consumer.refresh();
  const loadedAt = performance.now();
  const snapshotPath = resolve(snapshotDirectory, 'snapshots', `${consumed.metadata.snapshotId.replace(/^sha256:/u, '')}.json`);
  const snapshotBytes = (await stat(snapshotPath)).size;
  const factsWithConfidence = consumed.facts.filter((fact) => [
    fact.primaryProductFamily,
    ...fact.secondaryProductFamilies,
    ...fact.disciplines,
    ...fact.useContexts,
  ].some((tag) => tag?.confidence !== undefined)).length;
  const representativeProductIds = [29, 1023, 1619, 2134, 332, 444];

  console.log(JSON.stringify({
    status: 'ok',
    snapshotDirectory,
    snapshotId: consumed.metadata.snapshotId,
    schemaVersion: consumed.metadata.schemaVersion,
    builtAt: consumed.metadata.generatedAt,
    ontologyVersion: consumed.metadata.ontologyVersion,
    ontologyHash: consumed.metadata.ontologyHash,
    classifierVersion: consumed.metadata.classifierVersion,
    sourceSemanticChecksum: consumed.metadata.sourceSemanticChecksum,
    consumerNormalizedChecksum: consumed.metadata.consumerNormalizedChecksum,
    sourceProductCount: consumed.metadata.sourceProductCount,
    recordCount: consumed.metadata.recordCount,
    classificationCounts: consumed.metadata.classificationCounts,
    factsWithConfidence,
    factsWithoutConfidence: consumed.facts.length - factsWithConfidence,
    serializedBytes: snapshotBytes,
    loadAndValidationMs: Number((loadedAt - startedAt).toFixed(3)),
    representativeProducts: representativeProductIds.map((productId) => ({
      productId,
      fact: consumed.facts.find((fact) => fact.productId === productId) ?? null,
    })),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    errorCode: error instanceof Error && 'code' in error ? (error as Error & { code?: unknown }).code : 'UNKNOWN',
    errorType: error instanceof Error ? error.name : typeof error,
  }));
  process.exitCode = 1;
}
