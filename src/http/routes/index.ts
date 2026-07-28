import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { GetCustomerProfile } from '../../application/customer-profile/get-customer-profile.js';
import type { CustomerProfileLookupResult } from '../../domain/customer-profile/index.js';
import type { CrmReadinessResult } from '../../infrastructure/crm/crm-pool.js';
import { classifyErrorForLog } from '../../observability/classify-error-for-log.js';

// master_customer.id is bigint(20) unsigned: unsigned-integer text only, bounded to a
// sane length. Never accepts an email — email-based lookup does not exist in this route.
const masterCustomerIdParams = z.object({
  masterCustomerId: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[0-9]+$/, 'masterCustomerId must be a numeric id'),
});

export type ReadinessResult = {
  readonly crm: CrmReadinessResult;
  readonly prestashop: boolean;
};

export type ReadinessCheck = () => Promise<ReadinessResult>;

export type RouteDependencies = {
  readonly getCustomerProfile: GetCustomerProfile;
  readonly checkReadiness: ReadinessCheck;
};

export function buildRoutes(deps: RouteDependencies): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  router.get('/health/ready', async (_request, response) => {
    const readiness = await deps.checkReadiness();
    // CRM down or schema-incompatible => master_customer cannot be verified at all => not
    // ready. PrestaShop down => partial responses are still possible => ready, degraded.
    if (readiness.crm.status !== 'ready') {
      response.status(503).json({
        status: 'not_ready',
        crm: false,
        prestashop: readiness.prestashop,
        reason: readiness.crm.reason,
      });
      return;
    }
    response.status(200).json({
      status: readiness.prestashop ? 'ready' : 'ready_degraded',
      crm: true,
      prestashop: readiness.prestashop,
    });
  });

  router.get(
    '/v1/customers/:masterCustomerId/profile',
    async (request: Request, response: Response) => {
      const parsedParams = masterCustomerIdParams.safeParse(request.params);
      if (!parsedParams.success) {
        response.status(400).json({ error: 'invalid_master_customer_id' });
        return;
      }

      const requestId = randomUUID();
      const startedAt = Date.now();

      try {
        const result = await deps.getCustomerProfile({
          masterCustomerId: parsedParams.data.masterCustomerId,
        });

        logLookup(requestId, parsedParams.data.masterCustomerId, result, Date.now() - startedAt);
        response.status(statusForResult(result)).json(result);
      } catch (error) {
        // Logged here (not in a generic Express error middleware) so requestId and
        // masterCustomerId are available — never error.message/stack, SQL, config or
        // secrets, only a safe classification. Response contract stays unchanged.
        console.error({
          event: 'customer_profile_request_failed',
          requestId,
          masterCustomerId: parsedParams.data.masterCustomerId,
          errorType: classifyErrorForLog(error),
        });
        response.status(500).json({ error: 'internal_error' });
      }
    },
  );

  return router;
}

function statusForResult(result: CustomerProfileLookupResult): number {
  switch (result.status) {
    case 'available':
    case 'partial':
      return 200;
    case 'not_found':
      return 404;
    case 'degraded':
      // profile_build_failed: a deterministic internal failure once both reads succeeded.
      // Every other reason is PrestaShop being a temporarily unavailable dependency.
      return result.reason === 'profile_build_failed' ? 500 : 503;
  }
}

// Structured, PII-free: no email, firstname, lastname, rut, address, order reference,
// order amounts or currentStateId ever logged here — recentOrderCount is a count only.
function logLookup(
  requestId: string,
  masterCustomerId: string,
  result: CustomerProfileLookupResult,
  durationMs: number,
): void {
  console.info(
    {
      requestId,
      masterCustomerId,
      status: result.status,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
      prestashopLookupAttempted: result.status === 'available' || result.status === 'degraded',
      recentOrderCount: result.status === 'available' ? result.profile.recentOrders.length : null,
    },
    'customer profile lookup',
  );
}
