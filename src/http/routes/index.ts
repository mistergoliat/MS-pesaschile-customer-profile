import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { GetCustomerCommercialSummary } from '../../application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerOrderStatus } from '../../application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../application/customer-profile/get-customer-profile.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerIdentity } from '../../domain/customer-identity/index.js';
import type { GetCustomerCommercialSummaryResult } from '../../domain/customer-commercial-summary/index.js';
import type {
  GetCustomerPurchaseBehaviorInput,
  GetCustomerPurchaseBehaviorResult,
} from '../../domain/customer-purchase-behavior/index.js';
import type { GetPurchasedProductsInput, GetPurchasedProductsResult } from '../../domain/customer-purchased-products/index.js';
import type { GetCustomerOrderStatusResult } from '../../domain/customer-order-status/index.js';
import type { CustomerProfileLookupResult } from '../../domain/customer-profile/index.js';
import type { PrestashopReadinessResult } from '../../infrastructure/prestashop/prestashop-pool.js';
import { classifyErrorForLog } from '../../observability/classify-error-for-log.js';

const numericId = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[0-9]+$/, 'customerId must be a numeric id');

const customerIdParams = z.object({ customerId: numericId });

const orderReference = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9]+$/, 'reference must be alphanumeric');

const orderStatusParams = z.object({ customerId: numericId, reference: orderReference });

export type ReadinessResult = {
  readonly crm: boolean;
  readonly prestashop: PrestashopReadinessResult;
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

const LOG_IDENTITY: Pick<CustomerIdentity, 'identitySource' | 'identityStatus'> = {
  identitySource: 'PRESTASHOP',
  identityStatus: 'DIRECT_SOURCE',
};

export function buildRoutes(deps: RouteDependencies): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  router.get('/health/ready', async (_request, response) => {
    const readiness = await deps.checkReadiness();
    if (readiness.prestashop.status !== 'ready') {
      response.status(503).json({
        status: 'not_ready',
        prestashop: false,
        crm: readiness.crm,
        customerIdentitySource: 'PRESTASHOP',
        identityStatus: 'DIRECT_SOURCE',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        reason: readiness.prestashop.reason,
      });
      return;
    }

    response.status(200).json({
      status: 'ready',
      prestashop: true,
      crm: readiness.crm,
      customerIdentitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
    });
  });

  router.get('/v1/customers/:customerId/profile', async (request: Request, response: Response) => {
    const customerId = parseCustomerIdFromParams(request.params);
    if (customerId === null) {
      response.status(400).json({ error: 'invalid_customer_id' });
      return;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();

    try {
      const result = await deps.getCustomerProfile({ customerId });

      logProfileLookup(requestId, customerId, result, Date.now() - startedAt);
      response.status(statusForProfileResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_profile_request_failed',
        requestId,
        customerId,
        endpoint: 'profile',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        ...LOG_IDENTITY,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/commercial-summary', async (request: Request, response: Response) => {
    const customerId = parseCustomerIdFromParams(request.params);
    if (customerId === null) {
      response.status(400).json({ error: 'invalid_customer_id' });
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
      const result = await deps.getCustomerCommercialSummary({ customerId });

      logCommercialSummaryLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForCommercialSummaryResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_commercial_summary_request_failed',
        customerId,
        endpoint: 'commercial-summary',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        ...LOG_IDENTITY,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/purchased-products', async (request: Request, response: Response) => {
    const customerId = parseCustomerIdFromParams(request.params);
    if (customerId === null) {
      response.status(400).json({ error: 'invalid_customer_id' });
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
        customerId,
        limit: parsedQuery.value.limit,
        offset: parsedQuery.value.offset,
      });

      logPurchasedProductsLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForPurchasedProductsResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_purchased_products_request_failed',
        customerId,
        endpoint: 'purchased-products',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        ...LOG_IDENTITY,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/purchase-behavior', async (request: Request, response: Response) => {
    const customerId = parseCustomerIdFromParams(request.params);
    if (customerId === null) {
      response.status(400).json({ error: 'invalid_customer_id' });
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
        customerId,
        topProducts: parsedQuery.value.topProducts,
        topVariants: parsedQuery.value.topVariants,
      });

      logPurchaseBehaviorLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForPurchaseBehaviorResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_purchase_behavior_request_failed',
        customerId,
        endpoint: 'purchase-behavior',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        ...LOG_IDENTITY,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/orders/:reference/status', async (request: Request, response: Response) => {
    const parsedParams = orderStatusParams.safeParse(request.params);
    if (!parsedParams.success) {
      const invalidField = parsedParams.error.issues[0]?.path[0];
      response.status(400).json({
        error: invalidField === 'reference' ? 'invalid_order_reference' : 'invalid_customer_id',
      });
      return;
    }

    const customerId = parseCustomerId(parsedParams.data.customerId);
    if (customerId === null) {
      response.status(400).json({ error: 'invalid_customer_id' });
      return;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();

    try {
      const result = await deps.getCustomerOrderStatus({
        customerId,
        orderReference: parsedParams.data.reference,
      });

      logOrderStatusLookup(requestId, customerId, result, Date.now() - startedAt);
      response.status(statusForOrderStatusResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_order_status_request_failed',
        requestId,
        customerId,
        endpoint: 'order-status',
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        ...LOG_IDENTITY,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

function parseCustomerIdFromParams(params: Record<string, unknown>): number | null {
  const parsedParams = customerIdParams.safeParse(params);
  if (!parsedParams.success) {
    return null;
  }
  return parseCustomerId(parsedParams.data.customerId);
}

function parseCustomerId(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function statusForProfileResult(result: CustomerProfileLookupResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForOrderStatusResult(result: GetCustomerOrderStatusResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
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
      return 404;
    case 'degraded':
      return 503;
  }
}

function logProfileLookup(
  requestId: string,
  customerId: number,
  result: CustomerProfileLookupResult,
  durationMs: number,
): void {
  console.info(
    {
      requestId,
      customerId,
      endpoint: 'profile',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      ...LOG_IDENTITY,
      status: result.status,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
      recentOrderCount: result.status === 'available' ? result.profile.recentOrders.length : null,
      unknownOrderStateCount:
        result.status === 'available'
          ? result.profile.recentOrders.filter((order) => order.currentState.resolution === 'unknown').length
          : null,
    },
    'customer profile lookup',
  );
}

function logPurchaseBehaviorLookup(
  customerId: number,
  result: GetCustomerPurchaseBehaviorResult,
  durationMs: number,
): void {
  console.info(
    {
      customerId,
      endpoint: 'purchase-behavior',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      ...LOG_IDENTITY,
      status: result.status,
      distinctProductBucket:
        result.status === 'available' ? distinctProductBucket(result.summary.distinctProductCount) : null,
      hasRepeatedProducts: result.status === 'available' ? result.summary.repeatedProductCount > 0 : null,
      concentrationAvailable: result.status === 'available' ? result.summary.distinctProductCount > 0 : null,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
    },
    'customer purchase behavior lookup',
  );
}

function distinctProductBucket(count: number): 'zero' | 'one' | 'multiple' {
  if (count === 0) return 'zero';
  if (count === 1) return 'one';
  return 'multiple';
}

function logPurchasedProductsLookup(
  customerId: number,
  result: GetPurchasedProductsResult,
  durationMs: number,
): void {
  console.info(
    {
      customerId,
      endpoint: 'purchased-products',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      ...LOG_IDENTITY,
      status: result.status,
      returnedBucket: result.status === 'available' ? returnedBucket(result.products.length) : null,
      hasMore: result.status === 'available' ? result.pagination.hasMore : null,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
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

function logCommercialSummaryLookup(
  customerId: number,
  result: GetCustomerCommercialSummaryResult,
  durationMs: number,
): void {
  console.info(
    {
      customerId,
      endpoint: 'commercial-summary',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      ...LOG_IDENTITY,
      status: result.status,
      totalOrdersBucket: result.status === 'available' ? totalOrdersBucket(result.summary.totalOrders) : null,
      hasCommercialHistory: result.status === 'available' ? result.summary.totalOrders > 0 : false,
      durationMs,
      degradedReason: result.status === 'degraded' ? result.reason : null,
    },
    'customer commercial summary lookup',
  );
}

function totalOrdersBucket(totalOrders: number): 'zero' | 'one' | 'multiple' {
  if (totalOrders === 0) return 'zero';
  if (totalOrders === 1) return 'one';
  return 'multiple';
}

function logOrderStatusLookup(
  requestId: string,
  customerId: number,
  result: GetCustomerOrderStatusResult,
  durationMs: number,
): void {
  console.info(
    {
      requestId,
      customerId,
      endpoint: 'order-status',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      ...LOG_IDENTITY,
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
