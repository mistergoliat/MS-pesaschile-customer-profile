import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerRfm } from '../../src/application/customer-rfm/get-customer-rfm.js';
import type { GetCustomerRfmByCustomerId } from '../../src/application/customer-rfm/get-customer-rfm-by-customer-id.js';
import type { GetCustomerCluster } from '../../src/application/customer-clustering/get-customer-cluster.js';
import type { GetClusterSnapshotSummary } from '../../src/application/customer-clustering/get-cluster-snapshot-summary.js';
import type { GetRfmClusterCrossTab } from '../../src/application/customer-clustering/get-rfm-cluster-cross-tab.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerDataProvenance } from '../../src/domain/customer-identity/index.js';
import type { CustomerProfileLookupResult } from '../../src/domain/customer-profile/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the customer profile route tests');
};

const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the customer profile route tests');
};

const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the customer profile route tests');
};

const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the customer profile route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the customer profile route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the customer profile route tests');
};

const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the customer profile route tests');
};

const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the customer profile route tests');
};

const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the customer profile route tests');
};

async function startApp(
  getCustomerProfile: GetCustomerProfile,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    getCustomerCluster: unreachableGetCustomerCluster,
    getClusterSnapshotSummary: unreachableGetClusterSnapshotSummary,
    getRfmClusterCrossTab: unreachableGetRfmClusterCrossTab,
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
      { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_profile' },
      { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'recent_orders' },
    ],
    generatedAt: '2026-08-05T00:00:00.000Z',
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

const availableResult: CustomerProfileLookupResult = {
  status: 'available',
  customerId: 1,
  profile: {
    customerId: 1,
    generatedAt: '2026-08-05T00:00:00.000Z',
    customer: { firstname: 'Ana', lastname: 'Perez', email: 'ana@example.com', rut: null, platformOrigin: 'prestashop' },
    prestashop: { customerId: 1, active: true, shopId: 1, createdAt: null, updatedAt: null },
    recentOrders: [
      {
        orderId: 100,
        reference: 'REF100',
        currentStateId: 4,
        currentState: { stateId: 4, name: 'Enviado', resolution: 'resolved' },
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
  provenance: provenance(1),
  warnings: [],
};

describe('GET /v1/customers/:customerId/profile', () => {
  it('returns 200 for available and includes provenance', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as CustomerProfileLookupResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe('available');
    if (body.status !== 'available') throw new Error('expected available');
    expect(body.customerId).toBe(1);
    expect(body.provenance.contractVersion).toBe(CUSTOMER_PROFILE_CONTRACT_VERSION);
  });

  it('includes recentOrders with currentStateId/valid as raw facts and amounts as strings', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as { profile: { recentOrders: unknown[] } };

    expect(body.profile.recentOrders).toEqual([availableResult.status === 'available' ? availableResult.profile.recentOrders[0] : null]);
    const order = body.profile.recentOrders[0] as Record<string, unknown>;
    expect(typeof order.totalPaidTaxIncl).toBe('string');
    expect(typeof order.totalProductsTaxIncl).toBe('string');
    expect(order).not.toHaveProperty('isPaid');
  });

  it('returns 404 for not_found', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'not_found',
      customerId: 999,
      profile: null,
      warnings: [],
    }));

    const response = await fetch(`${baseUrl}/v1/customers/999/profile`);

    expect(response.status).toBe(404);
  });

  it('returns 503 for degraded states', async () => {
    const unavailableBaseUrl = await startApp(async () => ({
      status: 'degraded',
      reason: 'prestashop_unavailable',
      customerId: 1,
      profile: null,
      warnings: [],
    }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/profile`)).status).toBe(503);

    await closeServer();

    const incompatibleBaseUrl = await startApp(async () => ({
      status: 'degraded',
      reason: 'prestashop_schema_incompatible',
      customerId: 1,
      profile: null,
      warnings: [],
    }));
    expect((await fetch(`${incompatibleBaseUrl}/v1/customers/1/profile`)).status).toBe(503);
  });

  it('returns 400 for a non-numeric or zero customerId, without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/not-a-valid-id/profile`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/0/profile`)).status).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no stack trace or internals when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/profile`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs only safe aggregate fields on success', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/1/profile`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('REF100');
    expect(loggedArgs[0]).toMatchObject({
      customerId: 1,
      endpoint: 'profile',
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      status: 'available',
      recentOrderCount: 1,
      unknownOrderStateCount: 0,
    });
  });
});

describe('GET /health/ready', () => {
  it('is not_ready (503) when PrestaShop is unavailable', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: false,
      prestashop: { status: 'not_ready', reason: 'prestashop_unavailable' },
    }));

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: 'not_ready',
      reason: 'prestashop_unavailable',
      prestashop: false,
      crm: false,
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
    });
  });

  it('is not_ready (503) when the PrestaShop schema is incompatible', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: false,
      prestashop: { status: 'not_ready', reason: 'prestashop_schema_incompatible' },
    }));

    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(503);
  });

  it('is ready (200) when PrestaShop is up, even if CRM is false', async () => {
    const baseUrl = await startApp(async () => availableResult, async () => ({
      crm: false,
      prestashop: { status: 'ready' },
    }));

    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ready',
      prestashop: true,
      crm: false,
      customerIdentitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
    });
  });
});

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}
