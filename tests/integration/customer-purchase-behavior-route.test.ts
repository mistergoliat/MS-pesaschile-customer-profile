import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import type { GetCustomerPurchaseBehaviorResult } from '../../src/domain/customer-purchase-behavior/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the purchase behavior route tests');
};

const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the purchase behavior route tests');
};

const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the purchase behavior route tests');
};

const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the purchase behavior route tests');
};

async function startApp(
  getCustomerPurchaseBehavior: GetCustomerPurchaseBehavior,
  checkReadiness: ReadinessCheck = async () => ({ crm: { status: 'ready' }, prestashop: true }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior,
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

const emptyAvailableResult: GetCustomerPurchaseBehaviorResult = {
  status: 'available',
  currencyIsoCode: 'CLP',
  calculatedAt: '2026-01-10T00:00:00.000Z',
  summary: {
    validOrderCount: 0,
    distinctProductCount: 0,
    distinctVariantCount: 0,
    repeatedProductCount: 0,
    repeatedVariantCount: 0,
    repeatProductRate: '0.000000',
    repeatVariantRate: '0.000000',
    repeatedVariantSpendShare: '0.000000',
    productSpendConcentration: emptyConcentration(),
    variantSpendConcentration: emptyConcentration(),
  },
  topProducts: [],
  topVariants: [],
};

const availableResult: GetCustomerPurchaseBehaviorResult = {
  ...emptyAvailableResult,
  summary: {
    ...emptyAvailableResult.summary,
    validOrderCount: 2,
    distinctProductCount: 1,
    distinctVariantCount: 1,
    repeatedProductCount: 1,
    repeatedVariantCount: 1,
    repeatProductRate: '1.000000',
    repeatVariantRate: '1.000000',
    repeatedVariantSpendShare: '1.000000',
    productSpendConcentration: {
      top1Share: '1.000000',
      top3Share: '1.000000',
      hhi: '1.000000',
      effectiveDiversity: '1.000000',
    },
    variantSpendConcentration: {
      top1Share: '1.000000',
      top3Share: '1.000000',
      hhi: '1.000000',
      effectiveDiversity: '1.000000',
    },
  },
  topProducts: [
    {
      productId: 123,
      latestObservedProductName: 'Secret product',
      latestObservedProductReference: 'SECRETREF',
      variantCountPurchased: 1,
      repeatedVariantCount: 1,
      orderCount: 2,
      totalQuantityPurchased: 5,
      totalSpentTaxIncl: '99990.123456',
      spendShare: '1.000000',
      orderShare: '1.000000',
      quantityShare: '1.000000',
      firstPurchasedAt: '2026-01-01T00:00:00.000Z',
      lastPurchasedAt: '2026-01-05T00:00:00.000Z',
      daysSinceLastPurchase: 5,
      isRepeated: true,
    },
  ],
  topVariants: [
    {
      productId: 123,
      productAttributeId: 0,
      productName: 'Secret product',
      productReference: 'SECRETREF',
      orderCount: 2,
      totalQuantityPurchased: 5,
      totalSpentTaxIncl: '99990.123456',
      spendShare: '1.000000',
      orderShare: '1.000000',
      quantityShare: '1.000000',
      firstPurchasedAt: '2026-01-01T00:00:00.000Z',
      lastPurchasedAt: '2026-01-05T00:00:00.000Z',
      daysSinceLastPurchase: 5,
      isRepeated: true,
    },
  ],
};

describe('GET /v1/customers/:masterCustomerId/purchase-behavior', () => {
  it('uses default topProducts/topVariants 10 and returns an empty behavior payload', async () => {
    let input: Parameters<GetCustomerPurchaseBehavior>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return emptyAvailableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchase-behavior`);
    const body = (await response.json()) as GetCustomerPurchaseBehaviorResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ masterCustomerId: '1', topProducts: 10, topVariants: 10 });
    expect(body).toEqual(emptyAvailableResult);
  });

  it('accepts topProducts/topVariants in range 1..10 and serializes decimal strings', async () => {
    let input: Parameters<GetCustomerPurchaseBehavior>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return availableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchase-behavior?topProducts=1&topVariants=10`);
    const body = (await response.json()) as GetCustomerPurchaseBehaviorResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ masterCustomerId: '1', topProducts: 1, topVariants: 10 });
    if (body.status !== 'available') throw new Error('expected available');
    expect(typeof body.topProducts[0]?.spendShare).toBe('string');
    expect(body).not.toHaveProperty('masterCustomerId');
  });

  it('rejects invalid query params without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    const invalidQueries = [
      'topProducts=0',
      'topProducts=-1',
      'topProducts=1.5',
      'topProducts=',
      'topProducts=NaN',
      'topProducts=Infinity',
      'topProducts=11',
      'topProducts=1&topProducts=2',
      'topVariants=0',
      'topVariants=-1',
      'topVariants=1.5',
      'topVariants=',
      'topVariants=NaN',
      'topVariants=Infinity',
      'topVariants=11',
      'limit=10',
      'offset=0',
      'sort=spent',
      'category=2',
      'brand=HWM',
      'dateFrom=2026-01-01',
      'dateTo=2026-01-10',
      'productId=123',
      'email=a@example.com',
      'prestashopCustomerId=555',
    ];

    for (const query of invalidQueries) {
      expect((await fetch(`${baseUrl}/v1/customers/1/purchase-behavior?${query}`)).status, query).toBe(400);
    }
    expect((await fetch(`${baseUrl}/v1/customers/email@example.com/purchase-behavior`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/purchase-behavior`)).toBe(400);
    expect(called).toBe(false);
  });

  it('maps result statuses to HTTP status codes', async () => {
    const notFoundBaseUrl = await startApp(async () => ({ status: 'customer_not_found' }));
    expect((await fetch(`${notFoundBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(404);
    await closeServer();

    const notLinkedBaseUrl = await startApp(async () => ({ status: 'customer_not_linked' }));
    expect((await fetch(`${notLinkedBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(404);
    await closeServer();

    const timeoutBaseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_timeout' }));
    expect((await fetch(`${timeoutBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(503);
    await closeServer();

    const unavailableBaseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_unavailable' }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(503);
  });

  it('returns 500 sanitized when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchase-behavior`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs only allowed aggregate fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/1/purchase-behavior`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('Secret product');
    expect(serialized).not.toContain('SECRETREF');
    expect(serialized).not.toContain('99990.123456');
    expect(serialized).not.toContain('2026-01-');
    expect(loggedArgs[0]).not.toHaveProperty('masterCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('prestashopCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('productId');
    expect(loggedArgs[0]).toMatchObject({
      status: 'available',
      distinctProductBucket: 'one',
      hasRepeatedProducts: true,
      concentrationAvailable: true,
      degradedReason: null,
      lookupOutcome: 'available',
    });
  });
});

function emptyConcentration() {
  return {
    top1Share: '0.000000',
    top3Share: '0.000000',
    hhi: '0.000000',
    effectiveDiversity: '0.000000',
  };
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

