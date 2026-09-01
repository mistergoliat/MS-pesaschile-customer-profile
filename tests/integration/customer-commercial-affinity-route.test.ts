import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { GetCustomerCommercialAffinity, GetCustomerCommercialAffinitySnapshot } from '../../src/application/customer-commercial-affinity/index.js';

let server: Server | undefined;

const snapshot = {
  snapshotId: '3',
  calculationVersion: 'customer-commercial-affinity-v1',
  referenceTime: '2026-09-01T00:00:00.000Z',
  productSemanticSnapshotId: 'semantic-1',
  productSemanticSchemaVersion: '1',
  ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'a'.repeat(64),
  sourceSemanticChecksum: 'b'.repeat(64),
  consumerSemanticChecksum: 'c'.repeat(64),
  affinityDatasetChecksum: 'e'.repeat(64),
};

const available = {
  status: 'available' as const,
  customerId: 42,
  availability: 'AVAILABLE' as const,
  affinity: {
    customerId: 42,
    snapshot,
    affinities: [{ affinityAxis: 'PRODUCT_FAMILY' as const, affinityCode: 'BARBELL', score: 0.8, supportingOrderCount: 2, supportingProductCount: 1, supportingSpend: '100.000000', lastEvidenceAt: '2026-08-01T00:00:00.000Z', explicitEvidenceCoverage: null }],
  },
  contractVersion: 'customer-commercial-affinity-runtime-v1' as const,
};

async function startApp(getCustomerCommercialAffinity: GetCustomerCommercialAffinity = vi.fn(async () => available), getSnapshot: GetCustomerCommercialAffinitySnapshot = vi.fn(async () => ({ status: 'available' as const, availability: 'AVAILABLE' as const, snapshot, contractVersion: 'customer-commercial-affinity-runtime-v1' as const }))): Promise<string> {
  const app = buildApp({ getCustomerCommercialAffinity, getCustomerCommercialAffinitySnapshot: getSnapshot } as unknown as RouteDependencies);
  server = createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server?.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = undefined;
  }
});

describe('Customer Commercial Affinity HTTP endpoints', () => {
  it('returns AVAILABLE, NOT_IN_POPULATION, validates ids, and serves metadata', async () => {
    const getAffinity = vi.fn(async ({ customerId }: { customerId: number }) => customerId === 42 ? available : {
      status: 'not_in_population' as const,
      customerId,
      availability: 'NOT_IN_POPULATION' as const,
      affinity: null,
      contractVersion: 'customer-commercial-affinity-runtime-v1' as const,
    });
    const baseUrl = await startApp(getAffinity);

    const found = await fetch(`${baseUrl}/v1/customers/42/affinity`);
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ customerId: 42, availability: 'AVAILABLE', affinity: { snapshot: { snapshotId: '3' }, affinities: [{ affinityAxis: 'PRODUCT_FAMILY' }] } });

    const absent = await fetch(`${baseUrl}/v1/customers/7/affinity`);
    expect(absent.status).toBe(200);
    expect(await absent.json()).toMatchObject({ customerId: 7, availability: 'NOT_IN_POPULATION', affinity: null });

    expect((await fetch(`${baseUrl}/v1/customers/not-a-number/affinity`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/42/affinity?unexpected=true`)).status).toBe(400);

    const metadata = await fetch(`${baseUrl}/v1/customer-commercial-affinity/snapshot`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ availability: 'AVAILABLE', snapshot: { snapshotId: '3', affinityDatasetChecksum: 'e'.repeat(64) } });
  });

  it('uses explicit 503 semantics for unavailable affinity data', async () => {
    const baseUrl = await startApp(vi.fn(async () => ({ status: 'unavailable' as const, customerId: 42, availability: 'UNAVAILABLE' as const, affinity: null, reason: 'no_published_snapshot' as const, contractVersion: 'customer-commercial-affinity-runtime-v1' as const })), vi.fn(async () => ({ status: 'unavailable' as const, availability: 'UNAVAILABLE' as const, snapshot: null, reason: 'no_published_snapshot' as const, contractVersion: 'customer-commercial-affinity-runtime-v1' as const })));
    expect((await fetch(`${baseUrl}/v1/customers/42/affinity`)).status).toBe(503);
    expect((await fetch(`${baseUrl}/v1/customer-commercial-affinity/snapshot`)).status).toBe(503);
  });
});
