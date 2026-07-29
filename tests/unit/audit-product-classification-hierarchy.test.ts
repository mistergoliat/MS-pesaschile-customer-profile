import { describe, expect, it } from 'vitest';
import { auditCategoryHierarchy } from '../../scripts/audits/product-classification/lib/hierarchy.js';

describe('auditCategoryHierarchy', () => {
  it('detects roots, branches and maximum depth', () => {
    const result = auditCategoryHierarchy([
      { id: 1, parentId: 0, name: 'Root', active: true, levelDepth: 0 },
      { id: 2, parentId: 1, name: 'Training', active: true, levelDepth: 1 },
      { id: 3, parentId: 2, name: 'Bars', active: true, levelDepth: 2 },
    ]);

    expect(result.rootCategoryIds).toEqual([1]);
    expect(result.maxDepth).toBe(2);
    expect(result.branches[0]).toEqual({ categoryId: 1, categoryName: 'Root', directChildren: 1 });
  });

  it('detects orphan categories', () => {
    const result = auditCategoryHierarchy([{ id: 9, parentId: 99, name: 'Orphan', active: true, levelDepth: 2 }]);

    expect(result.orphanCategoryIds).toEqual([9]);
  });

  it('detects cycles without infinite traversal', () => {
    const result = auditCategoryHierarchy([
      { id: 10, parentId: 11, name: 'A', active: true, levelDepth: 2 },
      { id: 11, parentId: 10, name: 'B', active: true, levelDepth: 2 },
    ]);

    expect(result.cycleCategoryIds).toEqual([10, 11]);
  });
});

