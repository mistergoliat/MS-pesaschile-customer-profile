export type CommercialOrdersSummaryRecord = {
  readonly totalOrders: number;
  readonly totalSpentTaxIncl: string;
  readonly firstOrderAt: Date | null;
  readonly lastOrderAt: Date | null;
  readonly cancelledOrderCount: number;
  readonly refundedOrderCount: number;
};

export interface CommercialOrdersSummaryReader {
  findByCustomerId(prestashopCustomerId: number): Promise<CommercialOrdersSummaryRecord>;
}

export type CommercialProductsSummaryRecord = {
  readonly totalUnitsPurchased: number;
  readonly distinctProductsPurchased: number;
};

export interface CommercialProductsSummaryReader {
  findByCustomerId(prestashopCustomerId: number): Promise<CommercialProductsSummaryRecord>;
}
