export type CopilotBenchmarkRecord = {
  readonly runtime: 'legacy' | 'unified' | 'tools' | 'config';
  readonly model: string;
  readonly scenarioId: string;
  readonly run: number;
  readonly toolSelectionMs: number;
  readonly orchestratorMs: number;
  readonly plannerMs: number;
  readonly analyticsMs: number;
  readonly toolSynthesisMs: number;
  readonly answererMs: number;
  readonly totalMs: number;
  readonly queryCount: number;
  readonly toolCallCount: number;
  readonly repairCount: number;
  readonly status: string;
  readonly timeoutStage: string | null;
  readonly invalidResponseStage: string | null;
  readonly cacheHitTokens: number;
  readonly cacheMissTokens: number;
  readonly cacheHitRatio: number | null;
  readonly compactToolContract: boolean;
  readonly toolSchemaChars: number | null;
  readonly toolArgumentChars: number;
  readonly contextProjectionChars: number;
  readonly resultSummaryChars: number;
  readonly toolSelectionPromptChars: number | null;
  readonly toolSelectionPromptTokens: number | null;
  readonly synthesisFallbackUsed: boolean;
  readonly deterministicRendererEligible: boolean | null;
  readonly deterministicRendererReason: string | null;
  readonly semanticAnchorEntityType: string | null;
  readonly semanticAnchorEntityId: string | number | null;
  readonly evidenceBundleChars: number | null;
  readonly evidenceFactCount: number;
  readonly evidenceComparisonCount: number;
  readonly synthesisPromptChars: number | null;
  readonly synthesisCompletionTokens: number | null;
  readonly semanticPass: boolean;
  readonly semanticFailureReason: string | null;
};

export function aggregateBenchmark(records: readonly CopilotBenchmarkRecord[]) {
  const groups = new Map<string, CopilotBenchmarkRecord[]>();
  for (const record of records) {
    const key = `${record.model}:${record.scenarioId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const [model, scenarioId] = key.split(':');
    const totals = group.map((record) => record.totalMs).sort((a, b) => a - b);
    return {
      model,
      scenarioId,
      runs: group.length,
      meanTotalMs: mean(totals),
      p50TotalMs: percentile(totals, 0.5),
      p95TotalMs: totals.length >= 3 ? percentile(totals, 0.95) : null,
      minTotalMs: totals[0] ?? 0,
      maxTotalMs: totals[totals.length - 1] ?? 0,
      timeoutCount: group.filter((record) => record.timeoutStage !== null).length,
      invalidResponseCount: group.filter((record) => record.invalidResponseStage !== null).length,
      meanCacheHitRatio: mean(group.map((record) => record.cacheHitRatio).filter((value): value is number => value !== null)),
      successRate: group.filter((record) => record.status === 'answered' || record.status === 'unsupported_data' || record.status === 'unsupported_operation').length / group.length,
      semanticPassRate: group.filter((record) => record.semanticPass).length / group.length,
    };
  });
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index] ?? 0;
}
