// Deterministic scoring-policy constants and pure component transforms for the Customer
// Commercial Affinity kernel (CUSTOMER-INTELLIGENCE-R2-A01.2, hardened in A01.2.1). Every
// constant here belongs to customerCommercialAffinityCalculationVersion =
// 'customer-commercial-affinity-v1' (snapshot.ts) — changing any value on this file requires a
// version bump (A01.0 design doc's determinism invariant). None of these are learned from data;
// they are documented v1 heuristics pending real-data calibration once A01.4 has a live
// population to validate against.
//
// See docs/releases/CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md for
// the audit that led to removing FREQUENCY and REPEAT from this file (they were both derived
// from PurchaseBehaviorProduct.orderCount, which is only safe at product grain — see scoring.ts
// for why summing it across products overcounts distinct purchase occasions at code grain) and
// for the full formula writeup behind every constant below.

import type { ProductSemanticFactConfidence } from './contracts.js';

// ── Recency ─────────────────────────────────────────────────────────────────────────────────
//
// Exponential half-life decay: weight = 0.5 ^ (daysSinceLastPurchase / halfLifeDays). Chosen
// over linear decay because it never goes negative and never fully zeroes out (an old purchase
// still carries a small, non-zero weight), and a half-life is a single, intuitive calibration
// knob. 180 days (~6 months) is a conservative default for a durable-goods gym-equipment
// catalog, not a consumables catalog: a customer's interest in a product family they bought 6
// months ago should still count for roughly half as much as a purchase made yesterday, rather
// than being nearly discounted away the way a 30-day half-life would. This is a versioned
// heuristic, not learned from data, and is not exposed as runtime-mutable config in v1.
//
// Aggregation note (A01.2.1, task Section 21): recency is combined at CODE level using the
// STRONGEST (most recent, role/confidence-weighted) evidence among contributing products, never
// summed per product — see itemEvidenceWeight/aggregateGroup in scoring.ts. Summing per-product
// recency would double-reward a code that happens to have many supporting products, on top of
// the separate, explicit diversityBonus below that already rewards that.
export const RECENCY_HALF_LIFE_DAYS = 180;

export function recencyWeight(daysSinceLastPurchase: number): number {
  if (!Number.isFinite(daysSinceLastPurchase) || daysSinceLastPurchase < 0) {
    throw new Error(`Invalid daysSinceLastPurchase: must be a finite, non-negative number (got ${daysSinceLastPurchase})`);
  }
  return Math.pow(0.5, daysSinceLastPurchase / RECENCY_HALF_LIFE_DAYS);
}

// ── Monetary contribution, dampened ────────────────────────────────────────────────────────
//
// sqrt dampening, applied ONCE at code level to the code's AGGREGATE spend share (A01.2.1, task
// Section 8/9) — never per product then summed. Per-product sqrt-then-sum is concave-additive
// (sqrt(a) + sqrt(b) > sqrt(a + b) for positive a, b), which rewarded a customer purely for
// having split the same total spend across more products — a diversity effect already covered
// by diversityBonus below, not something monetary evidence should also encode. See
// aggregateGroup in scoring.ts for the sum-first-then-dampen order.
//
// spendShare is already a share of the customer's OWN total spend (never absolute currency).
// sqrt(0.01) = 0.1: a 1% aggregate share is boosted well above its linear weight, while
// sqrt(1.0) = 1.0 caps a customer's single, entire-wallet code at the same ceiling as any other
// code's full monetary weight. Combined with MONETARY_WEIGHT below, monetary evidence can never
// exceed its configured component-weight share of a code's composite evidence.
export function monetaryWeight(spendShare: number): number {
  if (!Number.isFinite(spendShare) || spendShare < 0 || spendShare > 1) {
    throw new Error(`Invalid spendShare: must be a finite number within [0,1] (got ${spendShare})`);
  }
  return Math.sqrt(spendShare);
}

// ── Component weight budget ─────────────────────────────────────────────────────────────────
//
// RECENCY_WEIGHT and MONETARY_WEIGHT sum to 1.0 so a code's composite evidence stays in an
// easily-reasoned-about ~[0,1] range before the diversity bonus is added — a budgeting
// convenience, not a softmax.
//
// A01.2 originally also had FREQUENCY_WEIGHT (0.30) and REPEAT_WEIGHT (0.10), both removed in
// A01.2.1: FREQUENCY used PurchaseBehaviorProduct.orderCount, which is COUNT(DISTINCT id_order)
// scoped to a single product (confirmed by reading the actual SQL in
// mysql-customer-product-behavior-reader.ts) — summing it across multiple products supporting
// the same code overcounts distinct purchase occasions whenever those products were bought
// together in one order. REPEAT (isRepeated) is literally `orderCount >= 2` on that same field —
// not independent evidence, just a coarser view of the same unreliable-at-code-grain quantity.
// Keeping either would have reintroduced the exact overcounting this hardening pass removes.
// Their combined 0.40 budget share is redistributed here, preserving RECENCY's dominance over
// MONETARY (recency is directly observed and always available; monetary remains dampened and
// capped specifically to avoid spend dominance) — a clean 0.6/0.4 split, close to the original
// 0.35:0.25 ratio (~0.583:0.417) but rounded to legible constants. Exact distinct-order frequency
// evidence is deferred to A01.4, which can join AnalyticalOrder line-level data — see the release
// doc for the full audit and the reasoning that A01.4 will need a differently-shaped signal
// entirely, not a resurrection of these two functions.
export const RECENCY_WEIGHT = 0.6;
export const MONETARY_WEIGHT = 0.4;

// ── Primary vs. secondary product family ───────────────────────────────────────────────────
//
// PRIMARY = 1.0 (full weight). SECONDARY = 0.6 — within the design doc's suggested 0.5-0.8
// range, chosen as a stable middle value: secondary-family evidence from a hybrid product is
// real and must stay > 0, but must read as meaningfully weaker than a product whose primary
// family is this code, not merely a rounding difference. DISCIPLINE and USE_CONTEXT tags carry
// no primary/secondary distinction in the contract (ProductSemanticFact.disciplines/useContexts
// are plain arrays) and always use STANDARD_ROLE_MULTIPLIER — no primary/secondary distinction
// is invented for axes that do not have one.
//
// Applied within BOTH the recency-strength and monetary-share computations for a product's
// contribution to a code (A01.2.1, task Section 10): a hybrid product's full evidence is counted
// toward EACH of its family codes independently (scores across different codes are independent
// and need not sum to 1 — task Section 10), but WITHIN its secondary code's own aggregation, that
// evidence is role-discounted before being combined with any other product's evidence for that
// same code.
export const PRIMARY_FAMILY_ROLE_MULTIPLIER = 1.0;
export const SECONDARY_FAMILY_ROLE_MULTIPLIER = 0.6;
export const STANDARD_ROLE_MULTIPLIER = 1.0;

export type CustomerCommercialAffinityEvidenceRole = 'primary' | 'secondary' | 'standard';

export function roleMultiplier(role: CustomerCommercialAffinityEvidenceRole): number {
  switch (role) {
    case 'primary':
      return PRIMARY_FAMILY_ROLE_MULTIPLIER;
    case 'secondary':
      return SECONDARY_FAMILY_ROLE_MULTIPLIER;
    case 'standard':
      return STANDARD_ROLE_MULTIPLIER;
  }
}

// ── Confidence discount ─────────────────────────────────────────────────────────────────────
//
// EXPLICIT and a missing/absent confidence both receive full weight (1.0) — a missing confidence
// field is never treated as low confidence (A01.1's contract policy). STRONGLY_INFERRED receives
// a small, bounded discount (0.85): still substantial evidence, just less certain than an
// explicit match. This ordering — EXPLICIT == missing > STRONGLY_INFERRED — is a required
// regression. This is the contribution multiplier only; it is a distinct concept from
// explicitEvidenceCoverage (contracts.ts / scoring.ts), which reports confidence-tag PROVENANCE
// rather than discounting the score (task Section 13).
export const EXPLICIT_CONFIDENCE_MULTIPLIER = 1.0;
export const STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER = 0.85;
export const MISSING_CONFIDENCE_MULTIPLIER = 1.0;

export function confidenceMultiplier(confidence: ProductSemanticFactConfidence | undefined): number {
  if (confidence === undefined) return MISSING_CONFIDENCE_MULTIPLIER;
  return confidence === 'EXPLICIT' ? EXPLICIT_CONFIDENCE_MULTIPLIER : STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER;
}

// ── Product diversity ───────────────────────────────────────────────────────────────────────
//
// Saturating transform applied to distinct supporting productId count, once per (axis, code)
// group during aggregation ("must be accumulated at code level"). Scale = 3: 3 distinct products
// is materially stronger evidence than 1, but not 3x stronger. Unweighted by role/confidence —
// a product counts as one more distinct supporting relationship regardless of how strong that
// individual relationship is; role/confidence already discount the recency and monetary
// components that measure strength.
export const DIVERSITY_WEIGHT = 0.3;
export const DIVERSITY_SATURATION_SCALE = 3;

export function diversityBonus(distinctProductCount: number): number {
  if (!Number.isSafeInteger(distinctProductCount) || distinctProductCount < 0) {
    throw new Error(`Invalid distinctProductCount: must be a non-negative integer (got ${distinctProductCount})`);
  }
  return DIVERSITY_WEIGHT * (1 - Math.exp(-distinctProductCount / DIVERSITY_SATURATION_SCALE));
}

// ── Final saturation ────────────────────────────────────────────────────────────────────────
//
// 1 - exp(-compositeEvidence / scale): score(0) = 0 exactly, strictly increasing in
// compositeEvidence (more evidence never decreases score), asymptotic to 1, never reaches or
// exceeds 1 for any finite input. Scale = 1.5: a single, strong, recent, high-spend product
// (raw contribution near the ~1.0 per-code ceiling) lands in the ~0.4 range — clearly positive
// evidence, but not near-maximal from one data point alone — while several similarly strong
// distinct products (via the diversity bonus) climb well past 0.7.
export const AFFINITY_SATURATION_SCALE = 1.5;

export function saturate(compositeEvidence: number): number {
  if (!Number.isFinite(compositeEvidence) || compositeEvidence < 0) {
    throw new Error(`Invalid compositeEvidence: must be a finite, non-negative number (got ${compositeEvidence})`);
  }
  return 1 - Math.exp(-compositeEvidence / AFFINITY_SATURATION_SCALE);
}

// ── Precision policy ────────────────────────────────────────────────────────────────────────
//
// score and explicitEvidenceCoverage are rounded to 6 decimal places on the way out of the
// kernel — the same decimal SCALE this repository already uses for monetary precision
// (src/shared/decimal.ts, and customer-rfm/decimal.ts which now delegates to it) — so the
// persisted row value itself is checksum-stable and directly comparable, regardless of
// incidental floating-point noise below that precision. Intermediate values are left at full
// float precision: determinism for those comes from always combining in a fixed, sorted order
// (scoring.ts), not from rounding.
export const AFFINITY_SCORE_PRECISION = 6;

export function roundToAffinityPrecision(value: number): number {
  const factor = 10 ** AFFINITY_SCORE_PRECISION;
  return Math.round(value * factor) / factor;
}
