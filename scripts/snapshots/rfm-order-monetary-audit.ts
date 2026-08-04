import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  assertMonetaryAuditReportHasNoPii,
  buildMonetaryAuditVerdict,
  buildRfmMonetaryImpact,
  classifyCartRule,
  compareMonetaryPolicies,
  composeOrderMonetary,
  evaluateLineValueSemantics,
  evaluateManualTaxFormula,
  monetaryCompositionChecksum,
  normalizeMonetaryCompositionPolicy,
  money,
  subMoney,
  sumMoney,
  type CartRuleCategory,
  type MonetaryCartRuleInput,
  type MonetaryCompositionPolicy,
  type MonetaryOrderInput,
  type MonetaryOrderLineInput,
  type OrderMonetaryComposition,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const outputDir = path.resolve('scripts/snapshots/rfm/monetary-audit-outputs');
const auditQueryTimeoutMs = Number(process.env.RFM_MONETARY_AUDIT_QUERY_TIMEOUT_MS ?? 300_000);
const auditScope = resolveAuditScope();
const tablePrefix = config.prestashopDb.prefix;
const tables = {
  orders: `${tablePrefix}orders`,
  orderDetail: `${tablePrefix}order_detail`,
  orderCartRule: `${tablePrefix}order_cart_rule`,
  cartRule: `${tablePrefix}cart_rule`,
  customer: `${tablePrefix}customer`,
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
  const [schemaFields, orders] = await Promise.all([
    readSchemaFields(),
    readOrders(),
  ]);
  const policy = normalizeMonetaryCompositionPolicy({
    confirmedSellerServiceProductIds: parseNumberListEnv('RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS', [444]),
    confirmedLogisticsProductIds: parseNumberListEnv('RFM_CONFIRMED_LOGISTICS_PRODUCT_IDS', []),
  });
  const compositions = orders.map((order) => composeOrderMonetary(order, policy));
  const operationalOrders = orders.filter((order) => isOperationalOrder(order.validOrderAt, referenceTime));
  const operationalCompositions = compositions.filter((composition) => isOperationalOrder(composition.validOrderAt, referenceTime));
  const lineSemantics = evaluateLineValueSemantics(orders);
  const manualTaxFormula = evaluateManualTaxFormula(orders);
  const policyComparison = compareMonetaryPolicies(orders, compositions);
  const rfmImpact = buildRfmMonetaryImpact(referenceTime, calculationVersion, operationalOrders, operationalCompositions);
  const verdict = buildMonetaryAuditVerdict({
    compositions,
    policyComparison,
    lineSemantics,
    manualTaxFormula,
  });

  await writeJson('schema-fields.json', schemaFields);
  await writeJson('current-price-calculation.json', buildCurrentPriceCalculation(lineSemantics, manualTaxFormula));
  await writeJson('tax-rate-analysis.json', buildTaxRateAnalysis(orders));
  await writeJson('line-vs-order-products-reconciliation.json', buildLineVsOrderProductsReconciliation(orders, compositions));
  await writeJson('discount-fields-reconciliation.json', buildDiscountFieldsReconciliation(orders));
  await writeJson('cart-rule-classification.json', buildCartRuleClassification(orders));
  await writeJson('technical-product-analysis.json', buildTechnicalProductAnalysis(orders, compositions, policy));
  await writeJson('eligible-product-subtotal-analysis.json', buildEligibleProductSubtotalAnalysis(compositions));
  await writeJson('discount-allocation-analysis.json', buildDiscountAllocationAnalysis(compositions));
  await writeJson('paid-total-reconciliation.json', buildPaidTotalReconciliation(compositions));
  await writeJson('monetary-policy-comparison.json', policyComparison);
  await writeJson('rfm-monetary-impact.json', rfmImpact);
  await writeJson('order-special-cases.json', buildOrderSpecialCases(orders, compositions));
  await writeJson('monetary-audit-verdict.json', {
    ...verdict,
    lineSemantics,
    manualTaxFormula,
    orderCount: orders.length,
    operationalOrderCount: operationalOrders.length,
    auditScope,
    checksum: monetaryCompositionChecksum({
      verdict,
      lineSemantics,
      manualTaxFormula,
      policyComparison,
      rfmImpact: {
        before: rfmImpact.before,
        after: rfmImpact.after,
        changedRfmCodeCount: rfmImpact.changedRfmCodeCount,
        changedMonetaryScoreCount: rfmImpact.changedMonetaryScoreCount,
      },
    }),
  });

  console.info(JSON.stringify({
    primaryVerdict: verdict.primaryVerdict,
    conditions: verdict.conditions,
    lineSemantics: lineSemantics.verdict,
    manualTaxFormula: manualTaxFormula.verdict,
    policyComparison,
    rfmImpact: {
      before: rfmImpact.before.totalMonetary,
      after: rfmImpact.after.totalMonetary,
      changedMonetaryScoreCount: rfmImpact.changedMonetaryScoreCount,
    },
  }, null, 2));
} finally {
  await pool.end();
}

async function readSchemaFields(): Promise<Record<string, readonly Record<string, unknown>[]>> {
  const tableNames = [tables.orderDetail, tables.orders, tables.orderCartRule, tables.cartRule];
  const rows = await query<SchemaRow>(
    `
      SELECT
        table_name AS tableName,
        column_name AS columnName,
        data_type AS dataType,
        column_type AS columnType,
        is_nullable AS isNullable
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN (?, ?, ?, ?)
      ORDER BY table_name ASC, ordinal_position ASC
    `,
    tableNames,
  );
  return Object.fromEntries(
    tableNames.map((tableName) => [
      tableName,
      rows
        .filter((row) => row.tableName === tableName)
        .map((row) => ({
          column: row.columnName,
          dataType: row.dataType,
          columnType: row.columnType,
          nullable: row.isNullable,
        })),
    ]),
  );
}

async function readOrders(): Promise<readonly MonetaryOrderInput[]> {
  const dateFilter = auditScope === 'operational_365d' ? 'AND o.date_add >= ? AND o.date_add < ?' : 'AND o.date_add < ?';
  const dateParams = auditScope === 'operational_365d'
    ? [mysqlDateTime(windowStart(referenceTime)), mysqlDateTime(referenceTime)]
    : [mysqlDateTime(referenceTime)];
  const orderRows = await query<OrderRow>(
    `
      SELECT
        o.id_order AS orderId,
        o.id_customer AS prestashopCustomerId,
        o.date_add AS validOrderAt,
        o.id_shop AS shopId,
        o.module AS module,
        o.id_currency AS currencyId,
        o.conversion_rate AS conversionRate,
        o.total_products AS totalProductsTaxExcl,
        o.total_products_wt AS totalProductsTaxIncl,
        o.total_discounts AS totalDiscounts,
        o.total_discounts_tax_incl AS totalDiscountsTaxIncl,
        o.total_discounts_tax_excl AS totalDiscountsTaxExcl,
        o.total_shipping_tax_incl AS totalShippingTaxIncl,
        o.total_shipping_tax_excl AS totalShippingTaxExcl,
        o.total_wrapping_tax_incl AS totalWrappingTaxIncl,
        o.total_wrapping_tax_excl AS totalWrappingTaxExcl,
        o.total_paid_tax_incl AS totalPaidTaxIncl,
        o.total_paid_tax_excl AS totalPaidTaxExcl,
        o.total_paid_real AS totalPaidReal,
        o.round_mode AS roundMode,
        o.round_type AS roundType
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        ${dateFilter}
      ORDER BY o.id_order ASC
    `,
    dateParams,
  );
  const orderIds = orderRows.map((row) => asInt(row.orderId));
  const [lineRows, cartRuleRows, refundRows] = await Promise.all([
    readOrderLinesByOrderIds(orderIds),
    readCartRulesByOrderIds(orderIds),
    readRefundsByOrderIds(orderIds),
  ]);
  const linesByOrder = groupBy(lineRows.map(toLine), (line) => line.orderId);
  const rulesByOrder = groupBy(cartRuleRows.map(toCartRule), (rule) => rule.orderId);
  const refundEvidence = new Map(refundRows.map((row) => [asInt(row.orderId), asInt(row.refundEvidence) > 0]));
  return orderRows.map((row) => ({
    orderId: asInt(row.orderId),
    prestashopCustomerId: asInt(row.prestashopCustomerId),
    validOrderAt: String(row.validOrderAt),
    shopId: asInt(row.shopId),
    module: String(row.module ?? 'unknown').toLowerCase(),
    currencyId: asInt(row.currencyId),
    conversionRate: money(String(row.conversionRate ?? '1')),
    totalProductsTaxExcl: money(String(row.totalProductsTaxExcl ?? '0')),
    totalProductsTaxIncl: money(String(row.totalProductsTaxIncl ?? '0')),
    totalDiscounts: money(String(row.totalDiscounts ?? '0')),
    totalDiscountsTaxIncl: money(String(row.totalDiscountsTaxIncl ?? '0')),
    totalDiscountsTaxExcl: money(String(row.totalDiscountsTaxExcl ?? '0')),
    totalShippingTaxIncl: money(String(row.totalShippingTaxIncl ?? '0')),
    totalShippingTaxExcl: money(String(row.totalShippingTaxExcl ?? '0')),
    totalWrappingTaxIncl: money(String(row.totalWrappingTaxIncl ?? '0')),
    totalWrappingTaxExcl: money(String(row.totalWrappingTaxExcl ?? '0')),
    totalPaidTaxIncl: money(String(row.totalPaidTaxIncl ?? '0')),
    totalPaidTaxExcl: money(String(row.totalPaidTaxExcl ?? '0')),
    totalPaidReal: money(String(row.totalPaidReal ?? '0')),
    roundMode: nullableInt(row.roundMode),
    roundType: nullableInt(row.roundType),
    refundEvidence: refundEvidence.get(asInt(row.orderId)) ?? false,
    lines: linesByOrder.get(asInt(row.orderId)) ?? [],
    cartRules: rulesByOrder.get(asInt(row.orderId)) ?? [],
  }));
}

function buildCurrentPriceCalculation(
  lineSemantics: ReturnType<typeof evaluateLineValueSemantics>,
  manualTaxFormula: ReturnType<typeof evaluateManualTaxFormula>,
): Record<string, unknown> {
  return {
    currentImplementation: [
      {
        area: 'T08 Purchased Products',
        sourceFields: ['ps_order_detail.total_price_tax_incl', 'ps_order_detail.product_quantity'],
        formula: 'SUM(total_price_tax_incl)',
        taxBasis: 'tax_incl_persisted_line_total',
        discountBasis: 'line_total_semantics_audited_separately',
      },
      {
        area: 'T09 Product Behavior',
        sourceFields: ['ps_order_detail.total_price_tax_incl'],
        formula: 'SUM(total_price_tax_incl), spendShare = itemSpent / totalSpent',
        taxBasis: 'tax_incl_persisted_line_total',
        discountBasis: 'line_total_semantics_audited_separately',
      },
      {
        area: 'RFM Monetary',
        sourceFields: ['ps_orders.total_paid_tax_incl'],
        formula: 'SUM(total_paid_tax_incl)',
        taxBasis: 'tax_incl_paid_order_total',
        discountBasis: 'order_total_after_prestashop_order_level_calculation',
      },
    ],
    manualTaxFormulaSearch: {
      formula: '(product price - product discount) * 1.19',
      foundInProductiveT08T09Rfm: false,
      verdictFromObservedRates: manualTaxFormula.verdict,
    },
    lineSemantics,
    manualTaxFormula,
  };
}

async function readOrderLinesByOrderIds(orderIds: readonly number[]): Promise<readonly OrderLineRow[]> {
  return queryByOrderIdChunks<OrderLineRow>(
    orderIds,
    (placeholders) => `
      SELECT
        od.id_order_detail AS orderDetailId,
        od.id_order AS orderId,
        od.product_id AS productId,
        od.product_attribute_id AS productAttributeId,
        od.product_quantity AS productQuantity,
        od.unit_price_tax_excl AS unitPriceTaxExcl,
        od.unit_price_tax_incl AS unitPriceTaxIncl,
        od.total_price_tax_excl AS totalPriceTaxExcl,
        od.total_price_tax_incl AS totalPriceTaxIncl,
        od.product_price AS productPrice,
        od.reduction_percent AS reductionPercent,
        od.reduction_amount AS reductionAmount,
        od.reduction_amount_tax_incl AS reductionAmountTaxIncl,
        od.reduction_amount_tax_excl AS reductionAmountTaxExcl,
        od.group_reduction AS groupReduction,
        od.tax_computation_method AS taxComputationMethod,
        od.id_tax_rules_group AS taxRulesGroupId
      FROM ${tables.orderDetail} od
      WHERE od.id_order IN (${placeholders})
      ORDER BY od.id_order ASC, od.id_order_detail ASC
    `,
  );
}

async function readCartRulesByOrderIds(orderIds: readonly number[]): Promise<readonly CartRuleRow[]> {
  return queryByOrderIdChunks<CartRuleRow>(
    orderIds,
    (placeholders) => `
      SELECT
        ocr.id_order AS orderId,
        ocr.id_cart_rule AS cartRuleId,
        ocr.value AS valueTaxIncl,
        ocr.value_tax_excl AS valueTaxExcl,
        cr.free_shipping AS freeShipping,
        cr.reduction_percent AS reductionPercent,
        cr.reduction_amount AS reductionAmount,
        cr.reduction_tax AS reductionTax,
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

async function readRefundsByOrderIds(orderIds: readonly number[]): Promise<readonly RefundRow[]> {
  return queryByOrderIdChunks<RefundRow>(
    orderIds,
    (placeholders) => `
      SELECT
        od.id_order AS orderId,
        MAX(CASE WHEN od.product_quantity_refunded > 0 OR od.total_refunded_tax_incl > 0 THEN 1 ELSE 0 END) AS refundEvidence
      FROM ${tables.orderDetail} od
      WHERE od.id_order IN (${placeholders})
      GROUP BY od.id_order
    `,
  );
}

async function queryByOrderIdChunks<T extends RowDataPacket>(
  orderIds: readonly number[],
  sqlForPlaceholders: (placeholders: string) => string,
): Promise<T[]> {
  const chunkSize = 1000;
  const rows: T[] = [];
  for (let index = 0; index < orderIds.length; index += chunkSize) {
    const chunk = orderIds.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    rows.push(...await query<T>(sqlForPlaceholders(placeholders), chunk));
  }
  return rows;
}

function buildTaxRateAnalysis(orders: readonly MonetaryOrderInput[]): Record<string, unknown> {
  const lines = orders.flatMap((order) => order.lines);
  const rates = lines.map((line) => ({
    taxRulesGroupId: line.taxRulesGroupId ?? -1,
    rate: effectiveRateBucket(line.totalPriceTaxIncl, line.totalPriceTaxExcl),
  }));
  return {
    distinctTaxRulesGroupCount: new Set(lines.map((line) => line.taxRulesGroupId ?? -1)).size,
    lineCount: lines.length,
    zeroTaxLineCount: rates.filter((entry) => entry.rate === '0.000000').length,
    non19LineCount: rates.filter((entry) => entry.rate !== '0.190000' && entry.rate !== 'UNDEFINED').length,
    undefinedRateLineCount: rates.filter((entry) => entry.rate === 'UNDEFINED').length,
    rateDistribution: summarizeByKey(rates, (entry) => entry.rate),
    taxRulesGroupDistribution: summarizeByKey(rates, (entry) => String(entry.taxRulesGroupId)),
  };
}

function buildLineVsOrderProductsReconciliation(
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
): Record<string, unknown> {
  return {
    taxIncl: summarizeDeltaBuckets(orders, compositions.map((composition) => composition.detailVsOrderProductsTaxInclDelta)),
    taxExcl: summarizeDeltaBuckets(orders, compositions.map((composition) => composition.detailVsOrderProductsTaxExclDelta)),
    byShop: summarizeCompositionGroups(orders, compositions, (order) => `shop_${order.shopId}`),
    byModule: summarizeCompositionGroups(orders, compositions, (order) => order.module),
    byCurrency: summarizeCompositionGroups(orders, compositions, (order) => `currency_${order.currencyId}`),
    byYear: summarizeCompositionGroups(orders, compositions, (order) => order.validOrderAt.slice(0, 4)),
    byHasOrderDiscount: summarizeCompositionGroups(orders, compositions, (order) => (compareStringMoney(order.totalDiscountsTaxIncl, '0.000000') > 0 ? 'has_order_discount' : 'no_order_discount')),
    byHasSellerService: summarizeCompositionGroups(orders, compositions, (_order, composition) => (compareStringMoney(composition.excludedSellerServiceValueTaxIncl, '0.000000') > 0 ? 'has_seller_service' : 'no_seller_service')),
    byHasLogisticsProduct: summarizeCompositionGroups(orders, compositions, (_order, composition) => (compareStringMoney(composition.excludedLogisticsValueTaxIncl, '0.000000') > 0 ? 'has_logistics_product' : 'no_logistics_product')),
  };
}

function buildDiscountFieldsReconciliation(orders: readonly MonetaryOrderInput[]): Record<string, unknown> {
  let ordersWhereLegacyEqualsTaxIncl = 0;
  let ordersWhereLegacyEqualsTaxExcl = 0;
  let ordersWhereAllDiffer = 0;
  let maxDifference = '0.000000';
  for (const order of orders) {
    const legacyVsIncl = absMoney(subMoney(order.totalDiscounts, order.totalDiscountsTaxIncl));
    const legacyVsExcl = absMoney(subMoney(order.totalDiscounts, order.totalDiscountsTaxExcl));
    if (compareStringMoney(legacyVsIncl, '0.000000') === 0) ordersWhereLegacyEqualsTaxIncl += 1;
    if (compareStringMoney(legacyVsExcl, '0.000000') === 0) ordersWhereLegacyEqualsTaxExcl += 1;
    if (compareStringMoney(legacyVsIncl, '0.000000') !== 0 && compareStringMoney(legacyVsExcl, '0.000000') !== 0) {
      ordersWhereAllDiffer += 1;
    }
    maxDifference = maxMoney(maxDifference, legacyVsIncl, legacyVsExcl);
  }
  return {
    ordersWithDiscount: orders.filter((order) => compareStringMoney(order.totalDiscountsTaxIncl, '0.000000') > 0).length,
    ordersWithoutDiscount: orders.filter((order) => compareStringMoney(order.totalDiscountsTaxIncl, '0.000000') === 0).length,
    ordersWhereLegacyEqualsTaxIncl,
    ordersWhereLegacyEqualsTaxExcl,
    ordersWhereAllDiffer,
    maxDifference,
    recommendation: {
      taxIncludedAnalysis: 'total_discounts_tax_incl',
      taxExcludedDiagnostics: 'total_discounts_tax_excl',
      totalDiscountsLegacyAuthority: 'DO_NOT_USE_UNTIL_SEMANTICS_CONFIRMED',
    },
  };
}

function buildCartRuleClassification(orders: readonly MonetaryOrderInput[]): Record<string, unknown> {
  const rules = orders.flatMap((order) => order.cartRules.map((rule) => ({ order, rule: classifyCartRule(rule) })));
  return Object.fromEntries(
    categories().map((category) => {
      const selected = rules.filter(({ rule }) => rule.category === category);
      return [
        category,
        {
          orderCount: new Set(selected.map(({ order }) => order.orderId)).size,
          ruleCount: selected.length,
          grossDiscountTaxIncl: sumMoney(selected.map(({ rule }) => rule.valueTaxIncl)),
          grossDiscountTaxExcl: sumMoney(selected.map(({ rule }) => rule.valueTaxExcl)),
          averageDiscount: selected.length === 0 ? '0.000000' : divideMoney(sumMoney(selected.map(({ rule }) => rule.valueTaxIncl)), selected.length),
          ordersWithMultipleRules: new Set(
            selected
              .filter(({ order }) => order.cartRules.length > 1)
              .map(({ order }) => order.orderId),
          ).size,
        },
      ];
    }),
  );
}

function buildTechnicalProductAnalysis(
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
  policy: MonetaryCompositionPolicy,
): Record<string, unknown> {
  const ids = [
    ...policy.confirmedSellerServiceProductIds.map((productId) => ({ productId, classification: 'SELLER_SERVICE' })),
    ...policy.confirmedLogisticsProductIds.map((productId) => ({ productId, classification: 'LOGISTICS_ARTIFACT' })),
  ];
  return {
    policy: {
      policyVersion: policy.policyVersion,
      confirmedSellerServiceProductIds: policy.confirmedSellerServiceProductIds,
      confirmedLogisticsProductIds: policy.confirmedLogisticsProductIds,
    },
    products: ids.map(({ productId, classification }) => {
      const orderLinePairs = orders.flatMap((order) => order.lines.filter((line) => line.productId === productId).map((line) => ({ order, line })));
      return {
        productId,
        classification,
        orderCount: new Set(orderLinePairs.map(({ order }) => order.orderId)).size,
        lineCount: orderLinePairs.length,
        quantity: orderLinePairs.reduce((sum, { line }) => sum + line.productQuantity, 0),
        grossLineTaxIncl: sumMoney(orderLinePairs.map(({ line }) => line.totalPriceTaxIncl)),
        grossLineTaxExcl: sumMoney(orderLinePairs.map(({ line }) => line.totalPriceTaxExcl)),
        unitPriceDistribution: decimalDistribution(orderLinePairs.map(({ line }) => line.unitPriceTaxIncl)),
        discountParticipation: orderLinePairs.filter(({ order }) => compareStringMoney(order.totalDiscountsTaxIncl, '0.000000') > 0).length,
        cartRuleParticipation: orderLinePairs.filter(({ order }) => order.cartRules.length > 0).length,
        shopDistribution: summarizeByKey(orderLinePairs, ({ order }) => `shop_${order.shopId}`),
        moduleDistribution: summarizeByKey(orderLinePairs, ({ order }) => order.module),
      };
    }),
    aggregateExcludedSellerServiceValueTaxIncl: sumMoney(compositions.map((composition) => composition.excludedSellerServiceValueTaxIncl)),
    aggregateExcludedLogisticsValueTaxIncl: sumMoney(compositions.map((composition) => composition.excludedLogisticsValueTaxIncl)),
  };
}

function buildEligibleProductSubtotalAnalysis(compositions: readonly OrderMonetaryComposition[]): Record<string, unknown> {
  return {
    orderCount: compositions.length,
    grossEligibleProductValueTaxIncl: sumMoney(compositions.map((composition) => composition.grossEligibleProductValueTaxIncl)),
    grossEligibleProductValueTaxExcl: sumMoney(compositions.map((composition) => composition.grossEligibleProductValueTaxExcl)),
    excludedSellerServiceValueTaxIncl: sumMoney(compositions.map((composition) => composition.excludedSellerServiceValueTaxIncl)),
    excludedLogisticsValueTaxIncl: sumMoney(compositions.map((composition) => composition.excludedLogisticsValueTaxIncl)),
    unresolvedLineValueTaxIncl: sumMoney(compositions.map((composition) => composition.unresolvedLineValueTaxIncl)),
    zeroEligibleOrderCount: compositions.filter((composition) => compareStringMoney(composition.grossEligibleProductValueTaxIncl, '0.000000') === 0).length,
  };
}

function buildDiscountAllocationAnalysis(compositions: readonly OrderMonetaryComposition[]): Record<string, unknown> {
  return {
    attributionStatusDistribution: summarizeByKey(compositions, (composition) => composition.discountAttributionStatus),
    productApplicableOrderDiscountTaxIncl: sumMoney(compositions.map((composition) => composition.productApplicableOrderDiscountTaxIncl)),
    shippingDiscountTaxIncl: sumMoney(compositions.map((composition) => composition.shippingDiscountTaxIncl)),
    otherDiscountTaxIncl: sumMoney(compositions.map((composition) => composition.otherDiscountTaxIncl)),
    allocatedDiscountTaxIncl: sumMoney(compositions.flatMap((composition) => composition.lines.map((line) => line.allocatedOrderDiscountTaxIncl))),
    negativeNetLineCount: 0,
    allocationMethod: 'largest_remainder',
  };
}

function buildPaidTotalReconciliation(compositions: readonly OrderMonetaryComposition[]): Record<string, unknown> {
  return {
    taxIncl: summarizeDeltaBuckets([], compositions.map((composition) => composition.paidTotalReconciliationDeltaTaxIncl)),
    taxExcl: summarizeDeltaBuckets([], compositions.map((composition) => composition.paidTotalReconciliationDeltaTaxExcl)),
    statusDistribution: summarizeByKey(compositions, (composition) => composition.reconciliationStatus),
    causeDistribution: summarizeByKey(
      compositions.flatMap((composition) => composition.reasonCodes),
      (reason) => reason,
    ),
  };
}

function buildOrderSpecialCases(
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
): Record<string, unknown> {
  return {
    fullyDiscountedOrderCount: compositions.filter((composition) => compareStringMoney(composition.netEligibleProductValueTaxIncl, '0.000000') === 0 && compareStringMoney(composition.productApplicableOrderDiscountTaxIncl, '0.000000') > 0).length,
    discountGreaterThanEligibleSubtotalCount: compositions.filter((composition) => compareStringMoney(composition.productApplicableOrderDiscountTaxIncl, composition.grossEligibleProductValueTaxIncl) > 0).length,
    zeroPaidOrderCount: orders.filter((order) => compareStringMoney(order.totalPaidTaxIncl, '0.000000') === 0).length,
    negativePaidOrderCount: orders.filter((order) => compareStringMoney(order.totalPaidTaxIncl, '0.000000') < 0).length,
    multipleCartRulesOrderCount: orders.filter((order) => order.cartRules.length > 1).length,
    giftProductOrderCount: compositions.filter((composition) => composition.cartRuleCategories.includes('GIFT_PRODUCT')).length,
    freeShippingOrderCount: compositions.filter((composition) => composition.cartRuleCategories.includes('FREE_SHIPPING')).length,
    technicalOnlyOrderCount: compositions.filter((composition) => compareStringMoney(composition.grossEligibleProductValueTaxIncl, '0.000000') === 0 && composition.lines.length > 0).length,
    exemptLineOrderCount: compositions.filter((composition) => composition.lines.some((line) => line.effectiveTaxRate === '0.000000')).length,
    multiCurrencyOrderCount: new Set(orders.map((order) => order.currencyId)).size > 1 ? orders.length : 0,
    refundEvidenceOrderCount: orders.filter((order) => order.refundEvidence).length,
    refundAdjustmentApplied: false,
  };
}

function summarizeDeltaBuckets(orders: readonly MonetaryOrderInput[], deltas: readonly string[]): Record<string, unknown> {
  const buckets = ['0', '<=1', '2-10', '11-100', '101-1000', '>1000'];
  return Object.fromEntries(
    buckets.map((bucket) => {
      const selectedIndexes = deltas
        .map((delta, index) => ({ delta, index }))
        .filter(({ delta }) => deltaBucket(delta) === bucket)
        .map(({ index }) => index);
      return [
        bucket,
        {
          orderCount: selectedIndexes.length,
          orderShare: deltas.length === 0 ? '0.000000' : (selectedIndexes.length / deltas.length).toFixed(6),
          grossAmount: orders.length === deltas.length ? sumMoney(selectedIndexes.map((index) => orders[index]?.totalPaidTaxIncl ?? '0.000000')) : '0.000000',
          minDelta: decimalMin(selectedIndexes.map((index) => deltas[index] ?? '0.000000')),
          maxDelta: decimalMax(selectedIndexes.map((index) => deltas[index] ?? '0.000000')),
          averageDelta: selectedIndexes.length === 0 ? '0.000000' : divideMoney(sumMoney(selectedIndexes.map((index) => deltas[index] ?? '0.000000')), selectedIndexes.length),
        },
      ];
    }),
  );
}

function summarizeCompositionGroups(
  orders: readonly MonetaryOrderInput[],
  compositions: readonly OrderMonetaryComposition[],
  keyOf: (order: MonetaryOrderInput, composition: OrderMonetaryComposition) => string,
): readonly Record<string, unknown>[] {
  const grouped = new Map<string, number[]>();
  orders.forEach((order, index) => {
    const key = keyOf(order, compositions[index]!);
    grouped.set(key, [...(grouped.get(key) ?? []), index]);
  });
  return Array.from(grouped.entries())
    .map(([key, indexes]) => ({
      key,
      orderCount: indexes.length,
      grossPaidTaxIncl: sumMoney(indexes.map((index) => orders[index]?.totalPaidTaxIncl ?? '0.000000')),
      detailTaxInclDelta: sumMoney(indexes.map((index) => compositions[index]?.detailVsOrderProductsTaxInclDelta ?? '0.000000')),
      paidReconciliationDeltaTaxIncl: sumMoney(indexes.map((index) => compositions[index]?.paidTotalReconciliationDeltaTaxIncl ?? '0.000000')),
    }))
    .sort((a, b) => Number(b.orderCount) - Number(a.orderCount));
}

function toLine(row: OrderLineRow): MonetaryOrderLineInput {
  return {
    orderDetailId: asInt(row.orderDetailId),
    orderId: asInt(row.orderId),
    productId: asInt(row.productId),
    productAttributeId: asInt(row.productAttributeId),
    productQuantity: asInt(row.productQuantity),
    unitPriceTaxExcl: money(String(row.unitPriceTaxExcl ?? '0')),
    unitPriceTaxIncl: money(String(row.unitPriceTaxIncl ?? '0')),
    totalPriceTaxExcl: money(String(row.totalPriceTaxExcl ?? '0')),
    totalPriceTaxIncl: money(String(row.totalPriceTaxIncl ?? '0')),
    productPrice: money(String(row.productPrice ?? '0')),
    reductionPercent: money(String(row.reductionPercent ?? '0')),
    reductionAmount: money(String(row.reductionAmount ?? '0')),
    reductionAmountTaxIncl: money(String(row.reductionAmountTaxIncl ?? '0')),
    reductionAmountTaxExcl: money(String(row.reductionAmountTaxExcl ?? '0')),
    groupReduction: money(String(row.groupReduction ?? '0')),
    taxComputationMethod: nullableInt(row.taxComputationMethod),
    taxRulesGroupId: nullableInt(row.taxRulesGroupId),
  };
}

function toCartRule(row: CartRuleRow): MonetaryCartRuleInput {
  return {
    orderId: asInt(row.orderId),
    cartRuleId: asInt(row.cartRuleId),
    valueTaxIncl: money(String(row.valueTaxIncl ?? '0')),
    valueTaxExcl: money(String(row.valueTaxExcl ?? '0')),
    freeShipping: asInt(row.freeShipping ?? 0) === 1,
    reductionPercent: money(String(row.reductionPercent ?? '0')),
    reductionAmount: money(String(row.reductionAmount ?? '0')),
    reductionTax: row.reductionTax === null || row.reductionTax === undefined ? null : asInt(row.reductionTax) === 1,
    reductionProduct: asInt(row.reductionProduct ?? 0),
    giftProduct: asInt(row.giftProduct ?? 0),
  };
}

function effectiveRateBucket(taxIncl: string, taxExcl: string): string {
  if (compareStringMoney(taxExcl, '0.000000') === 0) return 'UNDEFINED';
  const rate = Number(taxIncl) / Number(taxExcl) - 1;
  if (Math.abs(rate - 0.19) <= 0.0005) return '0.190000';
  if (Math.abs(rate) <= 0.0005) return '0.000000';
  return rate.toFixed(6);
}

function deltaBucket(delta: string): string {
  const abs = Number(absMoney(delta));
  if (abs === 0) return '0';
  if (abs <= 1) return '<=1';
  if (abs <= 10) return '2-10';
  if (abs <= 100) return '11-100';
  if (abs <= 1000) return '101-1000';
  return '>1000';
}

function decimalDistribution(values: readonly string[]): Record<string, unknown> {
  const sorted = [...values].sort(compareStringMoney);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    median: sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)],
    p95: sorted.length === 0 ? null : sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1) ?? null,
  };
}

function decimalMin(values: readonly string[]): string | null {
  return values.length === 0 ? null : [...values].sort(compareStringMoney)[0]!;
}

function decimalMax(values: readonly string[]): string | null {
  return values.length === 0 ? null : [...values].sort(compareStringMoney).at(-1)!;
}

function maxMoney(...values: readonly string[]): string {
  return [...values].sort(compareStringMoney).at(-1) ?? '0.000000';
}

function absMoney(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

function compareStringMoney(a: string, b: string): number {
  return Number(a) === Number(b) ? 0 : Number(a) < Number(b) ? -1 : 1;
}

function divideMoney(value: string, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return money((Number(value) / denominator).toFixed(6));
}

function summarizeByKey<T>(values: readonly T[], keyOf: (value: T) => string): readonly Record<string, unknown>[] {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return Array.from(grouped.entries())
    .map(([key, rows]) => ({ key, count: rows.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function categories(): readonly CartRuleCategory[] {
  return [
    'PERCENT_PRODUCT_DISCOUNT',
    'FIXED_PRODUCT_DISCOUNT',
    'SPECIFIC_PRODUCT_DISCOUNT',
    'FREE_SHIPPING',
    'MIXED_PRODUCT_AND_SHIPPING',
    'GIFT_PRODUCT',
    'UNKNOWN',
  ];
}

function isOperationalOrder(validOrderAt: string, reference: string): boolean {
  const end = new Date(reference).getTime();
  const start = end - 365 * 86_400_000;
  const actual = new Date(`${validOrderAt.replace(' ', 'T')}Z`).getTime();
  return actual >= start && actual < end;
}

function windowStart(reference: string): string {
  return new Date(new Date(reference).getTime() - 365 * 86_400_000).toISOString();
}

async function writeJson(name: string, value: unknown): Promise<void> {
  assertMonetaryAuditReportHasNoPii(value);
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function query<T extends RowDataPacket>(sql: string, params: readonly unknown[]): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(
    { sql, timeout: Math.max(config.prestashopDb.queryTimeoutMs, auditQueryTimeoutMs) },
    [...params] as Array<string | number | null>,
  );
  return rows;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
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

function parseNumberListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const value = process.env[name];
  if (!value || value.trim() === '') return fallback;
  return [...new Set(value.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isSafeInteger(entry) && entry >= 0))].sort((a, b) => a - b);
}

function resolveAuditScope(): 'operational_365d' | 'all_historical' {
  const value = process.env.RFM_MONETARY_AUDIT_SCOPE?.trim() || 'operational_365d';
  if (value === 'operational_365d' || value === 'all_historical') return value;
  throw new Error('RFM_MONETARY_AUDIT_SCOPE must be operational_365d or all_historical');
}

function mysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

function asInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid integer: ${String(value)}`);
  }
  return parsed;
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asInt(value);
}

type SchemaRow = RowDataPacket & {
  readonly tableName: string;
  readonly columnName: string;
  readonly dataType: string;
  readonly columnType: string;
  readonly isNullable: string;
};

type OrderRow = RowDataPacket & Record<string, string | number | null>;
type OrderLineRow = RowDataPacket & Record<string, string | number | null>;
type CartRuleRow = RowDataPacket & Record<string, string | number | null>;
type RefundRow = RowDataPacket & {
  readonly orderId: string | number;
  readonly refundEvidence: string | number;
};
