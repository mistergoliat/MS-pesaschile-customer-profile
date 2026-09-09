import {
  assertValidProductSemanticFact,
  type ProductSemanticFact,
  type ProductSemanticFactTag,
} from '../../domain/customer-commercial-affinity/index.js';
import { sha256Stable } from '../../shared/stable-checksum.js';
import {
  PRODUCT_SEMANTIC_BATCH_MAX_SIZE,
  PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION,
  type ProductSemanticBatchProduct,
  type ProductSemanticBatchResult,
  type ProductSemanticFactsSource,
} from './batch-contract.js';
import type {
  ConsumedProductSemanticSnapshot,
  ProductSemanticSnapshotClassificationCounts,
} from './consumer.js';
import { ProductSemanticSnapshotConsumerError } from './consumer.js';

export type ProductSemanticBatchRunMetrics = {
  readonly requestedDistinctProductIds: number;
  readonly requestedProductIds: number;
  readonly semanticBatches: number;
  readonly matchedSemanticFacts: number;
  readonly missingProductIds: number;
  readonly classificationCounts: ProductSemanticSnapshotClassificationCounts;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSchemaVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly semanticChecksum: string;
};

export type BatchedProductSemanticSnapshot = {
  readonly snapshot: ConsumedProductSemanticSnapshot;
  readonly metrics: ProductSemanticBatchRunMetrics;
};

export type BatchedProductSemanticSnapshotOptions = {
  /** The run timestamp is not supplied by the Catalog batch contract. */
  readonly generatedAt: string;
};

/**
 * Loads only the products present in a purchase population through Catalog batches.
 * The first response pins the semantic snapshot; every later request is sent with that
 * snapshot id. The returned shape is the same normalized consumer snapshot used by the
 * existing affinity builder, so scoring and eligibility stay untouched.
 */
export async function loadProductSemanticSnapshotFromFactsSource(
  source: ProductSemanticFactsSource,
  productIds: readonly number[],
  options: BatchedProductSemanticSnapshotOptions,
): Promise<BatchedProductSemanticSnapshot> {
  const requestedIds = normalizeProductIds(productIds);
  if (requestedIds.length === 0) {
    throw new ProductSemanticSnapshotConsumerError(
      'NO_REQUESTED_PRODUCT_IDS',
      'Cannot acquire Product Semantics without requested product IDs',
    );
  }
  if (Number.isNaN(Date.parse(options.generatedAt))) {
    throw new ProductSemanticSnapshotConsumerError('PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE', 'generatedAt must be a valid timestamp');
  }

  const batches: ProductSemanticBatchResult[] = [];
  let pinnedSnapshotId: string | undefined;
  for (let offset = 0; offset < requestedIds.length; offset += PRODUCT_SEMANTIC_BATCH_MAX_SIZE) {
    const batchIds = requestedIds.slice(offset, offset + PRODUCT_SEMANTIC_BATCH_MAX_SIZE);
    const result = await source.getFacts({
      productIds: batchIds,
      ...(pinnedSnapshotId === undefined ? {} : { expectedSnapshotId: pinnedSnapshotId }),
    });
    if (pinnedSnapshotId === undefined) pinnedSnapshotId = result.snapshotId;
    validateBatchLineage(result, pinnedSnapshotId);
    batches.push(result);
  }

  const aggregate = aggregateBatches(requestedIds, batches);
  const facts = aggregate.products.map((product) => toProductSemanticFact(product, aggregate.metadata));
  facts.sort((left, right) => left.productId - right.productId);
  const metadata = {
    snapshotId: aggregate.metadata.snapshotId,
    schemaVersion: PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION,
    generatedAt: new Date(options.generatedAt).toISOString(),
    ontologyVersion: aggregate.metadata.ontologyVersion,
    ontologyHash: aggregate.metadata.ontologyHash,
    classifierVersion: aggregate.metadata.classifierVersion,
    sourceProductCount: requestedIds.length,
    recordCount: facts.length,
    classificationCounts: aggregate.classificationCounts,
    sourceSemanticChecksum: aggregate.metadata.semanticChecksum,
    consumerNormalizedChecksum: sha256Stable(facts),
  } as const;

  return {
    snapshot: { metadata, facts },
    metrics: {
      requestedDistinctProductIds: requestedIds.length,
      requestedProductIds: requestedIds.length,
      semanticBatches: batches.length,
      matchedSemanticFacts: facts.length,
      missingProductIds: aggregate.missingProductIds.length,
      classificationCounts: aggregate.classificationCounts,
      productSemanticSnapshotId: metadata.snapshotId,
      productSemanticSchemaVersion: metadata.schemaVersion,
      ontologyVersion: metadata.ontologyVersion,
      ontologyHash: metadata.ontologyHash,
      classifierVersion: metadata.classifierVersion,
      semanticChecksum: metadata.sourceSemanticChecksum,
    },
  };
}

function normalizeProductIds(productIds: readonly number[]): number[] {
  if (!Array.isArray(productIds)) throw new ProductSemanticSnapshotConsumerError('PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE', 'productIds must be an array');
  const unique = new Set<number>();
  for (const productId of productIds) {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new ProductSemanticSnapshotConsumerError('PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE', 'productIds must contain positive safe integers');
    }
    unique.add(productId);
  }
  return [...unique].sort((left, right) => left - right);
}

function validateBatchLineage(result: ProductSemanticBatchResult, pinnedSnapshotId: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(result.snapshotId) || result.schemaVersion !== PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION || result.snapshotId !== pinnedSnapshotId) {
    throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', 'Product Semantic batch changed its pinned snapshot lineage');
  }
  if (!result.ontologyVersion.trim() || !result.classifierVersion.trim()) {
    throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', 'Product Semantic batch contains empty lineage metadata');
  }
  if (!/^[a-f0-9]{64}$/u.test(result.ontologyHash) || !/^[a-f0-9]{64}$/u.test(result.semanticChecksum)) {
    throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', 'Product Semantic batch contains invalid lineage checksums');
  }
}

function aggregateBatches(requestedIds: readonly number[], batches: readonly ProductSemanticBatchResult[]): {
  readonly metadata: ProductSemanticBatchResult;
  readonly products: readonly ProductSemanticBatchProduct[];
  readonly missingProductIds: readonly number[];
  readonly classificationCounts: ProductSemanticSnapshotClassificationCounts;
} {
  const first = batches[0];
  if (!first) throw new ProductSemanticSnapshotConsumerError('PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE', 'Catalog returned no semantic batches');
  const products: ProductSemanticBatchProduct[] = [];
  const missingProductIds: number[] = [];
  const seen = new Set<number>();
  const classificationCounts = {
    CLASSIFIED: 0,
    PARTIALLY_CLASSIFIED: 0,
    OTHER: 0,
    EXCLUDED_NON_PRODUCT: 0,
    NEEDS_REVIEW: 0,
  };

  for (const batch of batches) {
    validateBatchLineage(batch, first.snapshotId);
    if (batch.ontologyVersion !== first.ontologyVersion || batch.ontologyHash !== first.ontologyHash || batch.classifierVersion !== first.classifierVersion || batch.semanticChecksum !== first.semanticChecksum) {
      throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', 'Product Semantic batches do not share one lineage');
    }
    for (const product of batch.products) {
      if (seen.has(product.productId)) throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', `Product ${product.productId} was returned by more than one semantic batch`);
      seen.add(product.productId);
      products.push(product);
      classificationCounts[product.classificationStatus] += 1;
    }
    for (const productId of batch.missingProductIds) {
      if (seen.has(productId)) throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', `Product ${productId} was returned both as semantic fact and missing`);
      seen.add(productId);
      missingProductIds.push(productId);
    }
  }
  if (seen.size !== requestedIds.length || requestedIds.some((productId) => !seen.has(productId))) {
    throw new ProductSemanticSnapshotConsumerError('ONTOLOGY_LINEAGE_MISMATCH', 'Catalog batches do not cover the requested product IDs exactly');
  }
  products.sort((left, right) => left.productId - right.productId);
  missingProductIds.sort((left, right) => left - right);
  return { metadata: first, products, missingProductIds, classificationCounts };
}

function toProductSemanticFact(product: ProductSemanticBatchProduct, metadata: ProductSemanticBatchResult): ProductSemanticFact {
  const fact: ProductSemanticFact = {
    productId: product.productId,
    ontologyVersion: metadata.ontologyVersion,
    ontologyHash: metadata.ontologyHash,
    classificationStatus: product.classificationStatus,
    primaryProductFamily: toTag(product.primaryProductFamily),
    secondaryProductFamilies: product.secondaryProductFamilies.map(toNonNullTag),
    disciplines: product.disciplines.map(toNonNullTag),
    useContexts: product.useContexts.map(toNonNullTag),
  };
  try {
    assertValidProductSemanticFact(fact);
  } catch (error) {
    throw new ProductSemanticSnapshotConsumerError(
      'PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE',
      error instanceof Error ? error.message : 'Catalog returned an invalid Product Semantic fact',
      { cause: error },
    );
  }
  return fact;
}

function toTag(tag: { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' } | null): ProductSemanticFactTag | null {
  return tag === null ? null : { code: tag.code, confidence: tag.confidence };
}

function toNonNullTag(tag: { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' }): ProductSemanticFactTag {
  return { code: tag.code, confidence: tag.confidence };
}
