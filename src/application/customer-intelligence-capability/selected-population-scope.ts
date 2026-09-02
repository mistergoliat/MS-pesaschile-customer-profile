import type { AnalyticalFilterInput, AnalyticalFilterNode } from '../../domain/customer-intelligence-query/index.js';

// This is an application-owned correctness rule. It intentionally has no Copilot, provider or
// HTTP dependency so every brain must receive the same selected-population semantics.
export function composeSelectedPopulationScope(
  stepFilters: AnalyticalFilterInput | undefined,
  selectedPopulationFilters: AnalyticalFilterInput | null | undefined,
): AnalyticalFilterInput | undefined {
  if (selectedPopulationFilters === null || selectedPopulationFilters === undefined) return stepFilters;
  const stepFields = collectFilterFieldNames(stepFilters ?? null);
  const scopeNodes = toScopeNodes(selectedPopulationFilters).filter((node) => {
    const nodeFields = collectFilterFieldNames(node);
    return ![...nodeFields].some((field) => stepFields.has(field));
  });
  if (scopeNodes.length === 0) return stepFilters;
  return { and: [...toNodeArray(stepFilters ?? null), ...scopeNodes] };
}

export function collectFilterFieldNames(filters: AnalyticalFilterInput | null): ReadonlySet<string> {
  const fields = new Set<string>();
  for (const node of toNodeArray(filters)) walkFieldNames(node, fields);
  return fields;
}

function toScopeNodes(filters: AnalyticalFilterInput): readonly AnalyticalFilterNode[] {
  if (Array.isArray(filters)) return filters as readonly AnalyticalFilterNode[];
  if ('and' in filters) return filters.and;
  return [filters as AnalyticalFilterNode];
}

function toNodeArray(filters: AnalyticalFilterInput | null): readonly AnalyticalFilterNode[] {
  if (filters === null) return [];
  return Array.isArray(filters) ? filters as readonly AnalyticalFilterNode[] : [filters as AnalyticalFilterNode];
}

function walkFieldNames(node: AnalyticalFilterNode, fields: Set<string>): void {
  if ('field' in node) {
    fields.add(node.field);
    return;
  }
  for (const child of 'and' in node ? node.and : node.or) walkFieldNames(child, fields);
}
