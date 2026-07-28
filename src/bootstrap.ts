import { createGetCustomerProfile, type GetCustomerProfile } from './application/customer-profile/get-customer-profile.js';
import type { Clock } from './application/customer-profile/ports.js';
import { config } from './config.js';
import { checkCrmReadiness, closeCrmPool, getCrmQueryExecutor } from './infrastructure/crm/crm-pool.js';
import { createMysqlMasterCustomerReader } from './infrastructure/crm/mysql-master-customer-reader.js';
import { closePrestashopPool, getPrestashopQueryExecutor, pingPrestashop } from './infrastructure/prestashop/prestashop-pool.js';
import { createMysqlPrestashopCustomerReader } from './infrastructure/prestashop/mysql-prestashop-customer-reader.js';
import { createMysqlCustomerOrdersReader } from './infrastructure/prestashop/mysql-customer-orders-reader.js';
import { createMysqlOrderStatesReader } from './infrastructure/prestashop/mysql-order-states-reader.js';
import type { ReadinessCheck } from './http/routes/index.js';

const systemClock: Clock = { now: () => new Date() };

export type Bootstrap = {
  readonly getCustomerProfile: GetCustomerProfile;
  readonly checkReadiness: ReadinessCheck;
  readonly shutdown: () => Promise<void>;
};

// Composition root: readers/pools are wired here, never instantiated inside the use case.
export function bootstrap(): Bootstrap {
  const masterCustomerReader = createMysqlMasterCustomerReader(getCrmQueryExecutor());
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

  const getCustomerProfile = createGetCustomerProfile({
    masterCustomerReader,
    prestashopCustomerReader,
    customerOrdersReader,
    orderStatesReader,
    clock: systemClock,
    recentOrdersLimit: config.customerProfile.recentOrdersLimit,
    orderStateLanguageId: config.customerProfile.orderStateLanguageId,
  });

  const checkReadiness: ReadinessCheck = async () => {
    const [crm, prestashop] = await Promise.all([checkCrmReadiness(), pingPrestashop()]);
    return { crm, prestashop };
  };

  return {
    getCustomerProfile,
    checkReadiness,
    shutdown: async () => {
      await Promise.all([closeCrmPool(), closePrestashopPool()]);
    },
  };
}
