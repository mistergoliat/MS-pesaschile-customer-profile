import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
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

async function startApp(
  getCustomerPurchasedProducts: GetCustomerPurchasedProducts,
  checkReadiness: ReadinessCheck = async () => ({ crm: { status: 'ready' }, prestashop: true }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts,
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
    await closeServer();
  }
  vi.restoreAllMocks();
});

const emptyAvailableResult: GetPurchasedProductsResult = {
  status: 'available',
  products: [],
  pagination: {
    limit: 20,
    offset: 0,
    returned: 0,
    hasMore: false,
  },
};

const availableResult: GetPurchasedProductsResult = {
  status: 'available',
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
  pagination: {
    limit: 20,
    offset: 0,
    returned: 1,
    hasMore: false,
  },
};

describe('GET /v1/customers/:masterCustomerId/purchased-products', () => {
  it('uses default pagination limit 20 offset 0 and returns the documented empty payload', async () => {
    let input: Parameters<GetCustomerPurchasedProducts>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return emptyAvailableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchased-products`);
    const body = (await response.json()) as GetPurchasedProductsResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ masterCustomerId: '1', limit: 20, offset: 0 });
    expect(body).toEqual(emptyAvailableResult);
  });

  it('accepts valid limit and offset query params and serializes products with decimal strings', async () => {
    let input: Parameters<GetCustomerPurchasedProducts>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return {
        ...availableResult,
        pagination: { limit: request.limit, offset: request.offset, returned: 1, hasMore: true },
      };
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=100&offset=10`);
    const body = (await response.json()) as GetPurchasedProductsResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ masterCustomerId: '1', limit: 100, offset: 10 });
    if (body.status !== 'available') throw new Error('expected available');
    expect(body.pagination).toEqual({ limit: 100, offset: 10, returned: 1, hasMore: true });
    expect(typeof body.products[0]?.totalSpentTaxIncl).toBe('string');
  });

  it('accepts limit 1 and rejects invalid limit values', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=1`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=0`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=101`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=-1`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=1.5`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=Infinity`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=NaN`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=`)).status).toBe(400);
    expect(called).toBe(true);
  });

  it('accepts offset 0 and rejects invalid offset values', async () => {
    const baseUrl = await startApp(async () => emptyAvailableResult);

    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=0`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=-1`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=1.5`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=Infinity`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=NaN`)).status).toBe(400);
    expect(
      (await fetch(`${baseUrl}/v1/customers/1/purchased-products?offset=${Number.MAX_SAFE_INTEGER + 1}`)).status,
    ).toBe(400);
  });

  it('rejects invalid masterCustomerId, unknown params, duplicate params and JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/a@b.com/purchased-products`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?sort=lastPurchasedAt`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?category=bars`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/purchased-products?limit=20&limit=30`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/purchased-products`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 404 for customer_not_found and customer_not_linked', async () => {
    const notFoundBaseUrl = await startApp(async () => ({ status: 'customer_not_found' }));
    expect((await fetch(`${notFoundBaseUrl}/v1/customers/999/purchased-products`)).status).toBe(404);

    await closeServer();

    const notLinkedBaseUrl = await startApp(async () => ({ status: 'customer_not_linked' }));
    expect((await fetch(`${notLinkedBaseUrl}/v1/customers/1/purchased-products`)).status).toBe(404);
  });

  it('returns 503 for degraded timeout and unavailable', async () => {
    const timeoutBaseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_timeout' }));
    expect((await fetch(`${timeoutBaseUrl}/v1/customers/1/purchased-products`)).status).toBe(503);

    await closeServer();

    const unavailableBaseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_unavailable' }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/purchased-products`)).status).toBe(503);
  });

  it('returns 500 with no stack trace or internals when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchased-products`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs success without customer ids, product ids, names, references, amounts, dates or quantities', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => ({
      ...availableResult,
      products: [
        availableResult.status === 'available'
          ? {
              ...availableResult.products[0]!,
              productId: 123,
              productName: 'Secret product name',
              productReference: 'SECRETREF',
              totalQuantityPurchased: 77,
              totalSpentTaxIncl: '999999.123456',
            }
          : neverProduct(),
      ],
    }));

    await fetch(`${baseUrl}/v1/customers/1/purchased-products`);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('Secret product name');
    expect(serialized).not.toContain('SECRETREF');
    expect(serialized).not.toContain('999999.123456');
    expect(serialized).not.toContain('2026-01-02');
    expect(loggedArgs[0]).not.toHaveProperty('masterCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('prestashopCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('productId');
    expect(loggedArgs[0]).toMatchObject({
      status: 'available',
      returnedBucket: 'one',
      hasMore: false,
      degradedReason: null,
      lookupOutcome: 'available',
    });
  });
});

function neverProduct(): never {
  throw new Error('expected available result');
}

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
