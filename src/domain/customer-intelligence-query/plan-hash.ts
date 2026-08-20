import { sha256Stable } from '../customer-rfm/checksum.js';
import type { NormalizedAnalyticalQueryPlan } from './validator.js';

// task Section 69: canonical deterministic SHA-256 over the validated, defaults-filled plan —
// same plan (including semantically-equal plans that omitted vs. explicitly stated a default)
// always hashes identically. Hashes `canonical` (the re-serialized logical plan), never the
// resolved fieldMeta/sqlExpression objects the normalized plan also carries internally, and
// never includes an execution timestamp. Reuses sha256Stable from customer-rfm/checksum.ts —
// the same cross-domain import every other checksum in this codebase already uses (clustering,
// customer-analytics, customer-orders), not a new definition.
export function computeQueryPlanHash(plan: NormalizedAnalyticalQueryPlan): string {
  return sha256Stable(plan.canonical);
}
