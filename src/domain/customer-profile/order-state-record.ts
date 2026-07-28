// Mirrors <prefix>order_state joined with <prefix>order_state_lang for a single
// configured language (PRESTASHOP_ORDER_STATE_LANG_ID) — read only by id_order_state,
// never by name. See CP-R1-T05.
//
// This is the internal read model: just enough to translate a raw currentStateId into
// a localized label. It does not classify the state — no semanticStage, isDelivered,
// isCancelled, isFinal, isPaid, customerMessage or recommendedAction. Those require an
// explicit business policy that does not exist yet (candidate for a future task).
export type OrderStateRecord = {
  readonly stateId: number;
  readonly name: string;
};
