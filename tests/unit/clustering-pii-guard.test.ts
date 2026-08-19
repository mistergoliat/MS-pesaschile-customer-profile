import { describe, expect, it } from 'vitest';
import { assertNoPiiInClusterManifest, assertNoPiiInFeatureRow } from '../../scripts/clustering/lib/pii-guard.js';

describe('assertNoPiiInClusterManifest', () => {
  it('accepts a realistic manifest shape (ISO timestamps, checksum hex, dunder version keys, customerId)', () => {
    const manifest = {
      experimentVersion: 'cp-r2-t01-v1',
      referenceTime: '2026-08-19T17:58:22.535Z',
      datasetChecksum: 'f8f786ecd0aa7dcab88826ce8c9e1a21da58761625084888b4fada13db481ef5',
      populationPolicyVersion: 'cp-r2-clustering-population-b-prime-v1__x__y',
      populationSize: 10145,
      featureDistributions: { totalSpentTaxIncl: { p99: 6637602, mean: 637244.9189788073 } },
      notes: ['Population B′: >=2 valid orders lifetime, operational accounts excluded.'],
    };
    expect(() => assertNoPiiInClusterManifest(manifest)).not.toThrow();
  });

  it('rejects a PII-shaped field name anywhere in the object graph', () => {
    expect(() => assertNoPiiInClusterManifest({ nested: { customerEmail: 'x' } })).toThrow(/PII-shaped field/);
  });

  it('rejects a string value that looks like an email address', () => {
    expect(() => assertNoPiiInClusterManifest({ note: 'contact joaquin@example.com for details' })).toThrow(
      /PII-shaped value/,
    );
  });

  it('rejects a string value that looks like a Chilean RUT', () => {
    expect(() => assertNoPiiInClusterManifest({ value: '12.345.678-9' })).toThrow(/PII-shaped value/);
  });

  it('allows customerId as the one explicit technical identifier', () => {
    expect(() => assertNoPiiInClusterManifest({ customerId: 22066 })).not.toThrow();
  });
});

describe('assertNoPiiInFeatureRow', () => {
  const allowedColumns = ['customerId', 'totalSpentTaxIncl', 'discountShare'];

  it('passes when every column is on the allow-list', () => {
    expect(() =>
      assertNoPiiInFeatureRow({ customerId: 1, totalSpentTaxIncl: 100, discountShare: 0.1 }, allowedColumns),
    ).not.toThrow();
  });

  it('rejects any column not on the allow-list, even if it looks harmless', () => {
    expect(() =>
      assertNoPiiInFeatureRow({ customerId: 1, totalSpentTaxIncl: 100, unexpectedColumn: 1 }, allowedColumns),
    ).toThrow(/non-allow-listed column/);
  });

  it('rejects a PII-shaped column even if a caller mistakenly allow-listed it', () => {
    expect(() =>
      assertNoPiiInFeatureRow({ customerId: 1, customerEmail: 'x' }, ['customerId', 'customerEmail']),
    ).toThrow(/PII-shaped column/);
  });
});
