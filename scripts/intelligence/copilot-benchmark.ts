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
  }) => boolean;
};

const SCENARIOS: readonly CopilotBenchmarkScenario[] = [
  {
    id: 'simple_fact',
    turns: ['Cuantos clientes tenemos?'],
    semanticPass: ({ finalResponse }) => finalResponse.status === 'answered',
  },
  {
    id: 'simple_grouped_ranking',
    turns: ['Cual cluster tiene mayor ticket promedio?'],
    semanticPass: ({ finalResponse }) => finalResponse.status === 'answered',
  },
  {
    id: 'contextual_deep_followup',
    turns: ['Cual cluster tiene mayor ticket promedio?', 'Por que?'],
    semanticPass: ({ finalResponse, plannerDiagnostics }) =>
      finalResponse.status === 'answered' &&
      plannerDiagnostics.at(-1)?.selectedStatus === 'query_plan' &&
      (plannerDiagnostics.at(-1)?.queryStepIds.length ?? 0) >= 2,
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const models = splitCsv(args.models ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_MODELS ?? 'deepseek-v4-flash,deepseek-v4-pro');
  const runs = positiveInt(args.runs ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_RUNS, 3);
  const featureSnapshotId = args['feature-snapshot-id'] ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_FEATURE_SNAPSHOT_ID ?? null;
  const outputPath = args.output ?? process.env.CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_OUTPUT ?? null;
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
          const record = await runScenario({ model, scenario, run, featureSnapshotId, pool });
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
    unifiedPlannerEnabled: config.marketingCopilot.unifiedPlannerEnabled,
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
  return recordFromDiagnostics({
    model: args.model,
    scenarioId: args.scenario.id,
    run: args.run,
    status: finalResponse.status,
    semanticPass: args.scenario.semanticPass({ finalResponse, plannerDiagnostics }),
    diagnostics: stageDiagnostics,
  });
}

function recordFromDiagnostics(args: {
  readonly model: string;
  readonly scenarioId: string;
  readonly run: number;
  readonly status: string;
  readonly semanticPass: boolean;
  readonly diagnostics: readonly CopilotStageLatencyDiagnostic[];
}): CopilotBenchmarkRecord {
  return {
    model: args.model,
    scenarioId: args.scenarioId,
    run: args.run,
    orchestratorMs: sumStage(args.diagnostics, 'orchestrator') + sumStage(args.diagnostics, 'orchestrator_repair'),
    plannerMs: sumStage(args.diagnostics, 'planner') + sumStage(args.diagnostics, 'planner_repair') + sumStage(args.diagnostics, 'unified_planner') + sumStage(args.diagnostics, 'unified_planner_repair'),
    analyticsMs: sumStage(args.diagnostics, 'analytics_execution'),
    answererMs: sumStage(args.diagnostics, 'answerer'),
    totalMs: sumStage(args.diagnostics, 'turn'),
    queryCount: args.diagnostics.filter((diagnostic) => diagnostic.stage === 'analytics_execution').reduce((sum, diagnostic) => sum + diagnostic.queryCount, 0),
    repairCount: args.diagnostics.filter((diagnostic) => diagnostic.repairAttempted).length,
    status: args.status,
    timeoutStage: failureStage(args.diagnostics, 'provider_timeout'),
    invalidResponseStage: failureStage(args.diagnostics, 'provider_invalid_response'),
    semanticPass: args.semanticPass,
  };
}

function emptyRecord(args: { readonly model: string; readonly scenario: CopilotBenchmarkScenario; readonly run: number }, status: string, semanticPass: boolean, diagnostics: readonly CopilotStageLatencyDiagnostic[]): CopilotBenchmarkRecord {
  return recordFromDiagnostics({ model: args.model, scenarioId: args.scenario.id, run: args.run, status, semanticPass, diagnostics });
}

function sumStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], stage: CopilotStageLatencyDiagnostic['stage']): number {
  return diagnostics.filter((diagnostic) => diagnostic.stage === stage).reduce((sum, diagnostic) => sum + diagnostic.durationMs, 0);
}

function failureStage(diagnostics: readonly CopilotStageLatencyDiagnostic[], suffix: string): string | null {
  return diagnostics.find((diagnostic) => diagnostic.failureStatus?.endsWith(suffix))?.stage ?? null;
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
