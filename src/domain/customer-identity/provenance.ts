import type { CustomerDataProvenance, CustomerDataSource, CustomerIdentity } from './contracts.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION } from './contracts.js';

export function buildCustomerDataProvenance(
  identity: CustomerIdentity,
  dataSources: readonly CustomerDataSource[],
  generatedAt: string,
): CustomerDataProvenance {
  return {
    customerIdentity: {
      customerId: identity.customerId,
      source: identity.identitySource,
      externalCustomerId: String(identity.externalCustomerId),
      status: identity.identityStatus,
    },
    dataSources,
    generatedAt,
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

