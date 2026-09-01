import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { GetCustomerCommercialSummary } from '../../application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerRfm } from '../../application/customer-rfm/get-customer-rfm.js';
import type { GetCustomerRfmByCustomerId } from '../../application/customer-rfm/get-customer-rfm-by-customer-id.js';
import type { GetCustomerCluster } from '../../application/customer-clustering/get-customer-cluster.js';
import type { GetCustomerClv, GetCustomerClvResult } from '../../application/customer-clv/get-customer-clv.js';
import {
  CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
} from '../../application/customer-clv/get-customer-clv.js';
import type { GetCustomerClvSnapshot, GetCustomerClvSnapshotResult } from '../../application/customer-clv/get-customer-clv-snapshot.js';
import type { GetCustomerIntelligenceRow, GetCustomerIntelligenceRowResult } from '../../application/customer-intelligence/get-customer-intelligence-row.js';
import type {
  CustomerCommercialProfileService,
  GetCustomerCommercialProfileResult,
} from '../../application/customer-commercial-profile/customer-commercial-profile-service.js';
import type { GetClusterSnapshotSummary } from '../../application/customer-clustering/get-cluster-snapshot-summary.js';
import type { GetRfmClusterCrossTab } from '../../application/customer-clustering/get-rfm-cluster-cross-tab.js';
import type { GetDashboardContext } from '../../application/customer-intelligence-dashboard/get-dashboard-context.js';
import type { GetDashboardOverview } from '../../application/customer-intelligence-dashboard/get-dashboard-overview.js';
import type { GetDashboardRfm } from '../../application/customer-intelligence-dashboard/get-dashboard-rfm.js';
import type { GetDashboardClusters } from '../../application/customer-intelligence-dashboard/get-dashboard-clusters.js';
import type { GetDashboardIntersection } from '../../application/customer-intelligence-dashboard/get-dashboard-intersection.js';
import type { GetCustomerOrderStatus } from '../../application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../application/customer-profile/get-customer-profile.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerIdentity } from '../../domain/customer-identity/index.js';
import type { GetCustomerCommercialSummaryResult } from '../../domain/customer-commercial-summary/index.js';
import type {
  GetCustomerPurchaseBehaviorInput,
  GetCustomerPurchaseBehaviorResult,
} from '../../domain/customer-purchase-behavior/index.js';
import type { GetPurchasedProductsInput, GetPurchasedProductsResult } from '../../domain/customer-purchased-products/index.js';
import {
  CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
  type GetCustomerRfmByCustomerIdResult,
  type GetCustomerRfmResult,
} from '../../domain/customer-rfm/index.js';
import {
  CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
  CLUSTER_ANALYTICS_CONTRACT_VERSION,
  type GetCustomerClusterResult,
  type GetClusterSnapshotSummaryResult,
  type GetRfmClusterCrossTabResult,
} from '../../domain/customer-clustering/index.js';
import {
  CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_REQUEST_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
  type DashboardContextResult,
  type DashboardOverviewResult,
  type DashboardRfmResult,
  type DashboardClustersResult,
  type DashboardIntersectionResult,
} from '../../domain/customer-intelligence-dashboard/index.js';
import type { AnalyticalFilterInput } from '../../domain/customer-intelligence-query/index.js';
import type { GetCustomerOrderStatusResult } from '../../domain/customer-order-status/index.js';
import type { CustomerProfileLookupResult } from '../../domain/customer-profile/index.js';
import type {
  AnswerCustomerIntelligenceQuestion,
} from '../../application/customer-intelligence-copilot/index.js';
import type { CustomerIntelligenceCopilotSessionService } from '../../application/customer-intelligence-copilot-session/index.js';
import type { CopilotUiContextRequest, CustomerIntelligenceCopilotResponse } from '../../domain/customer-intelligence-copilot/index.js';
import type { PrestashopReadinessResult } from '../../infrastructure/prestashop/prestashop-pool.js';
import { classifyErrorForLog } from '../../observability/classify-error-for-log.js';

const numericId = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[0-9]+$/, 'customerId must be a numeric id');

const customerIdParams = z.object({ customerId: numericId });
const snapshotIdParams = z.object({ snapshotId: numericId });
// Explicit pinning (task MARKETING-R1-T06.2 Section 2/3): reuses the exact same optional
// featureSnapshotId convention the Copilot already exposes (copilotRequestBody below), never a
// new pinning token/mechanism. Omitted => latest published feature snapshot.
const dashboardQuery = z.object({ featureSnapshotId: numericId.optional() }).strict();
// task MARKETING-R1-T06.3 Section 3: `filters` reuses T03's own AnalyticalFilterInput shape -
// its full structural/semantic validation (unknown field, invalid operator, malformed BETWEEN,
// too many leaves, too deep, ...) is owned entirely by validateAnalyticalQueryPlan (task Section
// 15: reuse T03 validation, never a second, zod-shaped filter schema that could silently diverge
// from it). This body schema only bounds the outer envelope.
const dashboardIntersectionRequestBody = z
  .object({
    contractVersion: z.literal(CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_REQUEST_VERSION).optional(),
    featureSnapshotId: numericId.optional(),
    filters: z.unknown().optional(),
  })
  .strict();

const orderReference = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9]+$/, 'reference must be alphanumeric');

const orderStatusParams = z.object({ customerId: numericId, reference: orderReference });
const copilotRequestBody = z
  .object({
    question: z.string().trim().min(1).max(4000),
    featureSnapshotId: numericId.optional(),
  })
  .strict();
const copilotSessionParams = z.object({ sessionId: z.string().uuid() });
const copilotSessionListQuery = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();
const copilotCreateSessionBody = z
  .object({
    featureSnapshotId: numericId.optional(),
  })
  .strict();
// task MARKETING-R1-T06.4 Section 2/3: reuses T06.3's own AnalyticalFilterInput shape verbatim
// for `filters` (its full structural/semantic validation is owned entirely by
// validateAnalyticalQueryPlan inside resolveCopilotUiContext - task Section 15: never a second,
// zod-shaped filter schema that could silently diverge from it). This body schema only bounds
// the outer envelope, mirroring dashboardIntersectionRequestBody above.
const copilotUiContextBody = z
  .object({
    intersection: z
      .object({
        contractVersion: z.string().optional(),
        featureSnapshotId: numericId.optional(),
        filters: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
const copilotSessionMessageBody = z
  .object({
    question: z.string().trim().min(1).max(4000),
    uiContext: copilotUiContextBody.optional(),
  })
  .strict();
const copilotExportBody = z
  .object({
    queryId: z.string().trim().min(1).max(128).regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
    format: z.literal('xlsx'),
  })
  .strict();

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
  // PRIMARY RFM identity: customerId = ps_customer.id_customer, CRM-independent. See
  // docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md §18.
  readonly getCustomerRfmByCustomerId: GetCustomerRfmByCustomerId;
  // LEGACY/SECONDARY RFM identity: masterCustomerId = master_customer.id (CRM-space).
  // Preserved, not removed — see the audit above §6/§18 for why it's kept as a distinct,
  // non-ambiguous path instead of being merged into the primary one.
  readonly getCustomerRfm: GetCustomerRfm;
  // Behavioral clustering (CP-R2-T02): same identity space as the RFM primary path
  // (customerId = ps_customer.id_customer), latest-published-snapshot only. See
  // docs/releases/CP-R2-T02-behavioral-clustering-productionization.md.
  readonly getCustomerCluster: GetCustomerCluster;
  readonly getCustomerClv?: GetCustomerClv;
  readonly getCustomerClvSnapshot?: GetCustomerClvSnapshot;
  readonly getCustomerIntelligenceRow?: GetCustomerIntelligenceRow;
  readonly customerCommercialProfileService?: CustomerCommercialProfileService;
  // Clustering analytics/observability (CP-R2-T03): read-only assembly over already-published
  // snapshots/profiles, local MariaDB only — never recomputes, never touches PrestaShop. See
  // docs/releases/CP-R2-T03-clustering-analytics-observability.md.
  readonly getClusterSnapshotSummary: GetClusterSnapshotSummary;
  readonly getRfmClusterCrossTab: GetRfmClusterCrossTab;
  // Customer Intelligence Dashboard core readers (MARKETING-R1-T06.2) - dedicated, deterministic
  // reads over the same customer-intelligence-read-model-v1 the Copilot uses, gated on the same
  // config.analyticsDb capability. See docs/releases/MARKETING-R1-T06-2-...md.
  readonly getDashboardContext: GetDashboardContext;
  readonly getDashboardOverview: GetDashboardOverview;
  readonly getDashboardRfm: GetDashboardRfm;
  readonly getDashboardClusters: GetDashboardClusters;
  readonly getDashboardIntersection: GetDashboardIntersection;
  readonly answerCustomerIntelligenceQuestion?: AnswerCustomerIntelligenceQuestion;
  readonly customerIntelligenceCopilotSessionService?: CustomerIntelligenceCopilotSessionService;
  readonly marketingCopilot?: {
    readonly enabled: boolean;
    readonly internalToken: string | null;
  };
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

  router.post('/v1/customer-intelligence/copilot', async (request: Request, response: Response) => {
    if (!deps.marketingCopilot?.enabled) {
      response.status(404).json({ error: 'marketing_copilot_disabled' });
      return;
    }
    if (!deps.marketingCopilot.internalToken) {
      response.status(503).json({ error: 'marketing_copilot_auth_not_configured' });
      return;
    }
    if (!isAuthorizedCopilotRequest(request, deps.marketingCopilot.internalToken)) {
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!deps.answerCustomerIntelligenceQuestion) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }

    const parsedBody = copilotRequestBody.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({ error: 'invalid_copilot_request' });
      return;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const result = await deps.answerCustomerIntelligenceQuestion({
        question: parsedBody.data.question,
        featureSnapshotId: parsedBody.data.featureSnapshotId ?? null,
      });
      logCopilotRequest(requestId, result, Date.now() - startedAt);
      response.status(statusForCopilotResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_intelligence_copilot_request_failed',
        requestId,
        endpoint: 'customer-intelligence-copilot',
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customer-intelligence/copilot/sessions', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedQuery = copilotSessionListQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'invalid_copilot_session_list_request' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.listSessions(parsedQuery.data.limit);
    response.status(200).json(result);
  });

  router.post('/v1/customer-intelligence/copilot/sessions', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    const parsedBody = copilotCreateSessionBody.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      response.status(400).json({ error: 'invalid_copilot_session_request' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.createSession({
      featureSnapshotId: parsedBody.data.featureSnapshotId ?? null,
    });
    response.status(result.status === 'created' ? 201 : 503).json(result);
  });

  router.get('/v1/customer-intelligence/copilot/sessions/:sessionId', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.getSession(parsedParams.data.sessionId);
    response.status(result.status === 'ok' ? 200 : result.status === 'session_expired' ? 410 : 404).json(result);
  });

  router.post('/v1/customer-intelligence/copilot/sessions/:sessionId/messages', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    const parsedBody = copilotSessionMessageBody.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({ error: 'invalid_copilot_session_message' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.processSessionTurn({
      sessionId: parsedParams.data.sessionId,
      question: parsedBody.data.question,
      uiContext: parsedBody.data.uiContext as CopilotUiContextRequest | undefined,
    });
    if (result.status !== 'ok') {
      response.status(result.status === 'session_expired' ? 410 : 404).json({ error: result.status });
      return;
    }
    response.status(statusForCopilotResult(result.response)).json(result.response);
  });

  router.post('/v1/customer-intelligence/copilot/sessions/:sessionId/refresh', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    if (request.body !== undefined && Object.keys(request.body as Record<string, unknown>).length > 0) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.refreshSessionContext(parsedParams.data.sessionId);
    response.status(statusForSessionLifecycleResult(result.status)).json(result);
  });

  router.post('/v1/customer-intelligence/copilot/sessions/:sessionId/reset', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.resetSession(parsedParams.data.sessionId);
    response.status(statusForSessionLifecycleResult(result.status)).json(result);
  });

  router.delete('/v1/customer-intelligence/copilot/sessions/:sessionId', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    const result = await deps.customerIntelligenceCopilotSessionService.deleteSession(parsedParams.data.sessionId);
    response.status(statusForSessionLifecycleResult(result.status)).json(result);
  });

  router.post('/v1/customer-intelligence/copilot/sessions/:sessionId/export', async (request: Request, response: Response) => {
    if (!ensureCopilotRouteAvailable(request, response, deps)) return;
    if (!deps.customerIntelligenceCopilotSessionService) {
      response.status(503).json({ error: 'marketing_copilot_not_configured' });
      return;
    }
    const parsedParams = copilotSessionParams.safeParse(request.params);
    if (!parsedParams.success) {
      response.status(400).json({ error: 'invalid_session_id' });
      return;
    }
    const parsedBody = copilotExportBody.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({ error: 'invalid_copilot_export_request' });
      return;
    }
    const startedAt = Date.now();
    const result = await deps.customerIntelligenceCopilotSessionService.exportSessionQuery({
      sessionId: parsedParams.data.sessionId,
      queryId: parsedBody.data.queryId,
      format: parsedBody.data.format,
    });
    if (result.status !== 'ok') {
      response.status(statusForExportResult(result.status)).json({ error: result.status, message: result.message });
      return;
    }
    console.info({
      event: 'customer_intelligence_copilot_export',
      sessionId: result.metadata.sessionId,
      queryId: result.metadata.queryId,
      queryPlanHash: result.metadata.queryPlanHash,
      rowCount: result.metadata.rowCount,
      durationMs: Date.now() - startedAt,
    });
    response.setHeader('content-type', result.contentType);
    response.setHeader('content-disposition', `attachment; filename="${result.filename}"`);
    response.status(200).send(result.buffer);
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

  // PRIMARY RFM path: customerId = ps_customer.id_customer, consistent with the other five
  // endpoints above and CRM-independent (see CP-R1-RFM-data-ownership-crm-architecture-
  // audit.md §18). Deliberately a different path shape than the legacy route below — both
  // accept a same-shaped numeric id, so collapsing them onto one path would make the two
  // identity spaces indistinguishable at the HTTP layer.
  router.get('/v1/customers/:customerId/rfm', async (request: Request, response: Response) => {
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
      const result = await deps.getCustomerRfmByCustomerId({ customerId });

      logCustomerRfmByCustomerIdLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForCustomerRfmByCustomerIdResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_rfm_by_customer_id_request_failed',
        endpoint: 'rfm',
        customerId,
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // LEGACY/SECONDARY RFM path: masterCustomerId = master_customer.id (CRM-space identity).
  // Moved from /v1/customers/:masterCustomerId/rfm to its own path prefix so it can never
  // be confused with the customerId-keyed routes above by shape alone — both are
  // format-indistinguishable positive numeric strings. See the audit referenced above.
  router.get('/v1/master-customers/:masterCustomerId/rfm', async (request: Request, response: Response) => {
    const masterCustomerId = parseMasterCustomerIdFromParams(request.params);
    if (masterCustomerId === null) {
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
      const result = await deps.getCustomerRfm({ masterCustomerId });

      logCustomerRfmLookup(masterCustomerId, result, Date.now() - startedAt);
      response.status(statusForCustomerRfmResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_rfm_request_failed',
        endpoint: 'rfm',
        masterCustomerId,
        contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Behavioral clustering (CP-R2-T02): read-only serving from the latest published local
  // snapshot only — never recomputes an assignment, never trains, never calls Python.
  router.get('/v1/customers/:customerId/cluster', async (request: Request, response: Response) => {
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
      const result = await deps.getCustomerCluster({ customerId });

      logCustomerClusterLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForCustomerClusterResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_cluster_request_failed',
        endpoint: 'cluster',
        customerId,
        contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/clv', async (request: Request, response: Response) => {
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
    if (!deps.getCustomerClv) {
      response.status(503).json({ error: 'clv_not_configured' });
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await deps.getCustomerClv({ customerId });
      logCustomerClvLookup(customerId, result, Date.now() - startedAt);
      response.status(statusForCustomerClvResult(result)).json(result);
    } catch (error) {
      console.error({ event: 'customer_clv_request_failed', customerId, endpoint: 'clv', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION, durationMs: Date.now() - startedAt, errorType: classifyErrorForLog(error) });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/clv/snapshot', async (request: Request, response: Response) => {
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    if (request.body !== undefined) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }
    if (!deps.getCustomerClvSnapshot) {
      response.status(503).json({ error: 'clv_not_configured' });
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await deps.getCustomerClvSnapshot();
      console.info({ endpoint: 'clv-snapshot', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION, status: result.status, snapshotId: result.status === 'available' ? result.snapshot.snapshotId : null, durationMs: Date.now() - startedAt }, 'CLV snapshot metadata lookup');
      response.status(statusForCustomerClvSnapshotResult(result)).json(result);
    } catch (error) {
      console.error({ event: 'customer_clv_snapshot_request_failed', endpoint: 'clv-snapshot', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION, durationMs: Date.now() - startedAt, errorType: classifyErrorForLog(error) });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/intelligence', async (request: Request, response: Response) => {
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
    if (!deps.getCustomerIntelligenceRow) {
      response.status(503).json({ error: 'customer_intelligence_not_configured' });
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await deps.getCustomerIntelligenceRow({ featureSnapshotId: null, prestashopCustomerId: customerId });
      console.info({ endpoint: 'customer-intelligence', contractVersion: 'customer-intelligence-read-model-v1', customerId, status: result.status, hasClv: result.status === 'available' ? result.row.clv !== null && result.row.clv !== undefined : null, durationMs: Date.now() - startedAt }, 'customer intelligence lookup');
      response.status(statusForCustomerIntelligenceResult(result)).json(result);
    } catch (error) {
      console.error({ event: 'customer_intelligence_request_failed', customerId, endpoint: 'customer-intelligence', contractVersion: 'customer-intelligence-read-model-v1', durationMs: Date.now() - startedAt, errorType: classifyErrorForLog(error) });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customers/:customerId/commercial-profile', async (request: Request, response: Response) => {
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
    if (!deps.customerCommercialProfileService) {
      response.status(503).json({ error: 'customer_commercial_profile_not_configured' });
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await deps.customerCommercialProfileService.getByCustomerId({ customerId });
      console.info({
        endpoint: 'customer-commercial-profile',
        contractVersion: 'customer-commercial-profile-v1',
        customerId,
        status: result.status,
        durationMs: Date.now() - startedAt,
      }, 'customer commercial profile lookup');
      response.status(statusForCustomerCommercialProfileResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'customer_commercial_profile_request_failed',
        endpoint: 'customer-commercial-profile',
        customerId,
        contractVersion: 'customer-commercial-profile-v1',
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Clustering analytics/observability (CP-R2-T03) — latest published snapshot summary:
  // population distribution, per-cluster feature/commercial/distance profiles, model
  // provenance. Local reads only, never recomputes (task Section 19).
  router.get('/v1/clustering/snapshots/latest/summary', async (request: Request, response: Response) => {
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
      const result = await deps.getClusterSnapshotSummary({ snapshotId: null });
      logClusterSnapshotSummaryLookup('latest', result, Date.now() - startedAt);
      response.status(statusForClusterSnapshotSummaryResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'cluster_snapshot_summary_request_failed',
        endpoint: 'clustering-snapshot-summary',
        snapshotIdParam: 'latest',
        contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Cluster x RFM cross-tab (task Section 23/27) — kept inside clustering, not a general
  // Customer Intelligence surface (task Section 27: that capability does not exist yet).
  router.get('/v1/clustering/snapshots/latest/rfm-cross-tab', async (request: Request, response: Response) => {
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
      const result = await deps.getRfmClusterCrossTab({ snapshotId: null });
      logRfmClusterCrossTabLookup('latest', result, Date.now() - startedAt);
      response.status(statusForRfmClusterCrossTabResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'rfm_cluster_cross_tab_request_failed',
        endpoint: 'clustering-rfm-cross-tab',
        snapshotIdParam: 'latest',
        contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Historical reproducibility (task Section 20) — registered after the literal /latest routes
  // above so a request for "latest" is never captured by this :snapshotId param route.
  router.get('/v1/clustering/snapshots/:snapshotId/summary', async (request: Request, response: Response) => {
    const parsedParams = snapshotIdParams.safeParse(request.params);
    if (!parsedParams.success || /^0+$/.test(parsedParams.data.snapshotId)) {
      response.status(400).json({ error: 'invalid_snapshot_id' });
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

    const snapshotId = parsedParams.data.snapshotId;
    const startedAt = Date.now();
    try {
      const result = await deps.getClusterSnapshotSummary({ snapshotId });
      logClusterSnapshotSummaryLookup(snapshotId, result, Date.now() - startedAt);
      response.status(statusForClusterSnapshotSummaryResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'cluster_snapshot_summary_request_failed',
        endpoint: 'clustering-snapshot-summary',
        snapshotIdParam: snapshotId,
        contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Customer Intelligence Dashboard core readers (MARKETING-R1-T06.2) - each endpoint resolves
  // its own snapshot context server-side (task Section 2: "section endpoints may resolve current
  // context internally"), optionally pinned via ?featureSnapshotId= (task Section 2's "clean
  // existing pattern" - the same optional id the Copilot already accepts). No Commercial
  // Affinity field appears anywhere below - explicitly out of scope for this slice.
  router.get('/v1/customer-intelligence/dashboard/context', async (request: Request, response: Response) => {
    const parsedQuery = dashboardQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'invalid_query_params' });
      return;
    }
    if (request.body !== undefined) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }

    const featureSnapshotId = parsedQuery.data.featureSnapshotId ?? null;
    const startedAt = Date.now();
    try {
      const result = await deps.getDashboardContext({ featureSnapshotId });
      logDashboardContextLookup(featureSnapshotId, result, Date.now() - startedAt);
      response.status(statusForDashboardContextResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'dashboard_context_request_failed',
        endpoint: 'dashboard-context',
        featureSnapshotId,
        contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customer-intelligence/dashboard/overview', async (request: Request, response: Response) => {
    const parsedQuery = dashboardQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'invalid_query_params' });
      return;
    }
    if (request.body !== undefined) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }

    const featureSnapshotId = parsedQuery.data.featureSnapshotId ?? null;
    const startedAt = Date.now();
    try {
      const result = await deps.getDashboardOverview({ featureSnapshotId });
      logDashboardOverviewLookup(featureSnapshotId, result, Date.now() - startedAt);
      response.status(statusForDashboardOverviewResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'dashboard_overview_request_failed',
        endpoint: 'dashboard-overview',
        featureSnapshotId,
        contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customer-intelligence/dashboard/rfm', async (request: Request, response: Response) => {
    const parsedQuery = dashboardQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'invalid_query_params' });
      return;
    }
    if (request.body !== undefined) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }

    const featureSnapshotId = parsedQuery.data.featureSnapshotId ?? null;
    const startedAt = Date.now();
    try {
      const result = await deps.getDashboardRfm({ featureSnapshotId });
      logDashboardRfmLookup(featureSnapshotId, result, Date.now() - startedAt);
      response.status(statusForDashboardRfmResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'dashboard_rfm_request_failed',
        endpoint: 'dashboard-rfm',
        featureSnapshotId,
        contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  router.get('/v1/customer-intelligence/dashboard/clusters', async (request: Request, response: Response) => {
    const parsedQuery = dashboardQuery.safeParse(request.query);
    if (!parsedQuery.success) {
      response.status(400).json({ error: 'invalid_query_params' });
      return;
    }
    if (request.body !== undefined) {
      response.status(400).json({ error: 'unsupported_body' });
      return;
    }

    const featureSnapshotId = parsedQuery.data.featureSnapshotId ?? null;
    const startedAt = Date.now();
    try {
      const result = await deps.getDashboardClusters({ featureSnapshotId });
      logDashboardClustersLookup(featureSnapshotId, result, Date.now() - startedAt);
      response.status(statusForDashboardClustersResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'dashboard_clusters_request_failed',
        endpoint: 'dashboard-clusters',
        featureSnapshotId,
        contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
        durationMs: Date.now() - startedAt,
        errorType: classifyErrorForLog(error),
      });
      response.status(500).json({ error: 'internal_error' });
    }
  });

  // Dashboard Intersections (MARKETING-R1-T06.3) - public request/response envelope only;
  // `filters` is validated end-to-end by the existing T03 compiler/validator inside
  // deps.getDashboardIntersection, never a second filter grammar (task Section 3/8).
  router.post('/v1/customer-intelligence/dashboard/intersections', async (request: Request, response: Response) => {
    if (Object.keys(request.query).length > 0) {
      response.status(400).json({ error: 'unsupported_query_params' });
      return;
    }
    const parsedBody = dashboardIntersectionRequestBody.safeParse(request.body);
    if (!parsedBody.success) {
      response.status(400).json({ error: 'invalid_dashboard_intersection_request' });
      return;
    }

    const featureSnapshotId = parsedBody.data.featureSnapshotId ?? null;
    const filters = parsedBody.data.filters as AnalyticalFilterInput | undefined;
    const startedAt = Date.now();
    try {
      const result = await deps.getDashboardIntersection({ featureSnapshotId, filters });
      logDashboardIntersectionLookup(featureSnapshotId, result, Date.now() - startedAt);
      response.status(statusForDashboardIntersectionResult(result)).json(result);
    } catch (error) {
      console.error({
        event: 'dashboard_intersection_request_failed',
        endpoint: 'dashboard-intersections',
        featureSnapshotId,
        contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
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

function isAuthorizedCopilotRequest(request: Request, expectedToken: string): boolean {
  const actual = request.header('x-internal-copilot-token');
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expectedToken);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function ensureCopilotRouteAvailable(request: Request, response: Response, deps: RouteDependencies): boolean {
  if (!deps.marketingCopilot?.enabled) {
    response.status(404).json({ error: 'marketing_copilot_disabled' });
    return false;
  }
  if (!deps.marketingCopilot.internalToken) {
    response.status(503).json({ error: 'marketing_copilot_auth_not_configured' });
    return false;
  }
  if (!isAuthorizedCopilotRequest(request, deps.marketingCopilot.internalToken)) {
    response.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function parseMasterCustomerIdFromParams(params: Record<string, unknown>): string | null {
  const parsed = z
    .object({
      masterCustomerId: numericId,
    })
    .safeParse(params);
  if (!parsed.success) {
    return null;
  }
  return /^0+$/.test(parsed.data.masterCustomerId) ? null : parsed.data.masterCustomerId;
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

function statusForCustomerRfmResult(result: GetCustomerRfmResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'rfm_not_available':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForCustomerRfmByCustomerIdResult(result: GetCustomerRfmByCustomerIdResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'rfm_not_available':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForCustomerClusterResult(result: GetCustomerClusterResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
    case 'cluster_not_available':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForCustomerClvResult(result: GetCustomerClvResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_active_clv_snapshot':
    case 'customer_clv_not_found':
      return 404;
    case 'degraded':
      return result.reason === 'clv_timeout' ? 504 : 503;
    case 'malformed_clv_snapshot':
      return 500;
  }
}

function statusForCustomerClvSnapshotResult(result: GetCustomerClvSnapshotResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_active_clv_snapshot':
      return 404;
    case 'degraded':
      return result.reason === 'clv_timeout' ? 504 : 503;
    case 'malformed_clv_snapshot':
      return 500;
  }
}

function statusForCustomerIntelligenceResult(result: GetCustomerIntelligenceRowResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_in_feature_snapshot':
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForCustomerCommercialProfileResult(result: GetCustomerCommercialProfileResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'customer_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForClusterSnapshotSummaryResult(result: GetClusterSnapshotSummaryResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_cluster_snapshot':
    case 'cluster_snapshot_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForRfmClusterCrossTabResult(result: GetRfmClusterCrossTabResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_cluster_snapshot':
    case 'cluster_snapshot_not_found':
    // No RFM snapshot exists to cross-tab against — cluster analytics itself stays healthy
    // (task Section 45), but this specific resource cannot be built, same "resource absent"
    // shape as the two cases above.
    case 'no_compatible_rfm_snapshot':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForDashboardContextResult(result: DashboardContextResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForDashboardOverviewResult(result: DashboardOverviewResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForDashboardRfmResult(result: DashboardRfmResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
    // Feature snapshot resolved fine, but no compatible RFM snapshot exists (task Section 16:
    // this must never collapse into a generic 500/degraded - it is a distinct, expected
    // "resource absent" case, same shape as clustering's own no_compatible_rfm_snapshot).
    case 'no_compatible_rfm_snapshot':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForDashboardClustersResult(result: DashboardClustersResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
    case 'no_compatible_cluster_snapshot':
      return 404;
    case 'degraded':
      return 503;
  }
}

function statusForDashboardIntersectionResult(result: DashboardIntersectionResult): number {
  switch (result.status) {
    case 'available':
      return 200;
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
    // A referenced rfm.*/cluster.* filter dimension has no compatible snapshot for this
    // context - a distinct, expected "resource absent" case (task Section 16/17), never a
    // silently-wrong matchingPopulation: 0.
    case 'required_rfm_snapshot_unavailable':
    case 'required_cluster_snapshot_unavailable':
      return 404;
    // Malformed/invalid filters (unknown field, bad operator, too deep, ...) fail before any DB
    // execution (task Section 15) - a genuine client error, unlike T06.2's GET endpoints which
    // never had a request body to be invalid in the first place.
    case 'invalid_intersection':
      return 400;
    case 'degraded':
      return 503;
  }
}

function statusForCopilotResult(result: CustomerIntelligenceCopilotResponse): number {
  switch (result.status) {
    case 'answered':
    case 'answered_from_context':
    case 'responded_directly':
    case 'clarification_required':
      return 200;
    case 'unsupported_data':
    case 'unsupported_operation':
      return 422;
    case 'invalid_ui_context':
      return 400;
    case 'planner_invalid':
    case 'orchestrator_invalid':
    case 'answer_generation_failed':
    case 'provider_authentication_error':
    case 'provider_billing_error':
    case 'provider_rate_limited':
    case 'provider_network_error':
    case 'provider_invalid_response':
      return 502;
    case 'provider_timeout':
      return 504;
    case 'analytics_unavailable':
      return 503;
    case 'analytics_timeout':
      return 504;
  }
}

function statusForSessionLifecycleResult(status: string): number {
  switch (status) {
    case 'refreshed':
    case 'reset':
    case 'deleted':
      return 200;
    case 'session_expired':
      return 410;
    case 'analytics_unavailable':
      return 503;
    default:
      return 404;
  }
}

function statusForExportResult(status: string): number {
  switch (status) {
    case 'session_expired':
      return 410;
    case 'query_not_found':
      return 404;
    case 'invalid_query':
      return 422;
    case 'analytics_timeout':
      return 504;
    case 'analytics_unavailable':
      return 503;
    default:
      return 404;
  }
}

function logCopilotRequest(requestId: string, result: CustomerIntelligenceCopilotResponse, durationMs: number): void {
  console.info(
    {
      requestId,
      endpoint: 'customer-intelligence-copilot',
      status: result.status,
      queryCount: result.status === 'answered' ? result.analysis.queryCount : 0,
      queryPlanHashes: result.status === 'answered' ? result.analysis.queryPlanHashes : [],
      durationMs,
    },
    'customer intelligence copilot lookup',
  );
}

function logClusterSnapshotSummaryLookup(snapshotIdParam: string, result: GetClusterSnapshotSummaryResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'clustering-snapshot-summary',
      contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
      snapshotIdParam,
      status: result.status,
      snapshotId: result.status === 'available' ? result.snapshot.snapshotId : null,
      clusterCount: result.status === 'available' ? result.clusters.length : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'cluster snapshot summary lookup',
  );
}

function logRfmClusterCrossTabLookup(snapshotIdParam: string, result: GetRfmClusterCrossTabResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'clustering-rfm-cross-tab',
      contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
      snapshotIdParam,
      status: result.status,
      coveragePct: result.status === 'available' ? result.coverage.coveragePct : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'rfm cluster cross-tab lookup',
  );
}

function logDashboardContextLookup(featureSnapshotIdParam: string | null, result: DashboardContextResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'dashboard-context',
      contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
      featureSnapshotIdParam,
      status: result.status,
      featureSnapshotId: result.status === 'available' ? result.context.featureSnapshotId : null,
      rfmCoveragePct: result.status === 'available' ? result.population.rfmCoveragePct : null,
      clusterCoveragePct: result.status === 'available' ? result.population.clusterCoveragePct : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'dashboard context lookup',
  );
}

function logDashboardOverviewLookup(featureSnapshotIdParam: string | null, result: DashboardOverviewResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'dashboard-overview',
      contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
      featureSnapshotIdParam,
      status: result.status,
      featureSnapshotId: result.status === 'available' ? result.context.featureSnapshotId : null,
      totalCustomers: result.status === 'available' ? result.population.featurePopulation : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'dashboard overview lookup',
  );
}

function logDashboardRfmLookup(featureSnapshotIdParam: string | null, result: DashboardRfmResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'dashboard-rfm',
      contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
      featureSnapshotIdParam,
      status: result.status,
      analyzedPopulation: result.status === 'available' ? result.analyzedPopulation : null,
      segmentCount: result.status === 'available' ? result.segments.length : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'dashboard rfm lookup',
  );
}

function logDashboardClustersLookup(featureSnapshotIdParam: string | null, result: DashboardClustersResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'dashboard-clusters',
      contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
      featureSnapshotIdParam,
      status: result.status,
      analyzedPopulation: result.status === 'available' ? result.analyzedPopulation : null,
      clusterCount: result.status === 'available' ? result.clusters.length : null,
      rfmCrossSectionAvailable: result.status === 'available' ? result.rfmCrossSectionAvailable : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'dashboard clusters lookup',
  );
}

// task MARKETING-R1-T06.3 Section 19: structural counts only - never the filter's actual field
// names/values, never customer ids, never SQL.
function logDashboardIntersectionLookup(featureSnapshotIdParam: string | null, result: DashboardIntersectionResult, durationMs: number): void {
  console.info(
    {
      endpoint: 'dashboard-intersections',
      contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
      featureSnapshotIdParam,
      status: result.status,
      matchingPopulation: result.status === 'available' ? result.intersection.matchingPopulation : null,
      requiredDimensions: result.status === 'available' ? result.intersection.requiredDimensions : null,
      queryCount: result.status === 'available' ? result.execution.queryCount : null,
      filterLeafCount: result.status === 'available' ? result.execution.filterLeafCount : null,
      filterDepth: result.status === 'available' ? result.execution.filterDepth : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      invalidReasonCount: result.status === 'invalid_intersection' ? result.errors.length : null,
      durationMs,
    },
    'dashboard intersections lookup',
  );
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

function logCustomerRfmLookup(masterCustomerId: string, result: GetCustomerRfmResult, durationMs: number): void {
  console.info(
    {
      masterCustomerId,
      endpoint: 'rfm',
      contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      status: result.status,
      hasSegment:
        result.status === 'available' ? result.segment.code !== null && result.segment.version !== null : null,
      segmentCode: result.status === 'available' ? result.segment.code : null,
      snapshotId: result.status === 'available' ? result.snapshot.snapshotId : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      unavailableReason: result.status === 'rfm_not_available' ? result.reason : null,
      durationMs,
    },
    'customer rfm lookup',
  );
}

function logCustomerClusterLookup(customerId: number, result: GetCustomerClusterResult, durationMs: number): void {
  console.info(
    {
      customerId,
      endpoint: 'cluster',
      contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
      status: result.status,
      clusterId: result.status === 'available' ? result.cluster.clusterId : null,
      hasLabel: result.status === 'available' ? result.cluster.label !== null : null,
      snapshotId: result.status === 'available' ? result.snapshot.snapshotId : null,
      notAvailableReason: result.status === 'cluster_not_available' ? result.reason : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'customer cluster lookup',
  );
}

function logCustomerClvLookup(customerId: number, result: GetCustomerClvResult, durationMs: number): void {
  console.info(
    {
      customerId,
      endpoint: 'clv',
      contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
      status: result.status,
      snapshotId: result.status === 'available' ? result.clv.snapshotId : null,
      estimateSupportLevel: result.status === 'available' ? result.clv.estimateSupportLevel : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      durationMs,
    },
    'customer CLV lookup',
  );
}

function logCustomerRfmByCustomerIdLookup(
  customerId: number,
  result: GetCustomerRfmByCustomerIdResult,
  durationMs: number,
): void {
  console.info(
    {
      customerId,
      endpoint: 'rfm',
      contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
      status: result.status,
      hasSegment:
        result.status === 'available' ? result.segment.code !== null && result.segment.version !== null : null,
      segmentCode: result.status === 'available' ? result.segment.code : null,
      snapshotId: result.status === 'available' ? result.snapshot.snapshotId : null,
      degradedReason: result.status === 'degraded' ? result.reason : null,
      unavailableReason: result.status === 'rfm_not_available' ? result.reason : null,
      durationMs,
    },
    'customer rfm lookup',
  );
}
