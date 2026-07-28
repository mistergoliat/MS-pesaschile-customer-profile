import type { ClassificationConfidence, ClassificationProposal, StateVolumeInput } from './types.js';

// Proposes (does not implement) an operational-stage candidate for a single
// ps_order_state row, per CP-R1-T06A section 14. Decision inputs are exclusively
// `flags` and `orderCount`/`totalOrders` — `name` is recorded only in `weakSignals`,
// never in `evidence`, and is never branched on. This mirrors the task's explicit
// rule: "No usar keywords como única evidencia" / "las observaciones por nombre deben
// quedar marcadas como señal débil, no como regla."
//
// PrestaShop's own ps_order_state has no native boolean for "cancelled" or "refunded"
// (those are conventionally specific state ids in a stock install, e.g. 6/7, but that
// is a per-install configuration fact, not a flag this function can read) — so this
// function never emits `cancelled` or `refunded`. That gap is intentional and is
// surfaced as an open decision in the audit report rather than guessed here.
export function proposeClassification(input: StateVolumeInput): ClassificationProposal {
  const { stateId, name, flags, orderCount, totalOrders } = input;
  const weakSignals: string[] = [
    name
      ? `name="${name}" is descriptive content only — not used as classification evidence`
      : 'no localized name available for the configured language',
  ];

  if (!flags) {
    return {
      stateId,
      candidateStage: 'unknown',
      confidence: 'low',
      evidence: ['no order_state row found for this stateId — cannot evaluate technical flags'],
      weakSignals,
      manualReviewRequired: true,
    };
  }

  const orderShare = totalOrders > 0 ? orderCount / totalOrders : 0;
  const evidence: string[] = [
    `orderCount=${orderCount} (${(orderShare * 100).toFixed(2)}% of ${totalOrders} orders)`,
    `flags: paid=${flags.paid} shipped=${flags.shipped} delivery=${flags.delivery} hidden=${flags.hidden} deleted=${flags.deleted} logable=${flags.logable}`,
  ];

  // Deleted/hidden-but-used/non-logable states are excluded from the live operational
  // pool regardless of their other flags — see section 10 "inconsistencias potenciales".
  if (flags.deleted) {
    return withLowConfidenceException(stateId, [...evidence, 'flags.deleted = true'], weakSignals);
  }
  if (flags.hidden && orderCount > 0) {
    return withLowConfidenceException(
      stateId,
      [...evidence, 'flags.hidden = true but orderCount > 0 — state is hidden yet actually in use'],
      weakSignals,
    );
  }
  if (!flags.logable) {
    return withLowConfidenceException(
      stateId,
      [...evidence, 'flags.logable = false — typically a transient/technical state, not a stable commercial stage'],
      weakSignals,
    );
  }

  if (flags.delivery) {
    const confidence: ClassificationConfidence = flags.shipped ? 'high' : 'medium';
    const deliveryEvidence = flags.shipped
      ? evidence
      : [...evidence, 'flags.delivery = true but flags.shipped = false — inconsistent, lowers confidence'];
    return {
      stateId,
      candidateStage: 'delivered',
      confidence,
      evidence: deliveryEvidence,
      weakSignals,
      manualReviewRequired: confidence !== 'high',
    };
  }

  if (flags.shipped) {
    return {
      stateId,
      candidateStage: 'dispatched',
      confidence: 'high',
      evidence,
      weakSignals,
      manualReviewRequired: false,
    };
  }

  if (flags.paid) {
    return {
      stateId,
      candidateStage: 'payment_confirmed',
      confidence: 'medium',
      evidence: [
        ...evidence,
        'flags.paid = true, not shipped, not delivered — flags alone cannot distinguish preparing/packed/ready_for_dispatch',
      ],
      weakSignals,
      manualReviewRequired: true,
    };
  }

  return {
    stateId,
    candidateStage: 'unknown',
    confidence: 'low',
    evidence: [...evidence, 'no positive flag (paid/shipped/delivery) set — cannot be classified from technical flags alone'],
    weakSignals,
    manualReviewRequired: true,
  };
}

function withLowConfidenceException(
  stateId: number,
  evidence: readonly string[],
  weakSignals: readonly string[],
): ClassificationProposal {
  return {
    stateId,
    candidateStage: 'exception',
    confidence: 'low',
    evidence,
    weakSignals,
    manualReviewRequired: true,
  };
}

export type StateInconsistency = {
  readonly label: string;
  // 'weak_signal': derived from the localized name — informational only, matches the
  // one name-based check CP-R1-T06A section 10 explicitly allows ("nombre sugiere
  // entrega pero delivery = 0"), always marked non-authoritative.
  // 'flag_evidence': derived purely from technical flags and/or volume — real evidence,
  // not a guess.
  readonly kind: 'weak_signal' | 'flag_evidence';
};

const HIGH_VOLUME_SHARE_THRESHOLD = 0.01; // 1% of all orders — disclosed, not a magic number.
const DELIVERY_NAME_HINT = /entreg/i;

// Section 10 "Cruce con flags técnicos": surfaces potential inconsistencies for manual
// review. This never changes proposeClassification()'s output — it is a separate,
// explicitly-sanctioned QA pass, not a classification decision.
export function detectStateInconsistencies(input: StateVolumeInput): StateInconsistency[] {
  const { name, flags, orderCount, totalOrders } = input;
  if (!flags) return [];

  const findings: StateInconsistency[] = [];
  const orderShare = totalOrders > 0 ? orderCount / totalOrders : 0;

  if (name && DELIVERY_NAME_HINT.test(name) && !flags.delivery) {
    findings.push({ label: 'name suggests delivery but flags.delivery = false', kind: 'weak_signal' });
  }
  if (flags.shipped && !flags.delivery) {
    findings.push({ label: 'flags.shipped = true but flags.delivery = false', kind: 'flag_evidence' });
  }
  if (!flags.paid && orderCount > 0) {
    findings.push({
      label:
        'flags.paid = false on a state actually used by orders — PrestaShop\'s own "paid" flag does not align with the PesasChile business rule that every ps_orders row counts as paid (see CP-R1-T04/T05)',
      kind: 'flag_evidence',
    });
  }
  if (flags.deleted && orderCount > 0) {
    findings.push({ label: 'flags.deleted = true but the state is currently used by orders', kind: 'flag_evidence' });
  }
  if (!name && orderCount > 0) {
    findings.push({
      label: 'state is used by orders but has no translation for the operative language',
      kind: 'flag_evidence',
    });
  }
  if (flags.hidden && orderShare >= HIGH_VOLUME_SHARE_THRESHOLD) {
    findings.push({
      label: `flags.hidden = true but orderCount is ${(orderShare * 100).toFixed(2)}% of all orders (not negligible)`,
      kind: 'flag_evidence',
    });
  }

  return findings;
}
