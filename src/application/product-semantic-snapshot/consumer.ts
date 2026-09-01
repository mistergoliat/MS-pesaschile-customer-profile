import { z } from 'zod';
import {
  assertValidProductSemanticFact,
  type ProductSemanticFact,
  type ProductSemanticFactConfidence,
  type ProductSemanticFactTag,
} from '../../domain/customer-commercial-affinity/index.js';
import { sha256Stable } from '../../shared/stable-checksum.js';

export const PRODUCT_SEMANTIC_SNAPSHOT_SCHEMA_VERSION = '1';

export type ProductSemanticSnapshotConsumerMetadata = {
  readonly snapshotId: string;
  readonly schemaVersion: typeof PRODUCT_SEMANTIC_SNAPSHOT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly sourceProductCount: number;
  readonly recordCount: number;
  readonly classificationCounts: ProductSemanticSnapshotClassificationCounts;
  readonly sourceSemanticChecksum: string;
  readonly consumerNormalizedChecksum: string;
};

export type ProductSemanticSnapshotClassificationCounts = {
  readonly CLASSIFIED: number;
  readonly PARTIALLY_CLASSIFIED: number;
  readonly OTHER: number;
  readonly EXCLUDED_NON_PRODUCT: number;
  readonly NEEDS_REVIEW: number;
};

export type ConsumedProductSemanticSnapshot = {
  readonly metadata: ProductSemanticSnapshotConsumerMetadata;
  readonly facts: readonly ProductSemanticFact[];
};

export interface ProductSemanticSnapshotSource {
  getActiveSnapshot(): Promise<unknown | null>;
}

export type ProductSemanticSnapshotConsumer = {
  refresh(): Promise<ConsumedProductSemanticSnapshot>;
  readActiveSnapshot(): Promise<ConsumedProductSemanticSnapshot>;
  getActiveSnapshotMetadata(): Promise<ProductSemanticSnapshotConsumerMetadata>;
  getAllProductSemanticFacts(): Promise<readonly ProductSemanticFact[]>;
};

export type ProductSemanticSnapshotConsumerErrorCode =
  | 'NO_ACTIVE_PRODUCT_SEMANTIC_SNAPSHOT'
  | 'PRODUCT_SEMANTIC_SNAPSHOT_UNAVAILABLE'
  | 'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT'
  | 'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION'
  | 'ONTOLOGY_LINEAGE_MISMATCH';

export class ProductSemanticSnapshotConsumerError extends Error {
  constructor(
    readonly code: ProductSemanticSnapshotConsumerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProductSemanticSnapshotConsumerError';
  }
}

const classificationStatusSchema = z.enum([
  'CLASSIFIED',
  'PARTIALLY_CLASSIFIED',
  'OTHER',
  'EXCLUDED_NON_PRODUCT',
  'NEEDS_REVIEW',
]);

const snapshotTagSchema = z.object({
  axis: z.enum(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']),
  code: z.string().trim().min(1),
  confidence: z.enum(['EXPLICIT', 'STRONGLY_INFERRED']),
  ruleId: z.string().trim().min(1),
}).strict();

const snapshotFactSchema = z.object({
  productId: z.string().regex(/^\d+$/u).refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0),
  classificationStatus: classificationStatusSchema,
  primaryProductFamily: snapshotTagSchema.nullable(),
  secondaryProductFamilies: z.array(snapshotTagSchema),
  disciplines: z.array(snapshotTagSchema),
  useContexts: z.array(snapshotTagSchema),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  provenance: z.object({
    evidence: z.array(z.object({
      axis: z.enum(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']),
      code: z.string().trim().min(1),
      ruleId: z.string().trim().min(1),
      sourceType: z.enum(['NAME_TEXT', 'TRUSTED_CATEGORY', 'STRUCTURED_FEATURE', 'FAMILY_INFERENCE']),
      sourceId: z.string().trim().min(1),
      rawValue: z.string(),
      normalizedValue: z.string(),
    }).strict()),
    exclusion: z.object({ ruleId: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict().nullable(),
  }).strict(),
  needsReviewCandidates: z.array(snapshotTagSchema),
}).strict();

const classificationCountsSchema = z.object({
  CLASSIFIED: z.number().int().nonnegative(),
  PARTIALLY_CLASSIFIED: z.number().int().nonnegative(),
  OTHER: z.number().int().nonnegative(),
  EXCLUDED_NON_PRODUCT: z.number().int().nonnegative(),
  NEEDS_REVIEW: z.number().int().nonnegative(),
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.string(),
  snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  builtAt: z.string().datetime({ offset: true }),
  sourceProductCount: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  classifierVersion: z.string().trim().min(1),
  semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  classificationCounts: classificationCountsSchema,
  records: z.array(snapshotFactSchema),
}).strict();

type SnapshotFact = z.infer<typeof snapshotFactSchema>;
type Snapshot = z.infer<typeof snapshotSchema>;

export function createProductSemanticSnapshotConsumer(
  source: ProductSemanticSnapshotSource,
): ProductSemanticSnapshotConsumer {
  let loaded: ConsumedProductSemanticSnapshot | null = null;
  let loading: Promise<ConsumedProductSemanticSnapshot> | null = null;

  async function refresh(): Promise<ConsumedProductSemanticSnapshot> {
    if (loading) return loading;
    loading = loadAndNormalize(source).then((snapshot) => {
      loaded = snapshot;
      return snapshot;
    }).catch((error: unknown) => {
      // Never keep serving a previous snapshot after an explicit refresh fails:
      // stale semantic truth must not silently cross into a future affinity build.
      loaded = null;
      throw error;
    }).finally(() => {
      loading = null;
    });
    return loading;
  }

  async function readActiveSnapshot(): Promise<ConsumedProductSemanticSnapshot> {
    return loaded ?? refresh();
  }

  return {
    refresh,
    readActiveSnapshot,
    async getActiveSnapshotMetadata() {
      return (await readActiveSnapshot()).metadata;
    },
    async getAllProductSemanticFacts() {
      return (await readActiveSnapshot()).facts;
    },
  };
}

async function loadAndNormalize(source: ProductSemanticSnapshotSource): Promise<ConsumedProductSemanticSnapshot> {
  const raw = await source.getActiveSnapshot();
  if (raw === null) {
    throw new ProductSemanticSnapshotConsumerError(
      'NO_ACTIVE_PRODUCT_SEMANTIC_SNAPSHOT',
      'No active Product Semantic Snapshot is available',
    );
  }
  const snapshot = parseSnapshot(raw);
  const facts = snapshot.records.map((fact) => normalizeFact(fact));
  facts.sort((left, right) => left.productId - right.productId);
  const consumerNormalizedChecksum = sha256Stable(facts);

  return {
    metadata: {
      snapshotId: snapshot.snapshotId,
      schemaVersion: PRODUCT_SEMANTIC_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: snapshot.builtAt,
      ontologyVersion: snapshot.ontologyVersion,
      ontologyHash: snapshot.ontologyHash,
      classifierVersion: snapshot.classifierVersion,
      sourceProductCount: snapshot.sourceProductCount,
      recordCount: snapshot.recordCount,
      classificationCounts: snapshot.classificationCounts,
      sourceSemanticChecksum: snapshot.semanticChecksum,
      consumerNormalizedChecksum,
    },
    facts,
  };
}

function parseSnapshot(raw: unknown): Snapshot {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw malformed('Snapshot must be a JSON object');
  }
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion !== PRODUCT_SEMANTIC_SNAPSHOT_SCHEMA_VERSION) {
    throw new ProductSemanticSnapshotConsumerError(
      'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION',
      `Unsupported Product Semantic Snapshot schemaVersion: ${String(candidate.schemaVersion)}`,
    );
  }
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw malformed('Snapshot does not satisfy the A00.5 contract');
  const snapshot = parsed.data;
  const counted = Object.values(snapshot.classificationCounts).reduce((sum, value) => sum + value, 0);
  if (snapshot.recordCount !== snapshot.records.length || counted !== snapshot.recordCount) {
    throw malformed('Snapshot recordCount/classificationCounts are inconsistent');
  }
  if (snapshot.sourceProductCount < snapshot.recordCount) {
    throw malformed('Snapshot sourceProductCount cannot be smaller than recordCount');
  }

  const productIds = new Set<number>();
  for (const fact of snapshot.records) {
    const productId = Number(fact.productId);
    if (productIds.has(productId)) {
      throw malformed(`Duplicate productId in Product Semantic Snapshot: ${fact.productId}`);
    }
    productIds.add(productId);
    if (fact.ontologyVersion !== snapshot.ontologyVersion || fact.ontologyHash !== snapshot.ontologyHash) {
      throw new ProductSemanticSnapshotConsumerError(
        'ONTOLOGY_LINEAGE_MISMATCH',
        `Product Semantic Snapshot fact ${fact.productId} does not match snapshot ontology lineage`,
      );
    }
    validateTagAxes(fact);
  }
  return snapshot;
}

function normalizeFact(fact: SnapshotFact): ProductSemanticFact {
  const normalized: ProductSemanticFact = {
    productId: Number(fact.productId),
    ontologyVersion: fact.ontologyVersion,
    ontologyHash: fact.ontologyHash,
    classificationStatus: fact.classificationStatus,
    primaryProductFamily: fact.primaryProductFamily ? normalizeTag(fact.primaryProductFamily) : null,
    secondaryProductFamilies: normalizeTags(fact.secondaryProductFamilies),
    disciplines: normalizeTags(fact.disciplines),
    useContexts: normalizeTags(fact.useContexts),
  };
  try {
    assertValidProductSemanticFact(normalized);
  } catch (error) {
    throw malformed(error instanceof Error ? error.message : 'Product Semantic Snapshot fact is invalid');
  }
  return normalized;
}

function validateTagAxes(fact: SnapshotFact): void {
  if (fact.primaryProductFamily && fact.primaryProductFamily.axis !== 'PRODUCT_FAMILY') {
    throw malformed(`Product ${fact.productId} primaryProductFamily has an invalid axis`);
  }
  for (const tag of fact.secondaryProductFamilies) assertAxis(tag.axis, 'secondaryProductFamilies', fact.productId, 'PRODUCT_FAMILY');
  for (const tag of fact.disciplines) assertAxis(tag.axis, 'disciplines', fact.productId, 'DISCIPLINE');
  for (const tag of fact.useContexts) assertAxis(tag.axis, 'useContexts', fact.productId, 'USE_CONTEXT');
}

function assertAxis(actual: string, field: string, productId: string, expected: string): void {
  if (actual !== expected) throw malformed(`Product ${productId} ${field} contains axis ${actual}, expected ${expected}`);
}

function normalizeTags(tags: readonly z.infer<typeof snapshotTagSchema>[]): ProductSemanticFactTag[] {
  return tags.map(normalizeTag).sort(compareTags);
}

function normalizeTag(tag: z.infer<typeof snapshotTagSchema>): ProductSemanticFactTag {
  const confidence: ProductSemanticFactConfidence = tag.confidence;
  return { code: tag.code, confidence };
}

function compareTags(left: ProductSemanticFactTag, right: ProductSemanticFactTag): number {
  return left.code.localeCompare(right.code) || String(left.confidence ?? '').localeCompare(String(right.confidence ?? ''));
}

function malformed(message: string): ProductSemanticSnapshotConsumerError {
  return new ProductSemanticSnapshotConsumerError('MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT', message);
}
