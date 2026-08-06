import type { CustomerDataProvenance } from '../customer-identity/index.js';

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
  readonly customerId: number;
};

export type GetCustomerCommercialSummaryDegradedReason = 'prestashop_unavailable' | 'prestashop_schema_incompatible';

export type GetCustomerCommercialSummaryResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly summary: CustomerCommercialSummary;
      readonly provenance: CustomerDataProvenance;
    }
  | {
      readonly status: 'customer_not_found';
      readonly customerId: number;
    }
  | {
      readonly status: 'degraded';
      readonly customerId: number;
      readonly reason: GetCustomerCommercialSummaryDegradedReason;
    };
