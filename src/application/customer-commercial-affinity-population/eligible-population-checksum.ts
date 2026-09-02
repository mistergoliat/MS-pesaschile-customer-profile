import { sha256Stable } from '../../shared/stable-checksum.js';

/** Canonical checksum for the complete eligible-customer identity set. */
export function calculateEligibleCustomerPopulationChecksum(customerIds: readonly number[]): string {
  const sorted = [...customerIds].sort((left, right) => left - right);
  const seen = new Set<number>();
  for (const customerId of sorted) {
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      throw new Error(`Eligible affinity customer id must be a positive safe integer: ${customerId}`);
    }
    if (seen.has(customerId)) throw new Error(`Duplicate eligible affinity customer id: ${customerId}`);
    seen.add(customerId);
  }
  return sha256Stable(sorted);
}
