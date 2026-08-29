// RFM-named wrappers over the shared, domain-neutral decimal implementation
// (src/shared/decimal.ts) — extracted in CUSTOMER-INTELLIGENCE-R2-A01.2.1 once Customer
// Commercial Affinity needed the same generic decimal arithmetic without depending on the RFM
// domain for it (task Section 14/15). Behavior, precision, and rounding are byte-for-byte
// unchanged from before extraction: every RFM call site keeps importing these exact names from
// this exact path, unaffected by the internal move.
export {
  formatDecimal as formatRfmDecimal,
  addDecimals as addRfmDecimals,
  divideDecimal as divideRfmDecimal,
  compareDecimalAsc as compareRfmDecimalAsc,
} from '../../shared/decimal.js';
