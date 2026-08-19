import { CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION } from '../../domain/customer-clustering/index.js';
import type { GetCustomerCluster } from './get-customer-cluster.js';

// Used by bootstrap.ts when CLUSTER_DB_* is absent from the environment (see config.ts).
// Deliberately takes no dependencies and never touches a reader/pool — clustering being
// unconfigured must not stop any other endpoint from working. Mirrors
// customer-rfm/rfm-not-configured.ts exactly.
export const getCustomerClusterNotConfigured: GetCustomerCluster = async (input) => ({
  status: 'degraded',
  customerId: input.customerId,
  reason: 'cluster_not_configured',
  contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
});
