import 'dotenv/config';
import mysql from 'mysql2/promise';
import { assertPrestashopPoolIsReadOnly, loadPrestashopConnectionConfig } from '../clustering/lib/db.js';

const referenceTime = requiredEnv('AFFINITY_REFERENCE_TIME');
const mysqlReferenceTime = new Date(referenceTime).toISOString().replace('T', ' ').replace('Z', '');
const connection = loadPrestashopConnectionConfig(process.env);
const prefix = connection.prefix;
const excludedIds = [85980, 39617, 90890, 86421];
const excludedPlaceholders = excludedIds.map(() => '?').join(', ');
const pool = mysql.createPool({
  host: connection.host,
  port: connection.port,
  user: connection.user,
  password: connection.password,
  database: connection.database,
  connectionLimit: 1,
  dateStrings: true,
  timezone: 'Z',
});

try {
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(pool);
  const [ordersIndexes, orderDetailIndexes, watermarkPlan, pagePlan, linePlan, boundaryDiagnostics] = await Promise.all([
    pool.query(`SHOW INDEX FROM ${prefix}orders`),
    pool.query(`SHOW INDEX FROM ${prefix}order_detail`),
    pool.execute(
      `EXPLAIN SELECT MAX(o.id_order) AS sourceWatermarkOrderId
       FROM ${prefix}orders o
       INNER JOIN ${prefix}customer c ON c.id_customer = o.id_customer
       INNER JOIN ${prefix}currency cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
       WHERE o.valid = 1 AND o.total_paid_tax_incl > 0 AND o.id_customer > 0
         AND o.id_customer NOT IN (${excludedPlaceholders}) AND o.date_add < ?`,
      [...excludedIds, mysqlReferenceTime],
    ),
    pool.execute(
      `EXPLAIN SELECT o.id_order AS orderId
       FROM ${prefix}orders o
       INNER JOIN ${prefix}customer c ON c.id_customer = o.id_customer
       INNER JOIN ${prefix}currency cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
       WHERE o.valid = 1 AND o.total_paid_tax_incl > 0 AND o.id_customer > 0
         AND o.id_customer NOT IN (${excludedPlaceholders}) AND o.date_add < ?
         AND o.id_order > ? AND o.id_order <= ?
       ORDER BY o.id_order ASC LIMIT 1000`,
      [...excludedIds, mysqlReferenceTime, 0, 2_500_000_000],
    ),
    pool.execute(
      `EXPLAIN SELECT o.id_customer AS customerId, o.id_order AS orderId, od.id_order_detail AS orderDetailId
       FROM ${prefix}orders o
       INNER JOIN ${prefix}customer c ON c.id_customer = o.id_customer
       INNER JOIN ${prefix}currency cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
       INNER JOIN ${prefix}order_detail od ON od.id_order = o.id_order
       WHERE o.id_order IN (?, ?, ?) AND o.valid = 1 AND o.total_paid_tax_incl > 0
         AND o.id_customer > 0 AND o.id_customer NOT IN (${excludedPlaceholders})
         AND o.date_add < ? AND od.total_price_tax_incl > 0
       ORDER BY o.id_order ASC, od.id_order_detail ASC`,
      [1, 2, 3, ...excludedIds, mysqlReferenceTime],
    ),
    pool.execute(
      `SELECT
         SUM(CASE WHEN o.date_add < ? THEN 1 ELSE 0 END) AS beforeReferenceTime,
         SUM(CASE WHEN o.date_add >= ? THEN 1 ELSE 0 END) AS atOrAfterReferenceTime,
         SUM(CASE WHEN od.total_price_tax_incl > 0 AND od.total_price_tax_incl < 0.000001 THEN 1 ELSE 0 END) AS positiveBelowDecimalMinimum,
         SUM(CASE WHEN od.total_price_tax_incl <= 0 THEN 1 ELSE 0 END) AS nonPositiveLineRows,
         SUM(CASE WHEN o.date_add < ? AND od.total_price_tax_incl > 0 THEN 1 ELSE 0 END) AS eligibleLineRows
       FROM ${prefix}orders o
       INNER JOIN ${prefix}customer c ON c.id_customer = o.id_customer
       INNER JOIN ${prefix}currency cur ON cur.id_currency = o.id_currency AND cur.iso_code = 'CLP'
       INNER JOIN ${prefix}order_detail od ON od.id_order = o.id_order
       WHERE o.valid = 1 AND o.total_paid_tax_incl > 0 AND o.id_customer > 0
         AND o.id_customer NOT IN (${excludedPlaceholders})`,
      [mysqlReferenceTime, mysqlReferenceTime, mysqlReferenceTime, ...excludedIds],
    ),
  ]);
  console.log(JSON.stringify({
    status: 'ok',
    referenceTime,
    readOnlyGrantCheck,
    indexes: { orders: ordersIndexes[0], orderDetail: orderDetailIndexes[0] },
    explain: { watermark: watermarkPlan[0], keysetOrderPage: pagePlan[0], orderLineBatch: linePlan[0] },
    boundaryDiagnostics: boundaryDiagnostics[0],
  }, null, 2));
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be a valid timestamp`);
  return value;
}
