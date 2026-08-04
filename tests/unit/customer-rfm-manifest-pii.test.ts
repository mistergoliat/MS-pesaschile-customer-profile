import { describe, expect, it } from 'vitest';
import { assertRfmManifestHasNoPii } from '../../src/domain/customer-rfm/index.js';

describe('assertRfmManifestHasNoPii', () => {
  it.each([
    { email: 'customer@example.com' },
    { customer: { phone: '+56 9 1234 5678' } },
    { nested: [{ telefono: '+56 2 2345 6789' }] },
    { firstName: 'Ada' },
    { last_name: 'Lovelace' },
    { document: '12.345.678-9' },
    { neutral: { customerPayload: { id: 1 } } },
    { orderPayload: { payment: { card: '4111111111111111' } } },
    { shipping_address: 'street 123' },
  ])('rejects PII-shaped manifest structure %#', (manifest) => {
    expect(() => assertRfmManifestHasNoPii(manifest)).toThrow(/PII-shaped/);
  });

  it('allows aggregate metrics, timestamps, checksums and technical RFM fields', () => {
    expect(() =>
      assertRfmManifestHasNoPii({
        referenceTime: '2026-08-03T00:00:00.000Z',
        grossOrderValueTaxIncl: '123456789.000000',
        datasetChecksum: 'a'.repeat(64),
        rfmCodeDistribution: { R5F2M4: 10 },
      }),
    ).not.toThrow();
  });
});
