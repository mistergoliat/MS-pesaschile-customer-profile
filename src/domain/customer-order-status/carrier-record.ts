// Mirrors <prefix>carrier LEFT JOINed with <prefix>carrier_lang for a single
// (id_lang, id_shop) pair. `name` comes from ps_carrier itself (not translated);
// `delay` comes from ps_carrier_lang and is null when no row matches the configured
// language/shop — that is a valid outcome, not an error. Neither field is ever
// inspected to decide deliveryMethod — see resolveDeliveryMethod. See CP-R1-T06.
export type CarrierRecord = {
  readonly carrierId: number;
  readonly referenceId: number;
  readonly name: string;
  readonly delay: string | null;
};
