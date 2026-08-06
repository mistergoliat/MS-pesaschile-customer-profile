import type { ResolveCustomerIdentityResult } from '../../domain/customer-identity/index.js';
import type { CustomerIdentityRepository } from './ports.js';

export type ResolveCustomerIdentity = (customerId: unknown) => Promise<ResolveCustomerIdentityResult>;

export type ResolveCustomerIdentityDependencies = {
  readonly customerIdentityRepository: CustomerIdentityRepository;
};

export function createResolveCustomerIdentity(
  deps: ResolveCustomerIdentityDependencies,
): ResolveCustomerIdentity {
  return async function resolveCustomerIdentity(customerId) {
    const parsedCustomerId = parseCustomerId(customerId);
    if (parsedCustomerId === null) {
      return { status: 'invalid_id' };
    }

    const identity = await deps.customerIdentityRepository.findByCustomerId(parsedCustomerId);
    if (!identity) {
      return { status: 'not_found' };
    }

    return { status: 'found', identity };
  };
}

function parseCustomerId(customerId: unknown): number | null {
  if (typeof customerId === 'number') {
    return Number.isSafeInteger(customerId) && customerId > 0 ? customerId : null;
  }
  if (typeof customerId !== 'string' || !/^\d+$/.test(customerId)) {
    return null;
  }

  const parsed = Number(customerId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
