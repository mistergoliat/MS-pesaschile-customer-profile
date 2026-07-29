import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { GetCustomerCommercialSummary } from '../../application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerOrderStatus } from '../../application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../application/customer-profile/get-customer-profile.js';
import type { GetCustomerCommercialSummaryResult } from '../../domain/customer-commercial-summary/index.js';
import type {
  GetCustomerPurchaseBehaviorInput,
  GetCustomerPurchaseBehaviorResult,
} from '../../domain/customer-purchase-behavior/index.js';
import type { GetPurchasedProductsInput, GetPurchasedProductsResult } from '../../domain/customer-purchased-products/index.js';
import type { GetCustomerOrderStatusResult } from '../../domain/customer-order-status/index.js';
import type { CustomerProfileLookupResult } from '../../domain/customer-profile/index.js';
import type { CrmReadinessResult } from '../../infrastructure/crm/crm-pool.js';
import { classifyErrorForLog } from '../../observability/classify-error-for-log.js';

// master_customer.id is bigint(20) unsigned: unsigned-integer text only, bounded to a
// sane length. Never accepts an email — email-based lookup does not exist in this route.
const masterCustomerId = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[0-9]+$/, 'masterCustomerId must be a numeric id');

const masterCustomerIdParams = z.object({ masterCustomerId });

// ps_orders.reference is a short alphanumeric PrestaShop-generated code, never an email
// or a PrestaShop customerId — bounded to a sane length before it ever reaches SQL
// (mirrors MAX_REFERENCE_LENGTH in mysql-customer-order-status-reader.ts).
const orderReference = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9]+$/, 'reference must be alphanumeric');

const orderStatusParams = z.object({ masterCustomerId, reference: orderReference });

export type ReadinessResult = {
  readonly crm: CrmReadinessResult;
  readonly prestashop: boolean;
};

export type ReadinessCheck = () => Promise<ReadinessResult>;

export type RouteDependencies = {
  readonly getCustomerProfile: GetCustomerProfile;
  readonly getCustomerOrderStatus: GetCustomerOrderStatus;
  readonly getCustomerCommercialSummary: GetCustomerCommercialSummary;
  readonly getCustomerPurchasedProducts: GetCustomerPurchasedProducts;
  readonly getCustomerPurchaseBehavior: GetCustomerPurchaseBehavior;
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

  router.get(
    '/v1/customers/:masterCustomerId/commercial-summary',
    async (request: Request, response: Response) => {
      const parsedParams = masterCustomerIdParams.safeParse(request.params);
      if (!parsedParams.success) {
        response.status(400).json({ error: 'invalid_master_customer_id' });
        return;
      }
      if (Object.keys(request.query).length > 0) {
        response.status(400).json({ error: 'unsupported_query_params' });
        return;
      }
      if (request.body !== undefined) {
        response.status(400).json({ error: 'unsupported_body' });
        return;
      }

      const startedAt = Date.now();

      try {
        const result = await deps.getCustomerCommercialSummary({
          masterCustomerId: parsedParams.data.masterCustomerId,
        });

        logCommercialSummaryLookup(result, Date.now() - startedAt);
        response.status(statusForCommercialSummaryResult(result)).json(result);
      } catch (error) {
        console.error({
          event: 'customer_commercial_summary_request_failed',
          status: 'error',
          lookupOutcome: 'internal_error',
          durationMs: Date.now() - startedAt,
          errorType: classifyErrorForLog(error),
        });
        response.status(500).json({ error: 'internal_error' });
      }
    },
  );

  router.get(
    '/v1/customers/:masterCustomerId/purchased-products',
    async (request: Request, response: Response) => {
      const parsedParams = masterCustomerIdParams.safeParse(request.params);
      if (!parsedParams.success) {
        response.status(400).json({ error: 'invalid_master_customer_id' });
        return;
      }

      const parsedQuery = parsePurchasedProductsQuery(request.query);
      if (!parsedQuery.ok) {
        response.status(400).json({ error: parsedQuery.error });
        return;
      }
      if (request.body !== undefined) {
        response.status(400).json({ error: 'unsupported_body' });
        return;
      }

      const startedAt = Date.now();

      try {
        const result = await deps.getCustomerPurchasedProducts({
          masterCustomerId: parsedParams.data.masterCustomerId,
          limit: parsedQuery.value.limit,
          offset: parsedQuery.value.offset,
        });

        logPurchasedProductsLookup(result, Date.now() - startedAt);
        response.status(statusForPurchasedProductsResult(result)).json(result);
      } catch {
        console.error(
          {
            status: 'error',
            returnedBucket: null,
            hasMore: null,
            durationMs: Date.now() - startedAt,
            degradedReason: null,
            lookupOutcome: 'internal_error',
          },
          'customer purchased products lookup failed',
        );
        response.status(500).json({ error: 'internal_error' });
      }
    },
  );

  router.get(
    '/v1/customers/:masterCustomerId/purchase-behavior',
    async (request: Request, response: Response) => {
      const parsedParams = masterCustomerIdParams.safeParse(request.params);
      if (!parsedParams.success) {
        response.status(400).json({ error: 'invalid_master_customer_id' });
        return;
      }

      const parsedQuery = parsePurchaseBehaviorQuery(request.query);
      if (!parsedQuery.ok) {
        response.status(400).json({ error: parsedQuery.error });
        return;
      }
      if (request.body !== undefined) {
        response.status(400).json({ error: 'unsupported_body' });
        return;
      }

      const startedAt = Date.now();

      try {
        const result = await deps.getCustomerPurchaseBehavior({
          masterCustomerId: parsedParams.data.masterCustomerId,
          topProducts: parsedQuery.value.topProducts,
          topVariants: parsedQuery.value.topVariants,
        });

        logPurchaseBehaviorLookup(result, Date.now() - startedAt);
        response.status(statusForPurchaseBehaviorResult(result)).json(result);
      } catch {
        console.error(
          {
            status: 'error',
            distinctProductBucket: null,
            hasRepeatedProducts: null,
            concentrationAvailable: null,
            durationMs: Date.now() - startedAt,
            degradedReason: null,
            lookupOutcome: 'internal_error',
          },
          'customer purchase behavior lookup failed',
        );
        response.status(500).json({ error: 'internal_error' });
      }
    },
  );

  // GET, so there is no request body to validate — only the two path params.
  // masterCustomerId never accepts an email; reference never accepts a PrestaShop
  // customerId — both are validated with the same regex-bounded schemas as the
  // corresponding adapter-level checks (see mysql-customer-order-status-reader.ts).
  router.get(
    '/v1/customers/:masterCustomerId/orders/:reference/status',
    async (request: Request, response: Response) => {
      const parsedParams = orderStatusParams.safeParse(request.params);
      if (!parsedParams.success) {
        const invalidField = parsedParams.error.issues[0]?.path[0];
        response.status(400).json({
          error: invalidField === 'reference' ? 'invalid_reference' : 'invalid_master_customer_id',
        });
        return;
      }

      const requestId = randomUUID();
      const startedAt = Date.now();

      try {
        const result = await deps.getCustomerOrderStatus({
          masterCustomerId: parsedParams.data.masterCustomerId,
          orderReference: parsedParams.data.reference,
        });

        logOrderStatusLookup(requestId, result, Date.now() - startedAt);
        response.status(statusForOrderStatusResult(result)).json(result);
      } catch (error) {
        // No masterCustomerId, prestashopCustomerId, orderId or reference logged here —
        // see CP-R1-T06 section 14. Only a safe error classification.
        console.error({
          event: 'customer_order_status_request_failed',
          requestId,
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
// order amounts, currentStateId or state name ever logged here — recentOrderCount and
// unknownOrderStateCount are aggregate numbers only.
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
      unknownOrderStateCount:
        result.status === 'available'
          ? result.profile.recentOrders.filter((order) => order.currentState.resolution === 'unknown').length
          : null,
    },
    'customer profile lookup',
  );
}

// available/order_not_found mirror T03's not_found; customer_not_found/customer_not_linked
// also resolve to 404 — none of them ever return an order payload, and collapsing them
// onto the same status code as order_not_found avoids leaking a distinction (link state)
// that a caller has no legitimate use for. degraded reuses T03's convention: both known
// reasons here are a temporarily unavailable PrestaShop dependency, never a 500.
function statusForOrderStatusResult(result: GetCustomerOrderStatusResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'customer_not_linked':
    case 'order_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForCommercialSummaryResult(result: GetCustomerCommercialSummaryResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'customer_not_linked':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForPurchasedProductsResult(result: GetPurchasedProductsResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'customer_not_linked':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForPurchaseBehaviorResult(result: GetCustomerPurchaseBehaviorResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'customer_not_linked':
      return 404;
    case 'degraded':
      return 503;
  }
}

function logPurchaseBehaviorLookup(result: GetCustomerPurchaseBehaviorResult, durationMs: number): void {
  console.info(
    {
      status: result.status,
      distinctProductBucket:
        result.status === 'available' ? distinctProductBucket(result.summary.distinctProductCount) : null,
      hasRepeatedProducts: result.status === 'available' ? result.summary.repeatedProductCount > 0 : null,
      concentrationAvailable: result.status === 'available' ? result.summary.distinctProductCount > 0 : null,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      lookupOutcome: result.status,
    },
    'customer purchase behavior lookup',
  );
}

function distinctProductBucket(count: number): 'zero' | 'one' | 'multiple' {
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  return 'multiple';
}

function logPurchasedProductsLookup(result: GetPurchasedProductsResult, durationMs: number): void {
  console.info(
    {
      status: result.status,
      returnedBucket: result.status === 'available' ? returnedBucket(result.products.length) : null,
      hasMore: result.status === 'available' ? result.pagination.hasMore : null,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      lookupOutcome: result.status,
    },
    'customer purchased products lookup',
  );
}

function returnedBucket(returned: number): 'zero' | 'one' | 'multiple' {
  if (returned === 0) return 'zero';
  if (returned === 1) return 'one';
  return 'multiple';
}

type ParsedPurchasedProductsQuery =
  | {
      readonly ok: true;
      readonly value: Pick<GetPurchasedProductsInput, 'limit' | 'offset'>;
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_limit' | 'invalid_offset' | 'unsupported_query_params';
    };

function parsePurchasedProductsQuery(query: Request['query']): ParsedPurchasedProductsQuery {
  const allowedKeys = new Set(['limit', 'offset']);
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: 'unsupported_query_params' };
    }
  }

  const limit = parseOptionalIntegerQueryParam(query.limit, {
    defaultValue: 20,
    min: 1,
    max: 100,
  });
  if (limit === null) {
    return { ok: false, error: 'invalid_limit' };
  }

  const offset = parseOptionalIntegerQueryParam(query.offset, {
    defaultValue: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (offset === null) {
    return { ok: false, error: 'invalid_offset' };
  }

  return { ok: true, value: { limit, offset } };
}

type ParsedPurchaseBehaviorQuery =
  | {
      readonly ok: true;
      readonly value: Pick<GetCustomerPurchaseBehaviorInput, 'topProducts' | 'topVariants'>;
    }
  | {
      readonly ok: false;
      readonly error: 'invalid_top_products' | 'invalid_top_variants' | 'unsupported_query_params';
    };

function parsePurchaseBehaviorQuery(query: Request['query']): ParsedPurchaseBehaviorQuery {
  const allowedKeys = new Set(['topProducts', 'topVariants']);
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: 'unsupported_query_params' };
    }
  }

  const topProducts = parseOptionalIntegerQueryParam(query.topProducts, {
    defaultValue: 10,
    min: 1,
    max: 10,
  });
  if (topProducts === null) {
    return { ok: false, error: 'invalid_top_products' };
  }

  const topVariants = parseOptionalIntegerQueryParam(query.topVariants, {
    defaultValue: 10,
    min: 1,
    max: 10,
  });
  if (topVariants === null) {
    return { ok: false, error: 'invalid_top_variants' };
  }

  return { ok: true, value: { topProducts, topVariants } };
}

function parseOptionalIntegerQueryParam(
  value: unknown,
  bounds: { readonly defaultValue: number; readonly min: number; readonly max: number },
): number | null {
  if (value === undefined) {
    return bounds.defaultValue;
  }
  if (Array.isArray(value) || typeof value !== 'string' || value.length === 0 || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return null;
  }
  return parsed;
}

function logCommercialSummaryLookup(result: GetCustomerCommercialSummaryResult, durationMs: number): void {
  console.info(
    {
      status: result.status,
      totalOrdersBucket: result.status === 'available' ? totalOrdersBucket(result.summary.totalOrders) : null,
      hasCommercialHistory: result.status === 'available' ? result.summary.totalOrders > 0 : false,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      lookupOutcome: result.status,
    },
    'customer commercial summary lookup',
  );
}

function totalOrdersBucket(totalOrders: number): 'zero' | 'one' | 'multiple' {
  if (totalOrders === 0) return 'zero';
  if (totalOrders === 1) return 'one';
  return 'multiple';
}

// CP-R1-T06 section 14: no masterCustomerId, prestashopCustomerId, orderId, reference,
// currentStateId, currentStateName, carrierId, carrierName, delay or PII — only the
// closed set of fields the task allows.
function logOrderStatusLookup(requestId: string, result: GetCustomerOrderStatusResult, durationMs: number): void {
  console.info(
    {
      requestId,
      status: result.status,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      deliveryMethod: result.status === 'available' ? result.order.deliveryMethod : null,
      currentStateResolved: result.status === 'available' ? result.order.currentStateName !== null : null,
      carrierResolved: result.status === 'available' ? !result.warnings.includes('carrier_not_found') : null,
      warningsCount: result.status === 'available' ? result.warnings.length : 0,
      durationMs,
    },
    'customer order status lookup',
  );
}
