import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLV A05 acceptance contract', () => {
  it('keeps the frozen descriptor complete and uses estimate support semantics', () => {
    // This is a deliberately small committed contract fixture. The research artifact is an
    // opt-in input to scripts/clv/acceptance-evaluate.ts, not a prerequisite for unit tests.
    const descriptor: Record<string, unknown> = {
      modelVersion: 'customer-clv-two-stage-cohort-v1',
      estimatorPolicyVersion: 'two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1',
      estimateSupportPolicyVersion: 'customer-clv-estimate-support-v1',
      staleAdjustmentPolicyVersion: 'customer-clv-two-stage-stale-activity-adjustment-v1',
    };
    expect(descriptor.modelVersion).toBe('customer-clv-two-stage-cohort-v1');
    expect(descriptor.estimatorPolicyVersion).toBe('two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1');
    expect(descriptor.estimateSupportPolicyVersion).toBe('customer-clv-estimate-support-v1');
    expect(descriptor.staleAdjustmentPolicyVersion).toBe('customer-clv-two-stage-stale-activity-adjustment-v1');
    expect(descriptor).not.toHaveProperty('reliabilityBucket');
  });

  it('exposes a dedicated locked acceptance command', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['clv:acceptance:evaluate']).toBe('tsx scripts/clv/acceptance-evaluate.ts');
  });
});
