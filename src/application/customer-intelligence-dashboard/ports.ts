// Dedicated dashboard read port (task MARKETING-R1-T06.2 Section 8) - grouped aggregate
// queries, deliberately separate from CustomerIntelligenceReader (application/customer-
// intelligence/ports.ts), which reads one row per customer for T03/Copilot. Dashboard tiles
// need pre-aggregated distributions, not per-customer rows, so a second, purpose-built reader
// avoids forcing T03's generic per-row shape into a GROUP BY use case (same precedent as
// ClusterAnalyticsReader/RfmSegmentBulkReader already being separate from the single-customer
// serving readers). Cluster interpretation label/description is NOT part of this port - it is
// fetched via clustering's own, already-tested ClusterAnalyticsReader.getInterpretations()
// (infrastructure/clustering/mysql-cluster-analytics-reader.ts), reused verbatim.

export type DashboardOverviewCommercialAggregate = {
  readonly totalSpentTaxIncl: string;
  readonly totalValidOrders: number;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageValidOrders: string;
  readonly averageOrders365d: string;
  readonly averageDaysSinceLastOrder: string;
  readonly averagePurchaseFrequencyDays: string | null;
  readonly purchaseFrequencyDaysSampleSize: number;
};

export type DashboardRfmSegmentAggregate = {
  readonly segmentCode: string | null;
  readonly customerCount: number;
  readonly averageRScore: string;
  readonly averageFScore: string;
  readonly averageMScore: string;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageDaysSinceLastOrder: string;
};

export type DashboardClusterAggregate = {
  readonly clusterId: number;
  readonly customerCount: number;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageOrders365d: string;
  readonly averageDaysSinceLastOrder: string;
  readonly averageEffectiveDiversity: string;
  readonly averageRepeatProductRate: string;
};

// One (clusterId, hasRfmRow, segmentCode) group. hasRfmRow=false means the customer has no row
// at all in the resolved RFM snapshot (excluded from the RFM-comparable population); segmentCode
// is only meaningful when hasRfmRow=true, and null there means a matched-but-unsegmented legacy
// row (task Section 19 test S) - never conflated (see application-layer mapping).
export type DashboardClusterRfmCrossSectionGroup = {
  readonly clusterId: number;
  readonly hasRfmRow: boolean;
  readonly segmentCode: string | null;
  readonly customerCount: number;
};

export type DashboardAnalyticsReader = {
  getOverviewCommercialAggregate(featureSnapshotId: string): Promise<DashboardOverviewCommercialAggregate>;
  getRfmSegmentAggregates(rfmSnapshotId: string, featureSnapshotId: string): Promise<readonly DashboardRfmSegmentAggregate[]>;
  getClusterAggregates(clusterSnapshotId: string, featureSnapshotId: string): Promise<readonly DashboardClusterAggregate[]>;
  // Base population is cluster row INNER JOIN feature row (same clusterMatched population the
  // aggregate query above and the read model's own coverage counting use) - never plain cluster
  // population alone, so a cluster's cross-section total always reconciles with its
  // getClusterAggregates customerCount for the same (clusterSnapshotId, featureSnapshotId).
  getClusterRfmCrossSectionGroups(
    clusterSnapshotId: string,
    featureSnapshotId: string,
    rfmSnapshotId: string,
  ): Promise<readonly DashboardClusterRfmCrossSectionGroup[]>;
};
