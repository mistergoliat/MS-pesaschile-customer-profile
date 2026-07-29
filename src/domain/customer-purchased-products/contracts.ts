export type PurchasedProduct = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly totalQuantityPurchased: number;
  readonly orderCount: number;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly totalSpentTaxIncl: string;
  readonly catalogStatus: 'linked' | 'deleted_or_unavailable';
};

export type PurchasedProductsPagination = {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly hasMore: boolean;
};

export type GetPurchasedProductsInput = {
  readonly masterCustomerId: string;
  readonly limit: number;
  readonly offset: number;
};

export type GetPurchasedProductsDegradedReason = 'prestashop_unavailable' | 'prestashop_timeout';

export type GetPurchasedProductsResult =
  | {
      readonly status: 'available';
      readonly products: readonly PurchasedProduct[];
      readonly pagination: PurchasedProductsPagination;
    }
  | {
      readonly status: 'customer_not_found' | 'customer_not_linked';
    }
  | {
      readonly status: 'degraded';
      readonly reason: GetPurchasedProductsDegradedReason;
    };
