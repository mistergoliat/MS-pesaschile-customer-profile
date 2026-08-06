export { createMysqlPrestashopCustomerReader } from './mysql-prestashop-customer-reader.js';
export { createMysqlPrestaShopCustomerIdentityRepository } from './mysql-prestashop-customer-identity-repository.js';
export { createMysqlCustomerOrdersReader } from './mysql-customer-orders-reader.js';
export { createMysqlOrderStatesReader } from './mysql-order-states-reader.js';
export { createMysqlCustomerOrderStatusReader } from './mysql-customer-order-status-reader.js';
export { createMysqlCarriersReader } from './mysql-carriers-reader.js';
export { createMysqlCommercialOrdersSummaryReader } from './mysql-commercial-orders-summary-reader.js';
export { createMysqlCommercialProductsSummaryReader } from './mysql-commercial-products-summary-reader.js';
export { createMysqlPurchasedProductsReader } from './mysql-purchased-products-reader.js';
export { createMysqlCustomerProductBehaviorReader } from './mysql-customer-product-behavior-reader.js';
export { createMysqlRfmPopulationReader } from './mysql-rfm-population-reader.js';
export type { RfmPopulationReader } from './mysql-rfm-population-reader.js';
export {
  checkPrestashopReadiness,
  closePrestashopPool,
  getPrestashopQueryExecutor,
  pingPrestashop,
} from './prestashop-pool.js';
export type { PrestashopReadinessReason, PrestashopReadinessResult } from './prestashop-pool.js';
