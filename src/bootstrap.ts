import { createGetCustomerOrderStatus, type GetCustomerOrderStatus } from './application/customer-order-status/get-customer-order-status.js';
import {
  createGetCustomerCommercialSummary,
  type GetCustomerCommercialSummary,
} from './application/customer-commercial-summary/get-customer-commercial-summary.js';
import {
  createResolveCustomerIdentity,
  type ResolveCustomerIdentity,
} from './application/customer-identity/resolve-customer-identity.js';
import {
  createGetCustomerPurchasedProducts,
  type GetCustomerPurchasedProducts,
} from './application/customer-purchased-products/get-customer-purchased-products.js';
import {
  createGetCustomerPurchaseBehavior,
  type GetCustomerPurchaseBehavior,
} from './application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import { createGetCustomerRfm, type GetCustomerRfm } from './application/customer-rfm/get-customer-rfm.js';
import { createGetCustomerProfile, type GetCustomerProfile } from './application/customer-profile/get-customer-profile.js';
import { config } from './config.js';
import { createMysqlMasterCustomerReader, getCrmQueryExecutor } from './infrastructure/crm/index.js';
import {
  checkPrestashopReadiness,
  closePrestashopPool,
  getPrestashopQueryExecutor,
  pingPrestashop,
} from './infrastructure/prestashop/prestashop-pool.js';
import { createMysqlPrestaShopCustomerIdentityRepository } from './infrastructure/prestashop/mysql-prestashop-customer-identity-repository.js';
import { createMysqlPrestashopCustomerReader } from './infrastructure/prestashop/mysql-prestashop-customer-reader.js';
import { createMysqlCustomerOrdersReader } from './infrastructure/prestashop/mysql-customer-orders-reader.js';
import { createMysqlOrderStatesReader } from './infrastructure/prestashop/mysql-order-states-reader.js';
import { createMysqlCustomerOrderStatusReader } from './infrastructure/prestashop/mysql-customer-order-status-reader.js';
import { createMysqlCarriersReader } from './infrastructure/prestashop/mysql-carriers-reader.js';
import { createMysqlCommercialOrdersSummaryReader } from './infrastructure/prestashop/mysql-commercial-orders-summary-reader.js';
import { createMysqlCommercialProductsSummaryReader } from './infrastructure/prestashop/mysql-commercial-products-summary-reader.js';
import { createMysqlPurchasedProductsReader } from './infrastructure/prestashop/mysql-purchased-products-reader.js';
import { createMysqlCustomerProductBehaviorReader } from './infrastructure/prestashop/mysql-customer-product-behavior-reader.js';
import { createMysqlRfmSnapshotReader } from './infrastructure/rfm/mysql-rfm-snapshot-reader.js';
import { closeRfmSnapshotPool, getRfmSnapshotQueryExecutor } from './infrastructure/rfm/rfm-snapshot-pool.js';
import { SystemClock } from './infrastructure/shared/system-clock.js';
import type { ReadinessCheck } from './http/routes/index.js';

const systemClock = new SystemClock();

export type Bootstrap = {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly getCustomerProfile: GetCustomerProfile;
  readonly getCustomerOrderStatus: GetCustomerOrderStatus;
  readonly getCustomerCommercialSummary: GetCustomerCommercialSummary;
  readonly getCustomerPurchasedProducts: GetCustomerPurchasedProducts;
  readonly getCustomerPurchaseBehavior: GetCustomerPurchaseBehavior;
  readonly getCustomerRfm: GetCustomerRfm;
  readonly checkReadiness: ReadinessCheck;
  readonly shutdown: () => Promise<void>;
};

// Composition root: readers/pools are wired here, never instantiated inside the use case.
export function bootstrap(): Bootstrap {
  const customerIdentityRepository = createMysqlPrestaShopCustomerIdentityRepository(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const resolveCustomerIdentity = createResolveCustomerIdentity({ customerIdentityRepository });
  // Same logical PrestaShop pool as prestashopCustomerReader (getPrestashopQueryExecutor()
  // wraps the existing lazy singleton pool) — no new pool, no per-request connections.
  const prestashopCustomerReader = createMysqlPrestashopCustomerReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const customerOrdersReader = createMysqlCustomerOrdersReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const orderStatesReader = createMysqlOrderStatesReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix);
  const customerOrderStatusReader = createMysqlCustomerOrderStatusReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const carriersReader = createMysqlCarriersReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix);
  const commercialOrdersSummaryReader = createMysqlCommercialOrdersSummaryReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const commercialProductsSummaryReader = createMysqlCommercialProductsSummaryReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const purchasedProductsReader = createMysqlPurchasedProductsReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const customerProductBehaviorReader = createMysqlCustomerProductBehaviorReader(
    getPrestashopQueryExecutor(),
    config.prestashopDb.prefix,
  );
  const masterCustomerReader = createMysqlMasterCustomerReader(getCrmQueryExecutor());
  const currentRfmSnapshotReader = createMysqlRfmSnapshotReader(getRfmSnapshotQueryExecutor());

  const getCustomerProfile = createGetCustomerProfile({
    resolveCustomerIdentity,
    prestashopCustomerReader,
    customerOrdersReader,
    orderStatesReader,
    clock: systemClock,
    recentOrdersLimit: config.customerProfile.recentOrdersLimit,
    orderStateLanguageId: config.customerProfile.orderStateLanguageId,
  });

  // Reuses resolveCustomerIdentity and orderStatesReader — same PrestaShop pool, no
  // CRM runtime pool and no second connection for identity resolution. See CP-R1-T06.
  const getCustomerOrderStatus = createGetCustomerOrderStatus({
    resolveCustomerIdentity,
    customerOrderStatusReader,
    orderStatesReader,
    carriersReader,
    clock: systemClock,
    orderStateLanguageId: config.customerProfile.orderStateLanguageId,
    carrierLanguageId: config.customerOrderStatus.carrierLanguageId,
    carrierShopId: config.customerOrderStatus.carrierShopId,
  });

  const getCustomerCommercialSummary = createGetCustomerCommercialSummary({
    resolveCustomerIdentity,
    commercialOrdersSummaryReader,
    commercialProductsSummaryReader,
    clock: systemClock,
  });

  const getCustomerPurchasedProducts = createGetCustomerPurchasedProducts({
    purchasedProductsReader,
    resolveCustomerIdentity,
    clock: systemClock,
  });

  const getCustomerPurchaseBehavior = createGetCustomerPurchaseBehavior({
    resolveCustomerIdentity,
    customerProductBehaviorReader,
    clock: systemClock,
  });

  const getCustomerRfm = createGetCustomerRfm({
    masterCustomerReader,
    currentRfmSnapshotReader,
  });

  const checkReadiness: ReadinessCheck = async () => {
    const [prestashop, crm] = await Promise.all([
      checkPrestashopReadiness(config.prestashopDb.prefix),
      pingPrestashop().catch(() => false),
    ]);
    return { prestashop, crm };
  };

  return {
    resolveCustomerIdentity,
    getCustomerProfile,
    getCustomerOrderStatus,
    getCustomerCommercialSummary,
    getCustomerPurchasedProducts,
    getCustomerPurchaseBehavior,
    getCustomerRfm,
    checkReadiness,
    shutdown: async () => {
      await Promise.all([closePrestashopPool(), closeRfmSnapshotPool()]);
    },
  };
}
