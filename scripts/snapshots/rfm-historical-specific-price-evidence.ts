import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  assertHistoricalSpecificPriceReportHasNoPii,
  auditHistoricalSpecificPriceEvidence,
  buildHistoricalSpecificPriceAuditVerdict,
  countHistoricalSpecificPriceEvidenceBy,
  historicalSpecificPriceEvidenceChecksum,
  summarizeHistoricalSpecificPriceEvidence,
  type HistoricalSpecificPriceCandidate,
  type HistoricalSpecificPriceLineEvidence,
  type HistoricalSpecificPriceLineInput,
} from '../../src/domain/customer-orders/index.js';
import { defaultConfirmedSellerServiceProductIds } from '../../src/domain/customer-rfm/seller-service-policy.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const scope = resolveScope();
const outputDir = path.resolve('scripts/snapshots/rfm/historical-specific-price-outputs');
const auditQueryTimeoutMs = Number(process.env.RFM_HISTORICAL_SPECIFIC_PRICE_QUERY_TIMEOUT_MS ?? 300_000);
const sellerServiceProductIds = parseNumberListEnv('RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS', defaultConfirmedSellerServiceProductIds);
const logisticsProductIds = parseNumberListEnv('RFM_CONFIRMED_LOGISTICS_PRODUCT_IDS', []);
const tablePrefix = config.prestashopDb.prefix;
const tables = {
  orders: `${tablePrefix}orders`,
  orderDetail: `${tablePrefix}order_detail`,
  customer: `${tablePrefix}customer`,
  address: `${tablePrefix}address`,
  product: `${tablePrefix}product`,
  productShop: `${tablePrefix}product_shop`,
  productAttribute: `${tablePrefix}product_attribute`,
  productAttributeShop: `${tablePrefix}product_attribute_shop`,
  specificPrice: `${tablePrefix}specific_price`,
  orderCartRule: `${tablePrefix}order_cart_rule`,
  cartRule: `${tablePrefix}cart_rule`,
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
  const orders = await readOrders();
  const orderIds = orders.map((order) => order.orderId);
  const [lines, cartRules] = await Promise.all([
    readLineContexts(orderIds),
    readCartRules(orderIds),
  ]);
  const specificPrices = await readSpecificPrices([...new Set(lines.map((line) => line.productId))]);
  const evidences = auditHistoricalSpecificPriceEvidence({ lines, specificPrices });
  const summary = summarizeHistoricalSpecificPriceEvidence(evidences);
  const verdict = buildHistoricalSpecificPriceAuditVerdict(evidences);
  const orderById = new Map(orders.map((order) => [order.orderId, order]));

  await writeJson('context-availability.json', buildContextAvailability(orders, lines, evidences));
  await writeJson('base-price-evidence.json', buildBasePriceEvidence(evidences));
  await writeJson('specific-price-selection.json', buildSelectionEvidence(evidences, specificPrices));
  await writeJson('specific-discount-summary.json', {
    referenceTime,
    calculationVersion,
    scope,
    ...summary,
  });
  await writeJson('specific-discount-by-type.json', buildSpecificDiscountByType(evidences));
  await writeJson('order-detail-reconciliation.json', buildOrderDetailReconciliation(evidences));
  await writeJson('total-products-reconciliation.json', buildTotalProductsReconciliation(evidences, orderById));
  await writeJson('order-discount-separation.json', buildOrderDiscountSeparation(evidences, orders, cartRules));
  await writeJson('tax-evidence.json', buildTaxEvidence(evidences));
  await writeJson('unresolved-lines.json', buildUnresolvedLines(evidences));
  await writeJson('historical-specific-price-verdict.json', {
    ...verdict,
    referenceTime,
    calculationVersion,
    scope,
    summary,
    checksum: historicalSpecificPriceEvidenceChecksum({ verdict, summary }),
  });

  console.info(JSON.stringify({
    primaryVerdict: verdict.primaryVerdict,
    conditions: verdict.conditions,
    scope,
    summary,
  }, null, 2));
} finally {
  await pool.end();
}

async function readOrders(): Promise<readonly AuditOrder[]> {
  const dateClause = scope === 'operational_365d' ? 'AND o.date_add >= ? AND o.date_add < ?' : 'AND o.date_add < ?';
  const dateParams = scope === 'operational_365d'
    ? [mysqlDateTime(windowStart(referenceTime)), mysqlDateTime(referenceTime)]
    : [mysqlDateTime(referenceTime)];
  const limitClause = scope === 'sampled_historical' ? 'LIMIT 5000' : '';
  const rows = await query<OrderRow>(
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
  return rows.map((row) => ({
    orderId: asInt(row.orderId),
    prestashopCustomerId: asInt(row.prestashopCustomerId),
    orderDate: String(row.orderDate),
    shopId: asInt(row.shopId),
    currencyId: asInt(row.currencyId),
    module: String(row.module ?? 'unknown').toLowerCase(),
    totalProductsTaxIncl: money(row.totalProductsTaxIncl),
    totalProductsTaxExcl: money(row.totalProductsTaxExcl),
    totalDiscountsTaxIncl: money(row.totalDiscountsTaxIncl),
    totalDiscountsTaxExcl: money(row.totalDiscountsTaxExcl),
    totalShippingTaxIncl: money(row.totalShippingTaxIncl),
    totalShippingTaxExcl: money(row.totalShippingTaxExcl),
    totalWrappingTaxIncl: money(row.totalWrappingTaxIncl),
    totalWrappingTaxExcl: money(row.totalWrappingTaxExcl),
    totalPaidTaxIncl: money(row.totalPaidTaxIncl),
    totalPaidTaxExcl: money(row.totalPaidTaxExcl),
  }));
}

async function readLineContexts(orderIds: readonly number[]): Promise<readonly HistoricalSpecificPriceLineInput[]> {
  const rows = await queryByChunks<LineContextRow>(
    orderIds,
    (placeholders) => `
      SELECT
        od.id_order_detail AS orderDetailId,
        od.id_order AS orderId,
        od.product_id AS productId,
        od.product_attribute_id AS productAttributeId,
        od.product_quantity AS quantity,
        o.date_add AS orderDate,
        o.id_shop AS shopId,
        o.id_currency AS currencyId,
        o.id_customer AS customerId,
        ad.id_country AS countryId,
        p.active AS productActive,
        COALESCE(ps.price, p.price) AS productBasePriceTaxExcl,
        CASE
          WHEN od.product_attribute_id > 0 THEN COALESCE(pas.price, pa.price)
          ELSE 0
        END AS combinationImpactTaxExcl,
        od.unit_price_tax_incl AS orderDetailUnitPriceTaxIncl,
        od.unit_price_tax_excl AS orderDetailUnitPriceTaxExcl,
        od.total_price_tax_incl AS orderDetailTotalPriceTaxIncl,
        od.total_price_tax_excl AS orderDetailTotalPriceTaxExcl,
        od.tax_rate AS orderDetailTaxRate
      FROM ${tables.orderDetail} od
      INNER JOIN ${tables.orders} o
        ON o.id_order = od.id_order
      LEFT JOIN ${tables.address} ad
        ON ad.id_address = o.id_address_delivery
      LEFT JOIN ${tables.product} p
        ON p.id_product = od.product_id
      LEFT JOIN ${tables.productShop} ps
        ON ps.id_product = od.product_id
       AND ps.id_shop = o.id_shop
      LEFT JOIN ${tables.productAttribute} pa
        ON pa.id_product_attribute = od.product_attribute_id
      LEFT JOIN ${tables.productAttributeShop} pas
        ON pas.id_product_attribute = od.product_attribute_id
       AND pas.id_shop = o.id_shop
      WHERE od.id_order IN (${placeholders})
      ORDER BY od.id_order ASC, od.id_order_detail ASC
    `,
  );
  return rows.map((row) => {
    const productId = asInt(row.productId);
    return {
      orderDetailId: asInt(row.orderDetailId),
      orderId: asInt(row.orderId),
      productId,
      productAttributeId: asInt(row.productAttributeId ?? 0),
      quantity: asInt(row.quantity),
      orderDate: String(row.orderDate),
      shopId: asInt(row.shopId),
      currencyId: asInt(row.currencyId),
      customerId: asInt(row.customerId),
      countryId: nullableInt(row.countryId),
      customerGroupId: null,
      customerGroupSource: 'unavailable',
      productActive: row.productActive === null || row.productActive === undefined ? null : asInt(row.productActive) === 1,
      productBasePriceTaxExcl: nullableMoney(row.productBasePriceTaxExcl),
      combinationImpactTaxExcl: nullableMoney(row.combinationImpactTaxExcl),
      basePriceSource: row.productBasePriceTaxExcl === null || row.productBasePriceTaxExcl === undefined ? 'unavailable' : 'current_state',
      combinationImpactSource: row.combinationImpactTaxExcl === null || row.combinationImpactTaxExcl === undefined ? 'unavailable' : 'current_state',
      orderDetailUnitPriceTaxIncl: money(row.orderDetailUnitPriceTaxIncl),
      orderDetailUnitPriceTaxExcl: money(row.orderDetailUnitPriceTaxExcl),
      orderDetailTotalPriceTaxIncl: money(row.orderDetailTotalPriceTaxIncl),
      orderDetailTotalPriceTaxExcl: money(row.orderDetailTotalPriceTaxExcl),
      orderDetailTaxRate: row.orderDetailTaxRate === null || row.orderDetailTaxRate === undefined
        ? null
        : money(Number(row.orderDetailTaxRate) / 100),
      isSellerService: sellerServiceProductIds.includes(productId),
      isLogisticsArtifact: logisticsProductIds.includes(productId),
    };
  });
}

async function readSpecificPrices(productIds: readonly number[]): Promise<readonly HistoricalSpecificPriceCandidate[]> {
  return (await queryByChunks<SpecificPriceRow>(
    productIds,
    (placeholders) => `
      SELECT
        id_specific_price AS specificPriceId,
        id_product AS productId,
        id_product_attribute AS productAttributeId,
        id_shop AS shopId,
        id_currency AS currencyId,
        id_country AS countryId,
        id_group AS groupId,
        id_customer AS customerId,
        id_cart AS cartId,
        price AS price,
        from_quantity AS fromQuantity,
        reduction AS reduction,
        reduction_tax AS reductionTax,
        reduction_type AS reductionType,
        \`from\` AS validFrom,
        \`to\` AS validTo
      FROM ${tables.specificPrice}
      WHERE id_product IN (${placeholders})
        AND id_cart = 0
      ORDER BY id_product ASC, id_specific_price ASC
    `,
  )).map((row) => ({
    specificPriceId: asInt(row.specificPriceId),
    productId: asInt(row.productId),
    productAttributeId: asInt(row.productAttributeId),
    shopId: asInt(row.shopId),
    currencyId: asInt(row.currencyId),
    countryId: asInt(row.countryId),
    groupId: asInt(row.groupId),
    customerId: asInt(row.customerId),
    cartId: asInt(row.cartId),
    price: money(row.price),
    fromQuantity: asInt(row.fromQuantity),
    reduction: money(row.reduction),
    reductionTax: asInt(row.reductionTax) === 1,
    reductionType: normalizeReductionType(row.reductionType),
    validFrom: zeroDateToNull(row.validFrom),
    validTo: zeroDateToNull(row.validTo),
  }));
}

async function readCartRules(orderIds: readonly number[]): Promise<readonly AuditCartRule[]> {
  return (await queryByChunks<CartRuleRow>(
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
  )).map((row) => ({
    orderId: asInt(row.orderId),
    cartRuleId: asInt(row.cartRuleId),
    valueTaxIncl: money(row.valueTaxIncl),
    valueTaxExcl: money(row.valueTaxExcl),
    freeShipping: asInt(row.freeShipping ?? 0) === 1,
    reductionPercent: money(row.reductionPercent ?? '0'),
    reductionAmount: money(row.reductionAmount ?? '0'),
    reductionTax: row.reductionTax === null || row.reductionTax === undefined ? null : asInt(row.reductionTax) === 1,
    reductionProduct: asInt(row.reductionProduct ?? 0),
    giftProduct: asInt(row.giftProduct ?? 0),
  }));
}

function buildContextAvailability(
  orders: readonly AuditOrder[],
  lines: readonly HistoricalSpecificPriceLineInput[],
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
): Record<string, unknown> {
  const orderLineProductIds = new Map<number, readonly number[]>();
  for (const line of lines) {
    orderLineProductIds.set(line.orderId, [...(orderLineProductIds.get(line.orderId) ?? []), line.productId]);
  }
  const sellerProductSet = new Set(sellerServiceProductIds);
  const logisticsProductSet = new Set(logisticsProductIds);
  const genericCustomerIds = inferGenericCustomerIds(orders, orderLineProductIds, sellerProductSet);
  return {
    referenceTime,
    calculationVersion,
    scope,
    allValidOrders: orders.length,
    candidateOnlineOrders: orders.filter((order) => !genericCustomerIds.has(order.prestashopCustomerId) && !(orderLineProductIds.get(order.orderId) ?? []).some((productId) => sellerProductSet.has(productId))).length,
    excludedTechnicalOrders: orders.filter((order) => (orderLineProductIds.get(order.orderId) ?? []).some((productId) => sellerProductSet.has(productId) || logisticsProductSet.has(productId))).length,
    totalLineCount: lines.length,
    commercialLineCount: evidences.filter((line) => line.isCommercialLine).length,
    excludedSellerServiceLineCount: evidences.filter((line) => line.exclusionReason === 'SELLER_SERVICE').length,
    excludedLogisticsArtifactLineCount: evidences.filter((line) => line.exclusionReason === 'LOGISTICS_ARTIFACT').length,
    contextStatusDistribution: countHistoricalSpecificPriceEvidenceBy(evidences, (line) => line.contextStatus),
    countryAvailableLineCount: lines.filter((line) => line.countryId !== null).length,
    customerGroupHistoricalAvailableLineCount: lines.filter((line) => line.customerGroupSource === 'historical').length,
    customerGroupUnavailableLineCount: lines.filter((line) => line.customerGroupSource === 'unavailable').length,
    taxRateExplicitLineCount: lines.filter((line) => line.orderDetailTaxRate !== null).length,
  };
}

function buildBasePriceEvidence(evidences: readonly HistoricalSpecificPriceLineEvidence[]): Record<string, unknown> {
  return {
    byStatus: countHistoricalSpecificPriceEvidenceBy(evidences, (line) => line.baseEvidenceStatus),
    currentStateOnlyLineCount: evidences.filter((line) => line.baseEvidenceStatus === 'BASE_PRICE_CURRENT_STATE_ONLY').length,
    unavailableLineCount: evidences.filter((line) => line.baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE').length,
    currentlyInactiveProductLineCount: evidences.filter((line) => line.reasonCodes.includes('PRODUCT_CURRENTLY_INACTIVE')).length,
    commercialBaseValueTaxIncl: sumMoney(evidences.filter((line) => line.isCommercialLine).map((line) => line.resolution.historicalBaseLineValueTaxIncl ?? '0.000000')),
    note: 'Base prices are read from current product tables for evidence only; they are not adopted as historical authority.',
  };
}

function buildSelectionEvidence(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
  specificPrices: readonly HistoricalSpecificPriceCandidate[],
): Record<string, unknown> {
  const commercial = evidences.filter((line) => line.isCommercialLine);
  return {
    catalogPriorityReplicated: [
      'id_product_attribute exact',
      'id_shop exact',
      'id_currency exact',
      'id_country exact',
      'id_group exact',
      'id_customer exact',
      'from_quantity',
      'priority',
      'negative id_specific_price',
    ],
    sourceCandidateCount: specificPrices.length,
    bySelectionStatus: countHistoricalSpecificPriceEvidenceBy(commercial, (line) => line.selection.status),
    selectedLineCount: commercial.filter((line) => line.selection.selected !== null).length,
    ambiguousLineCount: commercial.filter((line) => line.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS').length,
    contextIncompleteSelectionCount: commercial.filter((line) => line.selection.status === 'CONTEXT_INCOMPLETE').length,
    matchedDimensionDistribution: countBy(commercial.flatMap((line) => line.selection.matchedDimensions), (value) => value),
    candidateCountDistribution: countBy(commercial, (line) => String(line.selection.candidateCount)),
    compatibleCandidateCountDistribution: countBy(commercial, (line) => String(line.selection.compatibleCandidateCount)),
  };
}

function buildSpecificDiscountByType(evidences: readonly HistoricalSpecificPriceLineEvidence[]): Record<string, unknown> {
  const commercial = evidences.filter((line) => line.isCommercialLine);
  const types = ['percentage', 'amount', 'price_override', 'price_override_percentage', 'price_override_amount', 'none'];
  return Object.fromEntries(types.map((type) => {
    const selected = commercial.filter((line) => (line.resolution.discountType ?? 'none') === type);
    return [
      type,
      {
        lineCount: selected.length,
        orderCount: new Set(selected.map((line) => line.orderId)).size,
        grossBaseValueTaxIncl: sumMoney(selected.map((line) => line.resolution.historicalBaseLineValueTaxIncl ?? '0.000000')),
        reconstructedDiscountValueTaxIncl: sumMoney(selected.map((line) => line.resolution.reconstructedSpecificProductDiscountTaxIncl ?? '0.000000')),
        effectiveValueTaxIncl: sumMoney(selected.map((line) => line.resolution.historicalEffectiveLineValueTaxIncl ?? '0.000000')),
        orderDetailMatchRate: ratio(selected.filter((line) => line.comparison.orderDetailAlreadyReflectsSpecificPrice === true).length, selected.length),
        contextCompleteRate: ratio(selected.filter((line) => line.contextStatus === 'CONTEXT_COMPLETE').length, selected.length),
      },
    ];
  }));
}

function buildOrderDetailReconciliation(evidences: readonly HistoricalSpecificPriceLineEvidence[]): Record<string, unknown> {
  const commercial = evidences.filter((line) => line.isCommercialLine);
  return {
    commercialLineCount: commercial.length,
    classificationDistribution: countHistoricalSpecificPriceEvidenceBy(commercial, (line) => line.comparison.classification),
    unitDeltaBucketDistribution: countBy(commercial, (line) => line.comparison.unitDeltaBucket),
    lineDeltaBucketDistribution: countBy(commercial, (line) => line.comparison.lineDeltaBucket),
    totalUnitDeltaTaxIncl: sumMoney(commercial.map((line) => line.comparison.unitDeltaTaxIncl ?? '0.000000')),
    totalLineDeltaTaxIncl: sumMoney(commercial.map((line) => line.comparison.lineDeltaTaxIncl ?? '0.000000')),
    orderDetailSpecificPriceMatchCount: commercial.filter((line) => line.comparison.orderDetailAlreadyReflectsSpecificPrice === true).length,
    orderDetailBaseOnlyMatchCount: commercial.filter((line) => line.comparison.classification === 'ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED').length,
  };
}

function buildTotalProductsReconciliation(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
  orderById: ReadonlyMap<number, AuditOrder>,
): Record<string, unknown> {
  const byOrder = groupBy(evidences, (line) => line.orderId);
  return {
    persistedOrderDetailVsTotalProductsWt: summarizeOrderSubtotalPolicy(byOrder, orderById, (lines) => sumMoney(lines.map(persistedOrderDetailLineValue))),
    reconstructedBaseVsTotalProductsWt: summarizeOrderSubtotalPolicy(byOrder, orderById, (lines) => sumMoney(lines.map((line) => line.isCommercialLine ? line.resolution.historicalBaseLineValueTaxIncl ?? '0.000000' : '0.000000'))),
    reconstructedEffectiveVsTotalProductsWt: summarizeOrderSubtotalPolicy(byOrder, orderById, (lines) => sumMoney(lines.map((line) => line.isCommercialLine ? line.resolution.historicalEffectiveLineValueTaxIncl ?? '0.000000' : '0.000000'))),
  };
}

function buildOrderDiscountSeparation(
  evidences: readonly HistoricalSpecificPriceLineEvidence[],
  orders: readonly AuditOrder[],
  cartRules: readonly AuditCartRule[],
): Record<string, unknown> {
  const byOrder = groupBy(evidences.filter((line) => line.isCommercialLine), (line) => line.orderId);
  const rulesByOrder = groupBy(cartRules, (rule) => rule.orderId);
  const rows = orders.map((order) => {
    const lines = byOrder.get(order.orderId) ?? [];
    const rules = rulesByOrder.get(order.orderId) ?? [];
    const reconstructedSpecificProductDiscountTaxIncl = sumMoney(lines.map((line) => line.resolution.reconstructedSpecificProductDiscountTaxIncl ?? '0.000000'));
    const historicalEffectiveProductSubtotalTaxIncl = sumMoney(lines.map((line) => line.resolution.historicalEffectiveLineValueTaxIncl ?? '0.000000'));
    const paidControl = money(
      Number(historicalEffectiveProductSubtotalTaxIncl) -
      Number(order.totalDiscountsTaxIncl) +
      Number(order.totalShippingTaxIncl) +
      Number(order.totalWrappingTaxIncl),
    );
    return {
      orderId: order.orderId,
      reconstructedSpecificProductDiscountTaxIncl,
      historicalEffectiveProductSubtotalTaxIncl,
      orderLevelDiscountTaxIncl: order.totalDiscountsTaxIncl,
      orderLevelDiscountTaxExcl: order.totalDiscountsTaxExcl,
      productCartRuleTaxIncl: sumMoney(rules.filter((rule) => classifyCartRule(rule) === 'productDiscount').map((rule) => rule.valueTaxIncl)),
      freeShippingCartRuleTaxIncl: sumMoney(rules.filter((rule) => classifyCartRule(rule) === 'freeShipping').map((rule) => rule.valueTaxIncl)),
      mixedCartRuleTaxIncl: sumMoney(rules.filter((rule) => classifyCartRule(rule) === 'mixed').map((rule) => rule.valueTaxIncl)),
      paidControlDeltaTaxIncl: money(Number(paidControl) - Number(order.totalPaidTaxIncl)),
    };
  });
  return {
    orderCount: rows.length,
    reconstructedSpecificProductDiscountTaxIncl: sumMoney(rows.map((row) => row.reconstructedSpecificProductDiscountTaxIncl)),
    orderLevelDiscountTaxIncl: sumMoney(rows.map((row) => row.orderLevelDiscountTaxIncl)),
    orderLevelDiscountTaxExcl: sumMoney(rows.map((row) => row.orderLevelDiscountTaxExcl)),
    productCartRuleTaxIncl: sumMoney(rows.map((row) => row.productCartRuleTaxIncl)),
    freeShippingCartRuleTaxIncl: sumMoney(rows.map((row) => row.freeShippingCartRuleTaxIncl)),
    mixedCartRuleTaxIncl: sumMoney(rows.map((row) => row.mixedCartRuleTaxIncl)),
    paidControlDeltaBucketDistribution: countBy(rows, (row) => deltaBucket(row.paidControlDeltaTaxIncl)),
    sequence: [
      'base product price',
      'minus specific product discount',
      'equals effective product subtotal',
      'minus order-level discount',
      'plus shipping and wrapping',
      'control against paid total',
    ],
  };
}

function buildTaxEvidence(evidences: readonly HistoricalSpecificPriceLineEvidence[]): Record<string, unknown> {
  return {
    byTaxStatus: countHistoricalSpecificPriceEvidenceBy(evidences, (line) => line.taxEvidence.status),
    taxRateDistribution: countBy(evidences, (line) => line.taxEvidence.taxRate ?? 'UNAVAILABLE'),
    inconsistentTaxLineCount: evidences.filter((line) => line.taxEvidence.status === 'TAX_RATE_INCONSISTENT').length,
    unavailableTaxLineCount: evidences.filter((line) => line.taxEvidence.status === 'TAX_RATE_UNAVAILABLE').length,
  };
}

function buildUnresolvedLines(evidences: readonly HistoricalSpecificPriceLineEvidence[]): Record<string, unknown> {
  const unresolved = evidences.filter((line) => line.isCommercialLine && (
    line.comparison.classification === 'HISTORICAL_PRICE_NOT_PROVABLE' ||
    line.comparison.classification === 'CONTEXT_INCOMPLETE' ||
    line.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS' ||
    line.baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE'
  ));
  return {
    unresolvedLineCount: unresolved.length,
    excludedTechnicalUnresolvedLineCount: evidences.filter((line) => !line.isCommercialLine && (
      line.comparison.classification === 'HISTORICAL_PRICE_NOT_PROVABLE' ||
      line.comparison.classification === 'CONTEXT_INCOMPLETE' ||
      line.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS' ||
      line.baseEvidenceStatus === 'BASE_PRICE_UNAVAILABLE'
    )).length,
    reasonDistribution: countBy(unresolved.flatMap((line) => line.reasonCodes), (reason) => reason),
    examples: unresolved.slice(0, 100).map((line) => ({
      orderId: line.orderId,
      orderDetailId: line.orderDetailId,
      productId: line.productId,
      productAttributeId: line.productAttributeId,
      contextStatus: line.contextStatus,
      baseEvidenceStatus: line.baseEvidenceStatus,
      taxStatus: line.taxEvidence.status,
      selectionStatus: line.selection.status,
      comparisonClassification: line.comparison.classification,
      reasonCodes: line.reasonCodes,
    })),
  };
}

function summarizeOrderSubtotalPolicy(
  byOrder: ReadonlyMap<number, readonly HistoricalSpecificPriceLineEvidence[]>,
  orderById: ReadonlyMap<number, AuditOrder>,
  subtotalOf: (lines: readonly HistoricalSpecificPriceLineEvidence[]) => string,
): Record<string, unknown> {
  const rows = Array.from(byOrder.entries()).map(([orderId, lines]) => {
    const order = orderById.get(orderId);
    const subtotal = subtotalOf(lines);
    const delta = order ? money(Number(subtotal) - Number(order.totalProductsTaxIncl)) : '0.000000';
    return {
      orderId,
      subtotal,
      delta,
      unresolved: lines.some((line) => line.resolution.source === 'UNRESOLVED'),
    };
  });
  return {
    orderCount: rows.length,
    exactMatchCount: rows.filter((row) => row.delta === '0.000000' && !row.unresolved).length,
    roundingOnlyCount: rows.filter((row) => ['<=1 CLP'].includes(deltaBucket(row.delta)) && !row.unresolved).length,
    materialMismatchCount: rows.filter((row) => !['0', '<=1 CLP'].includes(deltaBucket(row.delta)) && !row.unresolved).length,
    unresolvedCount: rows.filter((row) => row.unresolved).length,
    totalDelta: sumMoney(rows.map((row) => row.delta)),
    deltaBucketDistribution: countBy(rows, (row) => row.unresolved ? 'UNRESOLVED' : deltaBucket(row.delta)),
  };
}

function persistedOrderDetailLineValue(line: HistoricalSpecificPriceLineEvidence): string {
  if (!line.isCommercialLine || line.resolution.historicalEffectiveLineValueTaxIncl === null || line.comparison.lineDeltaTaxIncl === null) {
    return '0.000000';
  }
  return money(Number(line.resolution.historicalEffectiveLineValueTaxIncl) + Number(line.comparison.lineDeltaTaxIncl));
}

async function writeJson(name: string, value: unknown): Promise<void> {
  assertHistoricalSpecificPriceReportHasNoPii(value);
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function queryByChunks<T extends RowDataPacket>(
  ids: readonly number[],
  sqlForPlaceholders: (placeholders: string) => string,
): Promise<T[]> {
  const chunkSize = 1000;
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
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
  orders: readonly AuditOrder[],
  orderLineProductIds: ReadonlyMap<number, readonly number[]>,
  sellerProductSet: ReadonlySet<number>,
): ReadonlySet<number> {
  const grouped = new Map<number, AuditOrder[]>();
  for (const order of orders) {
    grouped.set(order.prestashopCustomerId, [...(grouped.get(order.prestashopCustomerId) ?? []), order]);
  }
  return new Set(Array.from(grouped.entries())
    .filter(([, customerOrders]) => {
      const sellerMarked = customerOrders.filter((order) => (orderLineProductIds.get(order.orderId) ?? []).some((productId) => sellerProductSet.has(productId))).length;
      return customerOrders.length > 100 || sellerMarked / Math.max(customerOrders.length, 1) >= 0.5;
    })
    .map(([customerId]) => customerId)
    .sort((left, right) => left - right)
    .slice(0, 3));
}

function classifyCartRule(rule: AuditCartRule): 'productDiscount' | 'freeShipping' | 'mixed' | 'gift' | 'unknown' {
  const hasValue = Number(rule.valueTaxIncl) > 0 || Number(rule.valueTaxExcl) > 0;
  const hasProductReduction = Number(rule.reductionPercent) > 0 || Number(rule.reductionAmount) > 0 || rule.reductionProduct > 0 || hasValue;
  if (rule.giftProduct > 0) return 'gift';
  if (rule.freeShipping && hasProductReduction) return 'mixed';
  if (rule.freeShipping) return 'freeShipping';
  if (hasProductReduction) return 'productDiscount';
  return 'unknown';
}

function countBy<T>(values: readonly T[], keyOf: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    grouped.set(key, [...(grouped.get(key) ?? []), value]);
  }
  return grouped;
}

function resolveScope(): 'operational_365d' | 'sampled_historical' {
  const value = process.env.HISTORICAL_SPECIFIC_PRICE_SCOPE?.trim() || 'operational_365d';
  if (value === 'operational_365d' || value === 'sampled_historical') return value;
  throw new Error('HISTORICAL_SPECIFIC_PRICE_SCOPE must be operational_365d or sampled_historical');
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

function parseNumberListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const value = process.env[name];
  if (!value || value.trim() === '') return fallback;
  return [...new Set(value.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isSafeInteger(entry) && entry >= 0))].sort((left, right) => left - right);
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

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asInt(value);
}

function nullableMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return money(value);
}

function money(value: unknown): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid money: ${String(value)}`);
  return numeric.toFixed(6);
}

function sumMoney(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + Number(value), 0).toFixed(6);
}

function ratio(numerator: number, denominator: number): string {
  return denominator <= 0 ? '0.000000' : (numerator / denominator).toFixed(6);
}

function deltaBucket(delta: string): string {
  const abs = Math.abs(Number(delta));
  if (abs === 0) return '0';
  if (abs <= 1) return '<=1 CLP';
  if (abs <= 10) return '2-10 CLP';
  if (abs <= 100) return '11-100 CLP';
  if (abs <= 1000) return '101-1000 CLP';
  return '>1000 CLP';
}

function normalizeReductionType(value: unknown): HistoricalSpecificPriceCandidate['reductionType'] {
  return value === 'amount' || value === 'percentage' ? value : 'unknown';
}

function zeroDateToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '0000-00-00 00:00:00' ? null : text;
}

type AuditOrder = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly orderDate: string;
  readonly shopId: number;
  readonly currencyId: number;
  readonly module: string;
  readonly totalProductsTaxIncl: string;
  readonly totalProductsTaxExcl: string;
  readonly totalDiscountsTaxIncl: string;
  readonly totalDiscountsTaxExcl: string;
  readonly totalShippingTaxIncl: string;
  readonly totalShippingTaxExcl: string;
  readonly totalWrappingTaxIncl: string;
  readonly totalWrappingTaxExcl: string;
  readonly totalPaidTaxIncl: string;
  readonly totalPaidTaxExcl: string;
};

type AuditCartRule = {
  readonly orderId: number;
  readonly cartRuleId: number;
  readonly valueTaxIncl: string;
  readonly valueTaxExcl: string;
  readonly freeShipping: boolean;
  readonly reductionPercent: string;
  readonly reductionAmount: string;
  readonly reductionTax: boolean | null;
  readonly reductionProduct: number;
  readonly giftProduct: number;
};

type OrderRow = RowDataPacket & Record<string, string | number | null>;
type LineContextRow = RowDataPacket & Record<string, string | number | null>;
type SpecificPriceRow = RowDataPacket & Record<string, string | number | null>;
type CartRuleRow = RowDataPacket & Record<string, string | number | null>;
