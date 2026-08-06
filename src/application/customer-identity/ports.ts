import type { CustomerIdentity } from '../../domain/customer-identity/index.js';

export interface CustomerIdentityRepository {
  findByCustomerId(customerId: number): Promise<CustomerIdentity | null>;
}

