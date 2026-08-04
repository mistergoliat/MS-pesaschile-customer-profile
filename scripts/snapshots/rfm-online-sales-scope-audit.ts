import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  buildRfmSnapshotDataset,
  buildRfmSnapshotWindow,
  buildRfmSourceRowsFromOrders,
  buildRfmDiagnosticsFromOrders,
  buildRfmUseCaseAnalysis,
  buildSignalCrossMatrix,
  buildSignalEvaluation,
  buildT08ScopeImpactSummary,
  buildT09ScopeImpactSummary,
  buildOnlineScopeVerdict,
  classifySalesChannelOrders,
  compareMetric,
  compareScope,
  addRfmDecimals,
  formatRfmDecimal,
  onlineSalesScopePolicyVersion,
  parseReferenceTime,
  stableStringify,
  summarizeAmbiguousOrders,
  summarizeClassifications,
  type HistoricalRfmOrderInput,
  type SalesChannelOrder,
  type SalesChannelOrderLine,
  type SalesChannelPolicy,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const outputDir = path.resolve('scripts/snapshots/rfm/online-scope-outputs');
const tables = {
  orders: `${config.prestashopDb.prefix}orders`,
  orderDetail: `${config.prestashopDb.prefix}order_detail`,
  customer: `${config.prestashopDb.prefix}customer`,
  shop: `${config.prestashopDb.prefix}shop`,
  product: `${config.prestashopDb.prefix}product`,
  productLang: `${config.prestashopDb.prefix}product_lang`,
};

const pool = mysql.createPool({
  host: config.prestashopDb.host,
  port: config.prestashopDb.port,
  user: config.prestashopDb.user,
  password: config.prestashopDb.password,
  database: config.prestashopDb.database,
  connectionLimit: 2,
  dateStrings: true,
  timezone: 'Z',
});

try {
  await mkdir(outputDir, { recursive: true });
  const [sellerServiceDiscoveryRows, orders] = await Promise.all([
    readSellerServiceDiscoveryRows(),
    readSalesChannelOrders(),
  ]);
  const inferredSellerServiceProductIds = inferSellerServiceProductIds(orders, sellerServiceDiscoveryRows);
  const sellerServiceProductIds = parseNumberListEnv('RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS', inferredSellerServiceProductIds);
  const genericCustomerCandidates = buildGenericCustomerCandidates(orders, sellerServiceProductIds);
  const genericCustomerIds = parseNumberListEnv(
    'RFM_CONFIRMED_GENERIC_CUSTOMER_IDS',
    genericCustomerCandidates
      .filter((candidate) => candidate.classification !== 'UNRESOLVED')
      .slice(0, 3)
      .map((candidate) => candidate.technicalCustomerId),
  );
  const policy = buildPolicy({
    sellerServiceProductIds,
    genericCustomerIds,
    storeShopIds: parseNumberListEnv('RFM_CONFIRMED_STORE_SHOP_IDS', []),
    storeModules: parseStringListEnv('RFM_CONFIRMED_STORE_MODULES', []),
  });

  const classified = classifySalesChannelOrders(orders, policy);
  const onlineOrders = classified.filter((order) => order.classifiedSalesChannel === 'online');
  const beforeRfm = buildRfmAnalysis(referenceTime, orders);
  const afterRfm = buildRfmAnalysis(referenceTime, onlineOrders);
  const beforeUseCases = buildRfmUseCaseAnalysis({
    referenceTime,
    calculationVersion,
    operationalRows: beforeRfm.rows,
    historicalOrders: toHistoricalOrders(orders),
  });
  const afterUseCases = buildRfmUseCaseAnalysis({
    referenceTime,
    calculationVersion,
    operationalRows: afterRfm.rows,
    historicalOrders: toHistoricalOrders(onlineOrders),
  });

  const shopInventory = buildShopInventory(await readShops(), orders, sellerServiceProductIds, genericCustomerIds);
  const paymentModuleInventory = buildPaymentModuleInventory(orders);
  const carrierInventory = buildCarrierInventory(orders);
  const sellerServiceCandidates = buildSellerServiceCandidates(orders, sellerServiceDiscoveryRows);
  const crossMatrix = buildSignalCrossMatrix(orders, policy);
  const policyComparison = buildPolicyComparison(orders, policy, sellerServiceProductIds, genericCustomerIds);
  const ambiguous = summarizeAmbiguousOrders(classified, policy);
  const rfmBeforeAfter = buildRfmBeforeAfter(beforeRfm, afterRfm);
  const cohortBeforeAfter = buildCohortBeforeAfter(beforeUseCases, afterUseCases);
  const t08Impact = buildT08ScopeImpactSummary(orders, onlineOrders, policy);
  const t09Impact = buildT09ScopeImpactSummary(orders, onlineOrders, policy);
  const verdict = buildOnlineScopeVerdict(classified, policy);

  await writeJson('shop-inventory.json', shopInventory);
  await writeJson('payment-module-inventory.json', paymentModuleInventory);
  await writeJson('carrier-inventory.json', carrierInventory);
  await writeJson('seller-service-candidates.json', sellerServiceCandidates);
  await writeJson('generic-customer-candidates.json', genericCustomerCandidates);
  await writeJson('signal-cross-matrix.json', crossMatrix);
  await writeJson('classification-policy-comparison.json', {
    signalEvaluation: buildSignalEvaluation(classified, policy),
    policyComparison,
    classificationSummary: summarizeClassifications(classified),
    policy: publicPolicy(policy),
  });
  await writeJson('ambiguous-orders-summary.json', ambiguous);
  await writeJson('rfm-before-after.json', rfmBeforeAfter);
  await writeJson('t11a3-cohort-before-after.json', cohortBeforeAfter);
  await writeJson('t08-impact-summary.json', t08Impact);
  await writeJson('t09-impact-summary.json', t09Impact);
  await writeJson('online-scope-verdict.json', {
    ...verdict,
    outlierImpact: buildOutlierImpact(beforeRfm, afterRfm, orders, onlineOrders, policy),
  });

  console.info(stableStringify({
    verdict,
    policyComparison: compareScope(classified),
    rfmBeforeAfter: {
      operationalCustomerCount: rfmBeforeAfter.operationalCustomerCount,
      maximumFrequency: rfmBeforeAfter.maximumFrequency,
    },
  }));
} finally {
  await pool.end();
}

type SellerDiscoveryRow = {
  readonly productId: number;
  readonly reference: string | null;
  readonly active: number;
  readonly languageCount: number;
  readonly matchedTerms: readonly string[];
  readonly nameChecksum: string;
};

type ShopRow = {
  readonly shopId: number;
  readonly shopGroupId: number | null;
  readonly active: number | null;
};

type RfmBuiltForScope = {
  readonly rows: ReturnType<typeof buildRfmSnapshotDataset>['rows'];
  readonly manifest: ReturnType<typeof buildRfmSnapshotDataset>['manifest'];
};

async function readSalesChannelOrders(): Promise<readonly SalesChannelOrder[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
      SELECT
        o.id_order AS orderId,
        o.id_customer AS prestashopCustomerId,
        o.id_shop AS shopId,
        o.id_shop_group AS shopGroupId,
        o.module AS module,
        o.payment AS payment,
        o.id_carrier AS carrierId,
        o.date_add AS validOrderAt,
        o.total_paid_tax_incl AS grossOrderValueTaxIncl,
        od.product_id AS productId,
        od.product_attribute_id AS productAttributeId,
        od.product_reference AS productReference,
        od.product_quantity AS quantity,
        od.unit_price_tax_incl AS unitPriceTaxIncl,
        od.total_price_tax_incl AS totalPriceTaxIncl
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      INNER JOIN ${tables.orderDetail} od
        ON od.id_order = o.id_order
      WHERE o.valid = 1
        AND o.id_customer > 0
        AND o.date_add < ?
      ORDER BY o.id_order ASC, od.id_order_detail ASC
    `,
    [toMysqlDateTime(referenceTime)],
  );
  const byOrder = new Map<number, SalesChannelOrder & { lines: SalesChannelOrderLine[] }>();
  for (const row of rows) {
    const orderId = Number(row.orderId);
    const line: SalesChannelOrderLine = {
      productId: Number(row.productId),
      productAttributeId: Number(row.productAttributeId ?? 0),
      productReference: row.productReference === null || row.productReference === undefined ? null : String(row.productReference),
      quantity: Number(row.quantity ?? 0),
      unitPriceTaxIncl: formatRfmDecimal(String(row.unitPriceTaxIncl ?? '0')),
      totalPriceTaxIncl: formatRfmDecimal(String(row.totalPriceTaxIncl ?? '0')),
    };
    const existing = byOrder.get(orderId);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    byOrder.set(orderId, {
      orderId,
      prestashopCustomerId: Number(row.prestashopCustomerId),
      shopId: Number(row.shopId),
      shopGroupId: row.shopGroupId === null || row.shopGroupId === undefined ? null : Number(row.shopGroupId),
      module: row.module === null || row.module === undefined ? null : String(row.module),
      payment: row.payment === null || row.payment === undefined ? null : String(row.payment),
      carrierId: row.carrierId === null || row.carrierId === undefined ? null : Number(row.carrierId),
      validOrderAt: String(row.validOrderAt),
      grossOrderValueTaxIncl: formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0')),
      lines: [line],
    });
  }
  return Array.from(byOrder.values());
}

async function readSellerServiceDiscoveryRows(): Promise<readonly SellerDiscoveryRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
      SELECT
        p.id_product AS productId,
        p.reference AS reference,
        p.active AS active,
        COUNT(DISTINCT pl.id_lang) AS languageCount,
        GROUP_CONCAT(DISTINCT LOWER(pl.name) SEPARATOR ' | ') AS namesJoined
      FROM ${tables.product} p
      INNER JOIN ${tables.productLang} pl
        ON pl.id_product = p.id_product
      WHERE LOWER(pl.name) LIKE '%vendedor%'
         OR LOWER(pl.name) LIKE '%servicio%'
         OR LOWER(pl.name) LIKE '%ajuste%'
         OR LOWER(pl.name) LIKE '%sii%'
         OR LOWER(pl.name) LIKE '%redondeo%'
         OR LOWER(pl.name) LIKE '%diferencia%'
         OR LOWER(p.reference) LIKE '%vendedor%'
         OR LOWER(p.reference) LIKE '%servicio%'
      GROUP BY p.id_product, p.reference, p.active
      ORDER BY p.id_product ASC
    `,
  );
  return rows.map((row) => {
    const namesJoined = String(row.namesJoined ?? '');
    const terms = ['vendedor', 'servicio', 'ajuste', 'sii', 'redondeo', 'diferencia'].filter((term) =>
      namesJoined.includes(term) || String(row.reference ?? '').toLowerCase().includes(term),
    );
    return {
      productId: Number(row.productId),
      reference: row.reference === null || row.reference === undefined ? null : String(row.reference),
      active: Number(row.active ?? 0),
      languageCount: Number(row.languageCount ?? 0),
      matchedTerms: terms,
      nameChecksum: awaitlessSha(namesJoined),
    };
  });
}

async function readShops(): Promise<readonly ShopRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
      SELECT id_shop AS shopId, id_shop_group AS shopGroupId, active
      FROM ${tables.shop}
      ORDER BY id_shop ASC
    `,
  );
  return rows.map((row) => ({
    shopId: Number(row.shopId),
    shopGroupId: row.shopGroupId === null || row.shopGroupId === undefined ? null : Number(row.shopGroupId),
    active: row.active === null || row.active === undefined ? null : Number(row.active),
  }));
}

function buildPolicy(input: {
  readonly sellerServiceProductIds: readonly number[];
  readonly genericCustomerIds: readonly number[];
  readonly storeShopIds: readonly number[];
  readonly storeModules: readonly string[];
}): SalesChannelPolicy {
  return {
    policyVersion: onlineSalesScopePolicyVersion,
    confirmedOnlineShopIds: [],
    confirmedOnlineModules: [],
    confirmedStoreShopIds: input.storeShopIds,
    confirmedStoreModules: input.storeModules,
    confirmedSellerServiceProductIds: input.sellerServiceProductIds,
    confirmedGenericCustomerIds: input.genericCustomerIds,
    ambiguousOrderPolicy: 'fail_open',
  };
}

function buildRfmAnalysis(referenceTimeForRun: string, orders: readonly SalesChannelOrder[]): RfmBuiltForScope {
  const window = buildRfmSnapshotWindow(referenceTimeForRun);
  const sourceRows = buildRfmSourceRowsFromOrders(referenceTimeForRun, orders);
  const diagnostics = buildRfmDiagnosticsFromOrders(referenceTimeForRun, orders);
  const built = buildRfmSnapshotDataset({
    ...window,
    generatedAt: referenceTimeForRun,
    calculationVersion,
    sourceRows,
    diagnostics,
  });
  return { rows: built.rows, manifest: built.manifest };
}

function toHistoricalOrders(orders: readonly SalesChannelOrder[]): readonly HistoricalRfmOrderInput[] {
  return orders.map((order) => ({
    prestashopCustomerId: order.prestashopCustomerId,
    orderId: order.orderId,
    validOrderAt: order.validOrderAt,
    grossOrderValueTaxIncl: order.grossOrderValueTaxIncl,
    shopId: order.shopId,
  }));
}

function buildShopInventory(
  shops: readonly ShopRow[],
  orders: readonly SalesChannelOrder[],
  sellerServiceProductIds: readonly number[],
  genericCustomerIds: readonly number[],
): readonly Record<string, unknown>[] {
  const sellerIds = new Set(sellerServiceProductIds);
  const genericIds = new Set(genericCustomerIds);
  return shops.map((shop) => {
    const shopOrders = orders.filter((order) => order.shopId === shop.shopId);
    return {
      shopAlias: `shop_${shop.shopId}`,
      idShopGroup: shop.shopGroupId,
      active: shop.active,
      validOrderCount: shopOrders.length,
      distinctCustomerCount: new Set(shopOrders.map((order) => order.prestashopCustomerId)).size,
      grossOrderValueTaxIncl: sumOrders(shopOrders),
      firstOrderAt: minDate(shopOrders),
      lastOrderAt: maxDate(shopOrders),
      distinctPaymentModules: new Set(shopOrders.map((order) => normalizeNullable(order.module))).size,
      distinctCarriers: new Set(shopOrders.map((order) => order.carrierId ?? 'unknown')).size,
      ordersWithSellerService: shopOrders.filter((order) => order.lines.some((line) => sellerIds.has(line.productId))).length,
      genericCustomerOrderCount: shopOrders.filter((order) => genericIds.has(order.prestashopCustomerId)).length,
    };
  });
}

function buildPaymentModuleInventory(orders: readonly SalesChannelOrder[]): readonly Record<string, unknown>[] {
  return distributionRows(orders, (order) => [String(order.shopId), normalizeNullable(order.module), normalizeNullable(order.payment)]);
}

function buildCarrierInventory(orders: readonly SalesChannelOrder[]): readonly Record<string, unknown>[] {
  return distributionRows(orders, (order) => [String(order.shopId), normalizeNullable(order.module), order.carrierId === null ? 'unknown' : String(order.carrierId)]);
}

function buildSellerServiceCandidates(
  orders: readonly SalesChannelOrder[],
  discoveryRows: readonly SellerDiscoveryRow[],
): readonly Record<string, unknown>[] {
  return discoveryRows.map((candidate) => {
    const candidateOrders = orders.filter((order) => order.lines.some((line) => line.productId === candidate.productId));
    const candidateLines = candidateOrders.flatMap((order) => order.lines.filter((line) => line.productId === candidate.productId));
    const unitPrices = candidateLines.map((line) => Number(line.unitPriceTaxIncl));
    return {
      productId: candidate.productId,
      reference: candidate.reference,
      active: candidate.active,
      languageCount: candidate.languageCount,
      matchedTerms: candidate.matchedTerms,
      nameChecksum: candidate.nameChecksum,
      validOrderCount: candidateOrders.length,
      distinctCustomerCount: new Set(candidateOrders.map((order) => order.prestashopCustomerId)).size,
      grossLineAmount: addRfmDecimals(candidateLines.map((line) => line.totalPriceTaxIncl)),
      unitPriceDistribution: {
        min: unitPrices.length === 0 ? null : Math.min(...unitPrices).toFixed(6),
        max: unitPrices.length === 0 ? null : Math.max(...unitPrices).toFixed(6),
        onePesoLikeCount: unitPrices.filter((value) => value > 0 && value <= 10).length,
      },
      quantityDistribution: {
        min: candidateLines.length === 0 ? null : Math.min(...candidateLines.map((line) => line.quantity)),
        max: candidateLines.length === 0 ? null : Math.max(...candidateLines.map((line) => line.quantity)),
      },
      shopDistribution: distributionRows(candidateOrders, (order) => [`shop_${order.shopId}`]),
      moduleDistribution: distributionRows(candidateOrders, (order) => [normalizeNullable(order.module)]),
      paymentDistribution: distributionRows(candidateOrders, (order) => [normalizeNullable(order.payment)]),
      carrierDistribution: distributionRows(candidateOrders, (order) => [order.carrierId === null ? 'unknown' : `carrier_${order.carrierId}`]),
      firstObservedAt: minDate(candidateOrders),
      lastObservedAt: maxDate(candidateOrders),
    };
  });
}

function inferSellerServiceProductIds(
  orders: readonly SalesChannelOrder[],
  discoveryRows: readonly SellerDiscoveryRow[],
): readonly number[] {
  return discoveryRows
    .filter((candidate) => {
      const candidateOrders = orders.filter((order) => order.lines.some((line) => line.productId === candidate.productId));
      const candidateLines = candidateOrders.flatMap((order) => order.lines.filter((line) => line.productId === candidate.productId));
      const onePesoLikeCount = candidateLines.filter((line) => {
        const price = Number(line.unitPriceTaxIncl);
        return price > 0 && price <= 10;
      }).length;
      return candidateOrders.length > 0 && onePesoLikeCount / Math.max(candidateLines.length, 1) >= 0.9;
    })
    .map((candidate) => candidate.productId);
}

function buildGenericCustomerCandidates(
  orders: readonly SalesChannelOrder[],
  sellerServiceProductIds: readonly number[],
): ReadonlyArray<Record<string, unknown> & { technicalCustomerId: number; classification: string }> {
  const sellerIds = new Set(sellerServiceProductIds);
  const byCustomer = new Map<number, SalesChannelOrder[]>();
  for (const order of orders) {
    byCustomer.set(order.prestashopCustomerId, [...(byCustomer.get(order.prestashopCustomerId) ?? []), order]);
  }
  return Array.from(byCustomer.entries())
    .map(([technicalCustomerId, customerOrders]) => {
      const sellerServiceOrderCount = customerOrders.filter((order) => order.lines.some((line) => sellerIds.has(line.productId))).length;
      const validOrderCount = customerOrders.length;
      const classification =
        validOrderCount > 100 && sellerServiceOrderCount / Math.max(validOrderCount, 1) >= 0.5
          ? 'LIKELY_GENERIC_STORE_CUSTOMER'
          : validOrderCount > 100
            ? 'TECHNICAL_ACCOUNT'
            : 'UNRESOLVED';
      return {
        technicalCustomerId,
        classification,
        validOrderCount,
        grossOrderValueTaxIncl: sumOrders(customerOrders),
        firstOrderAt: minDate(customerOrders),
        lastOrderAt: maxDate(customerOrders),
        shopDistribution: distributionRows(customerOrders, (order) => [`shop_${order.shopId}`]),
        moduleDistribution: distributionRows(customerOrders, (order) => [normalizeNullable(order.module)]),
        sellerServiceOrderShare: (sellerServiceOrderCount / Math.max(validOrderCount, 1)).toFixed(6),
        averageOrderValue: formatRfmDecimal((Number(sumOrders(customerOrders)) / Math.max(validOrderCount, 1)).toFixed(6)),
        distinctAddresses: 'NOT_READ_TO_AVOID_PII_SURFACE',
        distinctOrderDays: new Set(customerOrders.map((order) => order.validOrderAt.slice(0, 10))).size,
      };
    })
    .filter((candidate) => Number(candidate.validOrderCount) > 20)
    .sort((a, b) => Number(b.validOrderCount) - Number(a.validOrderCount))
    .slice(0, 20);
}

function buildPolicyComparison(
  orders: readonly SalesChannelOrder[],
  combinedPolicy: SalesChannelPolicy,
  sellerServiceProductIds: readonly number[],
  genericCustomerIds: readonly number[],
): Record<string, unknown> {
  const policies: Record<string, SalesChannelPolicy> = {
    policyAExcludeGenericCustomer: { ...combinedPolicy, confirmedStoreShopIds: [], confirmedStoreModules: [], confirmedSellerServiceProductIds: [], confirmedGenericCustomerIds: genericCustomerIds },
    policyBExcludeSellerService: { ...combinedPolicy, confirmedStoreShopIds: [], confirmedStoreModules: [], confirmedSellerServiceProductIds: sellerServiceProductIds, confirmedGenericCustomerIds: [] },
    policyCExcludeStoreShop: { ...combinedPolicy, confirmedStoreModules: [], confirmedSellerServiceProductIds: [], confirmedGenericCustomerIds: [] },
    policyDExcludeStoreModule: { ...combinedPolicy, confirmedStoreShopIds: [], confirmedSellerServiceProductIds: [], confirmedGenericCustomerIds: [] },
    policyECombinedExclusion: combinedPolicy,
    policyFOnlineAllowlist: {
      ...combinedPolicy,
      confirmedSellerServiceProductIds: [],
      confirmedGenericCustomerIds: [],
      confirmedStoreShopIds: [],
      confirmedStoreModules: [],
      confirmedOnlineShopIds: combinedPolicy.confirmedOnlineShopIds,
      confirmedOnlineModules: combinedPolicy.confirmedOnlineModules,
    },
  };
  return Object.fromEntries(
    Object.entries(policies).map(([name, policy]) => [name, compareScope(classifySalesChannelOrders(orders, policy))]),
  );
}

function buildRfmBeforeAfter(before: RfmBuiltForScope, after: RfmBuiltForScope): Record<string, unknown> {
  return {
    operationalCustomerCount: compareMetric(before.manifest.activeCustomerCount, after.manifest.activeCustomerCount),
    operationalOrderCount: compareMetric(before.manifest.validOrderCount, after.manifest.validOrderCount),
    operationalGrossOrderValueTaxIncl: compareMetric(before.manifest.grossOrderValueTaxIncl, after.manifest.grossOrderValueTaxIncl),
    averageOrderValue: compareMetric(
      divideSafe(before.manifest.grossOrderValueTaxIncl, before.manifest.validOrderCount),
      divideSafe(after.manifest.grossOrderValueTaxIncl, after.manifest.validOrderCount),
    ),
    maximumFrequency: compareMetric(before.manifest.frequencyDistribution.max, after.manifest.frequencyDistribution.max),
    p95Frequency: compareMetric(before.manifest.frequencyDistribution.p95, after.manifest.frequencyDistribution.p95),
    p99Frequency: compareMetric(before.manifest.frequencyDistribution.p99, after.manifest.frequencyDistribution.p99),
    recencyDistribution: { before: before.manifest.recencyDistribution, after: after.manifest.recencyDistribution },
    frequencyDistribution: { before: before.manifest.frequencyDistribution, after: after.manifest.frequencyDistribution },
    monetaryDistribution: { before: before.manifest.monetaryDistribution, after: after.manifest.monetaryDistribution },
    scoreDistributions: {
      before: {
        recency: before.manifest.recencyScoreDistribution,
        frequency: before.manifest.frequencyScoreDistribution,
        monetary: before.manifest.monetaryScoreDistribution,
      },
      after: {
        recency: after.manifest.recencyScoreDistribution,
        frequency: after.manifest.frequencyScoreDistribution,
        monetary: after.manifest.monetaryScoreDistribution,
      },
    },
    historicalCustomerCount: compareMetric(before.manifest.historicalCustomerCount, after.manifest.historicalCustomerCount),
  };
}

function buildCohortBeforeAfter(
  before: ReturnType<typeof buildRfmUseCaseAnalysis>,
  after: ReturnType<typeof buildRfmUseCaseAnalysis>,
): Record<string, unknown> {
  return {
    recentFirstPurchase30d: compareMetric(
      before.candidateCohorts.recentFirstPurchase.recent_first_purchase_30d_candidate?.customerCount ?? 0,
      after.candidateCohorts.recentFirstPurchase.recent_first_purchase_30d_candidate?.customerCount ?? 0,
    ),
    recentFirstPurchase60d: compareMetric(
      before.candidateCohorts.recentFirstPurchase.recent_first_purchase_60d_candidate?.customerCount ?? 0,
      after.candidateCohorts.recentFirstPurchase.recent_first_purchase_60d_candidate?.customerCount ?? 0,
    ),
    recentFirstPurchase90d: compareMetric(
      before.candidateCohorts.recentFirstPurchase.recent_first_purchase_90d_candidate?.customerCount ?? 0,
      after.candidateCohorts.recentFirstPurchase.recent_first_purchase_90d_candidate?.customerCount ?? 0,
    ),
    repeatCustomer2Plus: compareMetric(
      before.candidateCohorts.repeatCustomer.repeat_customer_2_plus_candidate?.customerCount ?? 0,
      after.candidateCohorts.repeatCustomer.repeat_customer_2_plus_candidate?.customerCount ?? 0,
    ),
    repeatCustomer3Plus: compareMetric(
      before.candidateCohorts.repeatCustomer.repeat_customer_3_plus_candidate?.customerCount ?? 0,
      after.candidateCohorts.repeatCustomer.repeat_customer_3_plus_candidate?.customerCount ?? 0,
    ),
    highGrossActiveM5: compareMetric(
      before.candidateCohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate?.customerCount ?? 0,
      after.candidateCohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate?.customerCount ?? 0,
    ),
    activeRepeatHighGross: compareMetric(
      before.candidateCohorts.activeRepeatHighGross.active_repeat_high_gross_r4_f4_m4_plus_candidate?.customerCount ?? 0,
      after.candidateCohorts.activeRepeatHighGross.active_repeat_high_gross_r4_f4_m4_plus_candidate?.customerCount ?? 0,
    ),
    historicallyHighGrossInactiveTop10: compareMetric(
      before.candidateCohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate?.customerCount ?? 0,
      after.candidateCohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate?.customerCount ?? 0,
    ),
    frequencyOutlier100Plus: compareMetric(
      before.candidateCohorts.frequencyOutlierReview.frequency_outlier_review_frequency_gt_100?.customerCount ?? 0,
      after.candidateCohorts.frequencyOutlierReview.frequency_outlier_review_frequency_gt_100?.customerCount ?? 0,
    ),
    secondPurchase: {
      customersWithSecondPurchase: compareMetric(before.secondPurchaseAnalysis.customersWithSecondPurchase, after.secondPurchaseAnalysis.customersWithSecondPurchase),
      customersWithoutSecondPurchase: compareMetric(before.secondPurchaseAnalysis.customersWithoutSecondPurchase, after.secondPurchaseAnalysis.customersWithoutSecondPurchase),
      sameDaySecondPurchase: compareMetric(before.secondPurchaseAnalysis.buckets.sameDay, after.secondPurchaseAnalysis.buckets.sameDay),
      medianFirstToSecond: compareMetric(before.secondPurchaseAnalysis.daysFirstToSecondOrder.median, after.secondPurchaseAnalysis.daysFirstToSecondOrder.median),
      p75FirstToSecond: compareMetric(before.secondPurchaseAnalysis.daysFirstToSecondOrder.p75, after.secondPurchaseAnalysis.daysFirstToSecondOrder.p75),
      p90FirstToSecond: compareMetric(before.secondPurchaseAnalysis.daysFirstToSecondOrder.p90, after.secondPurchaseAnalysis.daysFirstToSecondOrder.p90),
    },
  };
}

function buildOutlierImpact(
  before: RfmBuiltForScope,
  after: RfmBuiltForScope,
  beforeOrders: readonly SalesChannelOrder[],
  afterOrders: readonly SalesChannelOrder[],
  policy: SalesChannelPolicy,
): Record<string, unknown> {
  const maxFrequency = Math.max(...before.rows.map((row) => row.frequencyOrders));
  const outlierRows = before.rows.filter((row) => row.frequencyOrders === maxFrequency);
  const outlierCustomerIds = new Set(outlierRows.map((row) => row.prestashopCustomerId));
  const outlierOrders = beforeOrders.filter((order) => outlierCustomerIds.has(order.prestashopCustomerId));
  const outlierAfterOrders = afterOrders.filter((order) => outlierCustomerIds.has(order.prestashopCustomerId));
  const outlierClassified = classifySalesChannelOrders(outlierOrders, policy);
  return {
    result:
      outlierAfterOrders.length === 0 && outlierClassified.some((order) => order.classificationReason === 'STORE_CONFIRMED_BY_GENERIC_CUSTOMER')
        ? 'OUTLIER_CONFIRMED_GENERIC_CUSTOMER'
        : outlierAfterOrders.length === 0
          ? 'OUTLIER_CONFIRMED_STORE_ARTIFACT'
          : 'OUTLIER_UNRESOLVED',
    maximumFrequencyBeforeFilter: before.manifest.frequencyDistribution.max,
    maximumFrequencyAfterFilter: after.manifest.frequencyDistribution.max,
    p95FrequencyAfterFilter: after.manifest.frequencyDistribution.p95,
    p99FrequencyAfterFilter: after.manifest.frequencyDistribution.p99,
    fScoreDistributionAfterFilter: after.manifest.frequencyScoreDistribution,
    outlierOrderCountBefore: outlierOrders.length,
    outlierOrderCountAfter: outlierAfterOrders.length,
  };
}

function distributionRows(orders: readonly SalesChannelOrder[], keyOf: (order: SalesChannelOrder) => readonly string[]): readonly Record<string, unknown>[] {
  const grouped = new Map<string, SalesChannelOrder[]>();
  for (const order of orders) {
    const key = keyOf(order).join('__');
    grouped.set(key, [...(grouped.get(key) ?? []), order]);
  }
  return Array.from(grouped.entries())
    .map(([key, groupedOrders]) => ({
      key,
      validOrderCount: groupedOrders.length,
      distinctCustomerCount: new Set(groupedOrders.map((order) => order.prestashopCustomerId)).size,
      grossOrderValueTaxIncl: sumOrders(groupedOrders),
    }))
    .sort((a, b) => Number(b.validOrderCount) - Number(a.validOrderCount));
}

function publicPolicy(policy: SalesChannelPolicy): Record<string, unknown> {
  return {
    policyVersion: policy.policyVersion,
    confirmedOnlineShopIds: policy.confirmedOnlineShopIds.map((id) => `shop_${id}`),
    confirmedOnlineModules: policy.confirmedOnlineModules,
    confirmedStoreShopIds: policy.confirmedStoreShopIds.map((id) => `shop_${id}`),
    confirmedStoreModules: policy.confirmedStoreModules,
    confirmedSellerServiceProductIds: policy.confirmedSellerServiceProductIds,
    confirmedGenericCustomerIds: policy.confirmedGenericCustomerIds,
    ambiguousOrderPolicy: policy.ambiguousOrderPolicy,
  };
}

function parseNumberListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0);
}

function parseStringListEnv(name: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

function requiredUtcReferenceTime(name: string): string {
  const value = requiredEnv(name);
  parseReferenceTime(value);
  return new Date(value).toISOString();
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function sumOrders(orders: readonly SalesChannelOrder[]): string {
  return addRfmDecimals(orders.map((order) => order.grossOrderValueTaxIncl));
}

function minDate(orders: readonly SalesChannelOrder[]): string | null {
  return orders.map((order) => order.validOrderAt).sort()[0] ?? null;
}

function maxDate(orders: readonly SalesChannelOrder[]): string | null {
  return orders.map((order) => order.validOrderAt).sort().at(-1) ?? null;
}

function normalizeNullable(value: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length === 0 ? 'unknown' : normalized;
}

function divideSafe(value: string, denominator: number): string {
  return denominator === 0 ? '0.000000' : formatRfmDecimal((Number(value) / denominator).toFixed(6));
}

function awaitlessSha(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(outputDir, fileName), `${stableStringify(value)}\n`, 'utf8');
}
