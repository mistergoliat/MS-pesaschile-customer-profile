import { percentage } from './decimal.js';

export type IdentityCoverageInput = {
  readonly canonicalLinkedMasters: number;
  readonly mastersWithoutPrestashopLink: number;
  readonly prestashopCustomersWithValidOrders: number;
  readonly prestashopCustomersWithValidOrdersLinkedCanonically: number;
  readonly validOrders: number;
  readonly validOrdersLinkedCanonically: number;
  readonly validGrossMonetaryTaxIncl: string;
  readonly validGrossMonetaryTaxInclLinkedCanonically: string;
  readonly duplicatePrestashopLinks: number;
  readonly guestOrZeroCustomerOrders: number;
};

export function summarizeIdentityCoverage(input: IdentityCoverageInput): Record<string, unknown> {
  return {
    canonicalLinkedMasters: input.canonicalLinkedMasters,
    mastersWithoutPrestashopLink: input.mastersWithoutPrestashopLink,
    duplicatePrestashopLinks: input.duplicatePrestashopLinks,
    prestashopCustomersWithValidOrders: input.prestashopCustomersWithValidOrders,
    prestashopCustomersWithValidOrdersLinkedCanonically: input.prestashopCustomersWithValidOrdersLinkedCanonically,
    guestOrZeroCustomerOrders: input.guestOrZeroCustomerOrders,
    coverage: {
      customers: percentage(
        input.prestashopCustomersWithValidOrdersLinkedCanonically,
        input.prestashopCustomersWithValidOrders,
      ),
      orders: percentage(input.validOrdersLinkedCanonically, input.validOrders),
      spentTaxIncl: 'computed_from_decimal_outputs',
    },
    canonicalIdentityDecision:
      'T10 v1 uses only masterCustomerId records with exactly one confirmed prestashop_customer_id; unconsolidated PrestaShop history is excluded and reported as coverage pending.',
  };
}
