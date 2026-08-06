// Explicit, evidence-backed exclusion of operational/non-customer PrestaShop accounts from
// RFM. Each id was confirmed by direct reconciliation against pesas_productiva (not a name,
// email, frequency or Monetary heuristic — see docs/releases/CP-R1-T11A4-approved-monetary-policy.md):
//
//   85980  Ventas Pesas Chile          — internal point-of-sale account, not a real customer.
//   39617  Nicolas Solar Paez          — disproportionate order volume for an individual account.
//   90890  Evento Wodstock             — one-off internal event account.
//   86421  Gimnasio Nuevo Amanecer SPA — internal/partner account, not a retail customer.
//
// A real high-value customer (id_customer = 103237, Francisco Yanez) was verified NOT to
// match this pattern and must stay in the population.
export const operationalAccountExclusionPolicyVersion = 'operational-account-exclusion-v1';

export const excludedOperationalAccountPrestashopCustomerIds: readonly number[] = [85980, 39617, 90890, 86421];
