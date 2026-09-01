export type CustomerAffinityPurchaseEvidence = {
  readonly customerId: number;
  readonly orderId: number;
  readonly orderDetailId?: number;
  readonly orderCreatedAt: string;
  readonly productId: number;
  readonly lineRevenueTaxIncl: string;
};

export type CustomerAffinityPurchaseReaderPolicy = {
  readonly excludedOperationalCustomerIds: readonly number[];
};

export type CustomerAffinityPurchaseEvidenceReader = {
  readEvidence(referenceTime: string, options?: CustomerAffinityPurchaseReadOptions): Promise<readonly CustomerAffinityPurchaseEvidence[]>;
  getLastReadMetrics(): CustomerAffinityPurchaseReadMetrics;
};

export type CustomerAffinityPurchaseReadOptions = {
  readonly batchSize?: number;
  readonly maxRetries?: number;
  readonly onProgress?: (progress: CustomerAffinityPurchaseReadProgress) => void;
};

export type CustomerAffinityPurchaseReadProgress = {
  readonly batchNumber: number;
  readonly ordersProcessed: number;
  readonly linesProcessed: number;
  readonly lastSeenOrderId: number;
  readonly sourceWatermarkOrderId: number | null;
  readonly elapsedMs: number;
};

export type CustomerAffinityPurchaseReadMetrics = {
  readonly sourceWatermarkOrderId: number | null;
  readonly sourceQueries: number;
  readonly batches: number;
  readonly sourceOrdersRead: number;
  readonly sourceLinesRead: number;
  readonly retries: number;
  readonly durationMs: number;
};
