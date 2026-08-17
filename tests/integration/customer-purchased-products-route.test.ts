import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerRfm } from '../../src/application/customer-rfm/get-customer-rfm.js';
import type { GetCustomerRfmByCustomerId } from '../../src/application/customer-rfm/get-customer-rfm-by-customer-id.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerDataProvenance } from '../../src/domain/customer-identity/index.js';
import type { GetPurchasedProductsResult } from '../../src/domain/customer-purchased-products/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the purchased products route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the purchased products route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the purchased products route tests');
};
const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the purchased products route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the purchased products route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the purchased products route tests');
};

async function startApp(
  getCustomerPurchasedProducts: GetCustomerPurchasedProducts,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    checkReadiness,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await closeServer();
  }
  vi.restoreAllMocks();
});

function provenance(customerId: number): CustomerDataProvenance {
  return {
    customerIdentity: {
      customerId,
      source: 'PRESTASHOP',
      externalCustomerId: String(customerId),
      status: 'DIRECT_SOURCE',
    },
    dataSources: [
      { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
      { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'purchased_products' },
      { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'purchased_products' },
    ],
    generatedAt: '2026-08-05T00:00:00.000Z',
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

const emptyAvailableResult: GetPurchasedProductsResult = {
  status: 'available',
  customerId: 1,
  products: [],
  pagination: { limit: 20, offset: 0, returned: 0, hasMore: false },
  provenance: provenance(1),
};

const availableResult: GetPurchasedProductsResult = {
  status: 'available',
  customerId: 1,
  products: [
    {
      productId: 123,
      productAttributeId: 0,
      productName: 'Disco olimpico 20kg',
      productReference: 'DISC20',
      totalQuantityPurchased: 5,
      orderCount: 2,
      firstPurchasedAt: '2026-01-02T10:00:00.000Z',
      lastPurchasedAt: '2026-01-05T12:30:00.000Z',
      totalSpentTaxIncl: '99990.123456',
      catalogStatus: 'linked',
    },
  ],
  pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
  provenance: provenance(1),
};

describe('GET /v1/customers/:customerId/purchased-products', () => {
  it('uses default pagination and returns the documented empty payload', async () => {
    let input: Parameters<GetCustomerPurchasedProducts>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return emptyAvailableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchased-products`);
    const body = (await response.json()) as GetPurchasedProductsResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ customerId: 1, limit: 20, offset: 0 });
    expect(body).toEqual(emptyAvailableResult);
  });

  it('accepts valid limit and offset query params', async () => {
    let input: Parameters<GetCustomerPurchasedProducts>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return { ...availableResult, pagination: { ...availableResult.pagination, limit: request.limit, offset: request.offset, hasMore: true } };
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=100&offset=10`);
    const body = (await response.json()) as GetPurchasedProductsResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ customerId: 1, limit: 100, offset: 10 });
    if (body.status !== 'available') throw new Error('expected available');
    expect(body.pagination).toEqual({ limit: 100, offset: 10, returned: 1, hasMore: true });
  });

  it('rejects invalid customerId, query params and JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/a@b.com/purchased-products`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/0/purchased-products`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?sort=lastPurchasedAt`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=20&limit=30`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/purchased-products`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 404 for customer_not_found and 503 for degraded states', async () => {
    const notFoundBaseUrl = await startApp(async () => ({ status: 'customer_not_found', customerId: 999 }));
    expect((await fetch(`${notFoundBaseUrl}/v1/customers/999/purchased-products`)).status).toBe(404);

    await closeServer();

    const unavailableBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/purchased-products`)).status).toBe(503);

    await closeServer();

    const incompatibleBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    }));
    expect((await fetch(`${incompatibleBaseUrl}/v1/customers/1/purchased-products`)).status).toBe(503);
  });

  it('logs only safe aggregate fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/1/purchased-products`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('DISC20');
    expect(serialized).not.toContain('99990.123456');
    expect(loggedArgs[0]).toMatchObject({
      customerId: 1,
      endpoint: 'purchased-products',
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      status: 'available',
      returnedBucket: 'one',
      hasMore: false,
    });
  });
});

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

async function rawGetWithJsonBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ prestashopCustomerId: 555 });
    const request = httpRequest(
      url,
      {
        method: 'GET',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
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
