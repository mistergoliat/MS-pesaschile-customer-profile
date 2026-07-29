export type CustomerCommercialSummary = {
  readonly totalOrders: number;
  readonly totalSpentTaxIncl: string;
  readonly averageOrderValueTaxIncl: string;
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly daysSinceLastOrder: number | null;
  readonly purchaseFrequencyDays: number | null;
  readonly totalUnitsPurchased: number;
  readonly distinctProductsPurchased: number;
  readonly cancelledOrderCount: number;
  readonly refundedOrderCount: number;
  readonly currencyIsoCode: 'CLP';
};

export type GetCustomerCommercialSummaryInput = {
  readonly masterCustomerId: string;
};

export type GetCustomerCommercialSummaryDegradedReason = 'prestashop_unavailable' | 'prestashop_timeout';

export type GetCustomerCommercialSummaryResult =
  | {
      readonly status: 'available';
      readonly summary: CustomerCommercialSummary;
    }
  | {
      readonly status: 'customer_not_found' | 'customer_not_linked';
    }
  | {
      readonly status: 'degraded';
      readonly reason: GetCustomerCommercialSummaryDegradedReason;
    };
