import { describe, expect, it, vi } from 'vitest';
import { HttpProductSemanticFactsSource } from '../../src/infrastructure/catalog-product-semantics/http-product-semantic-facts-source.js';

const snapshotId = `sha256:${'a'.repeat(64)}`;
const valid = {
  schemaVersion: '1', snapshotId, ontologyVersion: 'commercial-product-ontology-v3', ontologyHash: 'b'.repeat(64),
  classifierVersion: 'product-semantic-classifier-v1', semanticChecksum: 'c'.repeat(64),
  products: [{ productId: 31, classificationStatus: 'OTHER', primaryProductFamily: null, secondaryProductFamilies: [], disciplines: [], useContexts: [] }],
  missingProductIds: [999],
};

function makeSource(payload: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status }));
  return { source: new HttpProductSemanticFactsSource({ baseUrl: 'http://catalog.local/', apiKey: 'secret', fetchImpl }), fetchImpl };
}

describe('HTTP Product Semantic Facts source', () => {
  it('validates a batch payload, deduplicates request IDs, and keeps lineage metadata', async () => {
    const created = makeSource(valid);
    const result = await created.source.getFacts({ productIds: [31, 31, 999] });
    expect(result).toMatchObject({ schemaVersion: '1', snapshotId, ontologyHash: 'b'.repeat(64), semanticChecksum: 'c'.repeat(64) });
    expect(result.products[0]?.classificationStatus).toBe('OTHER');
    expect(result.missingProductIds).toEqual([999]);
    expect(JSON.parse(String((created.fetchImpl.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ productIds: [31, 999] });
  });

  it('hard-fails unknown schema versions and invalid lineage', async () => {
    const unsupported = makeSource({ ...valid, schemaVersion: '2' }).source;
    await expect(unsupported.getFacts({ productIds: [31, 999] })).rejects.toMatchObject({ code: 'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION', retryable: false });
    const invalidLineage = makeSource({ ...valid, ontologyHash: 'invalid' }).source;
    await expect(invalidLineage.getFacts({ productIds: [31, 999] })).rejects.toMatchObject({ code: 'PRODUCT_SEMANTIC_LINEAGE_INVALID', retryable: false });
  });

  it('rejects duplicate product responses and maps mismatch/unavailable/timeout correctly', async () => {
    const duplicate = makeSource({ ...valid, products: [valid.products[0], valid.products[0]], missingProductIds: [] }).source;
    await expect(duplicate.getFacts({ productIds: [31] })).rejects.toMatchObject({ code: 'PRODUCT_SEMANTIC_LINEAGE_INVALID' });
    const mismatch = makeSource({ error: { code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', message: 'mismatch' } }, 409).source;
    await expect(mismatch.getFacts({ productIds: [31], expectedSnapshotId: snapshotId })).rejects.toMatchObject({ code: 'PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH', retryable: false });
    const unavailable = makeSource({ error: { code: 'PRODUCT_SEMANTICS_UNAVAILABLE', message: 'unavailable' } }, 503).source;
    await expect(unavailable.getFacts({ productIds: [31] })).rejects.toMatchObject({ code: 'PRODUCT_SEMANTICS_UNAVAILABLE', retryable: true });
    const timeout = new HttpProductSemanticFactsSource({ baseUrl: 'http://catalog.local', apiKey: 'secret', fetchImpl: vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')) });
    await expect(timeout.getFacts({ productIds: [31] })).rejects.toMatchObject({ code: 'PRODUCT_SEMANTICS_TIMEOUT', retryable: true });
  });
});
