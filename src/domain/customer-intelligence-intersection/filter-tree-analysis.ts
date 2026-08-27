import type { NormalizedFilterNode } from '../customer-intelligence-query/validator.js';
import type { IntersectionRequiredDimension } from './contracts.js';

// task Section 7: derive dimension-aware coverage requirements deterministically from the
// validated plan's own registered field sources - never phrase-match the user's raw filter
// JSON. Walks the already-normalized filter tree (every leaf already carries its resolved
// RegisteredField, including `source`), so an unknown/malicious field can never influence this
// (it would already have failed validation before this function is ever called).
export function collectRequiredDimensions(filters: NormalizedFilterNode | null): readonly IntersectionRequiredDimension[] {
  const sources = new Set<IntersectionRequiredDimension>();
  addSources(filters, sources);
  // Fixed, deterministic order (task Section 7's own example order: RFM before cluster) - never
  // dependent on filter tree traversal order or object key order.
  const ordered: IntersectionRequiredDimension[] = [];
  if (sources.has('rfm')) ordered.push('rfm');
  if (sources.has('cluster')) ordered.push('cluster');
  return ordered;
}

function addSources(node: NormalizedFilterNode | null, sources: Set<IntersectionRequiredDimension>): void {
  if (node === null) return;
  if (node.kind === 'condition') {
    if (node.fieldMeta.source === 'rfm' || node.fieldMeta.source === 'cluster') {
      sources.add(node.fieldMeta.source);
    }
    return;
  }
  for (const child of node.children) addSources(child, sources);
}

export type FilterTreeStats = {
  readonly leafCount: number;
  readonly depth: number;
};

// task Section 19: safe structural diagnostics for latency logging (filterLeafCount/filterDepth)
// - counts, never the filter's actual field names or values. Purely a byproduct of the tree
// T03's own validator already normalized (never a second traversal rule set) - not a security
// boundary, since MAX_FILTER_LEAVES/MAX_FILTER_DEPTH are already enforced by the validator
// itself before this ever runs.
export function filterTreeStats(filters: NormalizedFilterNode | null): FilterTreeStats {
  if (filters === null) return { leafCount: 0, depth: 0 };
  return walk(filters, 1);
}

function walk(node: NormalizedFilterNode, depth: number): FilterTreeStats {
  if (node.kind === 'condition') return { leafCount: 1, depth };
  let leafCount = 0;
  let maxDepth = depth;
  for (const child of node.children) {
    const childStats = walk(child, depth + 1);
    leafCount += childStats.leafCount;
    maxDepth = Math.max(maxDepth, childStats.depth);
  }
  return { leafCount, depth: maxDepth };
}
