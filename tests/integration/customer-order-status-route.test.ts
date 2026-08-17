import { createServer, type Server } from 'node:http';
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
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the order status route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the order status route tests');
};

async function startApp(
  getCustomerOrderStatus: GetCustomerOrderStatus,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
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
      { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'order_status' },
    ],
    generatedAt: '2026-08-05T00:00:00.000Z',
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

const availableResult: GetCustomerOrderStatusResult = {
  status: 'available',
  customerId: 1,
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
  provenance: provenance(1),
  warnings: [],
};

describe('GET /v1/customers/:customerId/orders/:reference/status', () => {
  it('returns 200 with the documented shape for available', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);
    const body = (await response.json()) as GetCustomerOrderStatusResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(availableResult);
  });

  it('serializes currentStateName: null as JSON null, not omitted', async () => {
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

  it('returns 404 for order_not_found and customer_not_found', async () => {
    const missingOrderBaseUrl = await startApp(async () => ({ status: 'order_not_found', customerId: 1 }));
    expect((await fetch(`${missingOrderBaseUrl}/v1/customers/1/orders/NOPE1234/status`)).status).toBe(404);

    await closeServer();

    const missingCustomerBaseUrl = await startApp(async () => ({ status: 'customer_not_found', customerId: 999 }));
    expect((await fetch(`${missingCustomerBaseUrl}/v1/customers/999/orders/ABC123XYZ/status`)).status).toBe(404);
  });

  it('returns 503 for degraded unavailable or schema incompatible', async () => {
    const unavailableBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/orders/ABC123XYZ/status`)).status).toBe(503);

    await closeServer();

    const incompatibleBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    }));
    expect((await fetch(`${incompatibleBaseUrl}/v1/customers/1/orders/ABC123XYZ/status`)).status).toBe(503);
  });

  it('returns 400 invalid_customer_id or invalid_order_reference without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/not-a-valid-id/orders/ABC123XYZ/status`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/0/orders/ABC123XYZ/status`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/orders/${'A'.repeat(40)}/status`)).status).toBe(400);
    const invalidReference = await fetch(
      `${baseUrl}/v1/customers/1/orders/${encodeURIComponent("A'; DROP TABLE ps_orders;")}/status`,
    );
    expect(invalidReference.status).toBe(400);
    expect(await invalidReference.json()).toEqual({ error: 'invalid_order_reference' });
    expect(called).toBe(false);
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

  it('logs on success without reference, orderId or raw state text, but with safe identity metadata', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/1/orders/ABC123XYZ/status`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('ABC123XYZ');
    expect(serialized).not.toContain('Entregado a Transportista');
    expect(loggedArgs[0]).toMatchObject({
      customerId: 1,
      endpoint: 'order-status',
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      status: 'available',
      deliveryMethod: 'direct_dispatch',
      currentStateResolved: true,
    });
  });
});

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}
