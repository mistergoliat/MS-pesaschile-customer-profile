import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  analyticalOrderChecksum,
  assertAnalyticalOrderReportHasNoPii,
  buildAnalyticalOrder,
  buildCanonicalAnalyticalOrderVerdict,
  countAnalyticalLinesBy,
  countAnalyticalOrdersBy,
  defaultAnalyticalOrderPolicies,
  money,
  sumMoney,
  summarizeAnalyticalOrders,
  type AnalyticalOrder,
  type AnalyticalOrderDiscountClassification,
  type AnalyticalOrderPolicies,
  type RawPrestaShopOrder,
  type RawPrestaShopOrderDiscount,
  type RawPrestaShopOrderLine,
} from '../../src/domain/customer-orders/index.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const scope = resolveScope();
const outputDir = path.resolve('scripts/snapshots/rfm/canonical-order-outputs');
const auditQueryTimeoutMs = Number(process.env.ANALYTICAL_ORDER_QUERY_TIMEOUT_MS ?? 300_000);
const tablePrefix = config.prestashopDb.prefix;
const tables = {
  orders: `${tablePrefix}orders`,
  orderDetail: `${tablePrefix}order_detail`,
  orderCartRule: `${tablePrefix}order_cart_rule`,
  cartRule: `${tablePrefix}cart_rule`,
  customer: `${tablePrefix}customer`,
  product: `${tablePrefix}product`,
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
  const rawOrders = await readOrders();
  const sellerServiceProductIds = parseNumberListEnv('RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS', [444]);
  const genericCustomerIds = parseNumberListEnv('RFM_CONFIRMED_GENERIC_CUSTOMER_IDS', inferGenericCustomerIds(rawOrders, sellerServiceProductIds));
  const policies = defaultAnalyticalOrderPolicies({
    genericCustomerIds,
    technicalCustomerIds: parseNumberListEnv('ANALYTICAL_ORDER_TECHNICAL_CUSTOMER_IDS', []),
    sellerServiceProductIds,
    logisticsArtifactProductIds: parseNumberListEnv('RFM_CONFIRMED_LOGISTICS_PRODUCT_IDS', []),
    technicalProductIds: parseNumberListEnv('ANALYTICAL_ORDER_TECHNICAL_PRODUCT_IDS', []),
    commercialServiceProductIds: parseNumberListEnv('ANALYTICAL_ORDER_COMMERCIAL_SERVICE_PRODUCT_IDS', []),
    unresolvedProductIds: parseNumberListEnv('ANALYTICAL_ORDER_UNRESOLVED_PRODUCT_IDS', []),
    storeShopIds: parseNumberListEnv('RFM_CONFIRMED_STORE_SHOP_IDS', []),
    storeModules: parseStringListEnv('RFM_CONFIRMED_STORE_MODULES', []),
    posModules: parseStringListEnv('RFM_CONFIRMED_POS_MODULES', []),
    ambiguousOrderPolicy: resolveAmbiguousPolicy(),
  });
  const analyticalOrders = rawOrders.map((order) => buildAnalyticalOrder({
    order: order.order,
    lines: order.lines,
    discounts: order.discounts,
  }, policies));
  const verdict = buildCanonicalAnalyticalOrderVerdict(analyticalOrders);
  const contractSummary = {
    referenceTime,
    calculationVersion,
    scope,
    ...summarizeAnalyticalOrders(analyticalOrders),
  };
  const policyVersionSummary = buildPolicyVersionSummary(policies, analyticalOrders);
  const priorAuditComparison = await buildPriorAuditComparison(analyticalOrders, rawOrders);

  await writeJson('canonical-order-contract-summary.json', contractSummary);
  await writeJson('order-inclusion-summary.json', buildOrderInclusionSummary(analyticalOrders));
  await writeJson('identity-classification-summary.json', buildIdentitySummary(analyticalOrders));
  await writeJson('line-classification-summary.json', buildLineClassificationSummary(analyticalOrders));
  await writeJson('discount-classification-summary.json', buildDiscountClassificationSummary(analyticalOrders));
  await writeJson('discount-allocation-summary.json', buildDiscountAllocationSummary(analyticalOrders));
  await writeJson('monetary-summary.json', buildMonetarySummary(analyticalOrders));
  await writeJson('reconciliation-summary.json', buildReconciliationSummary(analyticalOrders));
  await writeJson('policy-version-summary.json', policyVersionSummary);
  await writeJson('prior-audit-comparison.json', priorAuditComparison);
  await writeJson('canonical-order-verdict.json', {
    ...verdict,
    referenceTime,
    calculationVersion,
    scope,
    summary: contractSummary,
    checksum: analyticalOrderChecksum({ verdict, contractSummary, policyVersionSummary, priorAuditComparison }),
  });

  console.info(JSON.stringify({
    primaryVerdict: verdict.primaryVerdict,
    conditions: verdict.conditions,
    scope,
    summary: contractSummary,
    priorAuditComparison,
  }, null, 2));
} finally {
  await pool.end();
}

type RawAnalyticalOrderBundle = {
  readonly order: RawPrestaShopOrder;
  readonly lines: readonly RawPrestaShopOrderLine[];
  readonly discounts: readonly RawPrestaShopOrderDiscount[];
};

async function readOrders(): Promise<readonly RawAnalyticalOrderBundle[]> {
  const dateClause = scope === 'operational_365d' ? 'AND o.date_add >= ? AND o.date_add < ?' : 'AND o.date_add < ?';
  const dateParams = scope === 'operational_365d'
    ? [mysqlDateTime(windowStart(referenceTime)), mysqlDateTime(referenceTime)]
    : [mysqlDateTime(referenceTime)];
  const limitClause = scope === 'sampled_historical' ? 'LIMIT 5000' : '';
  const orderRows = await query<OrderRow>(
    `
      SELECT
        o.id_order AS orderId,
        o.id_customer AS prestashopCustomerId,
        o.date_add AS orderDate,
        o.id_shop AS shopId,
        o.id_currency AS currencyId,
        o.module AS module,
        o.total_products AS totalProductsTaxExcl,
        o.total_products_wt AS totalProductsTaxIncl,
        o.total_discounts_tax_incl AS totalDiscountsTaxIncl,
        o.total_discounts_tax_excl AS totalDiscountsTaxExcl,
        o.total_shipping_tax_incl AS totalShippingTaxIncl,
        o.total_shipping_tax_excl AS totalShippingTaxExcl,
        o.total_wrapping_tax_incl AS totalWrappingTaxIncl,
        o.total_wrapping_tax_excl AS totalWrappingTaxExcl,
        o.total_paid_tax_incl AS totalPaidTaxIncl,
        o.total_paid_tax_excl AS totalPaidTaxExcl
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        ${dateClause}
      ORDER BY o.date_add DESC, o.id_order DESC
      ${limitClause}
    `,
    dateParams,
  );
  const orderIds = orderRows.map((row) => asInt(row.orderId));
  const [lineRows, discountRows] = await Promise.all([
    readOrderLines(orderIds),
    readOrderDiscounts(orderIds),
  ]);
  const linesByOrder = groupBy(lineRows.map(toLine), (line) => line.orderId);
  const discountsByOrder = groupBy(discountRows.map(toDiscount), (discount) => discount.orderId);
  return orderRows.map((row) => {
    const orderId = asInt(row.orderId);
    return {
      order: {
        orderId,
        prestashopCustomerId: asInt(row.prestashopCustomerId),
        orderDate: String(row.orderDate),
        shopId: asInt(row.shopId),
        currencyId: asInt(row.currencyId),
        module: row.module === null || row.module === undefined ? null : String(row.module),
        totalProductsTaxIncl: money(String(row.totalProductsTaxIncl ?? '0')),
        totalProductsTaxExcl: money(String(row.totalProductsTaxExcl ?? '0')),
        totalDiscountsTaxIncl: money(String(row.totalDiscountsTaxIncl ?? '0')),
        totalDiscountsTaxExcl: money(String(row.totalDiscountsTaxExcl ?? '0')),
        totalShippingTaxIncl: money(String(row.totalShippingTaxIncl ?? '0')),
        totalShippingTaxExcl: money(String(row.totalShippingTaxExcl ?? '0')),
        totalWrappingTaxIncl: money(String(row.totalWrappingTaxIncl ?? '0')),
        totalWrappingTaxExcl: money(String(row.totalWrappingTaxExcl ?? '0')),
        totalPaidTaxIncl: money(String(row.totalPaidTaxIncl ?? '0')),
        totalPaidTaxExcl: money(String(row.totalPaidTaxExcl ?? '0')),
      },
      lines: linesByOrder.get(orderId) ?? [],
      discounts: discountsByOrder.get(orderId)?.map(({ orderId: _orderId, ...discount }) => discount) ?? [],
    };
  });
}

async function readOrderLines(orderIds: readonly number[]): Promise<readonly OrderLineRow[]> {
  return queryByOrderChunks<OrderLineRow>(
    orderIds,
    (placeholders) => `
      SELECT
        od.id_order AS orderId,
        od.id_order_detail AS orderDetailId,
        od.product_id AS productId,
        od.product_attribute_id AS productAttributeId,
        od.product_quantity AS quantity,
        od.unit_price_tax_incl AS unitPriceTaxIncl,
        od.unit_price_tax_excl AS unitPriceTaxExcl,
        od.total_price_tax_incl AS totalPriceTaxIncl,
        od.total_price_tax_excl AS totalPriceTaxExcl,
        p.active AS productActive
      FROM ${tables.orderDetail} od
      LEFT JOIN ${tables.product} p
        ON p.id_product = od.product_id
      WHERE od.id_order IN (${placeholders})
      ORDER BY od.id_order ASC, od.id_order_detail ASC
    `,
  );
}

async function readOrderDiscounts(orderIds: readonly number[]): Promise<readonly DiscountRow[]> {
  return queryByOrderChunks<DiscountRow>(
    orderIds,
    (placeholders) => `
      SELECT
        ocr.id_order AS orderId,
        ocr.id_cart_rule AS sourceOrderCartRuleId,
        ocr.value AS valueTaxIncl,
        ocr.value_tax_excl AS valueTaxExcl,
        cr.free_shipping AS freeShipping,
        cr.reduction_percent AS reductionPercent,
        cr.reduction_amount AS reductionAmount,
        cr.reduction_product AS reductionProduct,
        cr.gift_product AS giftProduct
      FROM ${tables.orderCartRule} ocr
      LEFT JOIN ${tables.cartRule} cr
        ON cr.id_cart_rule = ocr.id_cart_rule
      WHERE ocr.id_order IN (${placeholders})
      ORDER BY ocr.id_order ASC, ocr.id_cart_rule ASC
    `,
  );
}

function toLine(row: OrderLineRow): RawPrestaShopOrderLine & { readonly orderId: number } {
  return {
    orderId: asInt(row.orderId),
    orderDetailId: asInt(row.orderDetailId),
    productId: asInt(row.productId),
    productAttributeId: asInt(row.productAttributeId ?? 0),
    quantity: asInt(row.quantity),
    productActive: row.productActive === null || row.productActive === undefined ? null : asInt(row.productActive) === 1,
    unitPriceTaxIncl: money(String(row.unitPriceTaxIncl ?? '0')),
    unitPriceTaxExcl: money(String(row.unitPriceTaxExcl ?? '0')),
    totalPriceTaxIncl: money(String(row.totalPriceTaxIncl ?? '0')),
    totalPriceTaxExcl: money(String(row.totalPriceTaxExcl ?? '0')),
  };
}

function toDiscount(row: DiscountRow): RawPrestaShopOrderDiscount & { readonly orderId: number } {
  const classification = classifyDiscount(row);
  return {
    orderId: asInt(row.orderId),
    sourceOrderCartRuleId: asInt(row.sourceOrderCartRuleId),
    classification,
    valueTaxIncl: money(String(row.valueTaxIncl ?? '0')),
    valueTaxExcl: money(String(row.valueTaxExcl ?? '0')),
  };
}

function classifyDiscount(row: DiscountRow): AnalyticalOrderDiscountClassification {
  const freeShipping = asInt(row.freeShipping ?? 0) === 1;
  const giftProduct = asInt(row.giftProduct ?? 0) > 0;
  const productReduction =
    Number(row.reductionPercent ?? 0) > 0 ||
    Number(row.reductionAmount ?? 0) > 0 ||
    asInt(row.reductionProduct ?? 0) > 0 ||
    Number(row.valueTaxIncl ?? 0) > 0;
  if (giftProduct) return 'GIFT_PRODUCT';
  if (freeShipping && productReduction) return 'MIXED_PRODUCT_AND_SHIPPING';
  if (freeShipping) return 'FREE_SHIPPING';
  if (productReduction) return 'PRODUCT_DISCOUNT';
  return 'UNKNOWN';
}

function buildOrderInclusionSummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    orderCount: orders.length,
    byInclusionStatus: countAnalyticalOrdersBy(orders, (order) => order.inclusionStatus),
    bySalesChannel: countAnalyticalOrdersBy(orders, (order) => order.salesChannel),
    exclusionReasonDistribution: countReasons(orders.flatMap((order) => order.exclusionReasons)),
    includedNetEligibleProductValueTaxIncl: sumMoney(orders.filter((order) => order.inclusionStatus === 'INCLUDED').map((order) => order.netEligibleProductValueTaxIncl)),
    excludedNetEligibleProductValueTaxIncl: sumMoney(orders.filter((order) => order.inclusionStatus !== 'INCLUDED').map((order) => order.netEligibleProductValueTaxIncl)),
  };
}

function buildIdentitySummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    byIdentity: countAnalyticalOrdersBy(orders, (order) => order.identity),
    excludedGenericOrderCount: orders.filter((order) => order.exclusionReasons.includes('GENERIC_CUSTOMER')).length,
    excludedTechnicalOrderCount: orders.filter((order) => order.exclusionReasons.includes('TECHNICAL_CUSTOMER')).length,
  };
}

function buildLineClassificationSummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  const lines = orders.flatMap((order) => order.lines);
  return {
    totalLineCount: lines.length,
    eligibleCommercialLineCount: lines.filter((line) => line.inclusionStatus === 'INCLUDED').length,
    sellerServiceLineCount: lines.filter((line) => line.classification === 'SELLER_SERVICE').length,
    logisticsArtifactLineCount: lines.filter((line) => line.classification === 'LOGISTICS_ARTIFACT').length,
    unresolvedLineCount: lines.filter((line) => line.classification === 'UNRESOLVED').length,
    inactiveProductLineCount: lines.filter((line) => line.productActive === false).length,
    byClassification: countAnalyticalLinesBy(orders, (line) => line.classification),
    byInclusionStatus: countAnalyticalLinesBy(orders, (line) => line.inclusionStatus),
  };
}

function buildDiscountClassificationSummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  const discounts = orders.flatMap((order) => order.discounts);
  return {
    discountCount: discounts.length,
    byClassification: countReasons(discounts.map((discount) => discount.classification)),
    byAttributionStatus: countReasons(discounts.map((discount) => discount.attributionStatus)),
    grossDiscountTaxIncl: sumMoney(discounts.map((discount) => discount.valueTaxIncl)),
    productApplicableDiscountTaxIncl: sumMoney(discounts.map((discount) => discount.productApplicableValueTaxIncl)),
    shippingDiscountTaxIncl: sumMoney(discounts.map((discount) => discount.shippingDiscountTaxIncl)),
    unresolvedDiscountTaxIncl: sumMoney(discounts.map((discount) => discount.unresolvedDiscountTaxIncl)),
  };
}

function buildDiscountAllocationSummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    allocationMethod: 'LARGEST_REMAINDER',
    productApplicableOrderDiscountTaxIncl: sumMoney(orders.map((order) => order.productApplicableOrderDiscountTaxIncl)),
    allocatedOrderDiscountTaxIncl: sumMoney(orders.flatMap((order) => order.lines.map((line) => line.allocatedOrderDiscountTaxIncl))),
    unresolvedDiscountTaxIncl: sumMoney(orders.map((order) => order.unresolvedDiscountTaxIncl)),
    negativeNetLineCount: orders.flatMap((order) => order.lines).filter((line) => Number(line.netLineValueTaxIncl) < 0 || Number(line.netLineValueTaxExcl) < 0).length,
    excludedLineAllocatedDiscountTaxIncl: sumMoney(
      orders.flatMap((order) => order.lines.filter((line) => line.inclusionStatus !== 'INCLUDED').map((line) => line.allocatedOrderDiscountTaxIncl)),
    ),
  };
}

function buildMonetarySummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    orderCount: orders.length,
    grossEligibleProductValueTaxIncl: sumMoney(orders.map((order) => order.grossEligibleProductValueTaxIncl)),
    grossEligibleProductValueTaxExcl: sumMoney(orders.map((order) => order.grossEligibleProductValueTaxExcl)),
    productApplicableOrderDiscountTaxIncl: sumMoney(orders.map((order) => order.productApplicableOrderDiscountTaxIncl)),
    netEligibleProductValueTaxIncl: sumMoney(orders.map((order) => order.netEligibleProductValueTaxIncl)),
    netEligibleProductValueTaxExcl: sumMoney(orders.map((order) => order.netEligibleProductValueTaxExcl)),
    excludedTechnicalValueTaxIncl: sumMoney(orders.map((order) => order.excludedTechnicalValueTaxIncl)),
    shippingValueTaxIncl: sumMoney(orders.map((order) => order.shippingValueTaxIncl)),
    wrappingValueTaxIncl: sumMoney(orders.map((order) => order.wrappingValueTaxIncl)),
  };
}

function buildReconciliationSummary(orders: readonly AnalyticalOrder[]): Record<string, unknown> {
  return {
    byStatus: countAnalyticalOrdersBy(orders, (order) => order.reconciliation.status),
    lineSumVsTotalProductsTaxInclDelta: sumMoney(orders.map((order) => order.reconciliation.lineSumVsTotalProductsTaxInclDelta)),
    lineSumVsTotalProductsTaxExclDelta: sumMoney(orders.map((order) => order.reconciliation.lineSumVsTotalProductsTaxExclDelta)),
    analyticalNetVsExpectedProductNetTaxInclDelta: sumMoney(orders.map((order) => order.reconciliation.analyticalNetVsExpectedProductNetTaxInclDelta)),
    totalPaidTaxInclDelta: sumMoney(orders.map((order) => order.reconciliation.totalPaidTaxInclDelta)),
    totalPaidTaxExclDelta: sumMoney(orders.map((order) => order.reconciliation.totalPaidTaxExclDelta)),
    bucketDistribution: countReasons(orders.map((order) => deltaBucket(order.reconciliation.totalPaidTaxInclDelta))),
  };
}

function buildPolicyVersionSummary(
  policies: AnalyticalOrderPolicies,
  orders: readonly AnalyticalOrder[],
): Record<string, unknown> {
  return {
    policyVersions: orders[0]?.policyVersions ?? {
      analyticalOrderContractVersion: 'NO_ORDERS',
      salesChannelPolicyVersion: policies.salesChannel.version,
      identityPolicyVersion: policies.identity.version,
      lineEligibilityPolicyVersion: policies.lineEligibility.version,
      monetaryPolicyVersion: policies.monetary.version,
      discountAllocationPolicyVersion: policies.discountAllocationVersion,
      reconciliationPolicyVersion: policies.reconciliationVersion,
    },
    configuredPolicyCounts: {
      genericCustomerIds: policies.identity.genericCustomerIds.size,
      technicalCustomerIds: policies.identity.technicalCustomerIds.size,
      sellerServiceProductIds: policies.lineEligibility.sellerServiceProductIds.size,
      logisticsArtifactProductIds: policies.lineEligibility.logisticsArtifactProductIds.size,
      storeShopIds: policies.salesChannel.storeShopIds.size,
      storeModules: policies.salesChannel.storeModules.size,
      posModules: policies.salesChannel.posModules.size,
    },
    missingVersionCount: orders.filter((order) => Object.values(order.policyVersions).some((value) => value.trim() === '')).length,
  };
}

async function buildPriorAuditComparison(
  orders: readonly AnalyticalOrder[],
  rawOrders: readonly RawAnalyticalOrderBundle[],
): Promise<Record<string, unknown>> {
  const onlineVerdict = await readJsonIfExists('scripts/snapshots/rfm/online-scope-outputs/online-scope-verdict.json');
  const monetaryVerdict = await readJsonIfExists('scripts/snapshots/rfm/monetary-audit-outputs/monetary-audit-verdict.json');
  const historicalVerdict = await readJsonIfExists('scripts/snapshots/rfm/historical-price-outputs/historical-price-authority-verdict.json');
  return {
    t11a31OnlineScope: {
      currentValidOrderCount: rawOrders.length,
      candidateOnlineOrderCount: orders.filter((order) => order.inclusionStatus === 'INCLUDED').length,
      excludedGenericOrTechnicalOrders: orders.filter((order) => order.exclusionReasons.includes('GENERIC_CUSTOMER') || order.exclusionReasons.includes('TECHNICAL_CUSTOMER')).length,
      excludedSellerServiceMarkedOrders: orders.filter((order) => order.exclusionReasons.includes('SELLER_SERVICE_MARKER')).length,
      priorVerdict: pick(onlineVerdict, ['primaryVerdict', 'conditions']),
    },
    t11a32Monetary: {
      grossEligibleTaxIncl: sumMoney(orders.map((order) => order.grossEligibleProductValueTaxIncl)),
      distributedProductDiscountTaxIncl: sumMoney(orders.flatMap((order) => order.lines.map((line) => line.allocatedOrderDiscountTaxIncl))),
      netEligibleTaxIncl: sumMoney(orders.map((order) => order.netEligibleProductValueTaxIncl)),
      shippingDiscountTaxIncl: sumMoney(orders.map((order) => order.shippingDiscountTaxIncl)),
      unresolvedDiscountTaxIncl: sumMoney(orders.map((order) => order.unresolvedDiscountTaxIncl)),
      priorVerdict: pick(monetaryVerdict, ['primaryVerdict', 'conditions']),
    },
    t11a32aHistoricalCatalog: {
      historicalPriceAuthority: 'ORDER_DETAIL_PERSISTED',
      catalogDiagnosticStatus: 'NOT_RUN_IN_CANONICAL_BUILDER',
      priorVerdict: pick(historicalVerdict, ['primaryVerdict', 'conditions']),
    },
    comparisonNote: 'Counts can differ from prior audits when scope, inferred policy configuration, or mixed-discount attribution differs.',
  };
}

async function writeJson(name: string, value: unknown): Promise<void> {
  assertAnalyticalOrderReportHasNoPii(value);
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJsonIfExists(fileName: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(fileName, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function queryByOrderChunks<T extends RowDataPacket>(
  orderIds: readonly number[],
  sqlForPlaceholders: (placeholders: string) => string,
): Promise<T[]> {
  const rows: T[] = [];
  const chunkSize = 1000;
  for (let index = 0; index < orderIds.length; index += chunkSize) {
    const chunk = orderIds.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    rows.push(...await query<T>(sqlForPlaceholders(chunk.map(() => '?').join(', ')), chunk));
  }
  return rows;
}

async function query<T extends RowDataPacket>(sql: string, params: readonly unknown[]): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(
    { sql, timeout: Math.max(config.prestashopDb.queryTimeoutMs, auditQueryTimeoutMs) },
    [...params] as Array<string | number | null>,
  );
  return rows;
}

function inferGenericCustomerIds(
  rawOrders: readonly RawAnalyticalOrderBundle[],
  sellerServiceProductIds: readonly number[],
): readonly number[] {
  const sellerIds = new Set(sellerServiceProductIds);
  const grouped = groupBy(rawOrders, (order) => order.order.prestashopCustomerId);
  return Array.from(grouped.entries())
    .filter(([, orders]) => {
      const sellerMarked = orders.filter((order) => order.lines.some((line) => sellerIds.has(line.productId))).length;
      return orders.length > 100 || sellerMarked / Math.max(orders.length, 1) >= 0.5;
    })
    .map(([customerId]) => customerId)
    .sort((a, b) => a - b)
    .slice(0, 3);
}

function pick(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
}

function countReasons(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function deltaBucket(delta: string): string {
  const abs = Math.abs(Number(delta));
  if (abs === 0) return '0';
  if (abs <= 1) return '<=1 CLP';
  if (abs <= 10) return '2-10 CLP';
  if (abs <= 100) return '11-100 CLP';
  return '>100 CLP';
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function parseNumberListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return [...new Set(raw.split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value >= 0))].sort((a, b) => a - b);
}

function parseStringListEnv(name: string, fallback: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  return [...new Set(raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function resolveAmbiguousPolicy(): 'INCLUDE_AS_CANDIDATE' | 'EXCLUDE' | 'QUARANTINE' {
  const raw = process.env.ANALYTICAL_ORDER_AMBIGUOUS_POLICY?.trim() || 'INCLUDE_AS_CANDIDATE';
  if (raw === 'INCLUDE_AS_CANDIDATE' || raw === 'EXCLUDE' || raw === 'QUARANTINE') return raw;
  throw new Error('ANALYTICAL_ORDER_AMBIGUOUS_POLICY must be INCLUDE_AS_CANDIDATE, EXCLUDE or QUARANTINE');
}

function resolveScope(): 'operational_365d' | 'sampled_historical' {
  const raw = process.env.ANALYTICAL_ORDER_SCOPE?.trim() || 'operational_365d';
  if (raw === 'operational_365d' || raw === 'sampled_historical') return raw;
  throw new Error('ANALYTICAL_ORDER_SCOPE must be operational_365d or sampled_historical');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function requiredUtcReferenceTime(name: string): string {
  const value = requiredEnv(name);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !value.endsWith('Z')) {
    throw new Error(`${name} must be an explicit UTC ISO instant ending in Z`);
  }
  return parsed.toISOString();
}

function mysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

function windowStart(reference: string): string {
  return new Date(new Date(reference).getTime() - 365 * 86_400_000).toISOString();
}

function asInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid integer: ${String(value)}`);
  return parsed;
}

type OrderRow = RowDataPacket & Record<string, string | number | null>;
type OrderLineRow = RowDataPacket & Record<string, string | number | null>;
type DiscountRow = RowDataPacket & Record<string, string | number | null>;
