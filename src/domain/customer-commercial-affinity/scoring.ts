// Deterministic Customer Commercial Affinity scoring kernel (CUSTOMER-INTELLIGENCE-R2-A01.2,
// hardened in A01.2.1 — see docs/releases/CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md
// for the full audit). Pure, synchronous, offline: no I/O, no catalog-service call, no DB, no
// snapshot lookup. The caller is responsible for joining PurchaseBehaviorProduct to
// ProductSemanticFact by productId before calling scoreCustomerCommercialAffinity — the same join
// responsibility already established for customer-purchase-behavior in the A01.0 design doc,
// unchanged here.

import type { PurchaseBehaviorProduct } from '../customer-purchase-behavior/contracts.js';
import { addDecimals } from '../../shared/decimal.js';
import type {
  CustomerCommercialAffinityAxis,
  CustomerCommercialAffinityRow,
  ProductSemanticFact,
  ProductSemanticFactConfidence,
  ProductSemanticFactTag,
} from './contracts.js';
import { isDisciplineEligible, isProductFamilyEligible, isUseContextEligible } from './eligibility.js';
import {
  confidenceMultiplier,
  diversityBonus,
  monetaryWeight,
  recencyWeight,
  roleMultiplier,
  roundToAffinityPrecision,
  saturate,
  type CustomerCommercialAffinityEvidenceRole,
  MONETARY_WEIGHT,
  RECENCY_WEIGHT,
} from './scoring-policy.js';
import { assertValidAffinityScore, assertValidProductSemanticFact, isValidDecimalString } from './validation.js';

export type CustomerCommercialAffinityProductPurchase = {
  readonly purchase: PurchaseBehaviorProduct;
  readonly semanticFact: ProductSemanticFact;
};

export type CustomerCommercialAffinityKernelInput = {
  readonly customerId: number;
  readonly purchases: readonly CustomerCommercialAffinityProductPurchase[];
};

// Internal only — never exported. Carries exactly what the per-product/per-code stages below
// need; nothing here is part of this module's public contract.
type SemanticEvidenceItem = {
  readonly axis: CustomerCommercialAffinityAxis;
  readonly code: string;
  readonly productId: number;
  readonly orderCount: number;
  readonly spendShare: number;
  readonly totalSpentTaxIncl: string;
  readonly daysSinceLastPurchase: number;
  readonly lastPurchasedAt: string;
  readonly confidence: ProductSemanticFactConfidence | undefined;
  readonly role: CustomerCommercialAffinityEvidenceRole;
};

// ── Stage 1: per-product semantic evidence expansion ───────────────────────────────────────
//
// For one purchased product, derives zero or more semantic evidence items: PRODUCT_FAMILY
// (primary + each secondary), DISCIPLINE (each eligible tag), USE_CONTEXT (each eligible tag).
// Reuses A01.1's eligibility helpers verbatim — this function never re-implements the
// classification-status policy, only expands what eligibility already allows. Rejects a
// malformed fact (duplicate codes) at this boundary rather than silently deduplicating it
// (A01.2.1, task Section 17) — after this check passes, a single product can contribute at most
// one item per (axis, code) pair, which aggregateGroup below relies on.
export function expandSemanticEvidence(purchase: PurchaseBehaviorProduct, semanticFact: ProductSemanticFact): readonly SemanticEvidenceItem[] {
  if (purchase.productId !== semanticFact.productId) {
    throw new Error(`Mismatched productId between purchase (${purchase.productId}) and semanticFact (${semanticFact.productId})`);
  }
  assertValidProductSemanticFact(semanticFact);

  const items: SemanticEvidenceItem[] = [];

  if (isProductFamilyEligible(semanticFact) && semanticFact.primaryProductFamily) {
    items.push(toEvidenceItem(purchase, 'PRODUCT_FAMILY', semanticFact.primaryProductFamily, 'primary'));
    for (const secondary of semanticFact.secondaryProductFamilies) {
      items.push(toEvidenceItem(purchase, 'PRODUCT_FAMILY', secondary, 'secondary'));
    }
  }

  if (isDisciplineEligible(semanticFact)) {
    for (const discipline of semanticFact.disciplines) {
      items.push(toEvidenceItem(purchase, 'DISCIPLINE', discipline, 'standard'));
    }
  }

  if (isUseContextEligible(semanticFact)) {
    for (const useContext of semanticFact.useContexts) {
      items.push(toEvidenceItem(purchase, 'USE_CONTEXT', useContext, 'standard'));
    }
  }

  return items;
}

function toEvidenceItem(
  purchase: PurchaseBehaviorProduct,
  axis: CustomerCommercialAffinityAxis,
  tag: ProductSemanticFactTag,
  role: CustomerCommercialAffinityEvidenceRole,
): SemanticEvidenceItem {
  if (!isValidDecimalString(purchase.spendShare)) {
    throw new Error(`Invalid spendShare decimal string for productId ${purchase.productId}: ${purchase.spendShare}`);
  }
  return {
    axis,
    code: tag.code,
    productId: purchase.productId,
    orderCount: purchase.orderCount,
    spendShare: Number(purchase.spendShare),
    totalSpentTaxIncl: purchase.totalSpentTaxIncl,
    daysSinceLastPurchase: purchase.daysSinceLastPurchase,
    lastPurchasedAt: purchase.lastPurchasedAt,
    confidence: tag.confidence,
    role,
  };
}

// ── Per-item transforms (used only inside aggregation — one product's raw building blocks) ──
//
// Confidence-INDEPENDENT on purpose: used both as the pre-confidence base for recency strength
// below, and as the weight measure for explicitEvidenceCoverage (scoreAffinityEvidence) — a
// coverage metric weighted by the very quantity it discounts would be circular.
function itemEvidenceWeight(item: SemanticEvidenceItem): number {
  return recencyWeight(item.daysSinceLastPurchase) * roleMultiplier(item.role);
}

function itemRecencyStrength(item: SemanticEvidenceItem): number {
  return itemEvidenceWeight(item) * confidenceMultiplier(item.confidence);
}

function itemMonetaryShare(item: SemanticEvidenceItem): number {
  return item.spendShare * roleMultiplier(item.role) * confidenceMultiplier(item.confidence);
}

// ── Stage 2: per-(axis, code) aggregation ──────────────────────────────────────────────────
//
// recencyContribution: the STRONGEST (max, role/confidence-weighted) evidence among contributing
// products, not a sum — a code supported by 3 recent products reads as "recently supported," not
// "3x as recently supported." Summing here would double-reward breadth of evidence that
// diversityBonus already rewards separately (A01.2.1, task Section 21).
//
// aggregateSpendShare: the SUM of role/confidence-weighted spendShare across contributing
// products, capped to [0,1] — sqrt dampening is applied once, after this sum, in
// scoreAffinityEvidence (A01.2.1, task Section 8/9). The cap is a defensive safety net: since
// every individual spendShare is itself a share of the customer's single total spend, and role
// multipliers only ever scale a contribution down (never above 1), a well-formed input's
// aggregate cannot realistically exceed 1 — this only guards against upstream rounding drift.
//
// After assertValidProductSemanticFact (Stage 1), a single product contributes at most one item
// per (axis, code), so `items` here already IS the distinct-product set for this group — no
// separate dedup step is needed for supportingProductCount/supportingSpend/lastEvidenceAt.
export type CustomerCommercialAffinityAggregate = {
  readonly axis: CustomerCommercialAffinityAxis;
  readonly code: string;
  readonly recencyContribution: number;
  readonly aggregateSpendShare: number;
  readonly supportingProductCount: number;
  readonly supportingOrderCount: number;
  readonly supportingSpend: string;
  readonly lastEvidenceAt: string;
  readonly explicitEvidenceMass: number;
  readonly confidenceTaggedEvidenceMass: number;
};

export function aggregateAffinityEvidence(items: readonly SemanticEvidenceItem[]): readonly CustomerCommercialAffinityAggregate[] {
  const groups = new Map<string, SemanticEvidenceItem[]>();
  for (const item of items) {
    const key = groupKey(item.axis, item.code);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  // Sort group keys for determinism regardless of input iteration order.
  return [...groups.keys()].sort().map((key) => aggregateGroup(groups.get(key)!));
}

function groupKey(axis: CustomerCommercialAffinityAxis, code: string): string {
  return `${axis} ${code}`;
}

function aggregateGroup(items: readonly SemanticEvidenceItem[]): CustomerCommercialAffinityAggregate {
  // Sort by productId so every reduction below — and therefore the resulting floating-point
  // totals — is identical regardless of the caller's original array order.
  const sortedItems = [...items].sort((a, b) => a.productId - b.productId);
  const firstItem = sortedItems[0];
  if (!firstItem) {
    throw new Error('Cannot aggregate an empty evidence group');
  }

  const recencyContribution = sortedItems.reduce((max, item) => Math.max(max, itemRecencyStrength(item)), 0);
  const rawAggregateSpendShare = sortedItems.reduce((sum, item) => sum + itemMonetaryShare(item), 0);
  const aggregateSpendShare = Math.min(1, rawAggregateSpendShare);

  const explicitEvidenceMass = sumEvidenceWeights(sortedItems.filter((item) => item.confidence === 'EXPLICIT'));
  const confidenceTaggedEvidenceMass = sumEvidenceWeights(sortedItems.filter((item) => item.confidence !== undefined));

  return {
    axis: firstItem.axis,
    code: firstItem.code,
    recencyContribution,
    aggregateSpendShare,
    supportingProductCount: sortedItems.length,
    // Approximate UPPER BOUND (task Section 6/29), not an exact distinct-order count: this
    // kernel only has per-product aggregates (PurchaseBehaviorProduct), not order-line data, so
    // if two distinct products supporting the same code were bought in the same physical order,
    // that order is counted once per product here. Exact distinct-order counting is deferred to
    // A01.4, which can join against AnalyticalOrder line data. Never used for scoring (frequency
    // is deferred entirely — see scoring-policy.ts).
    supportingOrderCount: sortedItems.reduce((sum, item) => sum + item.orderCount, 0),
    supportingSpend: addDecimals(sortedItems.map((item) => item.totalSpentTaxIncl)),
    lastEvidenceAt: sortedItems.reduce(
      (latest, item) => (Date.parse(item.lastPurchasedAt) > Date.parse(latest) ? item.lastPurchasedAt : latest),
      firstItem.lastPurchasedAt,
    ),
    explicitEvidenceMass,
    confidenceTaggedEvidenceMass,
  };
}

function sumEvidenceWeights(items: readonly SemanticEvidenceItem[]): number {
  return items.reduce((sum, item) => sum + itemEvidenceWeight(item), 0);
}

// ── Stage 3: final saturation + row assembly ───────────────────────────────────────────────
//
// explicitEvidenceCoverage policy (A01.2.1, task Section 11/12 — replaces A01.2's evidenceCoverage,
// which defaulted an entirely-untagged group to 1 and conflated "all EXPLICIT" with "confidence
// unavailable"): null when no contributing item for this code carries confidence metadata at all
// (confidenceTaggedEvidenceMass === 0); otherwise explicitEvidenceMass / confidenceTaggedEvidenceMass,
// scoped to confidence-tagged evidence only. Weighted by itemEvidenceWeight (role/recency, NOT
// confidence) so the ratio isn't circularly biased by the very discount it's measuring.
export function scoreAffinityEvidence(aggregate: CustomerCommercialAffinityAggregate, customerId: number): CustomerCommercialAffinityRow {
  const monetaryContribution = MONETARY_WEIGHT * monetaryWeight(aggregate.aggregateSpendShare);
  const recencyContribution = RECENCY_WEIGHT * aggregate.recencyContribution;
  const compositeEvidence = recencyContribution + monetaryContribution + diversityBonus(aggregate.supportingProductCount);
  const score = roundToAffinityPrecision(saturate(compositeEvidence));
  assertValidAffinityScore(score, 'score');

  const explicitEvidenceCoverage =
    aggregate.confidenceTaggedEvidenceMass === 0
      ? null
      : roundToAffinityPrecision(aggregate.explicitEvidenceMass / aggregate.confidenceTaggedEvidenceMass);
  if (explicitEvidenceCoverage !== null) assertValidAffinityScore(explicitEvidenceCoverage, 'explicitEvidenceCoverage');

  return {
    customerId,
    affinityAxis: aggregate.axis,
    affinityCode: aggregate.code,
    score,
    supportingOrderCount: aggregate.supportingOrderCount,
    supportingProductCount: aggregate.supportingProductCount,
    supportingSpend: aggregate.supportingSpend,
    lastEvidenceAt: aggregate.lastEvidenceAt,
    explicitEvidenceCoverage,
  };
}

// ── Public composed API ─────────────────────────────────────────────────────────────────────
//
// scoreCustomerCommercialAffinity(customerId, purchases[]) -> rows[]. No I/O; the caller has
// already joined PurchaseBehaviorProduct to ProductSemanticFact by productId. No qualifying
// evidence anywhere in the input returns [] — no zero-valued row is ever synthesized.
export function scoreCustomerCommercialAffinity(input: CustomerCommercialAffinityKernelInput): readonly CustomerCommercialAffinityRow[] {
  assertNoDuplicateProductPurchases(input.purchases);

  const allItems = input.purchases.flatMap(({ purchase, semanticFact }) => expandSemanticEvidence(purchase, semanticFact));
  if (allItems.length === 0) return [];

  const aggregates = aggregateAffinityEvidence(allItems);
  return aggregates.map((aggregate) => scoreAffinityEvidence(aggregate, input.customerId));
}

function assertNoDuplicateProductPurchases(purchases: readonly CustomerCommercialAffinityProductPurchase[]): void {
  const seen = new Set<number>();
  for (const { purchase } of purchases) {
    if (seen.has(purchase.productId)) {
      throw new Error(`Duplicate productId in customer commercial affinity purchase input: ${purchase.productId}`);
    }
    seen.add(purchase.productId);
  }
}
