import type { CategoryNode, HierarchyAudit } from './types.js';

export function auditCategoryHierarchy(nodes: readonly CategoryNode[]): HierarchyAudit {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<number, CategoryNode[]>();
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const rootCategoryIds = nodes.filter((node) => node.parentId === 0 || node.parentId === node.id).map((node) => node.id);
  const orphanCategoryIds = nodes
    .filter((node) => node.parentId !== 0 && node.parentId !== node.id && !byId.has(node.parentId))
    .map((node) => node.id);
  const cycleCategoryIds = findCycleCategoryIds(nodes, byId);
  const maxDepth = Math.max(0, ...nodes.map((node) => walkDepth(node, byId)));

  const branches = nodes
    .map((node) => ({
      categoryId: node.id,
      categoryName: node.name,
      directChildren: childrenByParent.get(node.id)?.length ?? 0,
    }))
    .filter((branch) => branch.directChildren > 0)
    .sort((a, b) => b.directChildren - a.directChildren || a.categoryId - b.categoryId)
    .slice(0, 25);

  return {
    rootCategoryIds,
    orphanCategoryIds,
    cycleCategoryIds,
    maxDepth,
    branches,
  };
}

function walkDepth(node: CategoryNode, byId: ReadonlyMap<number, CategoryNode>): number {
  const seen = new Set<number>();
  let depth = 0;
  let current: CategoryNode | undefined = node;
  while (current && current.parentId !== 0 && current.parentId !== current.id && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

function findCycleCategoryIds(nodes: readonly CategoryNode[], byId: ReadonlyMap<number, CategoryNode>): number[] {
  const cycleIds = new Set<number>();
  for (const start of nodes) {
    const path = new Set<number>();
    let current: CategoryNode | undefined = start;
    while (current && current.parentId !== 0 && current.parentId !== current.id) {
      if (path.has(current.id)) {
        for (const id of path) cycleIds.add(id);
        break;
      }
      path.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return Array.from(cycleIds).sort((a, b) => a - b);
}

