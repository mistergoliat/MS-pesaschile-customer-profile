# CP-R1-T09A Category Hierarchy

## Facts

- Hierarchy is reconstructed from `ps_category.id_parent`.
- The audit reports roots, orphans, cycles, branches and maximum depth in `category-hierarchy.json`.
- Category names are localized through `ps_category_lang` using the configured catalog language.
- Observed hierarchy has root category 1, no orphan categories, no cycles and maximum depth 5.
- The top classified default category is categoryId 2, `CATEGORÍAS`, level depth 1, parentId 1.

## Interpretations

- Default categories at mixed depths can reduce clustering quality.
- Root and home-style categories are navigational, not commercial preferences.
- categoryId 2 is too broad to represent a purchase family.

## Recommendations

- Preserve raw default category as evidence for T09 runtime.
- Add `commercialFamilyId` only through a curated taxonomy in a later task.
- Do not use categoryId 2 as the main clustering feature.

## Decisions

1. Raw default category is retained as evidence.
2. Hierarchy-derived commercial families are not implemented in T09A.
3. A curated commercial taxonomy is mandatory before clustering.
4. Future clustering features include `rawCategoryId` and `commercialFamilyId`.
5. `preferredProductType` remains outside T09.

## Follow-up

- Define the commercial hierarchy level and mapping rules in the taxonomy task.
- Version the mapping so clustering results can be reproduced.
