import { randomUUID } from 'node:crypto';
import {
  PRODUCT_SEMANTIC_BATCH_MAX_SIZE,
  productSemanticBatchResponseSchema,
  type ProductSemanticBatchResult,
  type ProductSemanticFactsSource,
  type ProductSemanticFactsSourceInput,
} from '../../application/product-semantic-snapshot/batch-contract.js';

export type ProductSemanticFactsSourceErrorCode =
  | 'INVALID_PRODUCT_SEMANTICS_REQUEST'
  | 'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION'
  | 'PRODUCT_SEMANTIC_BATCH_MALFORMED'
  | 'PRODUCT_SEMANTIC_LINEAGE_INVALID'
  | 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH'
  | 'PRODUCT_SEMANTICS_UNAVAILABLE'
  | 'PRODUCT_SEMANTICS_AUTH_FAILED'
  | 'PRODUCT_SEMANTICS_HTTP_ERROR'
  | 'PRODUCT_SEMANTICS_NETWORK_ERROR'
  | 'PRODUCT_SEMANTICS_TIMEOUT';

export class ProductSemanticFactsSourceError extends Error {
  constructor(
    readonly code: ProductSemanticFactsSourceErrorCode,
    message: string,
    readonly statusCode?: number,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProductSemanticFactsSourceError';
  }
}

type FetchLike = typeof fetch;

export type HttpProductSemanticFactsSourceOptions = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
};

export class HttpProductSemanticFactsSource implements ProductSemanticFactsSource {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpProductSemanticFactsSourceOptions) {
    if (!options.baseUrl.trim() || !options.apiKey.trim()) {
      throw new Error('Catalog Service baseUrl and apiKey are required');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 2500;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async getFacts(input: ProductSemanticFactsSourceInput): Promise<ProductSemanticBatchResult> {
    if (!input || !Array.isArray(input.productIds)) {
      throw new ProductSemanticFactsSourceError('INVALID_PRODUCT_SEMANTICS_REQUEST', 'productIds must be an array');
    }
    if (input.productIds.length > PRODUCT_SEMANTIC_BATCH_MAX_SIZE) {
      throw new ProductSemanticFactsSourceError(
        'INVALID_PRODUCT_SEMANTICS_REQUEST',
        `productIds cannot contain more than ${PRODUCT_SEMANTIC_BATCH_MAX_SIZE} ids`,
      );
    }
    const productIds = normalizeProductIds(input.productIds);
    if (productIds.length === 0 || productIds.length > PRODUCT_SEMANTIC_BATCH_MAX_SIZE) {
      throw new ProductSemanticFactsSourceError(
        'INVALID_PRODUCT_SEMANTICS_REQUEST',
        `productIds must contain between 1 and ${PRODUCT_SEMANTIC_BATCH_MAX_SIZE} positive safe integers`,
      );
    }
    if (input.expectedSnapshotId !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(input.expectedSnapshotId)) {
      throw new ProductSemanticFactsSourceError('INVALID_PRODUCT_SEMANTICS_REQUEST', 'expectedSnapshotId is invalid');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const correlationId = randomUUID();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/products/semantics/batch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'x-correlation-id': correlationId,
        },
        body: JSON.stringify({
          productIds,
          ...(input.expectedSnapshotId === undefined ? {} : { expectedSnapshotId: input.expectedSnapshotId }),
        }),
        signal: controller.signal,
      });
      const payload = await readJson(response);
      if (!response.ok) throw mapHttpError(response.status, payload);
      return validateBatchPayload(payload, productIds, input.expectedSnapshotId);
    } catch (error) {
      if (error instanceof ProductSemanticFactsSourceError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTICS_TIMEOUT', 'Catalog Service request timed out', 408, true, { cause: error });
      }
      throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTICS_NETWORK_ERROR', 'Catalog Service request failed', 503, true, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeProductIds(productIds: readonly number[]): number[] {
  if (!Array.isArray(productIds)) return [];
  const normalized: number[] = [];
  const seen = new Set<number>();
  for (const productId of productIds) {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new ProductSemanticFactsSourceError('INVALID_PRODUCT_SEMANTICS_REQUEST', 'productIds contains an invalid id');
    }
    if (!seen.has(productId)) {
      seen.add(productId);
      normalized.push(productId);
    }
  }
  return normalized;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_BATCH_MALFORMED', 'Catalog Service returned invalid JSON', response.status, false);
  }
}

function mapHttpError(status: number, payload: unknown): ProductSemanticFactsSourceError {
  const error = payloadObject(payload);
  const code = error?.code;
  const message = typeof error?.message === 'string' ? error.message : `Catalog Service returned HTTP ${status}`;
  if (status === 409 && code === 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH') {
    return new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', message, status, false);
  }
  if (status === 503 && code === 'PRODUCT_SEMANTICS_UNAVAILABLE') {
    return new ProductSemanticFactsSourceError('PRODUCT_SEMANTICS_UNAVAILABLE', message, status, true);
  }
  if (status === 401 || status === 403) {
    return new ProductSemanticFactsSourceError('PRODUCT_SEMANTICS_AUTH_FAILED', message, status, false);
  }
  return new ProductSemanticFactsSourceError('PRODUCT_SEMANTICS_HTTP_ERROR', message, status, status >= 500);
}

function payloadObject(payload: unknown): { code?: unknown; message?: unknown } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const error = (payload as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  return error as { code?: unknown; message?: unknown };
}

function validateBatchPayload(payload: unknown, requestedIds: readonly number[], expectedSnapshotId?: string): ProductSemanticBatchResult {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const schemaVersion = (payload as Record<string, unknown>).schemaVersion;
    if (schemaVersion !== '1') {
      throw new ProductSemanticFactsSourceError(
        'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION',
        `Unsupported Product Semantics Batch schemaVersion: ${String(schemaVersion)}`,
      );
    }
  }
  if (hasInvalidLineage(payload)) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_LINEAGE_INVALID', 'Catalog Service returned invalid snapshot lineage');
  }
  const parsed = productSemanticBatchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_BATCH_MALFORMED', 'Catalog Service response does not satisfy the batch contract');
  }
  if (expectedSnapshotId !== undefined && parsed.data.snapshotId !== expectedSnapshotId) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', 'Catalog Service returned a different snapshot than expected', 409, false);
  }

  const productIds = parsed.data.products.map((product) => product.productId);
  const missingIds = parsed.data.missingProductIds;
  const returnedIds = [...productIds, ...missingIds];
  const requestedSet = new Set(requestedIds);
  if (returnedIds.length !== requestedIds.length || new Set(returnedIds).size !== returnedIds.length || returnedIds.some((id) => !requestedSet.has(id))) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_LINEAGE_INVALID', 'Catalog Service response does not cover the requested product IDs exactly');
  }
  const productById = new Map(parsed.data.products.map((product) => [product.productId, product]));
  const missingSet = new Set(missingIds);
  if (requestedIds.some((id) => !productById.has(id) && !missingSet.has(id))) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_LINEAGE_INVALID', 'Catalog Service response omits a requested product ID');
  }
  const returnedOrder = requestedIds.map((id) => productById.has(id) ? productById.get(id)!.productId : id);
  const actualOrder = [...productIds, ...missingIds];
  if (!sameOrderByPartition(requestedIds, productIds, missingIds) || returnedOrder.length !== actualOrder.length) {
    throw new ProductSemanticFactsSourceError('PRODUCT_SEMANTIC_LINEAGE_INVALID', 'Catalog Service response ordering is not deterministic');
  }
  return {
    schemaVersion: parsed.data.schemaVersion,
    snapshotId: parsed.data.snapshotId,
    ontologyVersion: parsed.data.ontologyVersion,
    ontologyHash: parsed.data.ontologyHash,
    classifierVersion: parsed.data.classifierVersion,
    semanticChecksum: parsed.data.semanticChecksum,
    products: parsed.data.products,
    missingProductIds: parsed.data.missingProductIds,
  };
}

function hasInvalidLineage(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false;
  const candidate = payload as Record<string, unknown>;
  return (
    ('snapshotId' in candidate && (typeof candidate.snapshotId !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(candidate.snapshotId))) ||
    ('ontologyHash' in candidate && (typeof candidate.ontologyHash !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.ontologyHash))) ||
    ('semanticChecksum' in candidate && (typeof candidate.semanticChecksum !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.semanticChecksum)))
  );
}

function sameOrderByPartition(requestedIds: readonly number[], productIds: readonly number[], missingIds: readonly number[]): boolean {
  let productIndex = 0;
  let missingIndex = 0;
  for (const id of requestedIds) {
    if (productIds.includes(id)) {
      if (productIds[productIndex++] !== id) return false;
    } else if (missingIds[missingIndex++] !== id) {
      return false;
    }
  }
  return productIndex === productIds.length && missingIndex === missingIds.length;
}
