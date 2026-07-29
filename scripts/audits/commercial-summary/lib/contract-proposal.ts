import type { ContractFieldDoc } from './types.js';

// CP-R1-T07A section 11: a single, testable source of truth for the per-field
// documentation the report must include (source/filter/formula/nullability/precision/
// limitations) for the proposed (not implemented) CustomerCommercialSummary contract.
// Lives as code — not only prose in the markdown report — so a test can assert the
// proposal covers exactly the 12 fields the task specifies, no more, no fewer, and that
// every field actually has all six documentation facets filled in.
export function buildContractFieldDocs(): readonly ContractFieldDoc[] {
  return [
    {
      field: 'totalOrders',
      type: 'number',
      source: 'ps_orders',
      filter: 'valid = 1 (pending final confirmation — see order-validity report, section 4)',
      formula: 'COUNT(*) grouped by id_customer',
      nullability: 'never null; 0 is not representable here — this field only exists for a customer with >= 1 valid order',
      precision: 'integer',
      limitations: 'Counts orders, not line items; a single order with many products still counts once.',
    },
    {
      field: 'totalSpentTaxIncl',
      type: 'string',
      source: 'ps_orders.total_paid_tax_incl',
      filter: 'valid = 1',
      formula: 'SUM(total_paid_tax_incl) grouped by id_customer, formatted as a fixed-precision decimal string',
      nullability: 'never null for a customer with >= 1 valid order',
      precision: 'decimal string, 6 fractional digits (matches decimal(20,6) in ps_orders) — never a JS number',
      limitations:
        'Bruto (gross): does not subtract refunds — see refund-analysis report for whether a net figure is safe to add later. Includes shipping and reflects post-discount, post-tax amounts (see monetary-analysis report).',
    },
    {
      field: 'averageOrderValueTaxIncl',
      type: 'string',
      source: 'ps_orders.total_paid_tax_incl',
      filter: 'valid = 1',
      formula: 'SUM(total_paid_tax_incl) / COUNT(*) grouped by id_customer — not AVG() directly, for explicit control over rounding — formatted as a fixed-precision decimal string',
      nullability: 'never null for a customer with >= 1 valid order',
      precision: 'decimal string, 6 fractional digits',
      limitations: 'Same gross-vs-net caveat as totalSpentTaxIncl. Not a median — sensitive to outlier orders.',
    },
    {
      field: 'firstOrderAt',
      type: 'string | null',
      source: 'ps_orders.date_add',
      filter: 'valid = 1',
      formula: 'MIN(date_add) grouped by id_customer, ISO-8601',
      nullability: 'null only if the customer has zero valid orders (in which case no summary row exists at all)',
      precision: 'second (ps_orders.date_add is DATETIME)',
      limitations: 'None identified for this field specifically.',
    },
    {
      field: 'lastOrderAt',
      type: 'string | null',
      source: 'ps_orders.date_add',
      filter: 'valid = 1',
      formula: 'MAX(date_add) grouped by id_customer, ISO-8601',
      nullability: 'null only if the customer has zero valid orders',
      precision: 'second',
      limitations: 'None identified for this field specifically.',
    },
    {
      field: 'daysSinceLastOrder',
      type: 'number | null',
      source: 'derived from lastOrderAt',
      filter: 'n/a (derived)',
      formula: 'FLOOR((executedAt - lastOrderAt) in days)',
      nullability: 'null only when lastOrderAt is null',
      precision: 'integer days',
      limitations: 'A snapshot value: correct only at the moment the summary is computed. A cached/stale summary understates recency.',
    },
    {
      field: 'purchaseFrequencyDays',
      type: 'number | null',
      source: 'derived from ps_orders.date_add',
      filter: 'valid = 1',
      formula: 'See docs/audits/commercial-summary/CP-R1-T07A-runtime-recommendation.md for formula A vs B comparison',
      nullability: 'null when totalOrders < 2 (per CP-R1-T07A section 8 recommendation)',
      precision: 'floating-point days (fractional)',
      limitations: 'Two candidate formulas exist and are not interchangeable — see the runtime recommendation doc for which one this audit recommends and why.',
    },
    {
      field: 'totalUnitsPurchased',
      type: 'number',
      source: 'ps_order_detail.product_quantity',
      filter: 'valid = 1 orders only, all lines',
      formula: 'SUM(product_quantity) for lines belonging to the customer\'s valid orders',
      nullability: 'never null; 0 only if valid orders exist but order_detail coverage is incomplete for all of them',
      precision: 'integer',
      limitations:
        'Gross units, per the section 9 recommendation: does NOT subtract product_quantity_refunded. A net-units field is deferred to a future Product Purchase Aggregates capability unless the audit finds a safe interpretation.',
    },
    {
      field: 'distinctProductsPurchased',
      type: 'number',
      source: 'ps_order_detail.product_id',
      filter: 'valid = 1 orders only, all lines',
      formula: 'COUNT(DISTINCT product_id) for lines belonging to the customer\'s valid orders',
      nullability: 'never null',
      precision: 'integer',
      limitations: 'Counts product_id, not product+attribute combinations — two variants of the same product_id count as one distinct product.',
    },
    {
      field: 'cancelledOrderCount',
      type: 'number',
      source: 'ps_orders.current_state',
      filter: 'current_state = <cancelled state id, confirmed at audit time — see order-validity report>',
      formula: 'COUNT(*) grouped by id_customer, filtered to the cancelled state id',
      nullability: 'never null; 0 is a valid, common value',
      precision: 'integer',
      limitations: 'Depends on a single configured state id being the correct representation of "cancelled" in this PrestaShop install — see order-validity report for the confirmation performed.',
    },
    {
      field: 'refundedOrderCount',
      type: 'number',
      source: 'ps_orders.current_state',
      filter: 'current_state = <refunded state id, confirmed at audit time — see order-validity report>',
      formula: 'COUNT(*) grouped by id_customer, filtered to the refunded state id',
      nullability: 'never null; 0 is a valid, common value',
      precision: 'integer',
      limitations:
        'Counts orders whose CURRENT state is "refunded" — does not count partial refunds recorded via product_quantity_refunded/total_refunded_tax_incl on an order that is still in another current_state. See refund-analysis report.',
    },
    {
      field: 'currencyIsoCode',
      type: 'string | null',
      source: 'ps_currency.iso_code via ps_orders.id_currency',
      filter: 'valid = 1',
      formula: 'The dominant (or only) id_currency across the customer\'s valid orders, resolved to iso_code',
      nullability: 'null if the customer has zero valid orders, or if ps_currency has no matching row',
      precision: 'n/a (ISO 4217 alpha code)',
      limitations:
        'Assumes a single customer never mixes currencies (see monetary-analysis report for whether this holds in practice). No currency conversion is performed anywhere in this audit or the proposed contract.',
    },
  ];
}
