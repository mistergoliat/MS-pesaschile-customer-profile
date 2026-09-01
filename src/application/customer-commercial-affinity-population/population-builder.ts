import type {
  CustomerCommercialAffinityAxis,
  CustomerCommercialAffinityRow,
  ProductSemanticClassificationStatus,
  ProductSemanticFact,
} from '../../domain/customer-commercial-affinity/index.js';
import {
  assertValidAffinityRow,
  assertValidProductSemanticFact,
  isDisciplineEligible,
  isProductFamilyEligible,
  isUseContextEligible,
  scoreCustomerCommercialAffinity,
  expandSemanticEvidence,
  type CustomerCommercialAffinityProductPurchase,
  customerCommercialAffinityCalculationVersion,
} from '../../domain/customer-commercial-affinity/index.js';
import { addDecimals } from '../../shared/decimal.js';
import { sha256Stable } from '../../shared/stable-checksum.js';
import { divideDecimalToBehaviorDecimal, divideIntegerToBehaviorDecimal } from '../customer-purchase-behavior/behavior-decimal.js';
import { calculateCustomerCommercialAffinityDatasetChecksum } from './affinity-dataset-checksum.js';
import type { ProductSemanticSnapshotConsumerMetadata } from '../product-semantic-snapshot/consumer.js';
import type { CustomerAffinityPurchaseEvidence } from './ports.js';

export const CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION = 'customer-commercial-affinity-population-v1';
export const CUSTOMER_COMMERCIAL_AFFINITY_ORDER_POLICY_VERSION = 'valid-positive-clp-order-before-reference-time-v1';

type SnapshotLineage = Pick<
  ProductSemanticSnapshotConsumerMetadata,
  'snapshotId' | 'schemaVersion' | 'ontologyVersion' | 'ontologyHash' | 'sourceSemanticChecksum' | 'consumerNormalizedChecksum'
>;

export type CustomerCommercialAffinityPopulationInput = {
  readonly referenceTime: string;
  readonly purchases: readonly CustomerAffinityPurchaseEvidence[];
  readonly semanticSnapshot: {
    readonly metadata: SnapshotLineage;
    readonly facts: readonly ProductSemanticFact[];
  };
  readonly populationPolicyVersion?: string;
  readonly sampleCustomerIds?: readonly number[];
};

export type AffinityStatusDiagnostic = {
  readonly lineCount: number;
  readonly customerCount: number;
  readonly distinctProductCount: number;
  readonly spend: string;
};

export type AffinityCodeDistribution = {
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string;
  readonly customerCount: number;
  readonly supportingSpend: string;
  readonly meanScore: number;
};

export type CustomerAffinitySanitySample = {
  readonly customerId: number;
  readonly purchasedProducts: readonly number[];
  readonly semanticFacts: readonly {
    readonly productId: number;
    readonly classificationStatus: ProductSemanticClassificationStatus | 'NO_SEMANTIC_EVIDENCE';
    readonly axes: readonly CustomerCommercialAffinityAxis[];
  }[];
  readonly affinityRows: readonly CustomerCommercialAffinityRow[];
};

export type CustomerCommercialAffinityPopulationManifest = {
  readonly calculationVersion: string;
  readonly referenceTime: string;
  readonly populationPolicyVersion: string;
  readonly orderEligibilityPolicyVersion: string;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSnapshotVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly sourceSemanticChecksum: string;
  readonly consumerSemanticChecksum: string;
  readonly sourceCustomerCount: number;
  readonly eligibleCustomerCount: number;
  readonly customersWithAffinityRows: number;
  readonly customersWithoutAffinityRows: number;
  readonly customersWithoutSemanticEvidence: number;
  readonly eligibleOrderCount: number;
  readonly eligibleOrderLineCount: number;
  readonly purchasedDistinctProductCount: number;
  readonly purchasedProductsWithSemanticFact: number;
  readonly purchasedProductsWithoutSemanticFact: number;
  readonly affinityRowCount: number;
  readonly datasetChecksum: string;
  readonly affinityDatasetChecksum: string;
  readonly checksum: string;
  readonly coverage: {
    readonly customer: number;
    readonly orderLine: number;
    readonly spend: number;
    readonly product: number;
  };
  readonly statusDiagnostics: Readonly<Record<string, AffinityStatusDiagnostic>>;
  readonly rowsByAxis: Readonly<Record<CustomerCommercialAffinityAxis, number>>;
  readonly distinctCodesByAxis: Readonly<Record<CustomerCommercialAffinityAxis, number>>;
  readonly customersByAxis: Readonly<Record<CustomerCommercialAffinityAxis, number>>;
  readonly rowsPerCustomerDistribution: ScoreDistribution;
  readonly scoreDistributionByAxis: Readonly<Record<CustomerCommercialAffinityAxis, ScoreDistribution>>;
  readonly supportingOrderCountAudit: ScoreDistribution;
  readonly topCodes: {
    readonly byCustomerCoverage: readonly AffinityCodeDistribution[];
    readonly bySupportingSpend: readonly AffinityCodeDistribution[];
    readonly byMeanScore: readonly AffinityCodeDistribution[];
  };
  readonly unknownProducts: readonly {
    readonly productId: number;
    readonly orderLineCount: number;
    readonly customerCount: number;
    readonly spend: string;
  }[];
  readonly customerSanitySample: readonly CustomerAffinitySanitySample[];
};

export type ScoreDistribution = {
  readonly min: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly max: number | null;
  readonly mean: number | null;
};

export type CustomerCommercialAffinityPopulation = {
  readonly manifest: CustomerCommercialAffinityPopulationManifest;
  readonly rows: readonly CustomerCommercialAffinityRow[];
};

type ProductAggregate = {
  readonly customerId: number;
  readonly productId: number;
  readonly orderIds: Set<number>;
  readonly lineDates: string[];
  readonly spendValues: string[];
};

type LineWithKey = CustomerAffinityPurchaseEvidence & { readonly canonicalDate: string };

export function buildCustomerCommercialAffinityPopulation(
  input: CustomerCommercialAffinityPopulationInput,
): CustomerCommercialAffinityPopulation {
  const referenceTime = canonicalTimestamp(input.referenceTime, 'referenceTime');
  const factsByProduct = buildFactMap(input.semanticSnapshot);
  const lines = input.purchases.map((purchase) => normalizePurchase(purchase, referenceTime)).filter((line): line is LineWithKey => line !== null).sort(comparePurchases);
  const customerIds = new Set(lines.map((line) => line.customerId));
  const orderKeys = new Set(lines.map((line) => `${line.customerId}:${line.orderId}`));
  const productAggregates = aggregateProducts(lines);
  const customerSpend = aggregateCustomerSpend(productAggregates);
  const customerOrderCounts = aggregateCustomerOrderCounts(lines);
  const scoredPurchases: Array<CustomerCommercialAffinityProductPurchase & { readonly customerId: number }> = [];
  const exactOrderIdsByRow = new Map<string, Set<number>>();
  const unknownProductStats = new Map<number, { lineCount: number; customerIds: Set<number>; spend: string[] }>();
  const linesByAggregate = groupLinesByAggregate(lines);

  for (const [key, aggregate] of productAggregates) {
    const fact = factsByProduct.get(aggregate.productId);
    if (!fact) {
      for (const line of linesByAggregate.get(key) ?? []) {
        const stat = unknownProductStats.get(line.productId) ?? { lineCount: 0, customerIds: new Set<number>(), spend: [] };
        stat.lineCount += 1;
        stat.customerIds.add(line.customerId);
        stat.spend.push(line.lineRevenueTaxIncl);
        unknownProductStats.set(line.productId, stat);
      }
      continue;
    }
    const purchase = toPurchaseBehaviorProduct(aggregate, customerSpend.get(aggregate.customerId)!, customerOrderCounts.get(aggregate.customerId)!, referenceTime);
    scoredPurchases.push({ customerId: aggregate.customerId, purchase, semanticFact: fact });
    const contributingEvidence = expandSemanticEvidence(purchase, fact);
    for (const evidence of contributingEvidence) {
      const rowKey = affinityKey(aggregate.customerId, evidence.axis, evidence.code);
      const orderIds = exactOrderIdsByRow.get(rowKey) ?? new Set<number>();
      for (const line of linesByAggregate.get(key) ?? []) orderIds.add(line.orderId);
      exactOrderIdsByRow.set(rowKey, orderIds);
    }
  }

  const rowsByCustomer = new Map<number, CustomerCommercialAffinityRow[]>();
  for (const scored of groupScoredPurchases(scoredPurchases)) {
    const provisionalRows = scoreCustomerCommercialAffinity(scored);
    for (const row of provisionalRows) {
      const exactOrderCount = exactOrderIdsByRow.get(affinityKey(row.customerId, row.affinityAxis, row.affinityCode))?.size ?? 0;
      const exactRow = { ...row, supportingOrderCount: exactOrderCount };
      assertValidAffinityRow(exactRow);
      const customerRows = rowsByCustomer.get(row.customerId) ?? [];
      customerRows.push(exactRow);
      rowsByCustomer.set(row.customerId, customerRows);
    }
  }
  const rows = [...rowsByCustomer.values()].flat().sort(compareRows);
  const customersWithRows = new Set(rows.map((row) => row.customerId));
  const customersWithoutSemanticEvidence = [...customerIds].filter((customerId) => !customersWithRows.has(customerId)).length;
  const totalSpend = addDecimals(lines.map((line) => line.lineRevenueTaxIncl));
  const contributingLines = lines.filter((line) => hasContributingFact(factsByProduct.get(line.productId)));
  const contributingSpend = addDecimals(contributingLines.map((line) => line.lineRevenueTaxIncl));
  const productsWithFact = [...new Set(lines.map((line) => line.productId))].filter((id) => factsByProduct.has(id)).length;
  const manifestWithoutChecksums = buildManifestWithoutChecksums({
    input,
    referenceTime,
    lines,
    orderKeys,
    customerIds,
    rows,
    customersWithRows,
    customersWithoutSemanticEvidence,
    factsByProduct,
    totalSpend,
    contributingSpend,
    contributingLines,
    productsWithFact,
    unknownProductStats,
    rowsByCustomer,
  });
  const datasetChecksum = sha256Stable({ referenceTime, purchases: lines.map(toChecksumPurchase) });
  const affinityDatasetChecksum = calculateCustomerCommercialAffinityDatasetChecksum({
    referenceTime,
    semanticSnapshot: input.semanticSnapshot.metadata,
    rows,
  });
  const manifest: CustomerCommercialAffinityPopulationManifest = {
    ...manifestWithoutChecksums,
    datasetChecksum,
    affinityDatasetChecksum,
    checksum: affinityDatasetChecksum,
  };
  return { manifest, rows };
}

function buildManifestWithoutChecksums(input: {
  readonly input: CustomerCommercialAffinityPopulationInput;
  readonly referenceTime: string;
  readonly lines: readonly LineWithKey[];
  readonly orderKeys: ReadonlySet<string>;
  readonly customerIds: ReadonlySet<number>;
  readonly rows: readonly CustomerCommercialAffinityRow[];
  readonly customersWithRows: ReadonlySet<number>;
  readonly customersWithoutSemanticEvidence: number;
  readonly factsByProduct: ReadonlyMap<number, ProductSemanticFact>;
  readonly totalSpend: string;
  readonly contributingSpend: string;
  readonly contributingLines: readonly LineWithKey[];
  readonly productsWithFact: number;
  readonly unknownProductStats: ReadonlyMap<number, { lineCount: number; customerIds: Set<number>; spend: string[] }>;
  readonly rowsByCustomer: ReadonlyMap<number, readonly CustomerCommercialAffinityRow[]>;
}): Omit<CustomerCommercialAffinityPopulationManifest, 'datasetChecksum' | 'affinityDatasetChecksum' | 'checksum'> {
  const axes: readonly CustomerCommercialAffinityAxis[] = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'];
  const rowsByAxis = Object.fromEntries(axes.map((axis) => [axis, input.rows.filter((row) => row.affinityAxis === axis).length])) as Record<CustomerCommercialAffinityAxis, number>;
  const distinctCodesByAxis = Object.fromEntries(axes.map((axis) => [axis, new Set(input.rows.filter((row) => row.affinityAxis === axis).map((row) => row.affinityCode)).size])) as Record<CustomerCommercialAffinityAxis, number>;
  const customersByAxis = Object.fromEntries(axes.map((axis) => [axis, new Set(input.rows.filter((row) => row.affinityAxis === axis).map((row) => row.customerId)).size])) as Record<CustomerCommercialAffinityAxis, number>;
  const productIds = new Set(input.lines.map((line) => line.productId));
  const statusDiagnostics = createStatusDiagnostics(input.lines, input.factsByProduct);
  const topCodes = codeDistributions(input.rows);
  return {
    calculationVersion: customerCommercialAffinityCalculationVersion,
    referenceTime: input.referenceTime,
    populationPolicyVersion: input.input.populationPolicyVersion ?? CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION,
    orderEligibilityPolicyVersion: CUSTOMER_COMMERCIAL_AFFINITY_ORDER_POLICY_VERSION,
    productSemanticSnapshotId: input.input.semanticSnapshot.metadata.snapshotId,
    productSemanticSnapshotVersion: input.input.semanticSnapshot.metadata.schemaVersion,
    ontologyVersion: input.input.semanticSnapshot.metadata.ontologyVersion,
    ontologyHash: input.input.semanticSnapshot.metadata.ontologyHash,
    sourceSemanticChecksum: input.input.semanticSnapshot.metadata.sourceSemanticChecksum,
    consumerSemanticChecksum: input.input.semanticSnapshot.metadata.consumerNormalizedChecksum,
    sourceCustomerCount: input.customerIds.size,
    eligibleCustomerCount: input.customerIds.size,
    customersWithAffinityRows: input.customersWithRows.size,
    customersWithoutAffinityRows: input.customerIds.size - input.customersWithRows.size,
    customersWithoutSemanticEvidence: input.customersWithoutSemanticEvidence,
    eligibleOrderCount: input.orderKeys.size,
    eligibleOrderLineCount: input.lines.length,
    purchasedDistinctProductCount: productIds.size,
    purchasedProductsWithSemanticFact: input.productsWithFact,
    purchasedProductsWithoutSemanticFact: productIds.size - input.productsWithFact,
    affinityRowCount: input.rows.length,
    coverage: {
      customer: percentage(input.customersWithRows.size, input.customerIds.size),
      orderLine: percentage(input.contributingLines.length, input.lines.length),
      spend: percentageDecimal(input.contributingSpend, input.totalSpend),
      product: percentage(input.productsWithFact, productIds.size),
    },
    statusDiagnostics,
    rowsByAxis,
    distinctCodesByAxis,
    customersByAxis,
    rowsPerCustomerDistribution: scoreDistribution([...input.rowsByCustomer.values()].map((rows) => rows.length)),
    scoreDistributionByAxis: Object.fromEntries(axes.map((axis) => [axis, scoreDistribution(input.rows.filter((row) => row.affinityAxis === axis).map((row) => row.score))])) as Record<CustomerCommercialAffinityAxis, ScoreDistribution>,
    supportingOrderCountAudit: scoreDistribution(input.rows.map((row) => row.supportingOrderCount)),
    topCodes,
    unknownProducts: [...input.unknownProductStats.entries()].map(([productId, stat]) => ({
      productId,
      orderLineCount: stat.lineCount,
      customerCount: stat.customerIds.size,
      spend: addDecimals(stat.spend),
    })).sort((left, right) => right.orderLineCount - left.orderLineCount || compareDecimalDesc(left.spend, right.spend) || left.productId - right.productId),
    customerSanitySample: buildCustomerSanitySample(input.input.sampleCustomerIds, input.customerIds, input.lines, input.factsByProduct, input.rowsByCustomer),
  };
}

function buildFactMap(snapshot: CustomerCommercialAffinityPopulationInput['semanticSnapshot']): Map<number, ProductSemanticFact> {
  const factsByProduct = new Map<number, ProductSemanticFact>();
  for (const fact of snapshot.facts) {
    assertValidProductSemanticFact(fact);
    if (fact.ontologyVersion !== snapshot.metadata.ontologyVersion || fact.ontologyHash !== snapshot.metadata.ontologyHash) throw new Error(`Semantic fact ${fact.productId} has mismatched ontology lineage`);
    if (factsByProduct.has(fact.productId)) throw new Error(`Duplicate semantic fact productId: ${fact.productId}`);
    factsByProduct.set(fact.productId, fact);
  }
  return factsByProduct;
}

function aggregateProducts(lines: readonly LineWithKey[]): Map<string, ProductAggregate> {
  const aggregates = new Map<string, ProductAggregate>();
  for (const line of lines) {
    const key = `${line.customerId}:${line.productId}`;
    const existing = aggregates.get(key);
    if (existing) {
      existing.orderIds.add(line.orderId);
      existing.lineDates.push(line.canonicalDate);
      existing.spendValues.push(line.lineRevenueTaxIncl);
    } else {
      aggregates.set(key, {
        customerId: line.customerId,
        productId: line.productId,
        orderIds: new Set([line.orderId]),
        lineDates: [line.canonicalDate],
        spendValues: [line.lineRevenueTaxIncl],
      });
    }
  }
  return new Map([...aggregates.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function aggregateCustomerSpend(aggregates: ReadonlyMap<string, ProductAggregate>): Map<number, string> {
  const byCustomer = new Map<number, string[]>();
  for (const aggregate of aggregates.values()) {
    const values = byCustomer.get(aggregate.customerId) ?? [];
    values.push(addDecimals(aggregate.spendValues));
    byCustomer.set(aggregate.customerId, values);
  }
  return new Map([...byCustomer.entries()].map(([customerId, values]) => [customerId, addDecimals(values)]));
}

function aggregateCustomerOrderCounts(lines: readonly LineWithKey[]): Map<number, number> {
  const ordersByCustomer = new Map<number, Set<number>>();
  for (const line of lines) {
    const orderIds = ordersByCustomer.get(line.customerId) ?? new Set<number>();
    orderIds.add(line.orderId);
    ordersByCustomer.set(line.customerId, orderIds);
  }
  return new Map([...ordersByCustomer.entries()].map(([customerId, orderIds]) => [customerId, orderIds.size]));
}

function toPurchaseBehaviorProduct(aggregate: ProductAggregate, customerSpend: string, customerOrderCount: number, referenceTime: string): CustomerCommercialAffinityProductPurchase['purchase'] {
  const firstPurchasedAt = aggregate.lineDates.reduce((first, date) => Date.parse(date) < Date.parse(first) ? date : first);
  const lastPurchasedAt = aggregate.lineDates.reduce((last, date) => Date.parse(date) > Date.parse(last) ? date : last);
  const orderCount = aggregate.orderIds.size;
  const totalSpentTaxIncl = addDecimals(aggregate.spendValues);
  const daysSinceLastPurchase = Math.floor((Date.parse(referenceTime) - Date.parse(lastPurchasedAt)) / 86_400_000);
  const safeDaysSinceLastPurchase = Number.isFinite(daysSinceLastPurchase) && daysSinceLastPurchase >= 0 ? daysSinceLastPurchase : 0;
  return {
    productId: aggregate.productId,
    latestObservedProductName: '',
    latestObservedProductReference: null,
    variantCountPurchased: 1,
    repeatedVariantCount: orderCount >= 2 ? 1 : 0,
    orderCount,
    totalQuantityPurchased: 0,
    totalSpentTaxIncl,
    spendShare: divideDecimalToBehaviorDecimal(totalSpentTaxIncl, customerSpend),
    orderShare: divideIntegerToBehaviorDecimal(orderCount, customerOrderCount),
    quantityShare: '0.000000',
    firstPurchasedAt,
    lastPurchasedAt,
    daysSinceLastPurchase: safeDaysSinceLastPurchase,
    isRepeated: orderCount >= 2,
  };
}

function groupScoredPurchases(purchases: ReadonlyArray<CustomerCommercialAffinityProductPurchase & { readonly customerId: number }>): readonly { customerId: number; purchases: readonly CustomerCommercialAffinityProductPurchase[] }[] {
  const groups = new Map<number, CustomerCommercialAffinityProductPurchase[]>();
  for (const purchase of purchases) {
    const group = groups.get(purchase.customerId) ?? [];
    group.push(purchase);
    groups.set(purchase.customerId, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([customerId, group]) => ({ customerId, purchases: group.sort((a, b) => a.purchase.productId - b.purchase.productId) }));
}

function groupLinesByAggregate(lines: readonly LineWithKey[]): Map<string, readonly LineWithKey[]> {
  const groups = new Map<string, LineWithKey[]>();
  for (const line of lines) {
    const key = `${line.customerId}:${line.productId}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }
  return groups;
}

function normalizePurchase(purchase: CustomerAffinityPurchaseEvidence, referenceTime: string): LineWithKey | null {
  if (!Number.isSafeInteger(purchase.customerId) || purchase.customerId <= 0) throw new Error(`Invalid customerId: ${purchase.customerId}`);
  if (!Number.isSafeInteger(purchase.orderId) || purchase.orderId <= 0) throw new Error(`Invalid orderId: ${purchase.orderId}`);
  if (!Number.isSafeInteger(purchase.productId) || purchase.productId <= 0) throw new Error(`Invalid productId: ${purchase.productId}`);
  const canonicalDate = canonicalTimestamp(purchase.orderCreatedAt, 'orderCreatedAt');
  // The bulk reader applies the same cutoff in SQL. Keeping this defensive filter in the pure
  // builder makes historical/replayed inputs safe as well: the boundary is excluded, never
  // treated as a future/invalid build failure.
  if (Date.parse(canonicalDate) >= Date.parse(referenceTime)) return null;
  const lineRevenueTaxIncl = addDecimals([purchase.lineRevenueTaxIncl]);
  if (lineRevenueTaxIncl === '0.000000') throw new Error(`Purchase line ${purchase.orderId}/${purchase.productId} must have positive revenue`);
  if (purchase.orderDetailId !== undefined && (!Number.isSafeInteger(purchase.orderDetailId) || purchase.orderDetailId <= 0)) throw new Error(`Invalid orderDetailId: ${purchase.orderDetailId}`);
  return { ...purchase, lineRevenueTaxIncl, canonicalDate };
}

function comparePurchases(left: LineWithKey, right: LineWithKey): number {
  return left.customerId - right.customerId || left.orderId - right.orderId || left.productId - right.productId || (left.orderDetailId ?? 0) - (right.orderDetailId ?? 0) || left.lineRevenueTaxIncl.localeCompare(right.lineRevenueTaxIncl);
}

function createStatusDiagnostics(lines: readonly LineWithKey[], facts: ReadonlyMap<number, ProductSemanticFact>): Readonly<Record<string, AffinityStatusDiagnostic>> {
  const keys = ['NO_SEMANTIC_EVIDENCE', 'CLASSIFIED', 'PARTIALLY_CLASSIFIED', 'OTHER', 'EXCLUDED_NON_PRODUCT', 'NEEDS_REVIEW'];
  const result = new Map(keys.map((key) => [key, { lineCount: 0, customerIds: new Set<number>(), productIds: new Set<number>(), spend: [] as string[] }]));
  for (const line of lines) {
    const status = facts.get(line.productId)?.classificationStatus ?? 'NO_SEMANTIC_EVIDENCE';
    const stat = result.get(status)!;
    stat.lineCount += 1;
    stat.customerIds.add(line.customerId);
    stat.productIds.add(line.productId);
    stat.spend.push(line.lineRevenueTaxIncl);
  }
  return Object.fromEntries(keys.map((key) => {
    const stat = result.get(key)!;
    return [key, { lineCount: stat.lineCount, customerCount: stat.customerIds.size, distinctProductCount: stat.productIds.size, spend: addDecimals(stat.spend) }];
  }));
}

function hasContributingFact(fact: ProductSemanticFact | undefined): boolean {
  return fact !== undefined && (isProductFamilyEligible(fact) || isDisciplineEligible(fact) || isUseContextEligible(fact));
}

function codeDistributions(rows: readonly CustomerCommercialAffinityRow[]): CustomerCommercialAffinityPopulationManifest['topCodes'] {
  const byAxisCode = new Map<string, { axis: CustomerCommercialAffinityAxis; code: string; customers: Set<number>; spend: string[]; scores: number[] }>();
  for (const row of rows) {
    const key = `${row.affinityAxis}:${row.affinityCode}`;
    const current = byAxisCode.get(key) ?? { axis: row.affinityAxis, code: row.affinityCode, customers: new Set<number>(), spend: [], scores: [] };
    current.customers.add(row.customerId);
    current.spend.push(row.supportingSpend);
    current.scores.push(row.score);
    byAxisCode.set(key, current);
  }
  const distributions = [...byAxisCode.values()].map((entry) => ({ affinityAxis: entry.axis, affinityCode: entry.code, customerCount: entry.customers.size, supportingSpend: addDecimals(entry.spend), meanScore: round(entry.scores.reduce((sum, score) => sum + score, 0) / entry.scores.length) }));
  return {
    byCustomerCoverage: [...distributions].sort((a, b) => b.customerCount - a.customerCount || a.affinityAxis.localeCompare(b.affinityAxis) || a.affinityCode.localeCompare(b.affinityCode)).slice(0, 10),
    bySupportingSpend: [...distributions].sort((a, b) => compareDecimalDesc(a.supportingSpend, b.supportingSpend) || a.affinityAxis.localeCompare(b.affinityAxis) || a.affinityCode.localeCompare(b.affinityCode)).slice(0, 10),
    byMeanScore: [...distributions].sort((a, b) => b.meanScore - a.meanScore || a.affinityAxis.localeCompare(b.affinityAxis) || a.affinityCode.localeCompare(b.affinityCode)).slice(0, 10),
  };
}

function buildCustomerSanitySample(sampleIds: readonly number[] | undefined, customerIds: ReadonlySet<number>, lines: readonly LineWithKey[], facts: ReadonlyMap<number, ProductSemanticFact>, rowsByCustomer: ReadonlyMap<number, readonly CustomerCommercialAffinityRow[]>): readonly CustomerAffinitySanitySample[] {
  const ids = [...new Set(sampleIds ?? [...customerIds].sort((a, b) => a - b).slice(0, 10))].filter((id) => customerIds.has(id)).sort((a, b) => a - b);
  return ids.map((customerId) => {
    const productIds = [...new Set(lines.filter((line) => line.customerId === customerId).map((line) => line.productId))].sort((a, b) => a - b);
    return {
      customerId,
      purchasedProducts: productIds,
      semanticFacts: productIds.map((productId) => {
        const fact = facts.get(productId);
        return { productId, classificationStatus: fact?.classificationStatus ?? 'NO_SEMANTIC_EVIDENCE', axes: fact ? contributingAxes(fact) : [] };
      }),
      affinityRows: [...(rowsByCustomer.get(customerId) ?? [])].sort(compareRows),
    };
  });
}

function contributingAxes(fact: ProductSemanticFact): readonly CustomerCommercialAffinityAxis[] {
  return [
    ...(isProductFamilyEligible(fact) ? ['PRODUCT_FAMILY' as const] : []),
    ...(isDisciplineEligible(fact) ? ['DISCIPLINE' as const] : []),
    ...(isUseContextEligible(fact) ? ['USE_CONTEXT' as const] : []),
  ];
}

function scoreDistribution(values: readonly number[]): ScoreDistribution {
  if (values.length === 0) return { min: null, median: null, p75: null, p90: null, p95: null, p99: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0]!, median: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), p90: percentile(sorted, 0.9), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1]!, mean: round(values.reduce((sum, value) => sum + value, 0) / values.length) };
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round((numerator / denominator) * 100);
}

function percentageDecimal(numerator: string, denominator: string): number {
  return denominator === '0.000000' ? 0 : round(Number(divideDecimalToBehaviorDecimal(numerator, denominator)) * 100);
}

function canonicalTimestamp(value: string, name: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${name}`);
  return new Date(value).toISOString();
}

function affinityKey(customerId: number, axis: CustomerCommercialAffinityAxis, code: string): string {
  return `${customerId}\u0000${axis}\u0000${code}`;
}

function compareRows(left: CustomerCommercialAffinityRow, right: CustomerCommercialAffinityRow): number {
  return left.customerId - right.customerId || left.affinityAxis.localeCompare(right.affinityAxis) || left.affinityCode.localeCompare(right.affinityCode);
}

function compareDecimalDesc(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return rightNumber - leftNumber;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toChecksumPurchase(line: LineWithKey): Record<string, unknown> {
  return { customerId: line.customerId, orderId: line.orderId, orderDetailId: line.orderDetailId ?? null, orderCreatedAt: line.canonicalDate, productId: line.productId, lineRevenueTaxIncl: line.lineRevenueTaxIncl };
}
