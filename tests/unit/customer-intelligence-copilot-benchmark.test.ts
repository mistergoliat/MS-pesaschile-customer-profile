import { describe, expect, it } from 'vitest';
import { aggregateBenchmark, type CopilotBenchmarkRecord } from '../../scripts/intelligence/copilot-benchmark-report.js';

function record(overrides: Partial<CopilotBenchmarkRecord>): CopilotBenchmarkRecord {
  return {
    runtime: 'tools',
    model: 'deepseek-v4-flash',
    scenarioId: 'simple_fact',
    run: 1,
    toolSelectionMs: 1,
    orchestratorMs: 1,
    plannerMs: 2,
    analyticsMs: 1,
    toolSynthesisMs: 0,
    answererMs: 0,
    totalMs: 4,
    queryCount: 1,
    toolCallCount: 1,
    repairCount: 0,
    status: 'answered',
    timeoutStage: null,
    invalidResponseStage: null,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    cacheHitRatio: null,
    compactToolContract: true,
    toolSchemaChars: 1000,
    toolArgumentChars: 100,
    contextProjectionChars: 500,
    resultSummaryChars: 0,
    toolSelectionPromptChars: 1500,
    toolSelectionPromptTokens: null,
    synthesisFallbackUsed: false,
    deterministicRendererEligible: true,
    deterministicRendererReason: 'eligible',
    semanticAnchorEntityType: null,
    semanticAnchorEntityId: null,
    primaryFindingEntityType: null,
    primaryFindingEntityId: null,
    primaryFindingMetric: null,
    primaryFindingType: null,
    evidenceBundleChars: null,
    evidenceFactCount: 0,
    evidenceComparisonCount: 0,
    evidenceDistributionCount: 0,
    synthesisMaxTokens: null,
    synthesisPromptChars: null,
    synthesisCompletionTokens: null,
    synthesisFinishReason: null,
    semanticPass: true,
    semanticFailureReason: null,
    ...overrides,
  };
}

describe('Customer Intelligence Copilot benchmark harness', () => {
  it('aggregates latency, success, timeout, invalid response and semantic pass rates by model/scenario', () => {
    const aggregate = aggregateBenchmark([
      record({ run: 1, totalMs: 10, cacheHitTokens: 80, cacheMissTokens: 20, cacheHitRatio: 0.8 }),
      record({ run: 2, totalMs: 20, timeoutStage: 'planner', status: 'provider_timeout', semanticPass: false }),
      record({ run: 3, totalMs: 30, invalidResponseStage: 'answerer', status: 'provider_invalid_response', semanticPass: false }),
      record({ model: 'deepseek-v4-pro', run: 1, totalMs: 40 }),
    ]);

    expect(aggregate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: 'deepseek-v4-flash',
          scenarioId: 'simple_fact',
          runs: 3,
          meanTotalMs: 20,
          p50TotalMs: 20,
          p95TotalMs: 30,
          minTotalMs: 10,
          maxTotalMs: 30,
          timeoutCount: 1,
          invalidResponseCount: 1,
          meanCacheHitRatio: 0.8,
          successRate: 1 / 3,
          semanticPassRate: 1 / 3,
        }),
        expect.objectContaining({
          model: 'deepseek-v4-pro',
          scenarioId: 'simple_fact',
          runs: 1,
          meanTotalMs: 40,
          p95TotalMs: null,
        }),
      ]),
    );
  });
});
