import { describe, expect, it, vi } from 'vitest';
import {
  loadProductSemanticSnapshotFromFactsSource,
} from '../../src/application/product-semantic-snapshot/batched-consumer.js';
import type { ProductSemanticBatchResult, ProductSemanticFactsSource } from '../../src/application/product-semantic-snapshot/batch-contract.js';

const snapshotId = `sha256:${'a'.repeat(64)}`;
const ontologyHash = 'b'.repeat(64);
const semanticChecksum = 'c'.repeat(64);

function batch(productIds: readonly number[], overrides: Partial<ProductSemanticBatchResult> = {}): ProductSemanticBatchResult {
  return {
    schemaVersion: '1',
    snapshotId,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash,
    classifierVersion: 'product-semantic-classifier-v1',
    semanticChecksum,
    products: productIds.map((productId) => ({
      productId,
      catalogPresence: 'current_catalog' as const,
      classificationStatus: productId === 2 ? 'OTHER' : 'CLASSIFIED',
      primaryProductFamily: productId === 2 ? null : { code: 'HOME_GYM', confidence: 'EXPLICIT' },
      secondaryProductFamilies: [],
      disciplines: [],
      useContexts: [],
    })),
    missingProductIds: [],
    ...overrides,
  };
}

function sourceFromBatches(results: readonly ProductSemanticBatchResult[]): ProductSemanticFactsSource {
  let index = 0;
  return {
    getFacts: vi.fn(async () => results[index++]!),
  };
}

describe('batched Product Semantic consumer', () => {
  it('loads one batch, preserves statuses, and keeps missing IDs separate', async () => {
    const source = sourceFromBatches([batch([1, 2], { missingProductIds: [3] })]);
    const loaded = await loadProductSemanticSnapshotFromFactsSource(source, [2, 1, 3], { generatedAt: '2026-09-01T00:00:00.000Z' });

    expect(loaded.snapshot.facts.map((fact) => fact.productId)).toEqual([1, 2]);
    expect(loaded.snapshot.facts.find((fact) => fact.productId === 2)?.classificationStatus).toBe('OTHER');
    expect(loaded.metrics).toMatchObject({
      requestedDistinctProductIds: 3,
      requestedProductIds: 3,
      semanticBatches: 1,
      matchedSemanticFacts: 2,
      missingProductIds: 1,
    });
  });

  it('keeps EXCLUDED_NON_PRODUCT as a returned semantic status, distinct from missing', async () => {
    const excluded = batch([4], {
      products: [{
        productId: 4,
        catalogPresence: 'current_catalog',
        classificationStatus: 'EXCLUDED_NON_PRODUCT',
        primaryProductFamily: null,
        secondaryProductFamilies: [],
        disciplines: [],
        useContexts: [],
      }],
      missingProductIds: [5],
    });
    const loaded = await loadProductSemanticSnapshotFromFactsSource(sourceFromBatches([excluded]), [4, 5], { generatedAt: '2026-09-01T00:00:00.000Z' });

    expect(loaded.snapshot.facts[0]?.classificationStatus).toBe('EXCLUDED_NON_PRODUCT');
    expect(loaded.metrics.classificationCounts.EXCLUDED_NON_PRODUCT).toBe(1);
    expect(loaded.metrics.missingProductIds).toBe(1);
  });

  it('uses deterministic batches of at most 500 IDs and pins every later batch', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);
    const source = sourceFromBatches([batch(ids.slice(0, 500)), batch(ids.slice(500, 1000)), batch(ids.slice(1000))]);
    await loadProductSemanticSnapshotFromFactsSource(source, [...ids].reverse(), { generatedAt: '2026-09-01T00:00:00.000Z' });

    const calls = (source.getFacts as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map(([input]) => input.productIds.length)).toEqual([500, 500, 1]);
    expect(calls[0]?.[0]).toEqual({ productIds: ids.slice(0, 500) });
    expect(calls[1]?.[0]).toEqual({ productIds: ids.slice(500, 1000), expectedSnapshotId: snapshotId });
    expect(calls[2]?.[0]).toEqual({ productIds: [1001], expectedSnapshotId: snapshotId });
  });

  it('aborts when a later batch changes snapshot or lineage', async () => {
    const mismatch = sourceFromBatches([batch([1]), batch([2], { snapshotId: `sha256:${'d'.repeat(64)}` })]);
    await expect(loadProductSemanticSnapshotFromFactsSource(mismatch, [1, 2], { generatedAt: '2026-09-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'ONTOLOGY_LINEAGE_MISMATCH' });

    const lineage = sourceFromBatches([batch([1]), batch([2], { ontologyVersion: 'commercial-product-ontology-v4' })]);
    await expect(loadProductSemanticSnapshotFromFactsSource(lineage, [1, 2], { generatedAt: '2026-09-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'ONTOLOGY_LINEAGE_MISMATCH' });
  });

  it('rejects cross-batch duplication rather than mixing or repairing semantic truth', async () => {
    const source = sourceFromBatches([batch([1]), batch([1])]);
    await expect(loadProductSemanticSnapshotFromFactsSource(source, [1, 2], { generatedAt: '2026-09-01T00:00:00.000Z' })).rejects.toMatchObject({ code: 'ONTOLOGY_LINEAGE_MISMATCH' });
  });
});
