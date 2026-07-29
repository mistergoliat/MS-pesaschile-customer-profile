import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import type { GetCustomerCommercialSummaryResult } from '../../src/domain/customer-commercial-summary/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the commercial summary route tests');
};

const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the commercial summary route tests');
};

async function startApp(
  getCustomerCommercialSummary: GetCustomerCommercialSummary,
  checkReadiness: ReadinessCheck = async () => ({ crm: { status: 'ready' }, prestashop: true }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary,
    checkReadiness,
  });
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

const emptyAvailableResult: GetCustomerCommercialSummaryResult = {
  status: 'available',
  summary: {
    totalOrders: 0,
    totalSpentTaxIncl: '0.000000',
    averageOrderValueTaxIncl: '0.000000',
    firstOrderAt: null,
    lastOrderAt: null,
    daysSinceLastOrder: null,
    purchaseFrequencyDays: null,
    totalUnitsPurchased: 0,
    distinctProductsPurchased: 0,
    cancelledOrderCount: 0,
    refundedOrderCount: 0,
    currencyIsoCode: 'CLP',
  },
};

describe('GET /v1/customers/:masterCustomerId/commercial-summary', () => {
  it('returns 200 with the documented available shape and decimal strings', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'available',
      summary: {
        ...emptyAvailableResult.summary,
        totalOrders: 2,
        totalSpentTaxIncl: '142177.121231',
        averageOrderValueTaxIncl: '71088.560616',
        firstOrderAt: '2026-01-02T10:00:00.000Z',
        lastOrderAt: '2026-01-05T10:00:00.000Z',
        daysSinceLastOrder: 205,
        purchaseFrequencyDays: 3,
        totalUnitsPurchased: 5,
        distinctProductsPurchased: 3,
      },
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as GetCustomerCommercialSummaryResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe('available');
    if (body.status !== 'available') throw new Error('expected available');
    expect(body.summary.totalSpentTaxIncl).toBe('142177.121231');
    expect(typeof body.summary.totalSpentTaxIncl).toBe('string');
    expect(body.summary.averageOrderValueTaxIncl).toBe('71088.560616');
    expect(body.summary.firstOrderAt).toBe('2026-01-02T10:00:00.000Z');
  });

  it('serializes the empty summary with JSON null fields', async () => {
    const baseUrl = await startApp(async () => emptyAvailableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as GetCustomerCommercialSummaryResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(emptyAvailableResult);
  });

  it('returns 404 for customer_not_found and customer_not_linked', async () => {
    const notFoundBaseUrl = await startApp(async () => ({ status: 'customer_not_found' }));
    expect((await fetch(`${notFoundBaseUrl}/v1/customers/999/commercial-summary`)).status).toBe(404);

    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;

    const notLinkedBaseUrl = await startApp(async () => ({ status: 'customer_not_linked' }));
    expect((await fetch(`${notLinkedBaseUrl}/v1/customers/1/commercial-summary`)).status).toBe(404);
  });

  it('returns 503 for degraded PrestaShop timeout or unavailable', async () => {
    const baseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_timeout' }));

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);

    expect(response.status).toBe(503);

    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;

    const unavailableBaseUrl = await startApp(async () => ({
      status: 'degraded',
      reason: 'prestashop_unavailable',
    }));

    const unavailableResponse = await fetch(`${unavailableBaseUrl}/v1/customers/1/commercial-summary`);

    expect(unavailableResponse.status).toBe(503);
  });

  it('returns 400 for invalid masterCustomerId, query params or JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return emptyAvailableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/a@b.com/commercial-summary`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/commercial-summary?currency=USD`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/commercial-summary`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no stack trace or internals when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs success without customer ids, money, dates, units, product counts, cancellation or refund counts', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => ({
      status: 'available',
      summary: {
        totalOrders: 2,
        totalSpentTaxIncl: '999999.123456',
        averageOrderValueTaxIncl: '499999.561728',
        firstOrderAt: '2026-01-02T10:00:00.000Z',
        lastOrderAt: '2026-01-05T10:00:00.000Z',
        daysSinceLastOrder: 205,
        purchaseFrequencyDays: 3,
        totalUnitsPurchased: 77,
        distinctProductsPurchased: 12,
        cancelledOrderCount: 5,
        refundedOrderCount: 4,
        currencyIsoCode: 'CLP',
      },
    }));

    await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('999999.123456');
    expect(serialized).not.toContain('2026-01-02');
    expect(loggedArgs[0]).not.toHaveProperty('masterCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('prestashopCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('totalUnitsPurchased');
    expect(loggedArgs[0]).not.toHaveProperty('distinctProductsPurchased');
    expect(loggedArgs[0]).not.toHaveProperty('cancelledOrderCount');
    expect(loggedArgs[0]).not.toHaveProperty('refundedOrderCount');
    expect(loggedArgs[0]).toMatchObject({
      status: 'available',
      totalOrdersBucket: 'multiple',
      hasCommercialHistory: true,
      degradedReason: null,
      lookupOutcome: 'available',
    });
  });
});

async function rawGetWithJsonBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ from: '2026-01-01' });
    const request = httpRequest(
      url,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}
