import 'dotenv/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../../src/config.js';
import { getAnalyticalSchema, createExecuteAnalyticalQueryWithResolvedContext } from '../../src/application/customer-intelligence-query/index.js';
import {
  createCustomerIntelligenceCopilotSessionService,
  createInMemoryCopilotSessionStore,
  type CopilotPlannerDiagnostic,
  type CopilotStageLatencyDiagnostic,
} from '../../src/application/customer-intelligence-copilot-session/index.js';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createMysqlAnalyticalQueryExecutor } from '../../src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.js';
import { createConfiguredCustomerIntelligenceCopilotModel } from '../../src/infrastructure/customer-intelligence-copilot/index.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { SystemClock } from '../../src/infrastructure/shared/system-clock.js';
import type { CustomerIntelligenceCopilotResponse } from '../../src/domain/customer-intelligence-copilot/index.js';
import { aggregateBenchmark, type CopilotBenchmarkRecord } from './copilot-benchmark-report.js';

type CopilotBenchmarkScenario = {
  readonly id: string;
  readonly turns: readonly string[];
  readonly semanticPass: (result: {
    readonly finalResponse: CustomerIntelligenceCopilotResponse;
    readonly plannerDiagnostics: readonly CopilotPlannerDiagnostic[];
    readonly stageDiagnostics: readonly CopilotStageLatencyDiagnostic[];
  }) => boolean;
};

type CopilotBenchmarkRuntime = 'legacy' | 'unified' | 'tools' | 'config';

const SCENARIOS: readonly CopilotBenchmarkScenario[] = [
  {
    id: 'simple_fact',
    turns: ['Cuantos clientes tenemos?'],
    semanticPass: ({ finalResponse, stageDiagnostics }) => {
      if (finalResponse.status !== 'answered') return false;
      if (!hasBenchmarkStage(stageDiagnostics, 'tool_selection')) return true;
      return hasBenchmarkStage(stageDiagnostics, 'analytics_execution') && countBenchmarkStage(stageDiagnostics, 'tool_synthesis') === 0;
    },
  },
  {
    id: 'simple_grouped_ranking',
    turns: ['Cual cluster tiene mayor ticket promedio?'],
    semanticPass: ({ finalResponse, stageDiagnostics }) => {
      if (finalResponse.status !== 'answered') return false;
      if (!hasBenchmarkStage(stageDiagnostics, 'tool_selection')) return true;
      const analytics = lastBenchmarkStage(stageDiagnostics, 'analytics_execution');
      return analytics !== null && analytics.deterministicRendererEligible === true && countBenchmarkStage(stageDiagnostics, 'tool_synthesis') === 0;
    },
  },
  {
    id: 'contextual_deep_followup',
    turns: ['Cual cluster tiene mayor ticket promedio?', 'Por que?'],
    semanticPass: ({ finalResponse, plannerDiagnostics, stageDiagnostics }) => {
      if (finalResponse.status !== 'answered') return false;
      const plannerPass = plannerDiagnostics.at(-1)?.selectedStatus === 'query_plan' && (plannerDiagnostics.at(-1)?.queryStepIds.length ?? 0) >= 2;
      const toolSelection = stageDiagnostics.filter((diagnostic) => diagnostic.stage === 'tool_selection').at(-1);
      const toolPass =
        toolSelection !== undefined &&
        toolSelection.activeSemanticEntityType === 'cluster' &&
        String(toolSelection.activeSemanticEntityId) === '3' &&
        (toolSelection.toolQueryCount ?? toolSelection.queryCount) >= 2 &&
        countBenchmarkStage(stageDiagnostics, 'tool_synthesis') <= 1 &&
        stageDiagnostics.some((diagnostic) => diagnostic.stage === 'analytics_execution') &&
        stageDiagnostics.some((diagnostic) => diagnostic.semanticAnchorEntityType === 'cluster' && String(diagnostic.semanticAnchorEntityId) === '3');
      return plannerPass || toolPass;
    },
  },
  {
    id: 'clarification_continuation',
    turns: ['Cual es el mejor grupo?', 'Por gasto total'],
    semanticPass: ({ finalResponse }) => finalResponse.status === 'answered',
  },
  {
    id: 'exploratory',
    turns: ['Que ves interesante en mis clientes?'],
    semanticPass: ({ finalResponse }) => finalResponse.status === 'answered',
  },
  {
    id: 'commercial_recommendation',
    turns: ['Donde ves una oportunidad comercial?'],
    semanticPass: ({ finalResponse }) => finalResponse.status === 'answered',
  },
  {
    id: 'unsupported_profitability',
    turns: ['Cual segmento es mas rentable?'],
    semanticPass: ({ finalResponse }) =>
      finalResponse.status === 'unsupported_data' ||
      finalResponse.status === 'unsupported_operation' ||
      (finalResponse.status === 'answered' && /rentabilidad|margen|costo|profit/i.test(finalResponse.answer)),
  },
] as const;

function hasBenchmarkStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], stage: CopilotStageLatencyDiagnostic['stage']): boolean {
  return diagnostics.some((diagnostic) => diagnostic.stage === stage);
}

function countBenchmarkStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], stage: CopilotStageLatencyDiagnostic['stage']): number {
  return diagnostics.filter((diagnostic) => diagnostic.stage === stage).length;
}

function lastBenchmarkStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], stage: CopilotStageLatencyDiagnostic['stage']): CopilotStageLatencyDiagnostic | null {
  return diagnostics.filter((diagnostic) => diagnostic.stage === stage).at(-1) ?? null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const models = splitCsv(args.models ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_MODELS ?? 'deepseek-v4-flash,deepseek-v4-pro');
  const runs = positiveInt(args.runs ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_RUNS, 3);
  const featureSnapshotId = args['feature-snapshot-id'] ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_FEATURE_SNAPSHOT_ID ?? null;
  const outputPath = args.output ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_OUTPUT ?? null;
  const runtime = parseRuntime(args.runtime ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_RUNTIME);
  const scenarioFilter = args.scenarios ? new Set(splitCsv(args.scenarios)) : null;
  const scenarios = scenarioFilter ? SCENARIOS.filter((scenario) => scenarioFilter.has(scenario.id)) : SCENARIOS;
  if (scenarios.length === 0) throw new Error('No benchmark scenarios selected');
  if (!config.analyticsDb) throw new Error('ANALYTICS_DB_* is not configured - cannot run copilot benchmark');

  const pool = mysql.createPool({
    host: config.analyticsDb.host,
    port: config.analyticsDb.port,
    user: config.analyticsDb.user,
    password: config.analyticsDb.password,
    database: config.analyticsDb.database,
    connectionLimit: config.analyticsDb.connectionLimit,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  });

  const records: CopilotBenchmarkRecord[] = [];
  const totalRuns = models.length * scenarios.length * runs;
  let runIndex = 0;
  try {
    for (const model of models) {
      for (const scenario of scenarios) {
        for (let run = 1; run <= runs; run += 1) {
          runIndex += 1;
          console.info(`[${runIndex}/${totalRuns}] ${model} ${scenario.id} run=${run} START`);
          const record = await runScenario({ model, runtime, scenario, run, featureSnapshotId, pool });
          records.push(record);
          if (outputPath) appendJsonLine(outputPath, record);
          console.info(`[${runIndex}/${totalRuns}] ${record.semanticPass ? 'PASS' : 'FAIL'} total=${record.totalMs} status=${record.status}`);
        }
      }
    }
  } finally {
    await pool.end();
  }

  console.info(JSON.stringify({ records, aggregate: aggregateBenchmark(records) }, null, 2));
}

async function runScenario(args: {
  readonly model: string;
  readonly runtime: CopilotBenchmarkRuntime;
  readonly scenario: CopilotBenchmarkScenario;
  readonly run: number;
  readonly featureSnapshotId: string | null;
  readonly pool: mysql.Pool;
}): Promise<CopilotBenchmarkRecord> {
  const modelConfig = createConfiguredCustomerIntelligenceCopilotModel({
    ...process.env,
    CUSTOMER_INTELLIGENCE_COPILOT_MODEL: args.model,
  });
  if (modelConfig.status !== 'configured') throw new Error(modelConfig.reason);
  const resolvers = createCustomerIntelligenceContextResolvers({
    featureSnapshotReader: createMysqlCustomerFeatureSnapshotReader(args.pool),
    snapshotHeaderReader: createMysqlSnapshotHeaderReader(args.pool),
    intelligenceReader: createMysqlCustomerIntelligenceReader(args.pool),
  });
  const queryExecutor = createMysqlAnalyticalQueryExecutor(createQueryExecutor(args.pool, config.analyticsDb!.queryTimeoutMs));
  const stageDiagnostics: CopilotStageLatencyDiagnostic[] = [];
  const plannerDiagnostics: CopilotPlannerDiagnostic[] = [];
  const service = createCustomerIntelligenceCopilotSessionService({
    getAnalyticalSchema,
    resolveCurrent: resolvers.resolveCurrent,
    resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
    executeAnalyticalQuery: createExecuteAnalyticalQueryWithResolvedContext({ queryExecutor }),
    executeAnalyticalQueryForExport: async () => {
      throw new Error('benchmark export is not supported');
    },
    model: modelConfig.model,
    store: createInMemoryCopilotSessionStore(config.marketingCopilot.session),
    clock: new SystemClock(),
    limits: config.marketingCopilot.session,
    toolRuntimeEnabled: args.runtime === 'config' ? config.marketingCopilot.toolRuntimeEnabled : args.runtime === 'tools',
    unifiedPlannerEnabled: args.runtime === 'config' ? config.marketingCopilot.unifiedPlannerEnabled : args.runtime === 'unified',
    synthesisMaxTokens: config.marketingCopilot.synthesisMaxTokens,
    onPlannerDiagnostic: (diagnostic) => plannerDiagnostics.push(diagnostic),
    onStageLatencyDiagnostic: (diagnostic) => stageDiagnostics.push(diagnostic),
  });

  const created = await service.createSession({ featureSnapshotId: args.featureSnapshotId });
  if (created.status !== 'created') {
    return emptyRecord(args, created.status, false, stageDiagnostics);
  }
  let finalResponse: CustomerIntelligenceCopilotResponse | null = null;
  for (const question of args.scenario.turns) {
    const turn = await service.processSessionTurn({ sessionId: created.session.sessionId, question });
    if (turn.status !== 'ok') return emptyRecord(args, turn.status, false, stageDiagnostics);
    finalResponse = turn.response;
  }
  if (!finalResponse) return emptyRecord(args, 'no_turns', false, stageDiagnostics);
  const semanticPass = args.scenario.semanticPass({ finalResponse, plannerDiagnostics, stageDiagnostics });
  return recordFromDiagnostics({
    model: args.model,
    runtime: args.runtime,
    scenarioId: args.scenario.id,
    run: args.run,
    status: finalResponse.status,
    semanticPass,
    semanticFailureReason: semanticPass ? null : semanticFailureReason({ scenarioId: args.scenario.id, finalResponse, plannerDiagnostics, stageDiagnostics }),
    diagnostics: stageDiagnostics,
  });
}

function recordFromDiagnostics(args: {
  readonly model: string;
  readonly runtime: CopilotBenchmarkRuntime;
  readonly scenarioId: string;
  readonly run: number;
  readonly status: string;
  readonly semanticPass: boolean;
  readonly semanticFailureReason: string | null;
  readonly diagnostics: readonly CopilotStageLatencyDiagnostic[];
}): CopilotBenchmarkRecord {
  return {
    model: args.model,
    runtime: args.runtime,
    scenarioId: args.scenarioId,
    run: args.run,
    toolSelectionMs: sumStage(args.diagnostics, 'tool_selection'),
    orchestratorMs: sumStage(args.diagnostics, 'orchestrator') + sumStage(args.diagnostics, 'orchestrator_repair'),
    plannerMs: sumStage(args.diagnostics, 'planner') + sumStage(args.diagnostics, 'planner_repair') + sumStage(args.diagnostics, 'unified_planner') + sumStage(args.diagnostics, 'unified_planner_repair'),
    analyticsMs: sumStage(args.diagnostics, 'analytics_execution'),
    toolSynthesisMs: sumStage(args.diagnostics, 'tool_synthesis'),
    answererMs: sumStage(args.diagnostics, 'answerer'),
    totalMs: sumStage(args.diagnostics, 'turn'),
    queryCount: args.diagnostics.filter((diagnostic) => diagnostic.stage === 'analytics_execution').reduce((sum, diagnostic) => sum + diagnostic.queryCount, 0),
    toolCallCount: args.diagnostics.filter((diagnostic) => diagnostic.stage === 'tool_selection' && diagnostic.queryCount > 0).length,
    repairCount: args.diagnostics.filter((diagnostic) => diagnostic.repairAttempted).length,
    status: args.status,
    timeoutStage: failureStage(args.diagnostics, 'provider_timeout'),
    invalidResponseStage: failureStage(args.diagnostics, 'provider_invalid_response'),
    cacheHitTokens: sumCacheTokens(args.diagnostics, 'promptCacheHitTokens'),
    cacheMissTokens: sumCacheTokens(args.diagnostics, 'promptCacheMissTokens'),
    cacheHitRatio: cacheHitRatio(args.diagnostics),
    compactToolContract: args.diagnostics.some((diagnostic) => diagnostic.compactToolContract === true),
    toolSchemaChars: maxOptional(args.diagnostics, 'toolSchemaChars'),
    toolArgumentChars: sumOptional(args.diagnostics, 'toolArgumentChars'),
    contextProjectionChars: sumOptional(args.diagnostics, 'contextProjectionChars'),
    resultSummaryChars: sumOptional(args.diagnostics, 'resultSummaryChars'),
    toolSelectionPromptChars: maxOptional(args.diagnostics, 'toolSelectionPromptChars'),
    toolSelectionPromptTokens: maxOptional(args.diagnostics, 'toolSelectionPromptTokens'),
    synthesisFallbackUsed: args.diagnostics.some((diagnostic) => diagnostic.synthesisFallbackUsed === true),
    deterministicRendererEligible: lastOptionalBoolean(args.diagnostics, 'deterministicRendererEligible'),
    deterministicRendererReason: lastOptionalString(args.diagnostics, 'deterministicRendererReason'),
    semanticAnchorEntityType: lastOptionalString(args.diagnostics, 'semanticAnchorEntityType'),
    semanticAnchorEntityId: lastOptionalStringOrNumber(args.diagnostics, 'semanticAnchorEntityId'),
    primaryFindingEntityType: lastOptionalString(args.diagnostics, 'primaryFindingEntityType'),
    primaryFindingEntityId: lastOptionalStringOrNumber(args.diagnostics, 'primaryFindingEntityId'),
    primaryFindingMetric: lastOptionalString(args.diagnostics, 'primaryFindingMetric'),
    primaryFindingType: lastOptionalString(args.diagnostics, 'primaryFindingType'),
    evidenceBundleChars: maxOptional(args.diagnostics, 'evidenceBundleChars'),
    evidenceFactCount: maxOptional(args.diagnostics, 'evidenceFactCount') ?? 0,
    evidenceComparisonCount: maxOptional(args.diagnostics, 'evidenceComparisonCount') ?? 0,
    evidenceDistributionCount: maxOptional(args.diagnostics, 'evidenceDistributionCount') ?? 0,
    synthesisMaxTokens: maxOptional(args.diagnostics, 'synthesisMaxTokens'),
    synthesisPromptChars: maxOptional(args.diagnostics, 'synthesisPromptChars'),
    synthesisCompletionTokens: maxOptional(args.diagnostics, 'synthesisCompletionTokens'),
    synthesisFinishReason: lastOptionalString(args.diagnostics, 'synthesisFinishReason'),
    semanticPass: args.semanticPass,
    semanticFailureReason: args.semanticFailureReason,
  };
}

function emptyRecord(args: { readonly model: string; readonly runtime: CopilotBenchmarkRuntime; readonly scenario: CopilotBenchmarkScenario; readonly run: number }, status: string, semanticPass: boolean, diagnostics: readonly CopilotStageLatencyDiagnostic[]): CopilotBenchmarkRecord {
  return recordFromDiagnostics({ model: args.model, runtime: args.runtime, scenarioId: args.scenario.id, run: args.run, status, semanticPass, semanticFailureReason: semanticPass ? null : status, diagnostics });
}

function semanticFailureReason(args: {
  readonly scenarioId: string;
  readonly finalResponse: CustomerIntelligenceCopilotResponse;
  readonly plannerDiagnostics: readonly CopilotPlannerDiagnostic[];
  readonly stageDiagnostics: readonly CopilotStageLatencyDiagnostic[];
}): string {
  if (args.scenarioId === 'simple_fact') {
    if (args.finalResponse.status !== 'answered') return `final_status_${args.finalResponse.status}`;
    if (hasBenchmarkStage(args.stageDiagnostics, 'tool_selection') && !hasBenchmarkStage(args.stageDiagnostics, 'analytics_execution')) return 'missing_analytics_execution';
    if (countBenchmarkStage(args.stageDiagnostics, 'tool_synthesis') > 0) return 'unexpected_tool_synthesis';
    return 'semantic_expectation_not_met';
  }
  if (args.scenarioId === 'simple_grouped_ranking') {
    if (args.finalResponse.status !== 'answered') return `final_status_${args.finalResponse.status}`;
    if (countBenchmarkStage(args.stageDiagnostics, 'tool_synthesis') > 0) return 'unexpected_tool_synthesis';
    const analytics = lastBenchmarkStage(args.stageDiagnostics, 'analytics_execution');
    if (analytics && analytics.deterministicRendererEligible !== true) return `deterministic_renderer_${analytics.deterministicRendererReason ?? 'not_eligible'}`;
    if (!analytics && hasBenchmarkStage(args.stageDiagnostics, 'tool_selection')) return 'missing_analytics_execution';
    return 'semantic_expectation_not_met';
  }
  if (args.scenarioId !== 'contextual_deep_followup') return `final_status_${args.finalResponse.status}`;
  if (args.finalResponse.status === 'clarification_required') return 'unexpected_clarification_required';
  if (args.finalResponse.status !== 'answered') return `final_status_${args.finalResponse.status}`;
  const plannerDiagnostic = args.plannerDiagnostics.at(-1);
  if (plannerDiagnostic && plannerDiagnostic.selectedStatus !== 'query_plan') return `planner_selected_${plannerDiagnostic.selectedStatus}`;
  if (plannerDiagnostic && plannerDiagnostic.queryStepIds.length < 2) return 'planner_query_count_below_2';
  const toolSelection = args.stageDiagnostics.filter((diagnostic) => diagnostic.stage === 'tool_selection').at(-1);
  if (toolSelection) {
    if (toolSelection.activeSemanticEntityType !== 'cluster' || String(toolSelection.activeSemanticEntityId) !== '3') return 'active_cluster_3_not_preserved';
    if ((toolSelection.toolQueryCount ?? toolSelection.queryCount) < 2) return 'tool_query_count_below_2';
  }
  if (countBenchmarkStage(args.stageDiagnostics, 'tool_synthesis') > 1) return 'tool_synthesis_count_above_1';
  if (!args.stageDiagnostics.some((diagnostic) => diagnostic.semanticAnchorEntityType === 'cluster' && String(diagnostic.semanticAnchorEntityId) === '3')) return 'semantic_anchor_cluster_3_not_preserved';
  return 'semantic_expectation_not_met';
}

function sumStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], stage: CopilotStageLatencyDiagnostic['stage']): number {
  return diagnostics.filter((diagnostic) => diagnostic.stage === stage).reduce((sum, diagnostic) => sum + diagnostic.durationMs, 0);
}

function failureStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], suffix: string): string | null {
  return diagnostics.find((diagnostic) => diagnostic.failureStatus?.endsWith(suffix))?.stage ?? null;
}

function sumCacheTokens(diagnostics: readonly CopilotStageLatencyDiagnostic[], key: 'promptCacheHitTokens' | 'promptCacheMissTokens'): number {
  return diagnostics.reduce((sum, diagnostic) => sum + (diagnostic[key] ?? 0), 0);
}

function cacheHitRatio(diagnostics: readonly CopilotStageLatencyDiagnostic[]): number | null {
  const hit = sumCacheTokens(diagnostics, 'promptCacheHitTokens');
  const miss = sumCacheTokens(diagnostics, 'promptCacheMissTokens');
  return hit + miss > 0 ? hit / (hit + miss) : null;
}

function sumOptional(diagnostics: readonly CopilotStageLatencyDiagnostic[], key: 'toolArgumentChars' | 'contextProjectionChars' | 'resultSummaryChars'): number {
  return diagnostics.reduce((sum, diagnostic) => sum + (diagnostic[key] ?? 0), 0);
}

function maxOptional(
  diagnostics: readonly CopilotStageLatencyDiagnostic[],
  key:
    | 'toolSchemaChars'
    | 'toolSelectionPromptChars'
    | 'toolSelectionPromptTokens'
    | 'evidenceBundleChars'
    | 'evidenceFactCount'
    | 'evidenceComparisonCount'
    | 'evidenceDistributionCount'
    | 'synthesisMaxTokens'
    | 'synthesisPromptChars'
    | 'synthesisCompletionTokens',
): number | null {
  const values = diagnostics.map((diagnostic) => diagnostic[key]).filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.max(...values) : null;
}

function lastOptionalBoolean(diagnostics: readonly CopilotStageLatencyDiagnostic[], key: 'deterministicRendererEligible'): boolean | null {
  return [...diagnostics].reverse().find((diagnostic) => typeof diagnostic[key] === 'boolean')?.[key] ?? null;
}

function lastOptionalString(
  diagnostics: readonly CopilotStageLatencyDiagnostic[],
  key: 'deterministicRendererReason' | 'semanticAnchorEntityType' | 'primaryFindingEntityType' | 'primaryFindingMetric' | 'primaryFindingType' | 'synthesisFinishReason',
): string | null {
  const value = [...diagnostics].reverse().find((diagnostic) => typeof diagnostic[key] === 'string')?.[key];
  return typeof value === 'string' ? value : null;
}

function lastOptionalStringOrNumber(diagnostics: readonly CopilotStageLatencyDiagnostic[], key: 'semanticAnchorEntityId' | 'primaryFindingEntityId'): string | number | null {
  const value = [...diagnostics].reverse().find((diagnostic) => typeof diagnostic[key] === 'string' || typeof diagnostic[key] === 'number')?.[key];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function parseArgs(args: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const [key, value = 'true'] = arg.slice(2).split('=', 2);
    if (key) parsed[key] = value;
  }
  return parsed;
}

function splitCsv(value: string): readonly string[] {
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRuntime(value: string | undefined): CopilotBenchmarkRuntime {
  if (value === 'legacy' || value === 'unified' || value === 'tools') return value;
  return 'config';
}

function appendJsonLine(path: string, record: CopilotBenchmarkRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[intelligence:copilot:benchmark] FAILED:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
