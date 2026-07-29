export type ProductBehaviorVariantRecord = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly firstPurchasedAt: Date;
  readonly lastPurchasedAt: Date;
  readonly productOrderCount: number;
  readonly productFirstPurchasedAt: Date;
  readonly productLastPurchasedAt: Date;
  readonly latestObservedProductName: string;
  readonly latestObservedProductReference: string | null;
};

export type CustomerProductBehaviorQuery = {
  readonly prestashopCustomerId: number;
};

export type CustomerProductBehaviorRecord = {
  readonly validOrderCount: number;
  readonly totalProductUnitsPurchased: number;
  readonly totalProductSpentTaxIncl: string;
  readonly variants: readonly ProductBehaviorVariantRecord[];
};

export interface CustomerProductBehaviorReader {
  findByCustomerId(query: CustomerProductBehaviorQuery): Promise<CustomerProductBehaviorRecord>;
}
