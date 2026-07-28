import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import type { CustomerProfileLookupResult } from '../../src/domain/customer-profile/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

// Uses Node's built-in http server + global fetch instead of adding an HTTP test
// dependency — the repo already has everything this needs.
let server: Server | undefined;

async function startApp(
  getCustomerProfile: GetCustomerProfile,
  checkReadiness: ReadinessCheck = async () => ({ crm: { status: 'ready' }, prestashop: true }),
): Promise<string> {
  const app = buildApp({ getCustomerProfile, checkReadiness });
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  vi.restoreAllMocks();
});

const availableResult: CustomerProfileLookupResult = {
  status: 'available',
  masterCustomerId: '1',
  linkStatus: 'linked',
  prestashopCustomerId: 555,
  profile: {
    masterCustomerId: '1',
    generatedAt: '2026-07-27T00:00:00.000Z',
    customer: { firstname: 'Ana', lastname: 'Perez', email: 'ana@example.com', rut: null, platformOrigin: 'prestashop' },
    prestashop: { customerId: 555, active: true, shopId: 1, createdAt: null, updatedAt: null },
    recentOrders: [
      {
        orderId: 100,
        reference: 'REF100',
        currentStateId: 4,
        valid: true,
        createdAt: '2026-01-01 10:00:00',
        updatedAt: '2026-01-02 10:00:00',
        totalPaidTaxIncl: '10000.000000',
        totalProductsTaxIncl: '9500.000000',
        currencyId: 1,
      },
    ],
    warnings: [],
  },
  warnings: [],
};

describe('GET /v1/customers/:masterCustomerId/profile', () => {
  it('returns 200 for available', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as CustomerProfileLookupResult;
    expect(body.status).toBe('available');
  });

  it('includes recentOrders with currentStateId/valid as raw facts and amounts as strings, and no undocumented fields', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as { profile: { recentOrders: unknown[] } };

    expect(body.profile.recentOrders).toEqual([
      {
        orderId: 100,
        reference: 'REF100',
        currentStateId: 4,
        valid: true,
        createdAt: '2026-01-01 10:00:00',
        updatedAt: '2026-01-02 10:00:00',
        totalPaidTaxIncl: '10000.000000',
        totalProductsTaxIncl: '9500.000000',
        currencyId: 1,
      },
    ]);
    const order = body.profile.recentOrders[0] as Record<string, unknown>;
    expect(typeof order.totalPaidTaxIncl).toBe('string');
    expect(typeof order.totalProductsTaxIncl).toBe('string');
    expect(order).not.toHaveProperty('customerId');
    expect(order).not.toHaveProperty('isPaid');
  });

  it('returns 200 for available with recentOrders = [] (an empty list is not an error)', async () => {
    const baseUrl = await startApp(async () => ({
      ...availableResult,
      profile: { ...availableResult.profile!, recentOrders: [] },
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as { profile: { recentOrders: unknown[] } };

    expect(response.status).toBe(200);
    expect(body.profile.recentOrders).toEqual([]);
  });

  it('returns 200 for partial', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'partial',
      masterCustomerId: '1',
      linkStatus: 'not_linked',
      prestashopCustomerId: null,
      profile: null,
      warnings: [],
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);

    expect(response.status).toBe(200);
  });

  it('returns 404 for not_found', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'not_found',
      masterCustomerId: '999',
      profile: null,
      warnings: [],
    }));

    const response = await fetch(`${baseUrl}/v1/customers/999/profile`);

    expect(response.status).toBe(404);
  });

  it('returns 503 for degraded / prestashop_unavailable', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      reason: 'prestashop_unavailable',
      masterCustomerId: '1',
      linkStatus: 'linked',
      prestashopCustomerId: 555,
      profile: null,
      warnings: [],
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);

    expect(response.status).toBe(503);
  });

  it('returns 500 for degraded / profile_build_failed (deterministic internal failure)', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      reason: 'profile_build_failed',
      masterCustomerId: '1',
      linkStatus: 'linked',
      prestashopCustomerId: 555,
      profile: null,
      warnings: [],
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);

    expect(response.status).toBe(500);
  });

  it('returns 400 for a non-numeric masterCustomerId, without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/not-a-valid-id/profile`);

    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no stack trace or internals when the use case throws (e.g. CRM down)', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('CRM connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs only a safe classification for a thrown error, never the original message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => {
      throw new Error('connect ECONNREFUSED secret-internal-host:3306 user=admin');
    });

    await fetch(`${baseUrl}/v1/customers/1/profile`);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('secret-internal-host');
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(loggedArgs[0]).toMatchObject({
      event: 'customer_profile_request_failed',
      masterCustomerId: '1',
      errorType: 'unexpected_error',
    });
  });
});

describe('GET /health/ready', () => {
  it('is not_ready (503) when CRM is down, even if PrestaShop is up', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: { status: 'not_ready', reason: 'crm_unavailable' },
      prestashop: true,
    }));

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'not_ready', reason: 'crm_unavailable' });
  });

  it('is not_ready (503) with reason crm_schema_incompatible when the CRM schema is missing the link column', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: { status: 'not_ready', reason: 'crm_schema_incompatible' },
      prestashop: true,
    }));

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'not_ready', reason: 'crm_schema_incompatible' });
  });

  it('is ready_degraded (200) when CRM is up but PrestaShop is down', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: { status: 'ready' },
      prestashop: false,
    }));

    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe('ready_degraded');
  });

  it('is ready (200) when both CRM and PrestaShop are up', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: { status: 'ready' },
      prestashop: true,
    }));

    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toBe('ready');
  });
});
