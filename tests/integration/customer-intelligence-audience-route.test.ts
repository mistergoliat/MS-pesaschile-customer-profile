import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';

let server: Server | undefined;
const unreachable = (() => { throw new Error('unreachable'); }) as any;

const completed = {
  status: 'completed',
  resultVersion: 'customer-intelligence-audience-evaluation-v1',
  definitionVersion: 'customer-intelligence-audience-definition-v1',
  matchedCount: 1,
  previewMembers: [{ customerId: 7 }],
} as any;

const deps = (capability: any, enabled = true): RouteDependencies => ({
  getCustomerProfile: unreachable, getCustomerOrderStatus: unreachable, getCustomerCommercialSummary: unreachable, getCustomerPurchasedProducts: unreachable, getCustomerPurchaseBehavior: unreachable, getCustomerRfm: unreachable, getCustomerRfmByCustomerId: unreachable, getCustomerCluster: unreachable, getClusterSnapshotSummary: unreachable, getRfmClusterCrossTab: unreachable, getDashboardContext: unreachable, getDashboardOverview: unreachable, getDashboardRfm: unreachable, getDashboardClusters: unreachable, getDashboardIntersection: unreachable, checkReadiness: async () => ({ crm: false, prestashop: { status: 'ready' } }),
  customerIntelligenceAudience: { enabled, internalToken: 'audience-token-123456' }, customerIntelligenceAudienceCapability: capability,
});

async function start(dependencies: RouteDependencies): Promise<string> {
  server = createServer(buildApp(dependencies));
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

describe('Customer Intelligence Audience A02 HTTP boundary', () => {
  it('requires the internal token and exposes the schema only after authentication', async () => {
    const baseUrl = await start(deps({ evaluate: async () => ({ capabilityVersion: 'customer-intelligence-audience-capability-v1', evaluation: completed, preview: null }) }));
    expect((await fetch(`${baseUrl}/v1/customer-intelligence/audiences/schema`)).status).toBe(401);
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/schema`, { headers: { 'x-internal-customer-intelligence-token': 'audience-token-123456' } });
    expect(response.status).toBe(200);
    expect((await response.json()).capabilityVersion).toBe('customer-intelligence-audience-capability-v1');
  });

  it('rejects malformed payloads before invoking the capability', async () => {
    const evaluate = async () => ({ capabilityVersion: 'customer-intelligence-audience-capability-v1', evaluation: completed, preview: null });
    const baseUrl = await start(deps({ evaluate }));
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-customer-intelligence-token': 'audience-token-123456' }, body: JSON.stringify({ definition: {}, previewLimit: 101 }) });
    expect(response.status).toBe(400);
  });

  it('returns the typed evaluation and separate preview envelope without accepting snapshot ids', async () => {
    const calls: unknown[] = [];
    const capability = { evaluate: async (input: unknown) => { calls.push(input); return { capabilityVersion: 'customer-intelligence-audience-capability-v1', evaluation: completed, preview: { previewVersion: 'customer-intelligence-audience-preview-v1', limit: 50, returned: 1, rows: [{ customerId: 7 }], truncated: false, enrichmentStatus: 'available', degradedComponents: [], lineage: {} } }; } };
    const baseUrl = await start(deps(capability));
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-customer-intelligence-token': 'audience-token-123456' }, body: JSON.stringify({ definition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'GTE', value: 1 } }, previewLimit: 50, featureSnapshotId: '99' }) });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
