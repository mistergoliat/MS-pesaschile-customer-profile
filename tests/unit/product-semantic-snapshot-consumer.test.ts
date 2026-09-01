import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ProductSemanticSnapshotConsumerError,
  createProductSemanticSnapshotConsumer,
  type ProductSemanticSnapshotSource,
} from '../../src/application/product-semantic-snapshot/consumer.js';
import { FileProductSemanticSnapshotSource } from '../../src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.js';

const HASH = 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955';

function tag(axis: string, code: string, confidence = 'EXPLICIT') {
  return { axis, code, confidence, ruleId: `${code}-RULE` };
}

function fact(productId: string, classificationStatus: string, overrides: Record<string, unknown> = {}) {
  return {
    productId,
    classificationStatus,
    primaryProductFamily: tag('PRODUCT_FAMILY', 'BARBELL'),
    secondaryProductFamilies: [tag('PRODUCT_FAMILY', 'CABLE_MACHINE', 'STRONGLY_INFERRED')],
    disciplines: [tag('DISCIPLINE', 'POWERLIFTING')],
    useContexts: [tag('USE_CONTEXT', 'HOME_GYM')],
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: HASH,
    provenance: {
      evidence: [],
      exclusion: null,
    },
    needsReviewCandidates: [],
    ...overrides,
  };
}

function snapshot(records = [fact('2', 'CLASSIFIED'), fact('1', 'PARTIALLY_CLASSIFIED')]) {
  return {
    schemaVersion: '1',
    snapshotId: `sha256:${'a'.repeat(64)}`,
    builtAt: '2026-08-29T20:36:33.148Z',
    sourceProductCount: records.length,
    recordCount: records.length,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: HASH,
    classifierVersion: 'product-semantic-classifier-v1',
    semanticChecksum: 'b'.repeat(64),
    classificationCounts: {
      CLASSIFIED: records.filter((row) => row.classificationStatus === 'CLASSIFIED').length,
      PARTIALLY_CLASSIFIED: records.filter((row) => row.classificationStatus === 'PARTIALLY_CLASSIFIED').length,
      OTHER: records.filter((row) => row.classificationStatus === 'OTHER').length,
      EXCLUDED_NON_PRODUCT: records.filter((row) => row.classificationStatus === 'EXCLUDED_NON_PRODUCT').length,
      NEEDS_REVIEW: records.filter((row) => row.classificationStatus === 'NEEDS_REVIEW').length,
    },
    records,
  };
}

function source(value: unknown): ProductSemanticSnapshotSource {
  return { getActiveSnapshot: async () => value };
}

describe('Product Semantic Snapshot consumer compatibility adapter', () => {
  it('normalizes the actual A00.5 fact shape, preserves roles/axes, and orders by numeric product id', async () => {
    const consumed = await createProductSemanticSnapshotConsumer(source(snapshot())).readActiveSnapshot();
    expect(consumed.facts.map((row) => row.productId)).toEqual([1, 2]);
    expect(consumed.facts[0]).toMatchObject({
      productId: 1,
      classificationStatus: 'PARTIALLY_CLASSIFIED',
      primaryProductFamily: { code: 'BARBELL', confidence: 'EXPLICIT' },
      secondaryProductFamilies: [{ code: 'CABLE_MACHINE', confidence: 'STRONGLY_INFERRED' }],
      disciplines: [{ code: 'POWERLIFTING', confidence: 'EXPLICIT' }],
      useContexts: [{ code: 'HOME_GYM', confidence: 'EXPLICIT' }],
    });
    expect(consumed.metadata).toMatchObject({
      snapshotId: `sha256:${'a'.repeat(64)}`,
      schemaVersion: '1',
      generatedAt: '2026-08-29T20:36:33.148Z',
      ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: HASH,
      classifierVersion: 'product-semantic-classifier-v1',
      sourceSemanticChecksum: 'b'.repeat(64),
    });
    expect(consumed.metadata.consumerNormalizedChecksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps OTHER as residual product truth while preserving real discipline/use-context facts', async () => {
    const other = fact('1619', 'OTHER', {
      primaryProductFamily: null,
      secondaryProductFamilies: [],
      disciplines: [],
      useContexts: [tag('USE_CONTEXT', 'COMMERCIAL_GYM')],
    });
    const consumed = await createProductSemanticSnapshotConsumer(source(snapshot([other]))).readActiveSnapshot();
    expect(consumed.facts[0]).toMatchObject({
      classificationStatus: 'OTHER',
      primaryProductFamily: null,
      useContexts: [{ code: 'COMMERCIAL_GYM' }],
    });
  });

  it('preserves excluded and needs-review statuses without turning them into semantic evidence', async () => {
    const records = [
      fact('3', 'EXCLUDED_NON_PRODUCT', { primaryProductFamily: null, secondaryProductFamilies: [], disciplines: [], useContexts: [] }),
      fact('4', 'NEEDS_REVIEW', { primaryProductFamily: null, secondaryProductFamilies: [], disciplines: [], useContexts: [] }),
    ];
    const consumed = await createProductSemanticSnapshotConsumer(source(snapshot(records))).readActiveSnapshot();
    expect(consumed.facts.map((row) => row.classificationStatus)).toEqual(['EXCLUDED_NON_PRODUCT', 'NEEDS_REVIEW']);
    expect(consumed.facts.every((row) => row.primaryProductFamily === null && row.disciplines.length === 0 && row.useContexts.length === 0)).toBe(true);
  });

  it('produces the same normalized checksum regardless of source record order', async () => {
    const first = await createProductSemanticSnapshotConsumer(source(snapshot())).readActiveSnapshot();
    const second = await createProductSemanticSnapshotConsumer(source(snapshot([fact('1', 'PARTIALLY_CLASSIFIED'), fact('2', 'CLASSIFIED')]))).readActiveSnapshot();
    expect(second.metadata.consumerNormalizedChecksum).toBe(first.metadata.consumerNormalizedChecksum);
    expect(second.facts).toEqual(first.facts);
  });

  it('loads one coherent active snapshot and does not reread it for metadata/facts', async () => {
    const getActiveSnapshot = vi.fn(async () => snapshot());
    const consumer = createProductSemanticSnapshotConsumer({ getActiveSnapshot });
    await consumer.getActiveSnapshotMetadata();
    await consumer.getAllProductSemanticFacts();
    expect(getActiveSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['duplicate product ids', snapshot([fact('1', 'CLASSIFIED'), fact('1', 'CLASSIFIED')]), 'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT'],
    ['ontology lineage mismatch', snapshot([fact('1', 'CLASSIFIED', { ontologyHash: 'c'.repeat(64) })]), 'ONTOLOGY_LINEAGE_MISMATCH'],
    ['unknown status', snapshot([fact('1', 'NEW_STATUS')]), 'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT'],
    ['wrong axis', snapshot([fact('1', 'CLASSIFIED', { disciplines: [tag('USE_CONTEXT', 'HOME_GYM')] })]), 'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT'],
    ['duplicate semantic tag', snapshot([fact('1', 'CLASSIFIED', { secondaryProductFamilies: [tag('PRODUCT_FAMILY', 'CABLE_MACHINE'), tag('PRODUCT_FAMILY', 'CABLE_MACHINE')] })]), 'MALFORMED_PRODUCT_SEMANTIC_SNAPSHOT'],
  ] as const)('rejects %s', async (_name, value, code) => {
    await expect(createProductSemanticSnapshotConsumer(source(value)).readActiveSnapshot()).rejects.toMatchObject({ code });
  });

  it('distinguishes no active snapshot and unsupported schema version', async () => {
    await expect(createProductSemanticSnapshotConsumer(source(null)).readActiveSnapshot()).rejects.toMatchObject({ code: 'NO_ACTIVE_PRODUCT_SEMANTIC_SNAPSHOT' });
    await expect(createProductSemanticSnapshotConsumer(source({ ...snapshot(), schemaVersion: '2' })).readActiveSnapshot()).rejects.toBeInstanceOf(ProductSemanticSnapshotConsumerError);
    await expect(createProductSemanticSnapshotConsumer(source({ ...snapshot(), schemaVersion: '2' })).readActiveSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_PRODUCT_SEMANTIC_CONTRACT_VERSION' });
  });

  it('resolves the immutable snapshot named by the active pointer through the batch artifact boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'customer-profile-semantic-consumer-'));
    const snapshotId = `sha256:${'a'.repeat(64)}`;
    await mkdir(join(root, 'snapshots'));
    await writeFile(join(root, 'active.json'), JSON.stringify({ snapshotId, schemaVersion: '1' }));
    await writeFile(join(root, 'snapshots', `${'a'.repeat(64)}.json`), JSON.stringify(snapshot()));

    const consumed = await createProductSemanticSnapshotConsumer(new FileProductSemanticSnapshotSource(root)).readActiveSnapshot();
    expect(consumed.metadata.snapshotId).toBe(snapshotId);
    expect(consumed.facts).toHaveLength(2);
  });
});
