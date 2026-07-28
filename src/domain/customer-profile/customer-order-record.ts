// Mirrors <prefix>orders, read only by id_customer — never used to search by email,
// name, rut, address, phone or id_guest. See CP-R1-T04.
//
// PesasChile business rule (confirmed, not reinterpreted here): any row persisted in
// ps_orders is a paid order. current_state and valid are captured as raw operational
// facts only — this record does not classify or interpret them. Order-state
// interpretation (e.g. "preparando" / "en despacho" / "entregada") is out of scope for
// this task and belongs to a future one (CP-R1-T05).
//
// id_order and id_customer are `int(10) unsigned` in the real ps_orders schema — safely
// below Number.MAX_SAFE_INTEGER — so they stay `number`, unlike master_customer.id
// (bigint). Monetary fields stay `string`: mysql2 returns DECIMAL columns as strings by
// default (no decimalNumbers option set on the PrestaShop pool), which is exactly what
// preserves precision here — never coerce them to `number`.
export type CustomerOrderRecord = {
  readonly orderId: number;
  readonly reference: string;
  readonly customerId: number;
  readonly currentStateId: number;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};
