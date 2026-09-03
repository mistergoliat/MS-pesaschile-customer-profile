import { getAudienceFieldDefinition } from './field-registry.js';
import { normalizeAudienceDecimal } from './canonicalization.js';
import { AUDIENCE_DEFINITION_VERSION, type AudienceDefinitionV1, type AudienceScalarOperatorV1, type AudienceValidationErrorV1 } from './contracts.js';

export const MAX_FILTER_DEPTH = 5;
export const MAX_CONDITIONS = 20;
export const MAX_IN_VALUES = 500;
export const MAX_PREVIEW_MEMBERS = 1000;

export function validateAudienceDefinition(input: unknown): { readonly ok: true; readonly definition: AudienceDefinitionV1 } | { readonly ok: false; readonly errors: readonly AudienceValidationErrorV1[] } {
  const errors: AudienceValidationErrorV1[] = [];
  if (!isObject(input) || input.definitionVersion !== AUDIENCE_DEFINITION_VERSION || !('root' in input)) {
    return { ok: false, errors: [{ code: 'MALFORMED_BOOLEAN_TREE', path: '$', message: `definitionVersion must be ${AUDIENCE_DEFINITION_VERSION} and root is required` }] };
  }
  let conditions = 0;
  walk(input.root, '$.root', 1);
  if (conditions > MAX_CONDITIONS) errors.push({ code: 'EXCESSIVE_CONDITIONS', path: '$.root', message: `Maximum conditions is ${MAX_CONDITIONS}` });
  return errors.length === 0 ? { ok: true, definition: input as AudienceDefinitionV1 } : { ok: false, errors };

  function walk(node: unknown, path: string, depth: number): void {
    if (depth > MAX_FILTER_DEPTH) { errors.push({ code: 'EXCESSIVE_DEPTH', path, message: `Maximum filter depth is ${MAX_FILTER_DEPTH}` }); return; }
    if (!isObject(node) || typeof node.kind !== 'string') { errors.push({ code: 'MALFORMED_BOOLEAN_TREE', path, message: 'Malformed filter node' }); return; }
    if (node.kind === 'AND' || node.kind === 'OR') {
      if (!Array.isArray(node.children) || node.children.length === 0) errors.push({ code: 'EMPTY_BOOLEAN_GROUP', path, message: `${node.kind} must contain at least one child` });
      else node.children.forEach((child, index) => walk(child, `${path}.children[${index}]`, depth + 1));
      return;
    }
    if (node.kind === 'NOT') { if (!('child' in node)) errors.push({ code: 'MALFORMED_BOOLEAN_TREE', path, message: 'NOT requires one child' }); else walk(node.child, `${path}.child`, depth + 1); return; }
    conditions += 1;
    if (node.kind === 'SCALAR') validateScalar(node, path);
    else if (node.kind === 'HAS_AFFINITY') validateAffinity(node, path);
    else errors.push({ code: 'MALFORMED_BOOLEAN_TREE', path, message: `Unsupported condition kind ${node.kind}` });
  }

  function validateScalar(condition: Record<string, unknown>, path: string): void {
    const field = typeof condition.field === 'string' ? getAudienceFieldDefinition(condition.field) : null;
    if (!field) { errors.push({ code: 'UNSUPPORTED_FIELD', path: `${path}.field`, message: 'Field is not in the fixed Audience registry' }); return; }
    if (typeof condition.operator !== 'string' || !field.allowedOperators.includes(condition.operator as AudienceScalarOperatorV1)) { errors.push({ code: 'INCOMPATIBLE_OPERATOR', path: `${path}.operator`, message: `Operator is not supported for ${field.type} field` }); return; }
    const operator = condition.operator as AudienceScalarOperatorV1;
    if (operator === 'IS_NULL' || operator === 'IS_NOT_NULL') { if ('value' in condition) errors.push({ code: 'UNSUPPORTED_NULL_TEST', path, message: 'Null tests do not accept a value' }); return; }
    if (!('value' in condition) || condition.value === null || condition.value === undefined) { errors.push({ code: 'INVALID_SCALAR_TYPE', path: `${path}.value`, message: 'A value is required and null must use an explicit null test' }); return; }
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    if ((operator === 'IN' || operator === 'NOT_IN') && (values.length === 0 || values.length > MAX_IN_VALUES)) { errors.push({ code: values.length > MAX_IN_VALUES ? 'EXCESSIVE_CONDITIONS' : 'INVALID_SCALAR_TYPE', path: `${path}.value`, message: `IN values must contain 1..${MAX_IN_VALUES} items` }); return; }
    if (operator === 'BETWEEN' && (values.length !== 2 || Array.isArray(condition.value) === false)) { errors.push({ code: 'INVALID_BETWEEN', path: `${path}.value`, message: 'BETWEEN requires exactly two ordered bounds' }); return; }
    if (!['IN', 'NOT_IN', 'BETWEEN'].includes(operator) && Array.isArray(condition.value)) { errors.push({ code: 'INVALID_SCALAR_TYPE', path: `${path}.value`, message: `${operator} accepts one scalar value` }); return; }
    for (const value of values) if (!validValue(value, field.type)) errors.push({ code: 'INVALID_SCALAR_TYPE', path: `${path}.value`, message: `Value does not match ${field.type}` });
    if (operator === 'BETWEEN' && values.length === 2 && validValue(values[0], field.type) && validValue(values[1], field.type) && compareValues(values[0], values[1], field.type) > 0) errors.push({ code: 'INVALID_BETWEEN', path: `${path}.value`, message: 'BETWEEN lower bound must not exceed upper bound' });
  }

  function validateAffinity(condition: Record<string, unknown>, path: string): void {
    if (condition.axis !== 'PRODUCT_FAMILY' && condition.axis !== 'DISCIPLINE' && condition.axis !== 'USE_CONTEXT') errors.push({ code: 'INVALID_AFFINITY_AXIS', path: `${path}.axis`, message: 'Affinity axis is not supported' });
    if (typeof condition.code !== 'string' || condition.code.trim().length === 0 || condition.code.trim().length > 191) errors.push({ code: 'INVALID_AFFINITY_QUALIFIER', path: `${path}.code`, message: 'Affinity code must be a bounded, non-empty opaque string' });
    for (const [name, min] of [['minScore', condition.minScore], ['minSupportingSpend', condition.minSupportingSpend], ['minExplicitEvidenceCoverage', condition.minExplicitEvidenceCoverage]] as const) {
      if (min !== undefined) { try { const n = Number(normalizeAudienceDecimal(min as string)); if (!Number.isFinite(n) || n < 0 || n > 1 && name !== 'minSupportingSpend') throw new Error(); } catch { errors.push({ code: 'INVALID_AFFINITY_QUALIFIER', path: `${path}.${name}`, message: 'Qualifier must be a non-negative bounded decimal' }); } }
    }
    for (const name of ['minSupportingOrderCount', 'minSupportingProductCount'] as const) if (condition[name] !== undefined && (!Number.isSafeInteger(condition[name]) || (condition[name] as number) < 0)) errors.push({ code: 'INVALID_AFFINITY_QUALIFIER', path: `${path}.${name}`, message: 'Qualifier must be a non-negative safe integer' });
    if (condition.lastEvidenceAt !== undefined && (!isObject(condition.lastEvidenceAt) || !['EQ', 'GT', 'GTE', 'LT', 'LTE'].includes(String(condition.lastEvidenceAt.operator)) || typeof condition.lastEvidenceAt.value !== 'string' || Number.isNaN(Date.parse(condition.lastEvidenceAt.value)))) errors.push({ code: 'INVALID_AFFINITY_QUALIFIER', path: `${path}.lastEvidenceAt`, message: 'lastEvidenceAt must be an absolute timestamp and comparison operator' });
  }
}

function validValue(value: unknown, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'decimal') { try { return typeof value === 'string' || typeof value === 'number' ? /^-?\d+(?:\.\d+)?$/u.test(normalizeAudienceDecimal(value)) : false; } catch { return false; } }
  if (type === 'string') return typeof value === 'string';
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.endsWith('Z');
}
function compareValues(a: unknown, b: unknown, type: string): number { if (type === 'datetime') return Date.parse(String(a)) - Date.parse(String(b)); if (type === 'integer') return Number(a) - Number(b); return normalizeAudienceDecimal(a as string).localeCompare(normalizeAudienceDecimal(b as string), 'en', { numeric: true }); }
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
