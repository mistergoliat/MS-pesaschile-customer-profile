import { describe, expect, it } from 'vitest';
import { detectStateInconsistencies, proposeClassification } from '../../scripts/audits/order-state-semantics/lib/classification.js';
import type { OrderStateFlags } from '../../scripts/audits/order-state-semantics/lib/types.js';

function flags(overrides: Partial<OrderStateFlags> = {}): OrderStateFlags {
  return {
    invoice: false,
    sendEmail: false,
    moduleName: null,
    unremovable: false,
    hidden: false,
    logable: true,
    delivery: false,
    shipped: false,
    paid: false,
    pdfInvoice: false,
    pdfDelivery: false,
    deleted: false,
    ...overrides,
  };
}

describe('proposeClassification', () => {
  it('is unknown/low when no order_state row was found for the stateId', () => {
    const result = proposeClassification({ stateId: 999, name: null, flags: null, orderCount: 0, totalOrders: 1000 });

    expect(result).toMatchObject({ candidateStage: 'unknown', confidence: 'low', manualReviewRequired: true });
    expect(result.evidence.join(' ')).not.toContain('name=');
  });

  it('is delivered/high when both shipped and delivery are true', () => {
    const result = proposeClassification({
      stateId: 5,
      name: 'Entregado',
      flags: flags({ paid: true, shipped: true, delivery: true }),
      orderCount: 100,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'delivered', confidence: 'high', manualReviewRequired: false });
  });

  it('is delivered/medium when delivery is true but shipped is false (inconsistent)', () => {
    const result = proposeClassification({
      stateId: 6,
      name: null,
      flags: flags({ delivery: true, shipped: false }),
      orderCount: 10,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'delivered', confidence: 'medium', manualReviewRequired: true });
  });

  it('is dispatched/high when shipped is true and delivery is false', () => {
    const result = proposeClassification({
      stateId: 4,
      name: 'Enviado',
      flags: flags({ paid: true, shipped: true }),
      orderCount: 200,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'dispatched', confidence: 'high', manualReviewRequired: false });
  });

  it('is payment_confirmed/medium and requires manual review when only paid is true', () => {
    const result = proposeClassification({
      stateId: 2,
      name: 'Pago aceptado',
      flags: flags({ paid: true }),
      orderCount: 300,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'payment_confirmed', confidence: 'medium', manualReviewRequired: true });
  });

  it('is exception/low when deleted = true, regardless of other flags', () => {
    const result = proposeClassification({
      stateId: 8,
      name: 'Antiguo',
      flags: flags({ paid: true, shipped: true, delivery: true, deleted: true }),
      orderCount: 0,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'exception', confidence: 'low', manualReviewRequired: true });
  });

  it('is exception/low when hidden = true but the state is actually in use', () => {
    const result = proposeClassification({
      stateId: 9,
      name: null,
      flags: flags({ hidden: true }),
      orderCount: 50,
      totalOrders: 1000,
    });

    expect(result.candidateStage).toBe('exception');
    expect(result.evidence.some((line) => line.includes('hidden'))).toBe(true);
  });

  it('is exception/low when logable = false (transient/technical state)', () => {
    const result = proposeClassification({
      stateId: 10,
      name: null,
      flags: flags({ logable: false, paid: true }),
      orderCount: 5,
      totalOrders: 1000,
    });

    expect(result.candidateStage).toBe('exception');
  });

  it('is unknown/low when no positive flag is set at all', () => {
    const result = proposeClassification({
      stateId: 1,
      name: 'Pedido nuevo',
      flags: flags(),
      orderCount: 400,
      totalOrders: 1000,
    });

    expect(result).toMatchObject({ candidateStage: 'unknown', confidence: 'low', manualReviewRequired: true });
  });

  it('never emits cancelled or refunded as a candidate stage (no native flag for either)', () => {
    const stageValues = [
      proposeClassification({ stateId: 1, name: null, flags: flags(), orderCount: 1, totalOrders: 10 }),
      proposeClassification({ stateId: 2, name: null, flags: flags({ paid: true }), orderCount: 1, totalOrders: 10 }),
      proposeClassification({ stateId: 3, name: null, flags: flags({ shipped: true }), orderCount: 1, totalOrders: 10 }),
      proposeClassification({ stateId: 4, name: null, flags: flags({ delivery: true, shipped: true }), orderCount: 1, totalOrders: 10 }),
      proposeClassification({ stateId: 5, name: null, flags: flags({ deleted: true }), orderCount: 1, totalOrders: 10 }),
    ].map((result) => result.candidateStage);

    expect(stageValues).not.toContain('cancelled');
    expect(stageValues).not.toContain('refunded');
  });

  it('records the name only as a weak signal, never as decision evidence', () => {
    const result = proposeClassification({
      stateId: 4,
      name: 'Enviado',
      flags: flags({ shipped: true }),
      orderCount: 1,
      totalOrders: 10,
    });

    expect(result.weakSignals.some((signal) => signal.includes('Enviado'))).toBe(true);
    expect(result.evidence.some((line) => line.includes('Enviado'))).toBe(false);
  });
});

describe('detectStateInconsistencies', () => {
  it('returns nothing when the state row was not found', () => {
    expect(detectStateInconsistencies({ stateId: 1, name: null, flags: null, orderCount: 0, totalOrders: 100 })).toEqual([]);
  });

  it('flags a name that suggests delivery when flags.delivery is false, as a weak_signal only', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: 'Entregado al cliente',
      flags: flags({ shipped: true, delivery: false }),
      orderCount: 10,
      totalOrders: 100,
    });

    const weak = findings.find((f) => f.label.includes('name suggests delivery'));
    expect(weak?.kind).toBe('weak_signal');
  });

  it('flags shipped=true/delivery=false as flag_evidence', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags({ shipped: true, delivery: false }),
      orderCount: 10,
      totalOrders: 100,
    });

    expect(findings.some((f) => f.label.includes('flags.shipped = true') && f.kind === 'flag_evidence')).toBe(true);
  });

  it('flags paid=false on a used state as flag_evidence (PesasChile business rule mismatch)', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags({ paid: false }),
      orderCount: 5,
      totalOrders: 100,
    });

    expect(findings.some((f) => f.label.includes('flags.paid = false') && f.kind === 'flag_evidence')).toBe(true);
  });

  it('does not flag paid=false when the state is unused (orderCount = 0)', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags({ paid: false }),
      orderCount: 0,
      totalOrders: 100,
    });

    expect(findings.some((f) => f.label.includes('flags.paid = false'))).toBe(false);
  });

  it('flags deleted=true but used as flag_evidence', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: 'Antiguo',
      flags: flags({ deleted: true }),
      orderCount: 3,
      totalOrders: 100,
    });

    expect(findings.some((f) => f.label.includes('deleted = true') && f.kind === 'flag_evidence')).toBe(true);
  });

  it('flags a used state with no translation as flag_evidence', () => {
    const findings = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags(),
      orderCount: 7,
      totalOrders: 100,
    });

    expect(findings.some((f) => f.label.includes('no translation') && f.kind === 'flag_evidence')).toBe(true);
  });

  it('flags hidden=true only when volume is above the 1% threshold, not for negligible volume', () => {
    const negligible = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags({ hidden: true, paid: true }),
      orderCount: 1,
      totalOrders: 10000, // 0.01%
    });
    const notNegligible = detectStateInconsistencies({
      stateId: 1,
      name: null,
      flags: flags({ hidden: true, paid: true }),
      orderCount: 200,
      totalOrders: 10000, // 2%
    });

    expect(negligible.some((f) => f.label.includes('hidden = true'))).toBe(false);
    expect(notNegligible.some((f) => f.label.includes('hidden = true') && f.kind === 'flag_evidence')).toBe(true);
  });
});
