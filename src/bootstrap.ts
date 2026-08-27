import { createGetCustomerOrderStatus, type GetCustomerOrderStatus } from './application/customer-order-status/get-customer-order-status.js';
import {
  createGetCustomerCommercialSummary,
  type GetCustomerCommercialSummary,
} from './application/customer-commercial-summary/get-customer-commercial-summary.js';
import {
  createResolveCustomerIdentity,
  type ResolveCustomerIdentity,
} from './application/customer-identity/resolve-customer-identity.js';
import {
  createGetCustomerPurchasedProducts,
  type GetCustomerPurchasedProducts,
} from './application/customer-purchased-products/get-customer-purchased-products.js';
import {
  createGetCustomerPurchaseBehavior,
  type GetCustomerPurchaseBehavior,
} from './application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import { createGetCustomerRfm, type GetCustomerRfm } from './application/customer-rfm/get-customer-rfm.js';
import {
  createGetCustomerRfmByCustomerId,
  type GetCustomerRfmByCustomerId,
} from './application/customer-rfm/get-customer-rfm-by-customer-id.js';
import {
  getCustomerRfmByCustomerIdNotConfigured,
  getCustomerRfmNotConfigured,
} from './application/customer-rfm/rfm-not-configured.js';
import { createGetCustomerCluster, type GetCustomerCluster } from './application/customer-clustering/get-customer-cluster.js';
import { getCustomerClusterNotConfigured } from './application/customer-clustering/cluster-not-configured.js';
import {
  createGetClusterSnapshotSummary,
  type GetClusterSnapshotSummary,
} from './application/customer-clustering/get-cluster-snapshot-summary.js';
import { createGetRfmClusterCrossTab, type GetRfmClusterCrossTab } from './application/customer-clustering/get-rfm-cluster-cross-tab.js';
import {
  getClusterSnapshotSummaryNotConfigured,
  getRfmClusterCrossTabNotConfigured,
  getRfmClusterCrossTabRfmNotConfigured,
} from './application/customer-clustering/cluster-analytics-not-configured.js';
import {
  createGetDashboardContext,
  createGetDashboardOverview,
  createGetDashboardRfm,
  createGetDashboardClusters,
  createGetDashboardIntersection,
  getDashboardContextNotConfigured,
  getDashboardOverviewNotConfigured,
  getDashboardRfmNotConfigured,
  getDashboardClustersNotConfigured,
  getDashboardIntersectionNotConfigured,
  type GetDashboardContext,
  type GetDashboardOverview,
  type GetDashboardRfm,
  type GetDashboardClusters,
  type GetDashboardIntersection,
} from './application/customer-intelligence-dashboard/index.js';
import { createMysqlDashboardAnalyticsReader } from './infrastructure/customer-intelligence-dashboard/mysql-dashboard-analytics-reader.js';
import { createExecuteIntersection } from './application/customer-intelligence-intersection/index.js';
import { createGetCustomerProfile, type GetCustomerProfile } from './application/customer-profile/get-customer-profile.js';
import {
  createAnswerCustomerIntelligenceQuestion,
  type AnswerCustomerIntelligenceQuestion,
} from './application/customer-intelligence-copilot/index.js';
import {
  createExecuteAnalyticalQueryForExport,
  createExecuteAnalyticalQueryWithResolvedContext,
  getAnalyticalSchema,
} from './application/customer-intelligence-query/index.js';
import {
  createCustomerIntelligenceCopilotSessionService,
  type CustomerIntelligenceCopilotSessionService,
} from './application/customer-intelligence-copilot-session/index.js';
import { createCustomerIntelligenceContextResolvers } from './application/customer-intelligence/resolve-customer-intelligence-context.js';
import { config } from './config.js';
import {
  checkCrmReadiness,
  closeCrmPool,
  createMysqlMasterCustomerReader,
  getCrmQueryExecutor,
  type CrmReadinessResult,
} from './infrastructure/crm/index.js';
import {
  checkPrestashopReadiness,
  closePrestashopPool,
  getPrestashopQueryExecutor,
} from './infrastructure/prestashop/prestashop-pool.js';
import { createMysqlPrestaShopCustomerIdentityRepository } from './infrastructure/prestashop/mysql-prestashop-customer-identity-repository.js';
import { createMysqlPrestashopCustomerReader } from './infrastructure/prestashop/mysql-prestashop-customer-reader.js';
import { createMysqlCustomerOrdersReader } from './infrastructure/prestashop/mysql-customer-orders-reader.js';
import { createMysqlOrderStatesReader } from './infrastructure/prestashop/mysql-order-states-reader.js';
import { createMysqlCustomerOrderStatusReader } from './infrastructure/prestashop/mysql-customer-order-status-reader.js';
import { createMysqlCarriersReader } from './infrastructure/prestashop/mysql-carriers-reader.js';
import { createMysqlCommercialOrdersSummaryReader } from './infrastructure/prestashop/mysql-commercial-orders-summary-reader.js';
import { createMysqlCommercialProductsSummaryReader } from './infrastructure/prestashop/mysql-commercial-products-summary-reader.js';
import { createMysqlPurchasedProductsReader } from './infrastructure/prestashop/mysql-purchased-products-reader.js';
import { createMysqlCustomerProductBehaviorReader } from './infrastructure/prestashop/mysql-customer-product-behavior-reader.js';
import { createMysqlRfmSnapshotReader } from './infrastructure/rfm/mysql-rfm-snapshot-reader.js';
import { createMysqlRfmSegmentBulkReader } from './infrastructure/rfm/mysql-rfm-segment-bulk-reader.js';
import { closeRfmSnapshotPool, getRfmSnapshotQueryExecutor } from './infrastructure/rfm/rfm-snapshot-pool.js';
import { createMysqlClusterSnapshotReader } from './infrastructure/clustering/mysql-cluster-snapshot-reader.js';
import { createMysqlClusterAnalyticsReader } from './infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { createMysqlClusterSnapshotProfileRepository } from './infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import { closeClusterPool, getClusterPool } from './infrastructure/clustering/cluster-db-pool.js';
import { closeAnalyticsPool, getAnalyticsPool, getAnalyticsQueryExecutor } from './infrastructure/customer-analytics/analytics-db-pool.js';
import { createMysqlCustomerFeatureSnapshotReader } from './infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from './infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from './infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createMysqlAnalyticalQueryExecutor } from './infrastructure/customer-intelligence-query/mysql-analytical-query-executor.js';
import { createConfiguredCustomerIntelligenceCopilotModel } from './infrastructure/customer-intelligence-copilot/index.js';
import { createMysqlCopilotSessionStore } from './infrastructure/customer-intelligence-copilot/mysql-copilot-session-store.js';
import { SystemClock } from './infrastructure/shared/system-clock.js';
import type { ReadinessCheck } from './http/routes/index.js';
import { CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION } from './domain/customer-intelligence-copilot/index.js';

const systemClock = new SystemClock();

export type Bootstrap = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly getCustomerProfile: GetCustomerProfile;
  readonly getCustomerOrderStatus: GetCustomerOrderStatus;
  readonly getCustomerCommercialSummary: GetCustomerCommercialSummary;
  readonly getCustomerPurchasedProducts: GetCustomerPurchasedProducts;
  readonly getCustomerPurchaseBehavior: GetCustomerPurchaseBehavior;
  readonly getCustomerRfm: GetCustomerRfm;
  readonly getCustomerRfmByCustomerId: GetCustomerRfmByCustomerId;
  readonly getCustomerCluster: GetCustomerCluster;
  readonly getClusterSnapshotSummary: GetClusterSnapshotSummary;
  readonly getRfmClusterCrossTab: GetRfmClusterCrossTab;
  readonly getDashboardContext: GetDashboardContext;
  readonly getDashboardOverview: GetDashboardOverview;
  readonly getDashboardRfm: GetDashboardRfm;
  readonly getDashboardClusters: GetDashboardClusters;
  readonly getDashboardIntersection: GetDashboardIntersection;
  readonly answerCustomerIntelligenceQuestion: AnswerCustomerIntelligenceQuestion;
  readonly customerIntelligenceCopilotSessionService?: CustomerIntelligenceCopilotSessionService;
  readonly checkReadiness: ReadinessCheck;
  readonly shutdown: () => Promise<void>;
};

// Composition root: readers/pools are wired here, never instantiated inside the use case.
export function bootstrap(): Bootstrap {
  const customerIdentityRepository = createMysqlPrestaShopCustomerIdentityRepository(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const resolveCustomerIdentity = createResolveCustomerIdentity({ customerIdentityRepository });
  // Same logical PrestaShop pool as prestashopCustomerReader (getPrestashopQueryExecutor()
  // wraps the existing lazy singleton pool) — no new pool, no per-request connections.
  const prestashopCustomerReader = createMysqlPrestashopCustomerReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const customerOrdersReader = createMysqlCustomerOrdersReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const orderStatesReader = createMysqlOrderStatesReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix);
  const customerOrderStatusReader = createMysqlCustomerOrderStatusReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const carriersReader = createMysqlCarriersReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix);
  const commercialOrdersSummaryReader = createMysqlCommercialOrdersSummaryReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const commercialProductsSummaryReader = createMysqlCommercialProductsSummaryReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const purchasedProductsReader = createMysqlPurchasedProductsReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const customerProductBehaviorReader = createMysqlCustomerProductBehaviorReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const masterCustomerReader = createMysqlMasterCustomerReader(getCrmQueryExecutor());

  const getCustomerProfile = createGetCustomerProfile({
    resolveCustomerIdentity,
    prestashopCustomerReader,
    customerOrdersReader,
    orderStatesReader,
    clock: systemClock,
    recentOrdersLimit: config.customerProfile.recentOrdersLimit,
    orderStateLanguageId: config.customerProfile.orderStateLanguageId,
  });

  // Reuses resolveCustomerIdentity and orderStatesReader — same PrestaShop pool, no
  // CRM runtime pool and no second connection for identity resolution. See CP-R1-T06.
  const getCustomerOrderStatus = createGetCustomerOrderStatus({
    resolveCustomerIdentity,
    customerOrderStatusReader,
    orderStatesReader,
    carriersReader,
    clock: systemClock,
    orderStateLanguageId: config.customerProfile.orderStateLanguageId,
    carrierLanguageId: config.customerOrderStatus.carrierLanguageId,
    carrierShopId: config.customerOrderStatus.carrierShopId,
  });

  const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
    resolveCustomerIdentity,
    commercialOrdersSummaryReader,
    commercialProductsSummaryReader,
    clock: systemClock,
  });

  const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
    purchasedProductsReader,
    resolveCustomerIdentity,
    clock: systemClock,
  });

  const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
    resolveCustomerIdentity,
    customerProductBehaviorReader,
    clock: systemClock,
  });

  // RFM is an optional runtime capability: when RFM_SNAPSHOT_DB_* is absent, no pool is
  // created and no connection is attempted — both RFM use cases fall back to a constant
  // "rfm_not_configured" degraded response. See CP-R1-RFM-data-ownership-crm-architecture-
  // audit.md §21 and config.ts.
  let getCustomerRfm: GetCustomerRfm;
  let getCustomerRfmByCustomerId: GetCustomerRfmByCustomerId;
  if (config.rfmSnapshotDb) {
    const currentRfmSnapshotReader = createMysqlRfmSnapshotReader(getRfmSnapshotQueryExecutor());
    getCustomerRfm = createGetCustomerRfm({ masterCustomerReader, currentRfmSnapshotReader });
    getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({ resolveCustomerIdentity, currentRfmSnapshotReader });
  } else {
    getCustomerRfm = getCustomerRfmNotConfigured;
    getCustomerRfmByCustomerId = getCustomerRfmByCustomerIdNotConfigured;
  }

  // Clustering is an optional runtime capability, same all-or-nothing pattern as RFM (task
  // Section 32 / config.ts): when CLUSTER_DB_* is absent, no pool is created and no connection
  // is attempted — the endpoint alone falls back to a constant "cluster_not_configured"
  // degraded response, every other endpoint keeps working unaffected.
  let getCustomerCluster: GetCustomerCluster;
  let getClusterSnapshotSummary: GetClusterSnapshotSummary;
  let getRfmClusterCrossTab: GetRfmClusterCrossTab;
  if (config.clusterDb) {
    const currentClusterSnapshotReader = createMysqlClusterSnapshotReader(getClusterPool());
    getCustomerCluster = createGetCustomerCluster({ resolveCustomerIdentity, currentClusterSnapshotReader });

    const clusterAnalyticsReader = createMysqlClusterAnalyticsReader(getClusterPool());
    const clusterSnapshotProfileRepository = createMysqlClusterSnapshotProfileRepository(getClusterPool());
    getClusterSnapshotSummary = createGetClusterSnapshotSummary({ clusterAnalyticsReader, clusterSnapshotProfileRepository });

    // Cross-tab needs both clustering (already configured here) and RFM. RFM being absent only
    // degrades this one endpoint (task Section 45) — the snapshot summary above is unaffected.
    if (config.rfmSnapshotDb) {
      const rfmSegmentBulkReader = createMysqlRfmSegmentBulkReader(getRfmSnapshotQueryExecutor());
      getRfmClusterCrossTab = createGetRfmClusterCrossTab({ clusterAnalyticsReader, rfmSegmentBulkReader });
    } else {
      getRfmClusterCrossTab = getRfmClusterCrossTabRfmNotConfigured;
    }
  } else {
    getCustomerCluster = getCustomerClusterNotConfigured;
    getClusterSnapshotSummary = getClusterSnapshotSummaryNotConfigured;
    getRfmClusterCrossTab = getRfmClusterCrossTabNotConfigured;
  }

  let getDashboardContext: GetDashboardContext = getDashboardContextNotConfigured;
  let getDashboardOverview: GetDashboardOverview = getDashboardOverviewNotConfigured;
  let getDashboardRfm: GetDashboardRfm = getDashboardRfmNotConfigured;
  let getDashboardClusters: GetDashboardClusters = getDashboardClustersNotConfigured;
  let getDashboardIntersection: GetDashboardIntersection = getDashboardIntersectionNotConfigured;

  let answerCustomerIntelligenceQuestion: AnswerCustomerIntelligenceQuestion = async () => ({
    status: 'analytics_unavailable',
    finalResponseState: 'failure',
    message: 'marketing_copilot_not_configured',
    contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_CONTRACT_VERSION,
  });
  let customerIntelligenceCopilotSessionService: CustomerIntelligenceCopilotSessionService | undefined;
  const copilotModel = createConfiguredCustomerIntelligenceCopilotModel();
  if (config.analyticsDb) {
    const analyticsPool = getAnalyticsPool();
    const intelligenceReader = createMysqlCustomerIntelligenceReader(analyticsPool);
    const resolvers = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: createMysqlCustomerFeatureSnapshotReader(analyticsPool),
      snapshotHeaderReader: createMysqlSnapshotHeaderReader(analyticsPool),
      intelligenceReader,
    });

    // Customer Intelligence Dashboard core readers (MARKETING-R1-T06.2) - gated purely on
    // config.analyticsDb, the same capability boundary the read model itself uses (task Section
    // 1). Deliberately NOT nested inside the copilotModel.status==='configured' check below -
    // the dashboard has no LLM dependency and must keep working even when no LLM key is set.
    const clusterAnalyticsReader = createMysqlClusterAnalyticsReader(analyticsPool);
    const dashboardAnalyticsReader = createMysqlDashboardAnalyticsReader(analyticsPool);
    getDashboardContext = createGetDashboardContext({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      clusterAnalyticsReader,
    });
    getDashboardOverview = createGetDashboardOverview({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      clusterAnalyticsReader,
      dashboardAnalyticsReader,
    });
    getDashboardRfm = createGetDashboardRfm({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      clusterAnalyticsReader,
      dashboardAnalyticsReader,
    });
    getDashboardClusters = createGetDashboardClusters({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      clusterAnalyticsReader,
      dashboardAnalyticsReader,
    });

    // Dashboard Intersections (MARKETING-R1-T06.3) - reuses the exact same T03 executor the
    // Copilot uses below (createExecuteAnalyticalQueryWithResolvedContext), built once here so
    // both consumers share one instance rather than two. Also has no LLM dependency: wired
    // regardless of copilotModel.status, same as the other dashboard readers above.
    const analyticalQueryExecutor = createMysqlAnalyticalQueryExecutor(getAnalyticsQueryExecutor());
    const executeAnalyticalQueryWithResolvedContext = createExecuteAnalyticalQueryWithResolvedContext({
      queryExecutor: analyticalQueryExecutor,
    });
    // task MARKETING-R1-T06.4 Section 3: the same dashboard-agnostic T06.3 adapter, built once
    // and shared by the Dashboard Intersections endpoint above and the Copilot's uiContext
    // adapter below - never a second executeIntersection instance.
    const executeIntersection = createExecuteIntersection({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      executeAnalyticalQueryWithResolvedContext,
    });
    getDashboardIntersection = createGetDashboardIntersection({
      executeIntersection,
      clusterAnalyticsReader,
    });

    // The Copilot additionally requires an LLM model to be configured - the dashboard readers
    // above have no such dependency and are already wired regardless of copilotModel.status.
    if (copilotModel.status === 'configured') {
      answerCustomerIntelligenceQuestion = createAnswerCustomerIntelligenceQuestion({
        getAnalyticalSchema,
        resolveCurrent: resolvers.resolveCurrent,
        resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
        executeAnalyticalQuery: executeAnalyticalQueryWithResolvedContext,
        model: copilotModel.model,
      });
      customerIntelligenceCopilotSessionService = createCustomerIntelligenceCopilotSessionService({
        getAnalyticalSchema,
        resolveCurrent: resolvers.resolveCurrent,
        resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
        executeAnalyticalQuery: executeAnalyticalQueryWithResolvedContext,
        executeAnalyticalQueryForExport: createExecuteAnalyticalQueryForExport({
          queryExecutor: analyticalQueryExecutor,
        }),
        executeIntersection,
        model: copilotModel.model,
        store: createMysqlCopilotSessionStore(analyticsPool),
        clock: systemClock,
        limits: config.marketingCopilot.session,
        toolRuntimeEnabled: config.marketingCopilot.toolRuntimeEnabled,
        unifiedPlannerEnabled: config.marketingCopilot.unifiedPlannerEnabled,
        synthesisMaxTokens: config.marketingCopilot.synthesisMaxTokens,
        toolSelectionTimeoutMs: copilotModel.toolSelectionTimeoutMs,
        toolSynthesisTimeoutMs: copilotModel.toolSynthesisTimeoutMs,
        onOrchestratorDiagnostic: (diagnostic) => {
          console.info(diagnostic, 'customer intelligence copilot orchestrator decision');
        },
        onPlannerDiagnostic: (diagnostic) => {
          console.info(diagnostic, 'customer intelligence copilot planner validation');
        },
        onStageLatencyDiagnostic: (diagnostic) => {
          console.info(diagnostic, 'customer intelligence copilot stage latency');
        },
      });
    }
  }

  const checkReadiness: ReadinessCheck = async () => {
    const [prestashop, crmResult] = await Promise.all([
      checkPrestashopReadiness(config.prestashopDb.prefix),
      checkCrmReadiness().catch((): CrmReadinessResult => ({ status: 'not_ready', reason: 'crm_unavailable' })),
    ]);
    return { prestashop, crm: crmResult.status === 'ready' };
  };

  return {
    resolveCustomerIdentity,
    getCustomerProfile,
    getCustomerOrderStatus,
    getCustomerCommercialSummary,
    getCustomerPurchasedProducts,
    getCustomerPurchaseBehavior,
    getCustomerRfm,
    getCustomerRfmByCustomerId,
    getCustomerCluster,
    getClusterSnapshotSummary,
    getRfmClusterCrossTab,
    getDashboardContext,
    getDashboardOverview,
    getDashboardRfm,
    getDashboardClusters,
    getDashboardIntersection,
    answerCustomerIntelligenceQuestion,
    customerIntelligenceCopilotSessionService,
    checkReadiness,
    shutdown: async () => {
      await Promise.all([closePrestashopPool(), closeCrmPool(), closeRfmSnapshotPool(), closeClusterPool(), closeAnalyticsPool()]);
    },
  };
}
