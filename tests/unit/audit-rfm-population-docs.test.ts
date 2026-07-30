import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REQUIRED_DOCS = [
  'docs/audits/rfm-population/CP-R1-T10A-rfm-population-audit.md',
  'docs/audits/rfm-population/CP-R1-T10A-identity-coverage.md',
  'docs/audits/rfm-population/CP-R1-T10A-distribution-analysis.md',
  'docs/audits/rfm-population/CP-R1-T10A-scoring-recommendation.md',
  'docs/audits/rfm-population/CP-R1-T10A-snapshot-architecture.md',
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
});
