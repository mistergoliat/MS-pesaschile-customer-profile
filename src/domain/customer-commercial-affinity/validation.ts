// Pure validators for Customer Commercial Affinity contract invariants (task Section 7/8/19).
// No scoring, no accumulation — only bound/shape checks a future kernel (A01.2+) and any
// snapshot builder (A01.4+) can reuse so these invariants are enforced in exactly one place.

import type { CustomerCommercialAffinityCoverage, CustomerCommercialAffinityRow, ProductSemanticFact, ProductSemanticFactTag } from './contracts.js';

// ── Score bounds (task Section 7) ──────────────────────────────────────────────────────────
//
// Bounded [0,1]. Explicitly rejects NaN, +/-Infinity, negative values, and values above 1 —
// Number.isFinite already excludes NaN and both infinities, so no separate check is needed.
export function isValidAffinityScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function assertValidAffinityScore(value: number, name = 'score'): void {
  if (!isValidAffinityScore(value)) {
    throw new Error(`Invalid ${name}: must be a finite number within [0,1] (got ${value})`);
  }
}

// ── Coverage percentage bounds (task Section 8) ────────────────────────────────────────────
//
// Bounded [0,100]. Invalid values are rejected, never silently clamped/normalized — a coverage
// computation that produces an out-of-range percentage indicates a bug in the counts feeding it
// and must fail loudly, not be masked.
export function isValidCoveragePercentage(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function assertValidCoveragePercentage(value: number, name = 'coverage percentage'): void {
  if (!isValidCoveragePercentage(value)) {
    throw new Error(`Invalid ${name}: must be a finite number within [0,100] (got ${value})`);
  }
}

// ── Non-negative counts (task Section 19: populationSize >= 0, etc.) ──────────────────────
export function assertNonNegativeCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: must be a non-negative integer (got ${value})`);
  }
}

// ── Positive integers (task Section 18: productId) ─────────────────────────────────────────
export function assertPositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${name}: must be a positive integer (got ${value})`);
  }
}

// ── Non-empty version/hash identifiers (task Section 19) ──────────────────────────────────
export function assertNonEmptyIdentifier(value: string, name: string): void {
  if (value.trim() === '') {
    throw new Error(`Invalid ${name}: must not be empty`);
  }
}

// ── ISO timestamps (same Date.parse convention already used by customer-intelligence-query's
// validator.ts) ─────────────────────────────────────────────────────────────────────────────
export function assertValidIsoTimestamp(value: string, name: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${name}: must be a valid ISO timestamp`);
  }
}

// ── Decimal strings (same non-negative-decimal shape already used by customer-rfm/decimal.ts
// and customer-orders/analytical-order.ts's money()) — supportingSpend/excludedNonProductSpend
// must never be a JS currency float ──────────────────────────────────────────────────────────
const NON_NEGATIVE_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

export function isValidDecimalString(value: string): boolean {
  return NON_NEGATIVE_DECIMAL_PATTERN.test(value.trim());
}

export function assertValidDecimalString(value: string, name: string): void {
  if (!isValidDecimalString(value)) {
    throw new Error(`Invalid ${name}: must be a non-negative decimal string (got ${JSON.stringify(value)})`);
  }
}

// ── Composite checks ────────────────────────────────────────────────────────────────────────

export function assertValidAffinityRow(row: CustomerCommercialAffinityRow): void {
  assertNonEmptyIdentifier(row.affinityCode, 'affinityCode');
  assertValidAffinityScore(row.score);
  assertNonNegativeCount(row.approximateSupportingOrderCount, 'approximateSupportingOrderCount');
  assertNonNegativeCount(row.supportingProductCount, 'supportingProductCount');
  assertValidDecimalString(row.supportingSpend, 'supportingSpend');
  assertValidIsoTimestamp(row.lastEvidenceAt, 'lastEvidenceAt');
  if (row.explicitEvidenceCoverage !== null && !isValidAffinityScore(row.explicitEvidenceCoverage)) {
    throw new Error(`Invalid explicitEvidenceCoverage: must be null or a finite number within [0,1] (got ${row.explicitEvidenceCoverage})`);
  }
}

// ── Semantic-fact transport invariants (A01.2.1 hardening, task Section 16/17/18) ─────────
//
// A malformed ProductSemanticFact is REJECTED at this consumer boundary, never silently
// deduplicated/repaired: catalog-service should publish canonical facts, and silently repairing
// a malformed one here would hide an upstream defect instead of surfacing it (task Section 17's
// explicit preference). Deliberately does NOT validate whether a code exists in any ontology —
// codes remain opaque strings owned entirely by catalog-service (task Section 18).
export function assertValidProductSemanticFact(fact: ProductSemanticFact): void {
  assertPositiveInt(fact.productId, 'productId');
  assertNonEmptyIdentifier(fact.ontologyVersion, 'ontologyVersion');
  assertNonEmptyIdentifier(fact.ontologyHash, 'ontologyHash');

  if (fact.primaryProductFamily) {
    assertNonEmptyIdentifier(fact.primaryProductFamily.code, 'primaryProductFamily.code');
    if (fact.secondaryProductFamilies.some((tag) => tag.code === fact.primaryProductFamily?.code)) {
      throw new Error(
        `Malformed ProductSemanticFact for productId ${fact.productId}: primary PRODUCT_FAMILY code "${fact.primaryProductFamily.code}" also appears in secondaryProductFamilies`,
      );
    }
  }
  assertUniqueTagCodes(fact.secondaryProductFamilies, 'secondaryProductFamilies', fact.productId);
  assertUniqueTagCodes(fact.disciplines, 'disciplines', fact.productId);
  assertUniqueTagCodes(fact.useContexts, 'useContexts', fact.productId);
}

function assertUniqueTagCodes(tags: readonly ProductSemanticFactTag[], fieldName: string, productId: number): void {
  const seen = new Set<string>();
  for (const tag of tags) {
    assertNonEmptyIdentifier(tag.code, `${fieldName}[].code`);
    if (seen.has(tag.code)) {
      throw new Error(`Malformed ProductSemanticFact for productId ${productId}: duplicate code "${tag.code}" in ${fieldName}`);
    }
    seen.add(tag.code);
  }
}

export function assertValidCoverage(coverage: CustomerCommercialAffinityCoverage): void {
  assertNonNegativeCount(coverage.customersEvaluated, 'customersEvaluated');
  assertNonNegativeCount(coverage.customersWithAffinity, 'customersWithAffinity');
  assertNonNegativeCount(coverage.purchaseLinesEvaluated, 'purchaseLinesEvaluated');
  assertNonNegativeCount(coverage.purchaseLinesWithSemanticProduct, 'purchaseLinesWithSemanticProduct');
  if (coverage.customersWithAffinity > coverage.customersEvaluated) {
    throw new Error('customersWithAffinity cannot exceed customersEvaluated');
  }
  if (coverage.purchaseLinesWithSemanticProduct > coverage.purchaseLinesEvaluated) {
    throw new Error('purchaseLinesWithSemanticProduct cannot exceed purchaseLinesEvaluated');
  }
  assertValidCoveragePercentage(coverage.semanticPurchaseCoverage, 'semanticPurchaseCoverage');
  assertValidCoveragePercentage(coverage.semanticSpendCoverage, 'semanticSpendCoverage');
  assertValidCoveragePercentage(coverage.classifiedOrderCoverage, 'classifiedOrderCoverage');
  assertValidCoveragePercentage(coverage.productFamilyCoverage, 'productFamilyCoverage');
  assertValidCoveragePercentage(coverage.disciplineCoverage, 'disciplineCoverage');
  assertValidCoveragePercentage(coverage.useContextCoverage, 'useContextCoverage');
}
