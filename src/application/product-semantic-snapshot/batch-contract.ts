import { z } from 'zod';

export const PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION = '1';
export const PRODUCT_SEMANTIC_BATCH_MAX_SIZE = 500;

export type ProductSemanticBatchTag = {
  readonly code: string;
  readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED';
};

export type ProductSemanticBatchProduct = {
  readonly productId: number;
  readonly classificationStatus: 'CLASSIFIED' | 'PARTIALLY_CLASSIFIED' | 'OTHER' | 'EXCLUDED_NON_PRODUCT' | 'NEEDS_REVIEW';
  readonly primaryProductFamily: ProductSemanticBatchTag | null;
  readonly secondaryProductFamilies: readonly ProductSemanticBatchTag[];
  readonly disciplines: readonly ProductSemanticBatchTag[];
  readonly useContexts: readonly ProductSemanticBatchTag[];
};

export type ProductSemanticBatchMetadata = {
  readonly schemaVersion: typeof PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classifierVersion: string;
  readonly semanticChecksum: string;
};

export type ProductSemanticBatchResult = ProductSemanticBatchMetadata & {
  readonly products: readonly ProductSemanticBatchProduct[];
  readonly missingProductIds: readonly number[];
};

export type ProductSemanticFactsSourceInput = {
  readonly productIds: readonly number[];
  readonly expectedSnapshotId?: string;
};

export interface ProductSemanticFactsSource {
  getFacts(input: ProductSemanticFactsSourceInput): Promise<ProductSemanticBatchResult>;
}

export const productSemanticBatchTagSchema = z.object({
  code: z.string().trim().min(1),
  confidence: z.enum(['EXPLICIT', 'STRONGLY_INFERRED']),
}).strict();

export const productSemanticBatchProductSchema = z.object({
  productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  classificationStatus: z.enum(['CLASSIFIED', 'PARTIALLY_CLASSIFIED', 'OTHER', 'EXCLUDED_NON_PRODUCT', 'NEEDS_REVIEW']),
  primaryProductFamily: productSemanticBatchTagSchema.nullable(),
  secondaryProductFamilies: z.array(productSemanticBatchTagSchema),
  disciplines: z.array(productSemanticBatchTagSchema),
  useContexts: z.array(productSemanticBatchTagSchema),
}).strict();

export const productSemanticBatchResponseSchema = z.object({
  schemaVersion: z.literal(PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION),
  snapshotId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  ontologyVersion: z.string().trim().min(1),
  ontologyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  classifierVersion: z.string().trim().min(1),
  semanticChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  products: z.array(productSemanticBatchProductSchema),
  missingProductIds: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
}).strict();

export type ProductSemanticBatchResponsePayload = z.infer<typeof productSemanticBatchResponseSchema>;
