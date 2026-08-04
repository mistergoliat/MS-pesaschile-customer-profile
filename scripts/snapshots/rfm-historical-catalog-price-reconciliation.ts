import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  assertHistoricalPriceReportHasNoPii,
  buildHistoricalPriceAuthorityVerdict,
  compareHistoricalPricePolicies,
  historicalPriceChecksum,
  reconcileHistoricalCatalogPrices,
  summarizeHistoricalPriceReconciliations,
  type HistoricalPriceLineInput,
  type HistoricalPriceLineReconciliation,
  type HistoricalSpecificPriceCandidate,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const scope = resolveScope();
const outputDir = path.resolve('scripts/snapshots/rfm/historical-price-outputs');
const auditQueryTimeoutMs = Number(process.env.RFM_HISTORICAL_PRICE_QUERY_TIMEOUT_MS ?? 300_000);
const sellerServiceProductIds = parseNumberListEnv('RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS', [444]);
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
  const lines = await readLineContexts();
  const specificPrices = await readSpecificPrices([...new Set(lines.map((line) => line.productId))]);
  const reconciliations = reconcileHistoricalCatalogPrices({ lines, specificPrices });
  const policyComparison = compareHistoricalPricePolicies({
    lines,
    reconciliations,
    totalProductsWt: await readTotalProductsWt(lines),
  });
  const summary = summarizeHistoricalPriceReconciliations(reconciliations);
  const verdict = buildHistoricalPriceAuthorityVerdict({ reconciliations, policyComparison });

  await writeJson('pricing-context-availability.json', buildContextAvailability(lines));
  await writeJson('specific-price-candidate-analysis.json', buildCandidateAnalysis(specificPrices, lines));
  await writeJson('specific-price-selection-analysis.json', buildSelectionAnalysis(reconciliations));
  await writeJson('historical-price-line-reconciliation.json', summary);
  await writeJson('historical-price-delta-distribution.json', buildDeltaDistribution(reconciliations));
  await writeJson('historical-price-temporal-analysis.json', buildTemporalAnalysis(reconciliations));
  await writeJson('tax-reconciliation.json', buildTaxReconciliation(reconciliations));
  await writeJson('inactive-product-analysis.json', buildInactiveProductAnalysis(lines, reconciliations));
  await writeJson('technical-line-analysis.json', buildTechnicalLineAnalysis(lines, reconciliations));
  await writeJson('pricing-policy-comparison.json', policyComparison);
  await writeJson('historical-price-authority-verdict.json', {
    ...verdict,
    scope,
    referenceTime,
    calculationVersion,
    summary,
    checksum: historicalPriceChecksum({ verdict, summary, policyComparison }),
  });

  console.info(JSON.stringify({
    primaryVerdict: verdict.primaryVerdict,
    conditions: verdict.conditions,
    scope,
    summary,
    policyComparison,
  }, null, 2));
} finally {
  await pool.end();
}

async function readLineContexts(): Promise<readonly HistoricalPriceLineInput[]> {
  const dateClause = scope === 'operational_365d'
    ? 'AND o.date_add >= ? AND o.date_add < ?'
    : 'AND o.date_add < ?';
  const dateParams = scope === 'operational_365d'
    ? [mysqlDateTime(windowStart(referenceTime)), mysqlDateTime(referenceTime)]
    : [mysqlDateTime(referenceTime)];
  const limitClause = scope === 'sampled_historical' ? 'LIMIT 5000' : '';
  const rows = await query<LineContextRow>(
    `
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
        o.module AS module,
        a.id_country AS countryId,
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
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      INNER JOIN ${tables.orderDetail} od
        ON od.id_order = o.id_order
      LEFT JOIN ${tables.address} a
        ON a.id_address = o.id_address_delivery
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
      WHERE o.valid = 1
        AND o.id_customer > 0
        ${dateClause}
      ORDER BY o.date_add DESC, od.id_order_detail DESC
      ${limitClause}
    `,
    dateParams,
  );
  return rows.map((row) => ({
    orderDetailId: asInt(row.orderDetailId),
    orderId: asInt(row.orderId),
    productId: asInt(row.productId),
    productAttributeId: asInt(row.productAttributeId ?? 0),
    quantity: asInt(row.quantity),
    orderDate: String(row.orderDate),
    shopId: asInt(row.shopId),
    currencyId: asInt(row.currencyId),
    customerId: asInt(row.customerId),
    countryId: nullableInt(row.countryId),
    customerGroupId: null,
    customerGroupSource: 'unavailable',
    module: String(row.module ?? 'unknown').toLowerCase(),
    productActive: row.productActive === null || row.productActive === undefined ? null : asInt(row.productActive) === 1,
    productBasePriceTaxExcl: nullableMoney(row.productBasePriceTaxExcl),
    combinationImpactTaxExcl: nullableMoney(row.combinationImpactTaxExcl),
    orderDetailUnitPriceTaxIncl: money(row.orderDetailUnitPriceTaxIncl),
    orderDetailUnitPriceTaxExcl: money(row.orderDetailUnitPriceTaxExcl),
    orderDetailTotalPriceTaxIncl: money(row.orderDetailTotalPriceTaxIncl),
    orderDetailTotalPriceTaxExcl: money(row.orderDetailTotalPriceTaxExcl),
    orderDetailTaxRate: row.orderDetailTaxRate === null || row.orderDetailTaxRate === undefined
      ? null
      : money(Number(row.orderDetailTaxRate) / 100),
    isSellerService: sellerServiceProductIds.includes(asInt(row.productId)),
    isLogisticsArtifact: logisticsProductIds.includes(asInt(row.productId)),
  }));
}

async function readSpecificPrices(productIds: readonly number[]): Promise<readonly HistoricalSpecificPriceCandidate[]> {
  const rows = await queryByChunks<SpecificPriceRow>(
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
  );
  return rows.map((row) => ({
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

async function readTotalProductsWt(lines: readonly HistoricalPriceLineInput[]): Promise<string> {
  const orderIds = [...new Set(lines.map((line) => line.orderId))];
  const rows = await queryByChunks<TotalProductsRow>(
    orderIds,
    (placeholders) => `
      SELECT COALESCE(SUM(total_products_wt), 0) AS totalProductsWt
      FROM ${tables.orders}
      WHERE id_order IN (${placeholders})
    `,
  );
  return sumMoney(rows.map((row) => money(row.totalProductsWt)));
}

function buildContextAvailability(lines: readonly HistoricalPriceLineInput[]): Record<string, unknown> {
  return {
    lineCount: lines.length,
    contextStatusDistribution: countBy(lines, contextStatusProjection),
    countryAvailableLineCount: lines.filter((line) => line.countryId !== null).length,
    customerGroupHistoricalAvailableLineCount: lines.filter((line) => line.customerGroupSource === 'historical').length,
    customerGroupCurrentOnlyLineCount: lines.filter((line) => line.customerGroupSource === 'current_default').length,
    customerGroupUnavailableLineCount: lines.filter((line) => line.customerGroupSource === 'unavailable').length,
    productBaseAvailableLineCount: lines.filter((line) => line.productBasePriceTaxExcl !== null).length,
    combinationImpactAvailableLineCount: lines.filter((line) => line.combinationImpactTaxExcl !== null).length,
    taxRateAvailableLineCount: lines.filter((line) => line.orderDetailTaxRate !== null).length,
  };
}

function buildCandidateAnalysis(
  prices: readonly HistoricalSpecificPriceCandidate[],
  lines: readonly HistoricalPriceLineInput[],
): Record<string, unknown> {
  const productsWithLines = new Set(lines.map((line) => line.productId));
  const pricesInScope = prices.filter((price) => productsWithLines.has(price.productId));
  return {
    productCountWithOrderLines: productsWithLines.size,
    specificPriceCandidateCount: pricesInScope.length,
    productsWithSpecificPriceCandidateCount: new Set(pricesInScope.map((price) => price.productId)).size,
    byReductionType: countBy(pricesInScope, (price) => price.reductionType),
    byDimension: {
      combinationSpecific: pricesInScope.filter((price) => price.productAttributeId > 0).length,
      shopSpecific: pricesInScope.filter((price) => price.shopId > 0).length,
      currencySpecific: pricesInScope.filter((price) => price.currencyId > 0).length,
      countrySpecific: pricesInScope.filter((price) => price.countryId > 0).length,
      groupSpecific: pricesInScope.filter((price) => price.groupId > 0).length,
      customerSpecific: pricesInScope.filter((price) => price.customerId > 0).length,
      quantityThreshold: pricesInScope.filter((price) => price.fromQuantity > 1).length,
    },
    temporalRange: {
      openStartCount: pricesInScope.filter((price) => price.validFrom === null).length,
      openEndCount: pricesInScope.filter((price) => price.validTo === null).length,
    },
  };
}

function buildSelectionAnalysis(reconciliations: readonly HistoricalPriceLineReconciliation[]): Record<string, unknown> {
  return {
    lineCount: reconciliations.length,
    selectionStatusDistribution: countBy(reconciliations, (row) => row.selection.status),
    selectedLineCount: reconciliations.filter((row) => row.selection.selectedSpecificPriceId !== null).length,
    ambiguousLineCount: reconciliations.filter((row) => row.selection.status === 'SPECIFIC_PRICE_SELECTION_AMBIGUOUS').length,
    candidateCountDistribution: countBy(reconciliations, (row) => String(row.selection.candidateSpecificPriceCount)),
    compatibleCandidateCountDistribution: countBy(reconciliations, (row) => String(row.selection.compatibleCandidateCount)),
    matchedDimensionDistribution: countBy(reconciliations.flatMap((row) => row.selection.matchedDimensions), (value) => value),
  };
}

function buildDeltaDistribution(reconciliations: readonly HistoricalPriceLineReconciliation[]): Record<string, unknown> {
  return {
    unitPriceDeltaTaxIncl: countBy(reconciliations, (row) => row.unitDeltaBucket),
    lineValueDeltaTaxIncl: countBy(reconciliations, (row) => row.lineDeltaBucket),
    lowerThanReconstructed: reconciliations.filter((row) => row.classifications.includes('ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED')).length,
    higherThanReconstructed: reconciliations.filter((row) => row.classifications.includes('ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED')).length,
    roundingOnly: reconciliations.filter((row) => row.classifications.includes('ROUNDING_ONLY')).length,
    baseOnlyMatch: reconciliations.filter((row) => row.classifications.includes('ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY')).length,
  };
}

function buildTemporalAnalysis(reconciliations: readonly HistoricalPriceLineReconciliation[]): Record<string, unknown> {
  return {
    byYear: groupedReconciliation(reconciliations, (row) => row.orderMonth.slice(0, 4)),
    byMonth: groupedReconciliation(reconciliations, (row) => row.orderMonth),
    byShop: groupedReconciliation(reconciliations, (row) => row.shopAlias),
    byModule: groupedReconciliation(reconciliations, (row) => row.module),
    byProductActiveStatus: groupedReconciliation(reconciliations, (row) => row.classifications.includes('CURRENTLY_INACTIVE_PRODUCT') ? 'currently_inactive' : 'active_or_unknown'),
    bySpecificPriceSource: groupedReconciliation(reconciliations, (row) => row.resolution.historicalPriceSource),
  };
}

function buildTaxReconciliation(reconciliations: readonly HistoricalPriceLineReconciliation[]): Record<string, unknown> {
  return {
    taxStatusDistribution: countBy(reconciliations, (row) => row.taxStatus),
    taxRateUsedDistribution: countBy(reconciliations, (row) => row.resolution.taxRateUsed ?? 'UNAVAILABLE'),
  };
}

function buildInactiveProductAnalysis(
  lines: readonly HistoricalPriceLineInput[],
  reconciliations: readonly HistoricalPriceLineReconciliation[],
): Record<string, unknown> {
  const inactiveIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.productActive === false)
    .map(({ index }) => index);
  return {
    inactiveLineCount: inactiveIndexes.length,
    inactiveProductAliasCount: new Set(inactiveIndexes.map((index) => reconciliations[index]?.productAlias)).size,
    inactiveMatchCount: inactiveIndexes.filter((index) => reconciliations[index]?.classifications.includes('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE')).length,
    inactiveUnresolvedCount: inactiveIndexes.filter((index) => reconciliations[index]?.resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK').length,
  };
}

function buildTechnicalLineAnalysis(
  lines: readonly HistoricalPriceLineInput[],
  reconciliations: readonly HistoricalPriceLineReconciliation[],
): Record<string, unknown> {
  const sellerIndexes = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.isSellerService).map(({ index }) => index);
  const logisticsIndexes = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.isLogisticsArtifact).map(({ index }) => index);
  return {
    sellerServiceLineCount: sellerIndexes.length,
    sellerServiceHistoricalPriceMatchRate: ratio(
      sellerIndexes.filter((index) => reconciliations[index]?.classifications.includes('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE')).length,
      sellerIndexes.length,
    ),
    sellerServiceDiscountParticipation: sellerIndexes.filter((index) => (reconciliations[index]?.selection.compatibleCandidateCount ?? 0) > 0).length,
    logisticsArtifactLineCount: logisticsIndexes.length,
    logisticsArtifactStatus: logisticsProductIds.length === 0 ? 'UNRESOLVED' : 'CONFIGURED',
  };
}

function groupedReconciliation(
  reconciliations: readonly HistoricalPriceLineReconciliation[],
  keyOf: (row: HistoricalPriceLineReconciliation) => string,
): readonly Record<string, unknown>[] {
  const grouped = new Map<string, HistoricalPriceLineReconciliation[]>();
  for (const row of reconciliations) {
    const key = keyOf(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return Array.from(grouped.entries())
    .map(([key, rows]) => {
      const matchCount = rows.filter((row) => row.classifications.includes('ORDER_DETAIL_MATCHES_HISTORICAL_EFFECTIVE_PRICE')).length;
      const unresolvedCount = rows.filter((row) => row.resolution.historicalPriceSource === 'ORDER_DETAIL_FALLBACK' || row.resolution.historicalPriceSource === 'UNRESOLVED').length;
      return {
        key,
        lineCount: rows.length,
        matchCount,
        mismatchCount: rows.length - matchCount - unresolvedCount,
        unresolvedCount,
        matchRate: ratio(matchCount, rows.length),
      };
    })
    .sort((a, b) => Number(b.lineCount) - Number(a.lineCount) || String(a.key).localeCompare(String(b.key)));
}

function contextStatusProjection(line: HistoricalPriceLineInput): string {
  if (line.productBasePriceTaxExcl === null || line.combinationImpactTaxExcl === null || line.countryId === null) return 'CONTEXT_PARTIAL';
  if (line.customerGroupSource === 'current_default') return 'CONTEXT_CURRENT_ONLY';
  if (line.customerGroupId === null || line.orderDetailTaxRate === null) return 'CONTEXT_PARTIAL';
  return 'CONTEXT_COMPLETE';
}

async function writeJson(name: string, value: unknown): Promise<void> {
  assertHistoricalPriceReportHasNoPii(value);
  await writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function query<T extends RowDataPacket>(sql: string, params: readonly unknown[]): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(
    { sql, timeout: Math.max(config.prestashopDb.queryTimeoutMs, auditQueryTimeoutMs) },
    [...params] as Array<string | number | null>,
  );
  return rows;
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

function resolveScope(): 'operational_365d' | 'sampled_historical' | 'all_historical' {
  const value = process.env.RFM_HISTORICAL_PRICE_SCOPE?.trim() || 'operational_365d';
  if (value === 'operational_365d' || value === 'sampled_historical' || value === 'all_historical') return value;
  throw new Error('RFM_HISTORICAL_PRICE_SCOPE must be operational_365d, sampled_historical or all_historical');
}

function parseNumberListEnv(name: string, fallback: readonly number[]): readonly number[] {
  const value = process.env[name];
  if (!value || value.trim() === '') return fallback;
  return [...new Set(value.split(',').map((entry) => Number(entry.trim())).filter((entry) => Number.isSafeInteger(entry) && entry >= 0))].sort((a, b) => a - b);
}

function windowStart(reference: string): string {
  return new Date(new Date(reference).getTime() - 365 * 86_400_000).toISOString();
}

function mysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
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
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid money: ${String(value)}`);
  return numeric.toFixed(6);
}

function sumMoney(values: readonly string[]): string {
  return values.reduce((sum, value) => sum + Number(value), 0).toFixed(6);
}

function normalizeReductionType(value: unknown): HistoricalSpecificPriceCandidate['reductionType'] {
  return value === 'amount' || value === 'percentage' ? value : 'unknown';
}

function zeroDateToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '0000-00-00 00:00:00' ? null : text;
}

function countBy<T>(values: readonly T[], keyOf: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function ratio(numerator: number, denominator: number): string {
  return denominator <= 0 ? '0.000000' : (numerator / denominator).toFixed(6);
}

type LineContextRow = RowDataPacket & Record<string, string | number | null>;
type SpecificPriceRow = RowDataPacket & Record<string, string | number | null>;
type TotalProductsRow = RowDataPacket & { readonly totalProductsWt: string | number };
