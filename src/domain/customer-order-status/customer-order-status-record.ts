// Mirrors <prefix>orders scoped to a single (id_customer, reference) pair — a distinct
// read model from CustomerOrderRecord (T04): no monetary fields, no `valid`, adds
// carrierId. updatedAt is parsed into a Date by the adapter (unlike CustomerOrderRecord,
// which keeps date_upd as the raw PrestaShop string) because the only consumer here
// needs an ISO-8601 instant (CustomerOrderStatus.lastRecordedUpdateAt), not the raw
// PrestaShop format. See CP-R1-T06.
export type CustomerOrderStatusRecord = {
  readonly orderId: number;
  readonly reference: string;
  readonly customerId: number;
  readonly currentStateId: number;
  readonly carrierId: number;
  readonly updatedAt: Date;
};
