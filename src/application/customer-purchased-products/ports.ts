export type PurchasedProductRecord = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly totalQuantityPurchased: number;
  readonly orderCount: number;
  readonly firstPurchasedAt: Date;
  readonly lastPurchasedAt: Date;
  readonly totalSpentTaxIncl: string;
  readonly catalogStatus: 'linked' | 'deleted_or_unavailable';
};

export type PurchasedProductsQuery = {
  readonly prestashopCustomerId: number;
  readonly limit: number;
  readonly offset: number;
};

export type PurchasedProductsPageRecord = {
  readonly products: readonly PurchasedProductRecord[];
  readonly hasMore: boolean;
};

export interface PurchasedProductsReader {
  findByCustomerId(query: PurchasedProductsQuery): Promise<PurchasedProductsPageRecord>;
}
