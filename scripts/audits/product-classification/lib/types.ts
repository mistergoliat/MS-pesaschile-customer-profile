export type CountAndSpend = {
  readonly lines: number;
  readonly units: number;
  readonly spentTaxIncl: string;
  readonly products: number;
  readonly orders?: number;
  readonly customers?: number;
};

export type CoverageBreakdown = {
  readonly classified: CountAndSpend;
  readonly unclassified: CountAndSpend;
  readonly totals: CountAndSpend;
  readonly percentages: {
    readonly lines: number;
    readonly units: number;
    readonly spentTaxIncl: number;
    readonly products: number;
    readonly orders: number | null;
    readonly customers: number | null;
  };
};

export type HistogramBucket = {
  readonly value: number;
  readonly count: number;
};

export type PercentileSummary = {
  readonly average: number;
  readonly median: number;
  readonly p90: number;
  readonly p95: number;
  readonly max: number;
};

export type CategoryNode = {
  readonly id: number;
  readonly parentId: number;
  readonly name: string | null;
  readonly active: boolean;
  readonly levelDepth: number | null;
};

export type HierarchyAudit = {
  readonly rootCategoryIds: readonly number[];
  readonly orphanCategoryIds: readonly number[];
  readonly cycleCategoryIds: readonly number[];
  readonly maxDepth: number;
  readonly branches: readonly {
    readonly categoryId: number;
    readonly categoryName: string | null;
    readonly directChildren: number;
  }[];
};

export type ContractFieldDoc = {
  readonly field: string;
  readonly type: string;
  readonly source: string;
  readonly filter: string;
  readonly formula: string;
  readonly nullability: string;
  readonly precision: string;
  readonly limitations: string;
};

