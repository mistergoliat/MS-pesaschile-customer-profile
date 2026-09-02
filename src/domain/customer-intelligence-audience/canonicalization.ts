import { sha256Stable, stableStringify } from '../../shared/stable-checksum.js';
import type { AudienceConditionV1, AudienceDefinitionV1, AudienceFilterV1 } from './contracts.js';

export function normalizeAudienceDecimal(value: string | number): string {
  let text = String(value).trim();
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/iu.test(text)) {
    const [coefficient = '', exponentText = '0'] = text.toLowerCase().split('e');
    const exponent = Number(exponentText);
    const negative = coefficient.startsWith('-');
    const digits = coefficient.replace(/^[+-]/, '').replace('.', '');
    const decimalPlaces = (coefficient.split('.')[1] ?? '').length - exponent;
    text = decimalPlaces <= 0 ? `${digits}${'0'.repeat(-decimalPlaces)}` : decimalPlaces >= digits.length ? `0.${'0'.repeat(decimalPlaces - digits.length)}${digits}` : `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`;
    if (negative) text = `-${text}`;
  }
  if (!/^-?\d+(?:\.\d+)?$/u.test(text)) throw new Error(`Invalid decimal value: ${value}`);
  const negative = text.startsWith('-');
  const [wholeRaw = '0', fractionRaw = ''] = text.replace(/^-/, '').split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  const result = fraction ? `${whole}.${fraction}` : whole;
  return negative && result !== '0' ? `-${result}` : result;
}

export function canonicalizeAudienceDefinition(definition: AudienceDefinitionV1): AudienceDefinitionV1 {
  return { definitionVersion: definition.definitionVersion, root: canonicalizeFilter(definition.root) };
}

export function audienceDefinitionChecksum(definition: AudienceDefinitionV1): string {
  return sha256Stable(canonicalizeAudienceDefinition(definition));
}

export function canonicalAudienceJson(definition: AudienceDefinitionV1): string {
  return stableStringify(canonicalizeAudienceDefinition(definition));
}

function canonicalizeFilter(filter: AudienceFilterV1): AudienceFilterV1 {
  if (filter.kind === 'NOT') return { kind: 'NOT', child: canonicalizeFilter(filter.child) };
  if (filter.kind === 'AND' || filter.kind === 'OR') {
    const children = filter.children.map(canonicalizeFilter).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    const unique: AudienceFilterV1[] = [];
    for (const child of children) if (unique.length === 0 || stableStringify(unique[unique.length - 1]) !== stableStringify(child)) unique.push(child);
    return { kind: filter.kind, children: unique };
  }
  return canonicalizeCondition(filter);
}

function canonicalizeCondition(condition: AudienceConditionV1): AudienceConditionV1 {
  if (condition.kind === 'HAS_AFFINITY') {
    return {
      kind: 'HAS_AFFINITY', axis: condition.axis, code: condition.code.trim(),
      ...(condition.minScore === undefined ? {} : { minScore: normalizeAudienceDecimal(condition.minScore) }),
      ...(condition.minSupportingOrderCount === undefined ? {} : { minSupportingOrderCount: condition.minSupportingOrderCount }),
      ...(condition.minSupportingProductCount === undefined ? {} : { minSupportingProductCount: condition.minSupportingProductCount }),
      ...(condition.minSupportingSpend === undefined ? {} : { minSupportingSpend: normalizeAudienceDecimal(condition.minSupportingSpend) }),
      ...(condition.minExplicitEvidenceCoverage === undefined ? {} : { minExplicitEvidenceCoverage: normalizeAudienceDecimal(condition.minExplicitEvidenceCoverage) }),
      ...(condition.lastEvidenceAt === undefined ? {} : { lastEvidenceAt: { operator: condition.lastEvidenceAt.operator, value: new Date(condition.lastEvidenceAt.value).toISOString() } }),
    };
  }
  const definition = typeof condition.field === 'string' ? condition.field : String(condition.field);
  const isDecimal = definition === 'rfm.grossOrderValueTaxIncl' || definition.startsWith('clv.') || ['commercial.totalSpentTaxIncl', 'commercial.averageOrderValueTaxIncl', 'commercial.repeatProductRate', 'commercial.top1Share', 'commercial.top3Share', 'commercial.effectiveDiversity', 'commercial.averageUnitsPerOrder', 'commercial.purchaseFrequencyDays', 'commercial.cancelledOrderRatio', 'commercial.discountShare', 'commercial.shippingShare'].includes(definition);
  const normalizeValue = (value: string | number): string | number => isDecimal ? normalizeAudienceDecimal(value) : definition.endsWith('At') ? new Date(String(value)).toISOString() : value;
  if (condition.operator === 'IS_NULL' || condition.operator === 'IS_NOT_NULL') return { kind: 'SCALAR', field: definition, operator: condition.operator };
  const value = Array.isArray(condition.value) ? condition.value.map(normalizeValue) : normalizeValue(condition.value as string | number);
  if (Array.isArray(value) && (condition.operator === 'IN' || condition.operator === 'NOT_IN')) {
    const unique = [...new Set(value.map((v) => `${typeof v}:${String(v)}`))].map((key) => key.slice(key.indexOf(':') + 1));
    const sorted = unique.sort((left, right) => isDecimal ? normalizeAudienceDecimal(left).localeCompare(normalizeAudienceDecimal(right), 'en', { numeric: true }) : typeof value[0] === 'number' ? Number(left) - Number(right) : left.localeCompare(right));
    return { kind: 'SCALAR', field: definition, operator: condition.operator, value: sorted };
  }
  return { kind: 'SCALAR', field: definition, operator: condition.operator, value };
}
