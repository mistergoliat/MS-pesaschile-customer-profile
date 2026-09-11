import { buildApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { logShutdownFailure } from './observability/log-shutdown-failure.js';
import { createAudienceExportLimiter } from './application/customer-intelligence-audience/export-limiter.js';

const {
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
  getCustomerClv,
  getCustomerClvSnapshot,
  getCustomerCommercialAffinity,
  getCustomerCommercialAffinitySnapshot,
  getCustomerIntelligenceRow,
  customerCommercialProfileService,
  customerIntelligenceAudienceCapability,
  customerIntelligenceAudienceMembership,
  customerIntelligenceAudienceExport,
  answerCustomerIntelligenceQuestion,
  customerIntelligenceCopilotSessionService,
  checkReadiness,
  shutdown,
} = bootstrap();
const app = buildApp({
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
  getCustomerClv,
  getCustomerClvSnapshot,
  getCustomerCommercialAffinity,
  getCustomerCommercialAffinitySnapshot,
  getCustomerIntelligenceRow,
  customerCommercialProfileService,
  customerIntelligenceAudienceCapability,
  customerIntelligenceAudienceMembership,
  customerIntelligenceAudienceExportAuth: {
    enabled: config.analyticsDb !== null,
    internalToken: config.audienceExport.exportToken,
    piiToken: config.audienceExport.piiToken,
    timeoutMs: config.audienceExport.timeoutMs,
  },
  customerIntelligenceAudience: {
    enabled: config.customerIntelligenceAudience.enabled,
    internalToken: config.customerIntelligenceAudience.internalToken,
  },
  customerIntelligenceAudienceExportLimiter: createAudienceExportLimiter({
    csvConcurrency: config.audienceExport.csvConcurrency,
    xlsxConcurrency: config.audienceExport.xlsxConcurrency,
    startsPerMinute: config.audienceExport.rateLimitPerMinute,
  }),
  customerIntelligenceAudienceExport,
  answerCustomerIntelligenceQuestion,
  customerIntelligenceCopilotSessionService,
  marketingCopilot: config.marketingCopilot,
  checkReadiness,
});

const server = app.listen(config.port, () => {
  console.info({ port: config.port }, 'Customer Profile service started');
});

function shutdownServer(signal: string): void {
  console.info({ signal }, 'Shutting down Customer Profile service');
  server.close(() => {
    shutdown()
      .catch(logShutdownFailure)
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdownServer('SIGTERM'));
process.on('SIGINT', () => shutdownServer('SIGINT'));
