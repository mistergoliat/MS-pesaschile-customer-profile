// Canonical seller-service product classification for RFM Monetary.
//
// Reuses the exact product id set already validated across the analytical audits
// (CP-R1-T11A3.2 order-monetary-composition, CP-R1-T11A3.3 canonical analytical order):
// product 444 (reference 'SVPC') is the confirmed seller-service marker line. This module
// is the single source of truth for that list so the productive reader, the audit scripts
// and their tests never diverge on which product ids count as seller service.
export const sellerServiceExclusionPolicyVersion = 'seller-service-exclusion-v1';

export const defaultConfirmedSellerServiceProductIds: readonly number[] = [444];
