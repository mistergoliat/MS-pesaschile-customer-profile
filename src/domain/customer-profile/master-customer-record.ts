// Mirrors main_management.master_customer (see docs/audits/CP-R1-T01-schema-inventory.md).
// id is bigint(20) unsigned; kept as string end-to-end — matching the public
// masterCustomerId contract — instead of a JS number, since a bigint can exceed
// Number.MAX_SAFE_INTEGER. firstname/lastname/email/platformOrigin are NOT NULL in the
// audited schema; only rut is nullable there, so this is not a defensive `| null` guess.
export type MasterCustomerRecord = {
  readonly id: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly email: string;
  readonly platformOrigin: string;
  readonly rut: string | null;
  readonly prestashopCustomerId: number | null;
};
