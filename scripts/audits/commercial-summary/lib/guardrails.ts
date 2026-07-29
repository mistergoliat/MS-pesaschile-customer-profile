// CP-R1-T07A section 3: "Reutilizar los guardrails read-only de T06A" — re-exported
// verbatim, never re-implemented, so there is exactly one tested definition of
// assessGrants/evaluateLoad in this repo. See
// scripts/audits/order-state-semantics/lib/guardrails.ts for the implementation and
// tests/unit/audit-order-state-guardrails.test.ts for its existing coverage.
export { assessGrants, evaluateLoad } from '../../order-state-semantics/lib/guardrails.js';
