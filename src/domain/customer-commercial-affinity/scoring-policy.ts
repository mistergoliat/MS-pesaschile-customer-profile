// Deterministic scoring-policy constants and pure component transforms for the Customer
// Commercial Affinity kernel (CUSTOMER-INTELLIGENCE-R2-A01.2). Every constant here belongs to
// customerCommercialAffinityCalculationVersion = 'customer-commercial-affinity-v1' (snapshot.ts)
// — changing any value on this file requires a version bump (A01.0 design doc's determinism
// invariant). None of these are learned from data; they are documented v1 heuristics pending
// real-data calibration once A01.4 has a live population to validate against.
//
// See docs/releases/CUSTOMER-INTELLIGENCE-R2-A01.2-deterministic-affinity-scoring-kernel.md for
// the full formula writeup and worked examples behind each constant.

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
export const RECENCY_HALF_LIFE_DAYS = 180;

export function recencyWeight(daysSinceLastPurchase: number): number {
  if (!Number.isFinite(daysSinceLastPurchase) || daysSinceLastPurchase < 0) {
    throw new Error(`Invalid daysSinceLastPurchase: must be a finite, non-negative number (got ${daysSinceLastPurchase})`);
  }
  return Math.pow(0.5, daysSinceLastPurchase / RECENCY_HALF_LIFE_DAYS);
}

// ── Frequency ───────────────────────────────────────────────────────────────────────────────
//
// Saturating transform: weight = 1 - exp(-orderCount / scale). orderCount = 20 must not produce
// 20x the evidence of orderCount = 1 — this bounds frequency evidence to [0,1) with diminishing
// returns. Scale = 3 means ~3 qualifying orders reach ~63% of the maximum frequency weight, and
// 5 orders reach ~81% — materially more than a single order, but nowhere near proportional.
export const FREQUENCY_SATURATION_SCALE = 3;

export function frequencyWeight(orderCount: number): number {
  if (!Number.isSafeInteger(orderCount) || orderCount < 0) {
    throw new Error(`Invalid orderCount: must be a non-negative integer (got ${orderCount})`);
  }
  return 1 - Math.exp(-orderCount / FREQUENCY_SATURATION_SCALE);
}

// ── Repeat bonus ────────────────────────────────────────────────────────────────────────────
//
// A flat, bounded bonus gated on isRepeated — not a further function of orderCount, so it never
// compounds with the frequency component above ("do not double-count frequency excessively").
// REPEAT_WEIGHT's small share of the total component budget (below) keeps it a bonus, never a
// dominant factor.
export function repeatBonus(isRepeated: boolean): number {
  return isRepeated ? 1 : 0;
}

// ── Monetary contribution, dampened ────────────────────────────────────────────────────────
//
// sqrt dampening on spendShare (already a share of the customer's OWN total spend, never an
// absolute currency amount). sqrt(0.01) = 0.1: a 1% spend share is boosted well above its linear
// weight, while sqrt(1.0) = 1.0 caps a customer's single, entire-wallet purchase at the same
// ceiling as any other product's full monetary weight — dampening compresses the *low end*
// upward more than the high end, which is what keeps a handful of small, frequent purchases from
// looking negligible next to one large one. Combined with MONETARY_WEIGHT below, monetary
// evidence can never exceed its configured component-weight share of a product's contribution.
export function monetaryWeight(spendShare: number): number {
  if (!Number.isFinite(spendShare) || spendShare < 0 || spendShare > 1) {
    throw new Error(`Invalid spendShare: must be a finite number within [0,1] (got ${spendShare})`);
  }
  return Math.sqrt(spendShare);
}

// ── Component weight budget ─────────────────────────────────────────────────────────────────
//
// Sums to 1.0 so a single product's raw contribution stays in an easily-reasoned-about ~[0,1]
// range before role/confidence multipliers and cross-product diversity are applied — a budgeting
// convenience, not a softmax (weights need not sum to 1 for correctness, but doing so keeps the
// per-product contribution scale legible).
//
// RECENCY_WEIGHT (0.35) and FREQUENCY_WEIGHT (0.30) together carry the majority (0.65) because
// they are the most direct behavioral signals: how recently and how often a customer actually
// bought into this code, independent of price.
// REPEAT_WEIGHT (0.10) is deliberately small — orderCount already captures multi-order behavior
// structurally via FREQUENCY_WEIGHT, so this is a modest additional nudge for confirmed repeat
// buyers, not a second frequency signal.
// MONETARY_WEIGHT (0.25) is real evidence but capped below recency+frequency combined, and
// further dampened by monetaryWeight() above — this is the primary defense against one expensive
// single purchase dominating the score.
export const RECENCY_WEIGHT = 0.35;
export const FREQUENCY_WEIGHT = 0.3;
export const REPEAT_WEIGHT = 0.1;
export const MONETARY_WEIGHT = 0.25;

// ── Primary vs. secondary product family ───────────────────────────────────────────────────
//
// PRIMARY = 1.0 (full weight). SECONDARY = 0.6 — within the design doc's suggested 0.5-0.8
// range, chosen as a stable middle value: secondary-family evidence from a hybrid product is
// real and must stay > 0, but must read as meaningfully weaker than a product whose primary
// family is this code, not merely a rounding difference. DISCIPLINE and USE_CONTEXT tags carry
// no primary/secondary distinction in the contract (ProductSemanticFact.disciplines/useContexts
// are plain arrays) and always use STANDARD_ROLE_MULTIPLIER — no primary/secondary distinction
// is invented for axes that do not have one.
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
// regression.
export const EXPLICIT_CONFIDENCE_MULTIPLIER = 1.0;
export const STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER = 0.85;
export const MISSING_CONFIDENCE_MULTIPLIER = 1.0;

export function confidenceMultiplier(confidence: ProductSemanticFactConfidence | undefined): number {
  if (confidence === undefined) return MISSING_CONFIDENCE_MULTIPLIER;
  return confidence === 'EXPLICIT' ? EXPLICIT_CONFIDENCE_MULTIPLIER : STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER;
}

// ── Product diversity ───────────────────────────────────────────────────────────────────────
//
// Same saturating shape as frequency, applied to distinct supporting productId count instead of
// order count, applied once per (axis, code) group during aggregation rather than per product
// ("must be accumulated at code level"). Scale = 3: 3 distinct products is materially stronger
// evidence than 1, but not 3x stronger.
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
// exceeds 1 for any finite input. Scale = 1.5: a single, strong, recent, repeated, high-spend
// product (raw contribution near the ~1.0 per-product ceiling) lands in the ~0.4 range — clearly
// positive evidence, but not near-maximal from one data point alone — while 3+ similarly strong
// distinct products (summed raw evidence plus the diversity bonus) climb well past 0.75.
export const AFFINITY_SATURATION_SCALE = 1.5;

export function saturate(compositeEvidence: number): number {
  if (!Number.isFinite(compositeEvidence) || compositeEvidence < 0) {
    throw new Error(`Invalid compositeEvidence: must be a finite, non-negative number (got ${compositeEvidence})`);
  }
  return 1 - Math.exp(-compositeEvidence / AFFINITY_SATURATION_SCALE);
}

// ── Precision policy ────────────────────────────────────────────────────────────────────────
//
// score and evidenceCoverage are rounded to 6 decimal places on the way out of the kernel — the
// same decimal SCALE this repository already uses for monetary precision (customer-rfm/decimal.ts)
// — so the persisted row value itself is checksum-stable and directly comparable, regardless of
// incidental floating-point noise below that precision. Intermediate values (rawEvidence,
// explicitEvidenceMass, totalEvidenceMass) are left at full float precision: determinism for
// those comes from always summing in a fixed, sorted order (scoring.ts), not from rounding.
export const AFFINITY_SCORE_PRECISION = 6;

export function roundToAffinityPrecision(value: number): number {
  const factor = 10 ** AFFINITY_SCORE_PRECISION;
  return Math.round(value * factor) / factor;
}
