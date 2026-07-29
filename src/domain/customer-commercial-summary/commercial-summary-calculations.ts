import type { Clock } from '../../application/customer-profile/ports.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type CommercialDateMetrics = {
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly daysSinceLastOrder: number | null;
  readonly purchaseFrequencyDays: number | null;
};

export function calculateCommercialDateMetrics(input: {
  readonly totalOrders: number;
  readonly firstOrderAt: Date | null;
  readonly lastOrderAt: Date | null;
  readonly clock: Clock;
}): CommercialDateMetrics {
  if (!Number.isSafeInteger(input.totalOrders) || input.totalOrders < 0) {
    throw new Error(`Invalid totalOrders: ${String(input.totalOrders)}`);
  }

  if (input.totalOrders === 0) {
    if (input.firstOrderAt !== null || input.lastOrderAt !== null) {
      throw new Error('Commercial order dates must be null when totalOrders is zero');
    }
    return {
      firstOrderAt: null,
      lastOrderAt: null,
      daysSinceLastOrder: null,
      purchaseFrequencyDays: null,
    };
  }

  if (!input.firstOrderAt || !input.lastOrderAt) {
    throw new Error('Commercial order dates are required when totalOrders is positive');
  }

  const firstMs = validDateMs(input.firstOrderAt, 'firstOrderAt');
  const lastMs = validDateMs(input.lastOrderAt, 'lastOrderAt');
  if (firstMs > lastMs) {
    throw new Error('firstOrderAt cannot be after lastOrderAt');
  }

  const nowMs = validDateMs(input.clock.now(), 'clock.now');
  if (lastMs > nowMs) {
    throw new Error('lastOrderAt cannot be in the future');
  }

  return {
    firstOrderAt: input.firstOrderAt.toISOString(),
    lastOrderAt: input.lastOrderAt.toISOString(),
    daysSinceLastOrder: Math.max(0, Math.floor((nowMs - lastMs) / DAY_MS)),
    purchaseFrequencyDays: input.totalOrders < 2 ? null : (lastMs - firstMs) / DAY_MS / (input.totalOrders - 1),
  };
}

function validDateMs(value: Date, field: string): number {
  const ms = value.getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ${field}`);
  }
  return ms;
}
