export type EligibilityStatus = 'active' | 'historical_inactive' | 'no_valid_purchases';
export type LifecycleStage = 'new_customer' | 'active' | 'historical_inactive' | 'no_purchase_history';

export type LifecycleInput = {
  readonly eligibilityStatus: EligibilityStatus;
  readonly firstValidOrderAt: string | null;
  readonly lifetimeValidOrderCount: number;
  readonly asOfDate: string;
};

const MS_PER_DAY = 86_400_000;

export function classifyEligibility(lifetimeValidOrderCount: number, windowValidOrderCount: number): EligibilityStatus {
  if (windowValidOrderCount > 0) return 'active';
  if (lifetimeValidOrderCount > 0) return 'historical_inactive';
  return 'no_valid_purchases';
}

export function classifyLifecycle(input: LifecycleInput): LifecycleStage {
  if (input.eligibilityStatus === 'no_valid_purchases') return 'no_purchase_history';
  if (input.eligibilityStatus === 'historical_inactive') return 'historical_inactive';
  if (input.firstValidOrderAt && input.lifetimeValidOrderCount === 1 && daysBetween(input.asOfDate, input.firstValidOrderAt) <= 90) {
    return 'new_customer';
  }
  return 'active';
}

function daysBetween(asOfDate: string, dateTime: string): number {
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`);
  const observed = new Date(`${dateTime.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(observed.getTime())) throw new Error('Invalid lifecycle date');
  const observedDay = Date.UTC(observed.getUTCFullYear(), observed.getUTCMonth(), observed.getUTCDate());
  return Math.floor((asOf.getTime() - observedDay) / MS_PER_DAY);
}
