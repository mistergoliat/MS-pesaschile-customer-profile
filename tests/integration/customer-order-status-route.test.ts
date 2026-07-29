import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import type { GetCustomerOrderStatusResult } from '../../src/domain/customer-order-status/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the order status route tests');
};

const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the order status route tests');
};

const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the order status route tests');
};

const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the order status route tests');
};

async function startApp(
  getCustomerOrderStatus: GetCustomerOrderStatus,
  checkReadiness: ReadinessCheck = async () => ({ crm: { status: 'ready' }, prestashop: true }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
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

const availableResult: GetCustomerOrderStatusResult = {
  status: 'available',
  order: {
    orderId: 123,
    reference: 'ABC123XYZ',
    currentStateId: 4,
    currentStateName: 'Entregado a Transportista',
    deliveryMethod: 'direct_dispatch',
    deliveryEstimate: {
      status: 'applicable',
      minimumBusinessDays: 3,
      maximumBusinessDays: 5,
      startsFrom: 'dispatch',
    },
    lastRecordedUpdateAt: '2026-01-02T10:00:00.000Z',
    source: 'prestashop_current_state',
    isRealTimeTracking: false,
  },
  warnings: [],
};

describe('GET /v1/customers/:masterCustomerId/orders/:reference/status', () => {
  it('returns 200 with the documented shape for available', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);
    const body = (await response.json()) as GetCustomerOrderStatusResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(availableResult);
  });

  it('serializes currentStateName: null (order_state_label_missing) as JSON null, not omitted', async () => {
    const unresolvedResult: GetCustomerOrderStatusResult = {
      ...availableResult,
      order: { ...availableResult.order, currentStateName: null },
      warnings: ['order_state_label_missing'],
    };
    const baseUrl = await startApp(async () => unresolvedResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);
    const body = (await response.json()) as { order: { currentStateName: unknown } };

    expect(response.status).toBe(200);
    expect(body.order).toHaveProperty('currentStateName', null);
  });

  it('returns 404 for order_not_found (covers both a missing order and an order belonging to another customer)', async () => {
    const baseUrl = await startApp(async () => ({ status: 'order_not_found' }));

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/NOPE1234/status`);

    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'order_not_found' });
  });

  it('returns 404 for customer_not_found', async () => {
    const baseUrl = await startApp(async () => ({ status: 'customer_not_found' }));

    const response = await fetch(`${baseUrl}/v1/customers/999/orders/ABC123XYZ/status`);

    expect(response.status).toBe(404);
  });

  it('returns 404 for customer_not_linked', async () => {
    const baseUrl = await startApp(async () => ({ status: 'customer_not_linked' }));

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    expect(response.status).toBe(404);
  });

  it('returns 503 for degraded / prestashop_unavailable', async () => {
    const baseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_unavailable' }));

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    expect(response.status).toBe(503);
  });

  it('returns 503 for degraded / prestashop_timeout', async () => {
    const baseUrl = await startApp(async () => ({ status: 'degraded', reason: 'prestashop_timeout' }));

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    expect(response.status).toBe(503);
  });

  it('returns 400 invalid_master_customer_id for a non-numeric masterCustomerId, without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/not-a-valid-id/orders/ABC123XYZ/status`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'invalid_master_customer_id' });
    expect(called).toBe(false);
  });

  it('returns 400 invalid_reference for an empty-after-decoding or oversized reference, without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/${'A'.repeat(40)}/status`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'invalid_reference' });
    expect(called).toBe(false);
  });

  it('returns 400 invalid_reference for a reference with unsafe characters', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/${encodeURIComponent("A'; DROP TABLE ps_orders;")}/status`);

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'invalid_reference' });
  });

  it('does not accept an email as masterCustomerId', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/${encodeURIComponent('a@b.com')}/orders/ABC123XYZ/status`);

    expect(response.status).toBe(400);
  });

  it('returns 500 with no stack trace or internals when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs on success without masterCustomerId, reference, orderId, currentStateId, currentStateName or carrier fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('ABC123XYZ');
    expect(serialized).not.toContain('Entregado a Transportista');
    expect(serialized).not.toContain('123');
    expect(loggedArgs[0]).not.toHaveProperty('masterCustomerId');
    expect(loggedArgs[0]).not.toHaveProperty('reference');
    expect(loggedArgs[0]).not.toHaveProperty('orderId');
    expect(loggedArgs[0]).toMatchObject({
      status: 'available',
      deliveryMethod: 'direct_dispatch',
      currentStateResolved: true,
      carrierResolved: true,
      warningsCount: 0,
    });
  });

  it('logs a safe classification only on error, never masterCustomerId or the raw error message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => {
      throw new Error('connect ECONNREFUSED secret-internal-host:3306 user=admin');
    });

    await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('secret-internal-host');
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(loggedArgs[0]).not.toHaveProperty('masterCustomerId');
    expect(loggedArgs[0]).toMatchObject({ event: 'customer_order_status_request_failed' });
  });
});
