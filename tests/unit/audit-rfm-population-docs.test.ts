import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REQUIRED_DOCS = [
  'docs/audits/rfm-population/CP-R1-T10A-rfm-population-audit.md',
  'docs/audits/rfm-population/CP-R1-T10A-identity-coverage.md',
  'docs/audits/rfm-population/CP-R1-T10A-distribution-analysis.md',
  'docs/audits/rfm-population/CP-R1-T10A-scoring-recommendation.md',
  'docs/audits/rfm-population/CP-R1-T10A-snapshot-architecture.md',
  'docs/audits/rfm-population/CP-R1-T10A-identity-mode.md',
  'docs/audits/rfm-population/CP-R1-T10A-prestashop-identity-quality.md',
  'docs/audits/rfm-population/CP-R1-T10A-frequency-outlier.md',
  'docs/audits/rfm-population/CP-R1-T10A-multishop.md',
  'docs/audits/rfm-population/CP-R1-T10A-frequency-threshold-simulation.md',
  'docs/audits/rfm-population/CP-R1-T10A-commercial-validity.md',
  'docs/audits/rfm-population/CP-R1-T10A-temporal-stability.md',
  'docs/audits/rfm-population/CP-R1-T10A-master-migration-plan.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-commercial-population-finalization.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-multishop-decision.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-operational-account-policy.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-rfm-method-finalization.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-temporal-stability.md',
  'docs/audits/rfm-population/CP-R1-T10A-3-rfm-v1-provisional-manifest.md',
] as const;

const REQUIRED_T10A3_DECISION_MARKERS = Array.from({ length: 24 }, (_, index) => `${index + 1}. `);

const REQUIRED_SECTION_12_DECISIONS = [
  'RFM_IDENTITY_MODE',
  'Multishop treatment',
  'F cuts',
  'Outlier treatment',
  'Conditions to freeze',
] as const;

const REQUIRED_DECISIONS = [
  'Active population',
  'Historical inactive population',
  'No RFM population',
  'Exact window',
  'asOfDate',
  'R definition',
  'F definition',
  'M definition',
  'R score method',
  'F score method',
  'M score method',
  'Tie policy',
  'RFM/lifecycle separation',
  'Initial lifecycle rule',
  'Canonical identity',
  'Unconsolidated identity',
  'Pipeline frequency',
  'Model versioning',
  'Snapshot structure',
  'Indexes and batches',
  'Future endpoint fields',
  'Out of T10',
] as const;

function readDoc(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CP-R1-T10A RFM audit documentation', () => {
  it('has Facts, Interpretations, Decisions and Follow-up with no Open Decisions', () => {
    for (const path of REQUIRED_DOCS) {
      const content = readDoc(path);

      expect(content, path).toContain('## Facts');
      expect(content, path).toContain('## Interpretations');
      expect(content, path).toContain('## Decisions');
      expect(content, path).toContain('## Follow-up');
      expect(content, path).not.toContain('Open Decisions');
    }
  });

  it('documents all 22 required decisions in the main audit document', () => {
    const mainDoc = readDoc('docs/audits/rfm-population/CP-R1-T10A-rfm-population-audit.md');

    for (const decision of REQUIRED_DECISIONS) {
      expect(mainDoc).toContain(decision);
    }
  });

  it('documents RFM/lifecycle separation and excludes named commercial segments', () => {
    const combined = REQUIRED_DOCS.map(readDoc).join('\n');

    expect(combined).toContain('Lifecycle remains separate from RFM');
    expect(combined).toContain('No named `rfmSegment`');
    expect(combined).not.toContain('rfmSegment:');
  });

  it('documents the CP-R1-T10A-2 extension decisions (identity mode, multishop, F cuts, outlier, freeze conditions) in the main audit document', () => {
    const mainDoc = readDoc('docs/audits/rfm-population/CP-R1-T10A-rfm-population-audit.md');

    for (const decision of REQUIRED_SECTION_12_DECISIONS) {
      expect(mainDoc).toContain(decision);
    }
  });

  it('closes all 24 CP-R1-T10A-3 decisions in the finalization document', () => {
    const finalizationDoc = readDoc('docs/audits/rfm-population/CP-R1-T10A-3-commercial-population-finalization.md');

    for (const marker of REQUIRED_T10A3_DECISION_MARKERS) {
      expect(finalizationDoc, marker).toContain(marker);
    }
    expect(finalizationDoc).not.toContain('Open Decisions');
  });

  it('closes R/F/M methods and boundaries explicitly (frozen boundaries, Model B, rfm-v1-f1)', () => {
    const methodDoc = readDoc('docs/audits/rfm-population/CP-R1-T10A-3-rfm-method-finalization.md');

    expect(methodDoc).toContain('frozen boundaries');
    expect(methodDoc).toContain('Model B');
    expect(methodDoc).toContain('rfm-v1-f1');
    expect(methodDoc).not.toMatch(/uses?\s+`?NTILE/i);
  });

  it('never asserts ps_customer is canonical while documenting the provisional identity mode', () => {
    const identityModeDoc = readDoc('docs/audits/rfm-population/CP-R1-T10A-identity-mode.md');

    expect(identityModeDoc).toContain('identityCanonical');
    expect(identityModeDoc).toContain('totalIdentityCandidates');
    expect(identityModeDoc).not.toContain('ps_customer is canonical');
  });
});
