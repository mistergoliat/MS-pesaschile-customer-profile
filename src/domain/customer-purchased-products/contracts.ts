import type { CustomerDataProvenance } from '../customer-identity/index.js';

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
  readonly customerId: number;
  readonly limit: number;
  readonly offset: number;
};

export type GetPurchasedProductsDegradedReason = 'prestashop_unavailable' | 'prestashop_schema_incompatible';

export type GetPurchasedProductsResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly products: readonly PurchasedProduct[];
      readonly pagination: PurchasedProductsPagination;
      readonly provenance: CustomerDataProvenance;
    }
  | {
      readonly status: 'customer_not_found';
      readonly customerId: number;
    }
  | {
      readonly status: 'degraded';
      readonly customerId: number;
      readonly reason: GetPurchasedProductsDegradedReason;
    };
