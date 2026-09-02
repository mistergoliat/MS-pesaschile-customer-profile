import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import {
  compileAudienceSql,
  createAudienceContextResolver,
  createEvaluateAudience,
} from '../../src/application/customer-intelligence-audience/index.js';
import {
  audienceDefinitionChecksum,
  type AudienceAffinityAxisV1,
  type AudienceDefinitionV1,
  type AudienceEvaluationContextV1,
  type AudienceEvaluationResultV1,
  type AudienceTruthV1,
  validateAudienceDefinition,
} from '../../src/domain/customer-intelligence-audience/index.js';
import { config } from '../../src/config.js';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { getAnalyticsPool, getAnalyticsQueryExecutor, closeAnalyticsPool } from '../../src/infrastructure/customer-analytics/analytics-db-pool.js';
import { createMysqlAudienceSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence-audience/mysql-audience-snapshot-header-reader.js';
import { createMysqlAudienceSqlExecutor } from '../../src/infrastructure/customer-intelligence-audience/mysql-audience-sql-executor.js';
import { getRfmSnapshotPool, getRfmSnapshotQueryExecutor, closeRfmSnapshotPool } from '../../src/infrastructure/rfm/rfm-snapshot-pool.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { sha256Stable } from '../../src/shared/stable-checksum.js';
import {
  assertEvaluationInvariants,
  buildRepresentativeDefinitions,
  type DiscoveredAudienceValues,
  type RepresentativeAudienceDefinition,
} from './a01-1-helpers.js';

const ARTIFACT_PATH = 'artifacts/customer-intelligence-audience/a01-1-operational-validation.json';
const PREVIEW_LIMIT = 1000;
const EXPECTED_AFFINITY_CHECKSUM = '55c635541e0fdf206b3e547b8549d0d9e7ef3a774ad4300386009793af9efd90';
const EXPECTED_CONTEXT_IDS = { feature: '2', rfm: '1', cluster: '1', clv: '1', commercialAffinity: '4' } as const;
const HYROX = { axis: 'DISCIPLINE' as const, code: 'HYROX' };

type ConnectionSource = 'ANALYTICS_DB' | 'RFM_SNAPSHOT_DB_RUNNER_COMPATIBILITY_FALLBACK';
type OperationalConnection = { readonly source: ConnectionSource; readonly queryExecutor: QueryExecutor; readonly pool: Parameters<typeof createMysqlCustomerFeatureSnapshotReader>[0]; readonly close: () => Promise<void> };
type EvaluationRecord = {
  readonly name: string;
  readonly definition: AudienceDefinitionV1;
  readonly definitionChecksum: string;
  readonly contextChecksum: string | null;
  readonly result: Record<string, unknown>;
};
type ExplainRecord = { readonly name: string; readonly definitionChecksum: string; readonly rows: readonly Record<string, unknown>[] };

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const artifact: Record<string, unknown> = {
    runnerVersion: 'customer-intelligence-audience-a01.1-operational-validation-v1',
    operationalStatus: 'PENDING_MANUAL_EC2_EXECUTION',
    generatedAt,
    expectedContext: { snapshotIds: EXPECTED_CONTEXT_IDS, affinityPopulationChecksum: EXPECTED_AFFINITY_CHECKSUM },
    connection: { configured: Boolean(config.analyticsDb || config.rfmSnapshotDb), source: null },
    resolvedContext: null,
    definitions: [],
    determinism: [],
    semanticProbes: { affinity: null, nullSemantics: null },
    explain: [],
    performance: { evaluations: [], pathologies: [] },
    indexDecision: { decision: 'NO_INDEX_CHANGE_REQUIRED', rationale: 'No migration is created by this runner; target-EC2 EXPLAIN evidence is pending.' },
    failureProbes: [],
    errors: [],
  };

  let connection: OperationalConnection | null = null;
  try {
    connection = openConnection();
    artifact.connection = { configured: true, source: connection.source };
    const featureReader = createMysqlCustomerFeatureSnapshotReader(connection.pool);
    const headerReader = createMysqlAudienceSnapshotHeaderReader(connection.pool);
    const contextResolver = createAudienceContextResolver({ featureSnapshotReader: featureReader, snapshotHeaderReader: headerReader });
    const sqlExecutor = createMysqlAudienceSqlExecutor(connection.queryExecutor);
    const evaluateAudience = createEvaluateAudience({ contextResolver, sqlExecutor });
    const resolution = await contextResolver.resolveCurrent();
    artifact.resolvedContext = resolution;
    printContext(resolution);
    if (resolution.status !== 'available') {
      (artifact.errors as string[]).push(`Context resolution unavailable: ${resolution.reason}`);
      return;
    }

    const context = resolution.context;
    const headerEvidence = await readHeaderEvidence(connection.queryExecutor, context);
    artifact.contextEvidence = headerEvidence;
    const contextChecks = verifyContext(context, headerEvidence);
    artifact.contextChecks = contextChecks;
    const discovered = await discoverRealValues(connection.queryExecutor, context);
    artifact.realValueDiscovery = discovered;
    printDiscovery(discovered);
    if (discovered.status !== 'available') {
      (artifact.errors as string[]).push(discovered.reason);
      return;
    }

    const definitions = buildRepresentativeDefinitions(discovered.values);
    artifact.definitions = definitions.map(({ name, definition }) => ({
      name,
      definition,
      definitionChecksum: audienceDefinitionChecksum(definition),
    }));
    printDefinitions(definitions);

    const records = new Map<string, EvaluationRecord>();
    for (const representative of definitions) {
      const evaluation = await runEvaluation(evaluateAudience, representative);
      records.set(representative.name, evaluation);
      (artifact.definitions as Array<unknown>)[definitions.indexOf(representative)] = evaluation;
      (artifact.performance as { evaluations: unknown[] }).evaluations.push({
        name: representative.name,
        result: evaluation.result,
      });
      printEvaluation(evaluation);
    }
    const expectedContextChecksum = sha256Stable(context);
    const contextConsistency = [...records.values()].map((record) => ({ name: record.name, ok: record.contextChecksum === expectedContextChecksum, contextChecksum: record.contextChecksum, expectedContextChecksum }));
    artifact.contextConsistency = contextConsistency;
    if (contextConsistency.some((check) => !check.ok)) throw new Error('A representative definition changed the resolved context');

    artifact.determinism = await runDeterminism(evaluateAudience, definitions, records);
    artifact.semanticProbes = await runSemanticProbes(connection.queryExecutor, sqlExecutor, evaluateAudience, context, records);
    artifact.failureProbes = await runFailureProbes(evaluateAudience, contextResolver, sqlExecutor);
    artifact.explain = await runExplain(connection.queryExecutor, context, definitions);
    const pathologies = inspectExplain(artifact.explain as ExplainRecord[], context.population.populationSize);
    (artifact.performance as { evaluations: unknown[]; pathologies: unknown[] }).pathologies = [...pathologies];
    artifact.indexDecision = decideIndexChange(pathologies);
    artifact.operationalStatus = contextChecks.every((check) => check.ok) ? 'COMPLETED' : 'COMPLETED_WITH_CONTEXT_MISMATCH';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (artifact.errors as string[]).push(message);
    print(`RUNNER_ERROR: ${message}`);
  } finally {
    if (connection) await connection.close();
    await mkdir('artifacts/customer-intelligence-audience', { recursive: true });
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    print(`ARTIFACT: ${ARTIFACT_PATH}`);
    print(`A01_OPERATIONAL_STATUS: ${String(artifact.operationalStatus)}`);
  }
}

function openConnection(): OperationalConnection {
  if (config.analyticsDb) {
    return { source: 'ANALYTICS_DB', pool: getAnalyticsPool(), queryExecutor: getAnalyticsQueryExecutor(), close: closeAnalyticsPool };
  }
  if (config.rfmSnapshotDb) {
    return { source: 'RFM_SNAPSHOT_DB_RUNNER_COMPATIBILITY_FALLBACK', pool: getRfmSnapshotPool(), queryExecutor: getRfmSnapshotQueryExecutor(), close: closeRfmSnapshotPool };
  }
  throw new Error('No ANALYTICS_DB_* or RFM_SNAPSHOT_DB_* analytics connection is configured');
}

async function readHeaderEvidence(queryExecutor: QueryExecutor, context: AudienceEvaluationContextV1): Promise<Record<string, unknown>> {
  const [feature, clv, affinity] = await Promise.all([
    queryExecutor.execute('SELECT id, status, reference_time AS referenceTime, population_size AS populationSize, feature_dataset_checksum AS featureDatasetChecksum FROM customer_feature_snapshot WHERE id = ? LIMIT 1', [context.lineage.feature.snapshotId]),
    context.lineage.clv ? queryExecutor.execute('SELECT id, status, reference_time AS referenceTime, population_size AS populationSize FROM customer_clv_snapshot WHERE id = ? LIMIT 1', [context.lineage.clv.snapshotId]) : Promise.resolve([] as RowDataPacket[]),
    context.lineage.commercialAffinity ? queryExecutor.execute('SELECT id, status, reference_time AS referenceTime, eligible_population_checksum AS populationChecksum, eligible_customer_count AS eligibleCustomerCount FROM customer_commercial_affinity_snapshot WHERE id = ? LIMIT 1', [context.lineage.commercialAffinity.snapshotId]) : Promise.resolve([] as RowDataPacket[]),
  ]);
  return { feature: feature[0] ?? null, clv: clv[0] ?? null, commercialAffinity: affinity[0] ?? null };
}

function verifyContext(context: AudienceEvaluationContextV1, evidence: Record<string, unknown>): Array<{ readonly check: string; readonly ok: boolean; readonly actual: unknown; readonly expected: unknown }> {
  const checks: Array<{ check: string; ok: boolean; actual: unknown; expected: unknown }> = [];
  for (const component of ['feature', 'rfm', 'cluster', 'clv', 'commercialAffinity'] as const) {
    const actual = component === 'feature' ? context.lineage.feature.snapshotId : context.lineage[component]?.snapshotId ?? null;
    const expected = EXPECTED_CONTEXT_IDS[component];
    checks.push({ check: `${component}.snapshotId`, ok: actual === expected, actual, expected });
  }
  checks.push({ check: 'affinity.populationChecksum', ok: context.lineage.commercialAffinity?.populationChecksum === EXPECTED_AFFINITY_CHECKSUM, actual: context.lineage.commercialAffinity?.populationChecksum ?? null, expected: EXPECTED_AFFINITY_CHECKSUM });
  const featureTime = Date.parse(context.lineage.feature.referenceTime);
  for (const component of ['rfm', 'cluster', 'clv', 'commercialAffinity'] as const) {
    const referenceTime = context.lineage[component]?.referenceTime ?? null;
    checks.push({ check: `${component}.referenceTime<=feature.referenceTime`, ok: referenceTime === null || Date.parse(referenceTime) <= featureTime, actual: referenceTime, expected: `<= ${context.lineage.feature.referenceTime}` });
  }
  const featureEvidence = evidence.feature as RowDataPacket | null;
  const clvEvidence = evidence.clv as RowDataPacket | null;
  checks.push({ check: 'feature.populationSize', ok: Number(featureEvidence?.populationSize) === 45196, actual: featureEvidence?.populationSize ?? null, expected: 45196 });
  checks.push({ check: 'clv.populationSize', ok: clvEvidence !== null && Number(clvEvidence.populationSize) === 45195, actual: clvEvidence?.populationSize ?? null, expected: 45195 });
  return checks;
}

async function discoverRealValues(queryExecutor: QueryExecutor, context: AudienceEvaluationContextV1): Promise<{ readonly status: 'available'; readonly values: DiscoveredAudienceValues } | { readonly status: 'unavailable'; readonly reason: string }> {
  if (!context.lineage.rfm || !context.lineage.cluster || !context.lineage.commercialAffinity) return { status: 'unavailable', reason: 'RFM, cluster, and affinity context are all required for real-value discovery' };
  const [rfmRows, clusterRows, affinityRows] = await Promise.all([
    queryExecutor.execute('SELECT segment_code AS segmentCode, segment_version AS segmentVersion FROM customer_rfm_snapshot_row WHERE snapshot_id = ? AND segment_code IS NOT NULL AND segment_version IS NOT NULL ORDER BY prestashop_customer_id ASC LIMIT 1', [context.lineage.rfm.snapshotId]),
    queryExecutor.execute('SELECT cluster_id AS clusterId FROM customer_cluster_snapshot_row WHERE snapshot_id = ? ORDER BY prestashop_customer_id ASC LIMIT 1', [context.lineage.cluster.snapshotId]),
    queryExecutor.execute('SELECT affinity_axis AS axis, affinity_code AS code FROM customer_commercial_affinity_snapshot_row WHERE snapshot_id = ? AND NOT (affinity_axis = ? AND affinity_code = ?) GROUP BY affinity_axis, affinity_code ORDER BY affinity_axis ASC, affinity_code ASC LIMIT 1', [context.lineage.commercialAffinity.snapshotId, HYROX.axis, HYROX.code]),
  ]);
  const rfm = rfmRows[0];
  const cluster = clusterRows[0];
  const second = affinityRows[0];
  if (!rfm || !cluster || !second) return { status: 'unavailable', reason: 'A bounded real-value discovery query returned no usable row' };
  const clusterId = Number(cluster.clusterId);
  if (!Number.isSafeInteger(clusterId)) return { status: 'unavailable', reason: 'Discovered clusterId is not a safe integer' };
  const axis = String(second.axis);
  if (!['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'].includes(axis)) return { status: 'unavailable', reason: `Discovered affinity axis is outside the fixed registry: ${axis}` };
  return {
    status: 'available',
    values: {
      rfmSegmentCode: String(rfm.segmentCode),
      rfmSegmentVersion: String(rfm.segmentVersion),
      clusterId,
      clusterModelVersion: context.lineage.cluster.modelVersion,
      secondAffinity: { axis: axis as AudienceAffinityAxisV1, code: String(second.code) },
    },
  };
}

async function runEvaluation(evaluateAudience: ReturnType<typeof createEvaluateAudience>, representative: RepresentativeAudienceDefinition): Promise<EvaluationRecord> {
  const definitionChecksum = audienceDefinitionChecksum(representative.definition);
  const result = await evaluateAudience({ definition: representative.definition, previewLimit: PREVIEW_LIMIT });
  if (result.status === 'completed') assertEvaluationInvariants(result, PREVIEW_LIMIT);
  const contextChecksum = result.context ? sha256Stable(result.context) : null;
  const record: EvaluationRecord = {
    name: representative.name,
    definition: representative.definition,
    definitionChecksum,
    contextChecksum,
    result: summarizeEvaluation(result),
  };
  return record;
}

function summarizeEvaluation(result: AudienceEvaluationResultV1): Record<string, unknown> {
  if (result.status === 'blocked') return { status: result.status, reason: result.reason, blockingComponents: result.blockingComponents, definitionChecksum: result.definitionChecksum, context: result.context };
  return {
    status: result.status,
    definitionChecksum: result.definitionChecksum,
    contextChecksum: sha256Stable(result.context),
    context: result.context,
    populationUniverseCount: result.populationUniverseCount,
    trueCount: result.trueCount,
    falseCount: result.falseCount,
    unknownCount: result.unknownCount,
    matchedCount: result.matchedCount,
    previewMembers: result.previewMembers,
    truncated: result.truncated,
    queryDurationMs: result.performance.queryDurationMs,
    totalDurationMs: result.performance.totalDurationMs,
  };
}

async function runDeterminism(evaluateAudience: ReturnType<typeof createEvaluateAudience>, definitions: readonly RepresentativeAudienceDefinition[], first: ReadonlyMap<string, EvaluationRecord>): Promise<readonly Record<string, unknown>[]> {
  const checks: Record<string, unknown>[] = [];
  for (const name of ['FEATURE', 'AFFINITY', 'MIXED'] as const) {
    const representative = definitions.find((candidate) => candidate.name === name);
    const initial = first.get(name);
    if (!representative || !initial) { checks.push({ name, equal: false, reason: 'Representative definition unavailable' }); continue; }
    const second = await evaluateAudience({ definition: representative.definition, previewLimit: PREVIEW_LIMIT });
    if (second.status === 'completed') assertEvaluationInvariants(second, PREVIEW_LIMIT);
    let equal = false;
    let reason: string | null = null;
    if (initial.result.status !== 'completed' || second.status !== 'completed') reason = 'At least one evaluation was blocked';
    else equal = sameSummaryFingerprint(initial.result, second);
    checks.push({ name, equal, reason, first: initial.result, second: summarizeEvaluation(second) });
  }
  return checks;
}

function sameSummaryFingerprint(first: Record<string, unknown>, second: AudienceEvaluationResultV1): boolean {
  if (second.status !== 'completed') return false;
  const fingerprint = (result: Record<string, unknown>): Record<string, unknown> => ({
    definitionChecksum: result.definitionChecksum,
    context: result.context,
    populationUniverseCount: result.populationUniverseCount,
    trueCount: result.trueCount,
    falseCount: result.falseCount,
    unknownCount: result.unknownCount,
    matchedCount: result.matchedCount,
    previewCustomerIds: (result.previewMembers as Array<{ customerId: number }>).map((member) => member.customerId),
  });
  return JSON.stringify(fingerprint(first)) === JSON.stringify(fingerprint(summarizeEvaluation(second)));
}

async function runSemanticProbes(queryExecutor: QueryExecutor, sqlExecutor: ReturnType<typeof createMysqlAudienceSqlExecutor>, evaluateAudience: ReturnType<typeof createEvaluateAudience>, context: AudienceEvaluationContextV1, records: ReadonlyMap<string, EvaluationRecord>): Promise<Record<string, unknown>> {
  const affinitySnapshotId = context.lineage.commercialAffinity?.snapshotId;
  if (!affinitySnapshotId) return { affinity: { status: 'UNAVAILABLE', reason: 'Affinity context unavailable' }, nullSemantics: { status: 'UNAVAILABLE', reason: 'Affinity context unavailable' } };
  const [trueRows, falseRows, unknownRows] = await Promise.all([
    queryExecutor.execute('SELECT p.customer_id AS customerId FROM customer_commercial_affinity_snapshot_population p INNER JOIN customer_commercial_affinity_snapshot_row r ON r.snapshot_id = p.snapshot_id AND r.customer_id = p.customer_id AND r.affinity_axis = ? AND r.affinity_code = ? WHERE p.snapshot_id = ? ORDER BY p.customer_id ASC LIMIT 1', [HYROX.axis, HYROX.code, affinitySnapshotId]),
    queryExecutor.execute('SELECT p.customer_id AS customerId FROM customer_commercial_affinity_snapshot_population p WHERE p.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_row r WHERE r.snapshot_id = p.snapshot_id AND r.customer_id = p.customer_id AND r.affinity_axis = ? AND r.affinity_code = ?) ORDER BY p.customer_id ASC LIMIT 1', [affinitySnapshotId, HYROX.axis, HYROX.code]),
    queryExecutor.execute('SELECT fr.prestashop_customer_id AS customerId FROM customer_feature_snapshot_row fr WHERE fr.snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM customer_commercial_affinity_snapshot_population p WHERE p.snapshot_id = ? AND p.customer_id = fr.prestashop_customer_id) ORDER BY fr.prestashop_customer_id ASC LIMIT 1', [context.lineage.feature.snapshotId, affinitySnapshotId]),
  ]);
  const affinityDefinition = records.get('AFFINITY')?.definition;
  const affinityTruths = affinityDefinition ? await sqlExecutor.execute(compileAudienceSql(context, affinityDefinition.root)) : [];
  const truthByCustomer = new Map(affinityTruths.map((row) => [row.customerId, normalizeTruth(row.truth)]));
  const probes = {
    status: 'COMPLETED',
    trueCustomerId: idFrom(trueRows[0]),
    falseCustomerId: idFrom(falseRows[0]),
    unknownCustomerId: idFrom(unknownRows[0]),
    trueTruth: truthByCustomer.get(idFrom(trueRows[0]) ?? -1) ?? null,
    falseTruth: truthByCustomer.get(idFrom(falseRows[0]) ?? -1) ?? null,
    unknownTruth: truthByCustomer.get(idFrom(unknownRows[0]) ?? -1) ?? null,
  };
  const affinityOk = probes.trueTruth === 'TRUE' && probes.falseTruth === 'FALSE' && probes.unknownTruth === 'UNKNOWN';
  const nullProbe = await runNullProbe(queryExecutor, sqlExecutor, evaluateAudience, context);
  return { affinity: { ...probes, ok: affinityOk }, nullSemantics: nullProbe };
}

async function runNullProbe(queryExecutor: QueryExecutor, sqlExecutor: ReturnType<typeof createMysqlAudienceSqlExecutor>, evaluateAudience: ReturnType<typeof createEvaluateAudience>, context: AudienceEvaluationContextV1): Promise<Record<string, unknown>> {
  const [nullRows, missingRfmRows] = await Promise.all([
    queryExecutor.execute('SELECT prestashop_customer_id AS customerId FROM customer_feature_snapshot_row WHERE snapshot_id = ? AND purchase_frequency_days IS NULL ORDER BY prestashop_customer_id ASC LIMIT 1', [context.lineage.feature.snapshotId]),
    context.lineage.rfm ? queryExecutor.execute('SELECT fr.prestashop_customer_id AS customerId FROM customer_feature_snapshot_row fr LEFT JOIN customer_rfm_snapshot_row rr ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id WHERE fr.snapshot_id = ? AND rr.prestashop_customer_id IS NULL ORDER BY fr.prestashop_customer_id ASC LIMIT 1', [context.lineage.rfm.snapshotId, context.lineage.feature.snapshotId]) : Promise.resolve([] as RowDataPacket[]),
  ]);
  const nullCustomerId = idFrom(nullRows[0]);
  const missingRfmCustomerId = idFrom(missingRfmRows[0]);
  const nullDefinition: AudienceDefinitionV1 = { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'commercial.purchaseFrequencyDays', operator: 'IS_NULL' } };
  const missingDefinition: AudienceDefinitionV1 = { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'rfm.recencyDays', operator: 'IS_NULL' } };
  const nullResult = await evaluateAudience({ definition: nullDefinition, previewLimit: PREVIEW_LIMIT });
  const missingResult = await evaluateAudience({ definition: missingDefinition, previewLimit: PREVIEW_LIMIT });
  const nullTruths = nullResult.status === 'completed' ? await sqlExecutor.execute(compileAudienceSql(context, nullDefinition.root)) : [];
  const missingTruths = missingResult.status === 'completed' ? await sqlExecutor.execute(compileAudienceSql(context, missingDefinition.root)) : [];
  const nullTruth = nullTruths.find((row) => row.customerId === nullCustomerId);
  const missingTruth = missingTruths.find((row) => row.customerId === missingRfmCustomerId);
  return {
    field: 'commercial.purchaseFrequencyDays',
    actualNullCustomerId: nullCustomerId,
    actualNullTruth: nullTruth ? normalizeTruth(nullTruth.truth) : null,
    missingReferencedComponent: 'rfm.recencyDays',
    missingRfmCustomerId,
    missingComponentTruth: missingTruth ? normalizeTruth(missingTruth.truth) : null,
    status: nullCustomerId === undefined || missingRfmCustomerId === undefined ? 'UNAVAILABLE' : 'COMPLETED',
    ok: nullCustomerId !== undefined && missingRfmCustomerId !== undefined && normalizeTruth(nullTruth?.truth) === 'TRUE' && normalizeTruth(missingTruth?.truth) === 'UNKNOWN',
  };
}

async function runFailureProbes(evaluateAudience: ReturnType<typeof createEvaluateAudience>, contextResolver: ReturnType<typeof createAudienceContextResolver>, sqlExecutor: ReturnType<typeof createMysqlAudienceSqlExecutor>): Promise<readonly Record<string, unknown>[]> {
  let sqlCalls = 0;
  const countingEvaluator = createEvaluateAudience({ contextResolver, sqlExecutor: { execute: async (compiled) => { sqlCalls += 1; return sqlExecutor.execute(compiled); } } });
  const invalid = await countingEvaluator({ definition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'not.allowed', operator: 'EQ', value: 1 } } });
  const callsAfterInvalid = sqlCalls;
  const excessiveIn = await countingEvaluator({ definition: { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'SCALAR', field: 'commercial.validOrders', operator: 'IN', value: Array.from({ length: 501 }, (_, index) => index) } } });
  const callsAfterExcessiveIn = sqlCalls;
  const unknownAffinityDefinition: AudienceDefinitionV1 = { definitionVersion: 'customer-intelligence-audience-definition-v1', root: { kind: 'HAS_AFFINITY', axis: 'DISCIPLINE', code: 'A01_1_SYNTAX_ONLY_PROBE' } };
  const unknownValidation = validateAudienceDefinition(unknownAffinityDefinition);
  const unknownEvaluation = await countingEvaluator({ definition: unknownAffinityDefinition, previewLimit: PREVIEW_LIMIT });
  return [
    { name: 'invalid field rejected before SQL', ok: invalid.status === 'blocked' && invalid.reason === 'INVALID_DEFINITION' && callsAfterInvalid === 0, result: summarizeEvaluation(invalid) },
    { name: 'IN > 500 rejected before SQL', ok: excessiveIn.status === 'blocked' && excessiveIn.reason === 'INVALID_DEFINITION' && callsAfterExcessiveIn === 0, result: summarizeEvaluation(excessiveIn) },
    { name: 'unknown affinity code is syntax-valid', ok: unknownValidation.ok && unknownEvaluation.status !== 'blocked' || (unknownValidation.ok && unknownEvaluation.status === 'blocked' && unknownEvaluation.reason !== 'INVALID_DEFINITION'), validation: unknownValidation, result: summarizeEvaluation(unknownEvaluation) },
  ];
}

async function runExplain(queryExecutor: QueryExecutor, context: AudienceEvaluationContextV1, definitions: readonly RepresentativeAudienceDefinition[]): Promise<readonly ExplainRecord[]> {
  const retained = new Set(['FEATURE', 'RAW_RFM', 'CLUSTER', 'CLV', 'AFFINITY', 'MIXED']);
  const results: ExplainRecord[] = [];
  for (const representative of definitions) {
    if (!retained.has(representative.name)) continue;
    const compiled = compileAudienceSql(context, representative.definition.root);
    const rows = await queryExecutor.execute(`EXPLAIN ${compiled.sql}`, compiled.params);
    results.push({ name: representative.name, definitionChecksum: audienceDefinitionChecksum(representative.definition), rows: rows.map((row) => ({ table: row.table ?? null, type: row.type ?? null, possible_keys: row.possible_keys ?? null, key: row.key ?? null, rows: row.rows ?? null, Extra: row.Extra ?? null })) });
  }
  return results;
}

function inspectExplain(plans: readonly ExplainRecord[], populationSize: number): readonly Record<string, unknown>[] {
  const pathologies: Record<string, unknown>[] = [];
  for (const plan of plans) for (const row of plan.rows) {
    const table = String(row.table ?? '');
    const estimatedRows = Number(row.rows);
    if (table !== 'fr' && table !== 'cr' && table !== 'rr' && table !== 'cv' && table !== 'ap' && table !== 'ar' && row.type === 'ALL') continue;
    if (table !== 'fr' && row.type === 'ALL' && Number.isFinite(estimatedRows) && estimatedRows > populationSize) pathologies.push({ definition: plan.name, ...row, reason: 'Secondary table full scan exceeds feature population estimate' });
  }
  return pathologies;
}

function decideIndexChange(pathologies: readonly Record<string, unknown>[]): Record<string, unknown> {
  if (pathologies.length === 0) return { decision: 'NO_INDEX_CHANGE_REQUIRED', rationale: 'No clearly pathological secondary access path was observed; no index migration is created.' };
  return { decision: 'INDEX_CHANGE_RECOMMENDED', rationale: 'A secondary table full scan exceeds the feature population estimate; review the existing composite access path before adding any migration.', evidence: pathologies, recommendedShapes: ['customer_rfm_snapshot_row(snapshot_id, prestashop_customer_id)', 'customer_cluster_snapshot_row(snapshot_id, prestashop_customer_id)', 'customer_clv_snapshot_row(snapshot_id, customer_id)', 'customer_commercial_affinity_snapshot_population(snapshot_id, customer_id)', 'customer_commercial_affinity_snapshot_row(snapshot_id, customer_id, affinity_axis, affinity_code)'] };
}

function idFrom(row: RowDataPacket | undefined): number | undefined {
  if (!row || row.customerId === null || row.customerId === undefined) return undefined;
  const id = Number(row.customerId);
  return Number.isSafeInteger(id) ? id : undefined;
}

function normalizeTruth(value: unknown): AudienceTruthV1 {
  return value === 'TRUE' || value === 1 || value === '1' ? 'TRUE' : value === 'FALSE' || value === 0 || value === '0' ? 'FALSE' : 'UNKNOWN';
}

function printContext(resolution: Awaited<ReturnType<ReturnType<typeof createAudienceContextResolver>['resolveCurrent']>>): void {
  print(`CONTEXT_RESOLUTION: ${JSON.stringify(resolution)}`);
}

function printDiscovery(discovery: Awaited<ReturnType<typeof discoverRealValues>>): void {
  print(`REAL_VALUE_DISCOVERY: ${JSON.stringify(discovery)}`);
}

function printDefinitions(definitions: readonly RepresentativeAudienceDefinition[]): void {
  print(`DEFINITIONS: ${JSON.stringify(definitions.map(({ name, definition }) => ({ name, definitionChecksum: audienceDefinitionChecksum(definition), definition })))}`);
}

function printEvaluation(evaluation: EvaluationRecord): void {
  print(`EVALUATION ${evaluation.name}: ${JSON.stringify(evaluation.result)}`);
}

function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
