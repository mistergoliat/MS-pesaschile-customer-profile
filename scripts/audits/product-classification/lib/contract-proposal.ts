import type { ContractFieldDoc } from './types.js';

export function buildObservedPreferencesContractDocs(): readonly ContractFieldDoc[] {
  return [
    field('topCategories', 'readonly ProductCategoryPreference[]', 'category aggregate rows resolved through the selected category authority', 'valid orders only', 'top N categories ordered by gross spend, then quantity, then categoryId', 'empty array when no category is classifiable', 'money strings inside each item use 6 decimals; spendShare is a bounded number percent', 'category names are current catalog labels, not historical labels'),
    field('topBrands', 'readonly ProductBrandPreference[]', 'manufacturer aggregate rows resolved through ps_product.id_manufacturer -> ps_manufacturer', 'valid orders only', 'top N brands ordered by gross spend, then quantity, then manufacturerId', 'empty array when no brand is classifiable', 'money strings inside each item use 6 decimals; spendShare is a bounded number percent', 'manufacturer names are current catalog labels'),
    field('classifiedCategorySpentTaxIncl', 'string', 'SUM(ps_order_detail.total_price_tax_incl) for lines with resolvable category', 'valid orders only', 'gross classified category spend', 'never null', '6-decimal decimal string', 'does not include shipping or order-level adjustments'),
    field('unclassifiedCategorySpentTaxIncl', 'string', 'SUM(ps_order_detail.total_price_tax_incl) for deleted/missing/no-category lines', 'valid orders only', 'gross unclassified category spend', 'never null', '6-decimal decimal string', 'kept separate from top categories so spendShare denominator is explicit'),
    field('classifiedBrandSpentTaxIncl', 'string', 'SUM(ps_order_detail.total_price_tax_incl) for lines with resolvable manufacturer', 'valid orders only', 'gross classified brand spend', 'never null', '6-decimal decimal string', 'brand coverage depends on current catalog enrichment'),
    field('unclassifiedBrandSpentTaxIncl', 'string', 'SUM(ps_order_detail.total_price_tax_incl) for lines without resolvable manufacturer', 'valid orders only', 'gross unclassified brand spend', 'never null', '6-decimal decimal string', 'includes deleted products and id_manufacturer = 0'),
    field('categoryDiversity', 'number', 'count of distinct classified categories for the customer', 'valid orders only', 'COUNT(DISTINCT categoryId)', '0 when none are classifiable', 'safe integer', 'raw diversity unless a curated commercial taxonomy is introduced'),
    field('brandDiversity', 'number', 'count of distinct classified manufacturers for the customer', 'valid orders only', 'COUNT(DISTINCT manufacturerId)', '0 when none are classifiable', 'safe integer', 'manufacturer duplicates by spelling can inflate this'),
    field('dominantCategoryId', 'number | null', 'topCategories[0].categoryId', 'valid orders only', 'highest gross spend category after ordering tie-breaks', 'null when topCategories is empty', 'safe integer', 'not a preferredProductType; only observed purchase evidence'),
    field('dominantManufacturerId', 'number | null', 'topBrands[0].manufacturerId', 'valid orders only', 'highest gross spend manufacturer after ordering tie-breaks', 'null when topBrands is empty', 'safe integer', 'not an affinity score; only observed purchase evidence'),
    field('calculatedAt', 'string', 'injected Clock in the future T09 use case', 'not SQL-derived', 'current clock instant when runtime read model is calculated', 'never null', 'ISO UTC', 'runtime metadata, not a snapshot timestamp'),
  ];
}

function field(
  fieldName: string,
  type: string,
  source: string,
  filter: string,
  formula: string,
  nullability: string,
  precision: string,
  limitations: string,
): ContractFieldDoc {
  return { field: fieldName, type, source, filter, formula, nullability, precision, limitations };
}

