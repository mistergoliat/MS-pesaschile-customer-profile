import { getAudienceFieldDefinition } from './field-registry.js';
import type { AudienceAffinityAxisV1, AudienceConditionV1, AudienceFilterV1, AudienceTruthV1 } from './contracts.js';
import { normalizeAudienceDecimal } from './canonicalization.js';

export type AudienceRowV1 = {
  readonly customerId: number;
  readonly feature: Readonly<Record<string, unknown>>;
  readonly rfm?: Readonly<Record<string, unknown>> | null;
  readonly cluster?: Readonly<Record<string, unknown>> | null;
  readonly clv?: Readonly<Record<string, unknown>> | null;
  readonly affinityPopulationMember?: boolean;
  readonly affinityRows?: readonly Readonly<Record<string, unknown>>[];
};

export function evaluateAudienceFilter(filter: AudienceFilterV1, row: AudienceRowV1): AudienceTruthV1 {
  if (filter.kind === 'NOT') return not(evaluateAudienceFilter(filter.child, row));
  if (filter.kind === 'AND') { let unknown = false; for (const child of filter.children) { const result = evaluateAudienceFilter(child, row); if (result === 'FALSE') return 'FALSE'; if (result === 'UNKNOWN') unknown = true; } return unknown ? 'UNKNOWN' : 'TRUE'; }
  if (filter.kind === 'OR') { let unknown = false; for (const child of filter.children) { const result = evaluateAudienceFilter(child, row); if (result === 'TRUE') return 'TRUE'; if (result === 'UNKNOWN') unknown = true; } return unknown ? 'UNKNOWN' : 'FALSE'; }
  return filter.kind === 'HAS_AFFINITY' ? evaluateAffinity(filter, row) : evaluateScalar(filter, row);
}
function evaluateScalar(condition: Extract<AudienceConditionV1, { kind: 'SCALAR' }>, row: AudienceRowV1): AudienceTruthV1 {
  const field = getAudienceFieldDefinition(condition.field);
  if (!field) return 'UNKNOWN';
  const source = field.component === 'feature' ? row.feature : field.component === 'rfm' ? row.rfm : field.component === 'cluster' ? row.cluster : row.clv;
  if (source === null || source === undefined) return 'UNKNOWN';
  const value = source[condition.field.slice(condition.field.indexOf('.') + 1)];
  if (value === undefined) return 'UNKNOWN';
  if (condition.operator === 'IS_NULL') return value === null ? 'TRUE' : 'FALSE';
  if (condition.operator === 'IS_NOT_NULL') return value === null ? 'FALSE' : 'TRUE';
  if (value === null || value === undefined) return 'UNKNOWN';
  const target = condition.value;
  const compare = (candidate: unknown, expected: unknown): number => field.type === 'datetime' ? Date.parse(String(candidate)) - Date.parse(String(expected)) : field.type === 'integer' ? Number(candidate) - Number(expected) : field.type === 'decimal' ? decimalCompare(String(candidate), String(expected)) : String(candidate).localeCompare(String(expected));
  switch (condition.operator) {
    case 'EQ': return compare(value, target) === 0 ? 'TRUE' : 'FALSE'; case 'NEQ': return compare(value, target) !== 0 ? 'TRUE' : 'FALSE';
    case 'GT': return compare(value, target) > 0 ? 'TRUE' : 'FALSE'; case 'GTE': return compare(value, target) >= 0 ? 'TRUE' : 'FALSE';
    case 'LT': return compare(value, target) < 0 ? 'TRUE' : 'FALSE'; case 'LTE': return compare(value, target) <= 0 ? 'TRUE' : 'FALSE';
    case 'IN': return (target as readonly unknown[]).some((item) => compare(value, item) === 0) ? 'TRUE' : 'FALSE';
    case 'NOT_IN': return (target as readonly unknown[]).some((item) => compare(value, item) === 0) ? 'FALSE' : 'TRUE';
    case 'BETWEEN': return compare(value, (target as readonly unknown[])[0]) >= 0 && compare(value, (target as readonly unknown[])[1]) <= 0 ? 'TRUE' : 'FALSE';
    default: return 'UNKNOWN';
  }
}
function evaluateAffinity(condition: Extract<AudienceConditionV1, { kind: 'HAS_AFFINITY' }>, row: AudienceRowV1): AudienceTruthV1 {
  if (row.affinityPopulationMember !== true) return 'UNKNOWN';
  const matching = (row.affinityRows ?? []).filter((candidate) => candidate.affinityAxis === condition.axis && candidate.affinityCode === condition.code.trim());
  if (matching.length === 0) return 'FALSE';
  let unknown = false;
  for (const candidate of matching) {
    const result = affinityQualifierResult(condition, candidate);
    if (result === 'TRUE') return 'TRUE';
    if (result === 'UNKNOWN') unknown = true;
  }
  return unknown ? 'UNKNOWN' : 'FALSE';
}
function affinityQualifierResult(condition: Extract<AudienceConditionV1, { kind: 'HAS_AFFINITY' }>, row: Readonly<Record<string, unknown>>): AudienceTruthV1 {
  if (condition.minScore !== undefined && Number(row.score) < Number(condition.minScore)) return 'FALSE';
  if (condition.minSupportingOrderCount !== undefined && Number(row.supportingOrderCount) < condition.minSupportingOrderCount) return 'FALSE';
  if (condition.minSupportingProductCount !== undefined && Number(row.supportingProductCount) < condition.minSupportingProductCount) return 'FALSE';
  if (condition.minSupportingSpend !== undefined && Number(row.supportingSpend) < Number(condition.minSupportingSpend)) return 'FALSE';
  if (condition.minExplicitEvidenceCoverage !== undefined && row.explicitEvidenceCoverage === null) return 'UNKNOWN';
  if (condition.minExplicitEvidenceCoverage !== undefined && (row.explicitEvidenceCoverage === undefined || Number(row.explicitEvidenceCoverage) < Number(condition.minExplicitEvidenceCoverage))) return 'FALSE';
  if (condition.lastEvidenceAt !== undefined) { const compare = Date.parse(String(row.lastEvidenceAt)) - Date.parse(condition.lastEvidenceAt.value); const op = condition.lastEvidenceAt.operator; if ((op === 'EQ' && compare !== 0) || (op === 'GT' && compare <= 0) || (op === 'GTE' && compare < 0) || (op === 'LT' && compare >= 0) || (op === 'LTE' && compare > 0)) return 'FALSE'; }
  return 'TRUE';
}
function not(value: AudienceTruthV1): AudienceTruthV1 { return value === 'TRUE' ? 'FALSE' : value === 'FALSE' ? 'TRUE' : 'UNKNOWN'; }
function decimalCompare(left: string, right: string): number { const a = normalizeAudienceDecimal(left).split('.'); const b = normalizeAudienceDecimal(right).split('.'); const aw = BigInt(a[0] ?? '0'); const bw = BigInt(b[0] ?? '0'); if (aw !== bw) return aw < bw ? -1 : 1; const af = (a[1] ?? '').padEnd(30, '0'); const bf = (b[1] ?? '').padEnd(30, '0'); return af === bf ? 0 : af < bf ? -1 : 1; }

export type AudienceAffinityConditionShape = { readonly kind: 'HAS_AFFINITY'; readonly axis: AudienceAffinityAxisV1; readonly code: string };
