// Mirrors <prefix>customer, read only by id_customer — never used to search by email.
// No orders, addresses, carts or derived fields; see CP-R1-T03 for scope.
export type PrestashopCustomerRecord = {
  readonly idCustomer: number;
  readonly firstname: string;
  readonly lastname: string;
  readonly email: string;
  readonly active: boolean;
  readonly idShop: number;
  readonly dateAdd: string | null;
  readonly dateUpd: string | null;
};
