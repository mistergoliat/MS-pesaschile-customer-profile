import { CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION } from '../../domain/customer-rfm/index.js';
import type { GetCustomerRfmByCustomerId } from './get-customer-rfm-by-customer-id.js';
import type { GetCustomerRfm } from './get-customer-rfm.js';

// Used by bootstrap.ts when RFM_SNAPSHOT_DB_* is absent from the environment (see
// config.ts). Deliberately takes no dependencies and never touches a reader/pool — RFM
// being unconfigured must not stop the other five endpoints, PrestaShop, or CRM from
// working, so this is a pure, constant degraded response.
export const getCustomerRfmNotConfigured: GetCustomerRfm = async (input) => ({
  status: 'degraded',
  masterCustomerId: input.masterCustomerId,
  reason: 'rfm_not_configured',
  contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
});

export const getCustomerRfmByCustomerIdNotConfigured: GetCustomerRfmByCustomerId = async (input) => ({
  status: 'degraded',
  customerId: input.customerId,
  reason: 'rfm_not_configured',
  contractVersion: CUSTOMER_RFM_RUNTIME_CONTRACT_VERSION,
});
