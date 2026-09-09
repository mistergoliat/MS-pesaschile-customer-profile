import { resolve } from 'node:path';
import { createProductSemanticSnapshotConsumer } from '../../../src/application/product-semantic-snapshot/consumer.js';
import {
  loadProductSemanticSnapshotFromFactsSource,
  type ProductSemanticBatchRunMetrics,
} from '../../../src/application/product-semantic-snapshot/batched-consumer.js';
import { FileProductSemanticSnapshotSource } from '../../../src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.js';
import { HttpProductSemanticFactsSource } from '../../../src/infrastructure/catalog-product-semantics/http-product-semantic-facts-source.js';
import type { CustomerAffinityPurchaseEvidence } from '../../../src/application/customer-commercial-affinity-population/ports.js';

export type CustomerAffinitySemanticSourceMode = 'http' | 'file';

type SemanticSnapshot = Awaited<ReturnType<ReturnType<typeof createProductSemanticSnapshotConsumer>['readActiveSnapshot']>>;

export async function loadCustomerAffinitySemanticSnapshot(
  purchases: readonly CustomerAffinityPurchaseEvidence[],
  options: {
    readonly referenceTime: string;
    readonly generatedAt?: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<{ readonly snapshot: SemanticSnapshot; readonly metrics: ProductSemanticBatchRunMetrics }> {
  const env = options.env ?? process.env;
  const mode = parseSourceMode(env.AFFINITY_SEMANTIC_SOURCE);
  const productIds = [...new Set(purchases.map((purchase) => purchase.productId))].sort((left, right) => left - right);

  if (mode === 'file') {
    const rootDirectory = env.PRODUCT_SEMANTIC_SNAPSHOT_DIR
      ? resolvePath(env.PRODUCT_SEMANTIC_SNAPSHOT_DIR)
      : resolve(process.cwd(), '..', 'MS-pesaschile-catalog-service', 'data', 'product-semantic-snapshots');
    const snapshot = await createProductSemanticSnapshotConsumer(new FileProductSemanticSnapshotSource(rootDirectory)).refresh();
    return { snapshot, metrics: summarizeFileLoad(snapshot, productIds) };
  }

  const baseUrl = env.CATALOG_SERVICE_BASE_URL?.trim();
  const apiKey = env.CATALOG_SERVICE_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error('CATALOG_SERVICE_BASE_URL and CATALOG_SERVICE_API_KEY are required when AFFINITY_SEMANTIC_SOURCE=http');
  }
  const timeoutMs = parseNonNegativeInteger(env.CATALOG_SERVICE_TIMEOUT_MS, 2_500, 'CATALOG_SERVICE_TIMEOUT_MS');
  const maxRetries = parseNonNegativeInteger(env.CATALOG_SERVICE_MAX_RETRIES, 2, 'CATALOG_SERVICE_MAX_RETRIES');
  const loaded = await loadProductSemanticSnapshotFromFactsSource(
    new HttpProductSemanticFactsSource({ baseUrl, apiKey, timeoutMs, maxRetries }),
    productIds,
    { generatedAt: options.generatedAt ?? new Date().toISOString() },
  );
  return loaded;
}

export function parseSourceMode(value: string | undefined): CustomerAffinitySemanticSourceMode {
  const mode = (value?.trim().toLowerCase() || 'http') as string;
  if (mode !== 'http' && mode !== 'file') throw new Error('AFFINITY_SEMANTIC_SOURCE must be either http or file');
  return mode;
}

function summarizeFileLoad(snapshot: SemanticSnapshot, requestedProductIds: readonly number[]): ProductSemanticBatchRunMetrics {
  const requested = new Set(requestedProductIds);
  const facts = snapshot.facts.filter((fact) => requested.has(fact.productId));
  const matched = new Set(facts.map((fact) => fact.productId));
  const classificationCounts = {
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  };
  for (const fact of facts) classificationCounts[fact.classificationStatus] += 1;
  return {
    requestedDistinctProductIds: requestedProductIds.length,
    requestedProductIds: requestedProductIds.length,
    semanticBatches: requestedProductIds.length === 0 ? 0 : 1,
    matchedSemanticFacts: matched.size,
    missingProductIds: requestedProductIds.filter((productId) => !matched.has(productId)).length,
    classificationCounts,
    productSemanticSnapshotId: snapshot.metadata.snapshotId,
    productSemanticSchemaVersion: snapshot.metadata.schemaVersion,
    ontologyVersion: snapshot.metadata.ontologyVersion,
    ontologyHash: snapshot.metadata.ontologyHash,
    classifierVersion: snapshot.metadata.classifierVersion,
    semanticChecksum: snapshot.metadata.sourceSemanticChecksum,
  };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function resolvePath(path: string): string {
  return resolve(process.cwd(), path);
}
