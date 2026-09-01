import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';

const profileService = {
  getByCustomerId: async ({ customerId }: { customerId: number }) => ({
    status: 'available' as const,
    customerId,
    contractVersion: 'customer-commercial-profile-v1' as const,
    profile: {
      customerId,
      identityAuthority: 'prestashop_customer' as const,
      rfm: null,
      behavioralCluster: null,
      clv: { expectedRevenueTaxIncl: '123456789012345678.123456', horizonMonths: 12, currencyIsoCode: 'CLP', estimateSupportLevel: 'SPARSE' as const },
      commercialAffinity: null,
      availability: { rfm: 'NOT_IN_POPULATION' as const, behavioralCluster: 'UNAVAILABLE' as const, clv: 'AVAILABLE' as const, commercialAffinity: 'UNAVAILABLE' as const },
      provenance: { generatedAt: '2026-08-04T00:00:00.000Z', oldestReferenceTime: '2026-08-03T00:00:00.000Z', newestReferenceTime: '2026-08-03T00:00:00.000Z', rfm: null, behavioralCluster: null, clv: { snapshotId: 'clv-1', referenceTime: '2026-08-03T00:00:00.000Z', modelVersion: 'customer-clv-two-stage-cohort-v1' }, commercialAffinity: null },
    },
  }),
  getByCustomerIds: async () => [],
};

async function startApp(): Promise<{ baseUrl: string; server: Server }> {
  const app = buildApp({ customerCommercialProfileService: profileService } as unknown as RouteDependencies);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

describe('GET /v1/customers/:customerId/commercial-profile', () => {
  it('returns the versioned bounded profile and validates the customer id', async () => {
    const { baseUrl, server } = await startApp();
    try {
      const response = await fetch(`${baseUrl}/v1/customers/42/commercial-profile`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ contractVersion: 'customer-commercial-profile-v1', customerId: 42, profile: { commercialAffinity: null, clv: { expectedRevenueTaxIncl: '123456789012345678.123456' } } });
      expect((await fetch(`${baseUrl}/v1/customers/not-a-number/commercial-profile`)).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/customers/42/commercial-profile?foo=bar`)).status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
