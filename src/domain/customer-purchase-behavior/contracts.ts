export type PurchaseBehaviorConcentration = {
  readonly top1Share: string;
  readonly top3Share: string;
  readonly hhi: string;
  readonly effectiveDiversity: string;
};

export type PurchaseBehaviorSummary = {
  readonly validOrderCount: number;
  readonly distinctProductCount: number;
  readonly distinctVariantCount: number;
  readonly repeatedProductCount: number;
  readonly repeatedVariantCount: number;
  readonly repeatProductRate: string;
  readonly repeatVariantRate: string;
  readonly repeatedVariantSpendShare: string;
  readonly productSpendConcentration: PurchaseBehaviorConcentration;
  readonly variantSpendConcentration: PurchaseBehaviorConcentration;
};

export type PurchaseBehaviorVariant = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productName: string;
  readonly productReference: string | null;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly spendShare: string;
  readonly orderShare: string;
  readonly quantityShare: string;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly daysSinceLastPurchase: number;
  readonly isRepeated: boolean;
};

export type PurchaseBehaviorProduct = {
  readonly productId: number;
  readonly latestObservedProductName: string;
  readonly latestObservedProductReference: string | null;
  readonly variantCountPurchased: number;
  readonly repeatedVariantCount: number;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly totalSpentTaxIncl: string;
  readonly spendShare: string;
  readonly orderShare: string;
  readonly quantityShare: string;
  readonly firstPurchasedAt: string;
  readonly lastPurchasedAt: string;
  readonly daysSinceLastPurchase: number;
  readonly isRepeated: boolean;
};

export type GetCustomerPurchaseBehaviorInput = {
  readonly masterCustomerId: string;
  readonly topProducts: number;
  readonly topVariants: number;
};

export type GetCustomerPurchaseBehaviorDegradedReason = 'prestashop_timeout' | 'prestashop_unavailable';

export type GetCustomerPurchaseBehaviorResult =
  | {
      readonly status: 'available';
      readonly currencyIsoCode: 'CLP';
      readonly calculatedAt: string;
      readonly summary: PurchaseBehaviorSummary;
      readonly topProducts: readonly PurchaseBehaviorProduct[];
      readonly topVariants: readonly PurchaseBehaviorVariant[];
    }
  | {
      readonly status: 'customer_not_found' | 'customer_not_linked';
    }
  | {
      readonly status: 'degraded';
      readonly reason: GetCustomerPurchaseBehaviorDegradedReason;
    };

