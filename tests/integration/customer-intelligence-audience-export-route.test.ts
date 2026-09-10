import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAudienceExportArtifact } from '../../src/application/customer-intelligence-audience/export-artifact.js';
import { AudienceExportError } from '../../src/application/customer-intelligence-audience/export-artifact.js';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { AudienceMembershipResultV1 } from '../../src/domain/customer-intelligence-audience/index.js';

let server: Server | undefined;
const unreachable = (() => { throw new Error('unreachable'); }) as any;

const membership = (overrides: Partial<AudienceMembershipResultV1> = {}): AudienceMembershipResultV1 => ({
  status: 'completed',
  membershipVersion: 'customer-intelligence-audience-membership-v1',
  definition: {
    definitionVersion: 'customer-intelligence-audience-definition-v1',
    root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'GTE', value: 1 },
  },
  definitionChecksum: 'a'.repeat(64),
  evaluationContext: {} as AudienceMembershipResultV1['evaluationContext'],
  lineage: {
    lineageVersion: 'customer-intelligence-audience-evaluation-lineage-v1',
    evaluatorVersion: 'customer-intelligence-audience-evaluation-v1',
    reproducibilityLevel: 'ACTIVE_SNAPSHOT_CONSISTENT',
    definitionChecksum: 'a'.repeat(64),
    contextVersion: 'customer-intelligence-audience-context-v1',
    referenceTime: '2026-09-10T00:00:00.000Z',
    population: {} as AudienceMembershipResultV1['evaluationContext']['population'],
    resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1',
    relevantSnapshotLineage: {
      feature: {
        snapshotId: '42',
        referenceTime: '2026-09-10T00:00:00.000Z',
        featureVersion: 'features-v1',
        populationPolicyVersion: 'population-v1',
        featureDatasetChecksum: 'f'.repeat(64),
      },
    },
    evaluatedAt: '2026-09-10T00:00:00.000Z',
  },
  evaluatedAt: '2026-09-10T00:00:00.000Z',
  counts: { population: 2, matched: 2, notMatched: 0, unknown: 0 },
  members: [{ customerId: 7 }, { customerId: 8 }],
  evaluationChecksum: 'b'.repeat(64),
  membershipChecksum: 'c'.repeat(64),
  completeness: 'COMPLETE',
  warnings: [],
  ...overrides,
});

const deps = (options: {
  readonly resolveMembership?: () => Promise<any>;
  readonly exportArtifact?: (input: any) => Promise<any>;
  readonly limiter?: any;
  readonly timeoutMs?: number;
} = {}): RouteDependencies => ({
  getCustomerProfile: unreachable,
  getCustomerOrderStatus: unreachable,
  getCustomerCommercialSummary: unreachable,
  getCustomerPurchasedProducts: unreachable,
  getCustomerPurchaseBehavior: unreachable,
  getCustomerRfm: unreachable,
  getCustomerRfmByCustomerId: unreachable,
  getCustomerCluster: unreachable,
  getClusterSnapshotSummary: unreachable,
  getRfmClusterCrossTab: unreachable,
  getDashboardContext: unreachable,
  getDashboardOverview: unreachable,
  getDashboardRfm: unreachable,
  getDashboardClusters: unreachable,
  getDashboardIntersection: unreachable,
  checkReadiness: async () => ({ crm: false, prestashop: { status: 'ready' } }),
  customerIntelligenceAudienceExportAuth: {
    enabled: true,
    internalToken: 'audience-export-token-123456',
    piiToken: 'audience-pii-token-123456',
    timeoutMs: options.timeoutMs ?? 5_000,
  },
  customerIntelligenceAudienceMembership: options.resolveMembership ?? (async () => membership()),
  customerIntelligenceAudienceExport: options.exportArtifact ?? (async (input) => buildAudienceExportArtifact({
    membership: input.membership,
    fields: input.fields,
    format: input.format,
    contacts: [
      { customerId: 7, email: 'ana@example.com', firstname: 'Ana', lastname: 'Pérez' },
      { customerId: 8, email: 'ben@example.com', firstname: 'Ben', lastname: 'Soto' },
    ].filter((contact) => input.membership.members.some((member: { readonly customerId: number }) => member.customerId === contact.customerId)),
    generatedAt: '2026-09-10T12:34:56.000Z',
  })),
  customerIntelligenceAudienceExportLimiter: options.limiter,
});

async function start(dependencies: RouteDependencies): Promise<string> {
  server = createServer(buildApp(dependencies));
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

function headers(options: { readonly pii?: boolean } = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-internal-customer-intelligence-export-token': 'audience-export-token-123456',
    ...(options.pii ? { 'x-internal-customer-intelligence-pii-export-token': 'audience-pii-token-123456' } : {}),
  };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

describe('Customer Intelligence Audience A04.5 download endpoint', () => {
  it('returns a binary CSV attachment with exact headers and row count', async () => {
    const baseUrl = await start(buildAppDeps());
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ definition: { valid: true }, format: 'CSV', fields: ['customerId'] }),
    });

    const body = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="audience-export-[A-Za-z0-9-]+\.csv"$/);
    expect(Number(response.headers.get('content-length'))).toBe(body.byteLength);
    expect(body.toString('utf8')).toBe('customerId\r\n7\r\n8\r\n');
    expect(() => JSON.parse(body.toString('utf8'))).toThrow();
  });

  it('returns an XLSX binary attachment and requires the separate PII permission', async () => {
    const baseUrl = await start(buildAppDeps());
    const forbidden = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'XLSX', fields: ['customerId', 'email'] }),
    });
    expect(forbidden.status).toBe(403);

    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, {
      method: 'POST', headers: headers({ pii: true }), body: JSON.stringify({ definition: {}, format: 'XLSX', fields: ['customerId', 'email', 'firstname', 'lastname'] }),
    });
    const body = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="audience-export-[A-Za-z0-9-]+\.xlsx"$/);
    expect(Number(response.headers.get('content-length'))).toBe(body.byteLength);
    expect(body.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('rejects unauthenticated, obsolete-format, and unsupported-field requests before membership', async () => {
    let calls = 0;
    const baseUrl = await start(buildAppDeps({ resolveMembership: async () => { calls += 1; return membership(); } }));
    const unauthenticated = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    const obsolete = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'GENERIC_CSV' }) });
    const unsupported = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV', fields: ['phone'] }) });
    expect(unauthenticated.status).toBe(401);
    expect(obsolete.status).toBe(400);
    expect(unsupported.status).toBe(400);
    expect(calls).toBe(0);
  });

  it('returns a header-only CSV for zero matched rows and all UNKNOWN membership', async () => {
    const baseUrl = await start(buildAppDeps({
      resolveMembership: async () => membership({
        counts: { population: 2, matched: 0, notMatched: 0, unknown: 2 },
        members: [],
      }),
    }));
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }),
    });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString('utf8')).toBe('customerId\r\n');
  });

  it('maps membership, hydration, size, and timeout failures and releases the limiter', async () => {
    const limiter = {
      tryAcquire: (() => {
        let active = 0;
        return () => {
          if (active > 0) return { accepted: false, reason: 'CONCURRENCY_LIMIT' } as const;
          active += 1;
          return { accepted: true, lease: { release: () => { active -= 1; } } } as const;
        };
      })(),
    };
    let fail = true;
    const baseUrl = await start(buildAppDeps({
      limiter,
      exportArtifact: async () => {
        if (fail) {
          fail = false;
          throw new AudienceExportError('CONTACT_HYDRATION_FAILED', 'test');
        }
        return buildAudienceExportArtifact({ membership: membership(), fields: ['customerId'], format: 'CSV', contacts: [] });
      },
    }));
    const first = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    const second = await fetch(`${baseUrl}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
  });

  it('maps typed budget failures, membership conflicts, writer failures, and execution timeout', async () => {
    const budget = await start(buildAppDeps({ exportArtifact: async () => { throw new AudienceExportError('EXPORT_ROW_LIMIT_EXCEEDED', 'test'); } }));
    const budgetResponse = await fetch(`${budget}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    expect(budgetResponse.status).toBe(413);
    expect((await budgetResponse.json()).error).toBe('EXPORT_ROW_LIMIT_EXCEEDED');
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = undefined;

    const conflict = await start(buildAppDeps({ resolveMembership: async () => ({ status: 'blocked', reason: 'INCOMPATIBLE_SNAPSHOT' }) }));
    const conflictResponse = await fetch(`${conflict}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    expect(conflictResponse.status).toBe(409);
    expect((await conflictResponse.json()).error).toBe('AUDIENCE_SNAPSHOT_CONFLICT');
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = undefined;

    const writer = await start(buildAppDeps({ exportArtifact: async () => { throw new Error('writer failed'); } }));
    const writerResponse = await fetch(`${writer}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    expect(writerResponse.status).toBe(500);
    expect((await writerResponse.json()).error).toBe('internal_error');
    await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
    server = undefined;

    const timeout = await start(buildAppDeps({
      timeoutMs: 10,
      exportArtifact: async () => new Promise((resolve) => setTimeout(() => resolve(buildAudienceExportArtifact({ membership: membership(), fields: ['customerId'], format: 'CSV', contacts: [] })), 50)),
    }));
    const timeoutResponse = await fetch(`${timeout}/v1/customer-intelligence/audiences/export`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: {}, format: 'CSV' }) });
    expect(timeoutResponse.status).toBe(504);
    expect((await timeoutResponse.json()).error).toBe('EXPORT_TIMEOUT');
  });
});

function buildAppDeps(options: Parameters<typeof deps>[0] = {}): RouteDependencies {
  return deps(options);
}
