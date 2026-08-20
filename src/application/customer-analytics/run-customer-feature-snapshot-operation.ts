import { buildCustomerFeatureSnapshotKey } from '../../domain/customer-analytics/index.js';
import type { CustomerFeatureSnapshotManifest } from '../../domain/customer-analytics/index.js';
import { createCustomerFeatureSnapshot, type CreateCustomerFeatureSnapshotResult } from './create-customer-feature-snapshot.js';
import type { CustomerFeatureReader, CustomerFeatureSnapshotRepository } from './ports.js';
import type {
  CustomerFeatureSnapshotRunRepository,
  CustomerFeatureSnapshotRunSummary,
  CustomerFeatureSnapshotRunTriggerSource,
} from '../../infrastructure/customer-analytics/mysql-customer-feature-snapshot-run-repository.js';

type Clock = { now(): Date };

export type RunCustomerFeatureSnapshotOperationInput = {
  readonly triggerSource: CustomerFeatureSnapshotRunTriggerSource;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly dryRun: boolean;
  readonly referenceTime: string;
  readonly referenceTimeMysql: string;
  readonly generatedAt: string | null;
};

export type RunCustomerFeatureSnapshotOperationResult = {
  readonly runId: string | null;
  readonly triggerSource: CustomerFeatureSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateCustomerFeatureSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: CustomerFeatureSnapshotRunSummary | null;
  readonly manifest: CustomerFeatureSnapshotManifest | null;
  readonly priorSnapshotId: string | null;
};

// Mirrors run-cluster-snapshot-operation.ts's execution-lock + run-log orchestration exactly
// — same idempotency guarantee, same fail-closed behavior on error (task Section 25). The one
// addition is mapping mode 'source_drift_detected' to a 'skipped' run (skipReason
// 'source_drift_detected'): nothing new was published, but it is not an operator/system
// error either — PrestaShop genuinely changed retroactively under an already-published
// referenceTime (task Section 28).
export async function runCustomerFeatureSnapshotOperation(
  input: RunCustomerFeatureSnapshotOperationInput,
  deps: {
    readonly reader: CustomerFeatureReader;
    readonly repository?: CustomerFeatureSnapshotRepository;
    readonly runRepository?: CustomerFeatureSnapshotRunRepository;
    readonly clock: Clock;
  },
): Promise<RunCustomerFeatureSnapshotOperationResult> {
  const startedAt = deps.clock.now().toISOString();
  const generatedAt = input.generatedAt ?? startedAt;
  const snapshotKey = buildCustomerFeatureSnapshotKey(input.featureVersion, input.populationPolicyVersion, input.referenceTime);

  if (input.dryRun) {
    const completed = await createCustomerFeatureSnapshot(
      {
        featureVersion: input.featureVersion,
        populationPolicyVersion: input.populationPolicyVersion,
        operationalExclusionPolicyVersion: input.operationalExclusionPolicyVersion,
        shopScope: input.shopScope,
        referenceTime: input.referenceTime,
        referenceTimeMysql: input.referenceTimeMysql,
        generatedAt,
        dryRun: true,
      },
      { reader: deps.reader },
    );
    return buildCompletedResult({
      runId: null,
      triggerSource: input.triggerSource,
      status: 'succeeded',
      mode: completed.mode,
      startedAt,
      completedAt: deps.clock.now().toISOString(),
      referenceTime: input.referenceTime,
      featureVersion: input.featureVersion,
      snapshotKey,
      snapshotId: completed.snapshotId,
      skipReason: null,
      errorType: null,
      errorCode: null,
      summary: buildRunSummary(completed.manifest),
      manifest: completed.manifest,
      priorSnapshotId: completed.priorSnapshotId,
    });
  }

  if (!deps.repository || !deps.runRepository) {
    throw new Error('Customer feature snapshot repository and run repository are required outside dry-run');
  }

  const executionLock = await deps.runRepository.tryAcquireExecutionLock();
  if (!executionLock) {
    const runId = await deps.runRepository.createRun({
      triggerSource: input.triggerSource,
      status: 'skipped',
      referenceTime: input.referenceTime,
      featureVersion: input.featureVersion,
      snapshotKey,
      startedAt,
      completedAt: startedAt,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      skipReason: 'execution_lock_not_acquired',
      summary: null,
    });
    return buildCompletedResult({
      runId,
      triggerSource: input.triggerSource,
      status: 'skipped',
      mode: null,
      startedAt,
      completedAt: startedAt,
      referenceTime: input.referenceTime,
      featureVersion: input.featureVersion,
      snapshotKey,
      snapshotId: null,
      skipReason: 'execution_lock_not_acquired',
      errorType: null,
      errorCode: null,
      summary: null,
      manifest: null,
      priorSnapshotId: null,
    });
  }

  let runId: string | null = null;
  try {
    runId = await deps.runRepository.createRun({
      triggerSource: input.triggerSource,
      status: 'started',
      referenceTime: input.referenceTime,
      featureVersion: input.featureVersion,
      snapshotKey,
      startedAt,
      completedAt: null,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      skipReason: null,
      summary: null,
    });

    const completed = await createCustomerFeatureSnapshot(
      {
        featureVersion: input.featureVersion,
        populationPolicyVersion: input.populationPolicyVersion,
        operationalExclusionPolicyVersion: input.operationalExclusionPolicyVersion,
        shopScope: input.shopScope,
        referenceTime: input.referenceTime,
        referenceTimeMysql: input.referenceTimeMysql,
        generatedAt,
        dryRun: false,
      },
      { reader: deps.reader, repository: deps.repository },
    );

    const completedAt = deps.clock.now().toISOString();
    const status = completed.mode === 'persisted' ? 'succeeded' : 'skipped';
    const skipReason =
      completed.mode === 'skipped_existing'
        ? 'snapshot_already_published'
        : completed.mode === 'source_drift_detected'
          ? 'source_drift_detected'
          : null;
    const summary = buildRunSummary(completed.manifest);
    await deps.runRepository.completeRun({
      runId,
      status,
      completedAt,
      snapshotId: completed.snapshotId,
      errorType: null,
      errorCode: null,
      skipReason,
      summary,
    });

    return buildCompletedResult({
      runId,
      triggerSource: input.triggerSource,
      status,
      mode: completed.mode,
      startedAt,
      completedAt,
      referenceTime: input.referenceTime,
      featureVersion: input.featureVersion,
      snapshotKey,
      snapshotId: completed.snapshotId,
      skipReason,
      errorType: null,
      errorCode: null,
      summary,
      manifest: completed.manifest,
      priorSnapshotId: completed.priorSnapshotId,
    });
  } catch (error) {
    const completedAt = deps.clock.now().toISOString();
    const meta = getCustomerFeatureSnapshotErrorMeta(error);
    if (runId) {
      await deps.runRepository.completeRun({
        runId,
        status: 'failed',
        completedAt,
        snapshotId: null,
        errorType: meta.errorType,
        errorCode: meta.errorCode,
        skipReason: null,
        summary: null,
      });
    }
    throw error;
  } finally {
    await executionLock.release();
  }
}

export function getCustomerFeatureSnapshotErrorMeta(error: unknown): { errorType: string; errorCode: string } {
  const errorType =
    error instanceof Error && error.name.trim() !== ''
      ? error.name
      : typeof error === 'object' && error !== null && 'constructor' in error
        ? String((error as { constructor?: { name?: string } }).constructor?.name ?? 'Error')
        : 'Error';
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : errorType;
  return { errorType, errorCode };
}

function buildCompletedResult(input: {
  readonly runId: string | null;
  readonly triggerSource: CustomerFeatureSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateCustomerFeatureSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: CustomerFeatureSnapshotRunSummary | null;
  readonly manifest: CustomerFeatureSnapshotManifest | null;
  readonly priorSnapshotId: string | null;
}): RunCustomerFeatureSnapshotOperationResult {
  return {
    ...input,
    durationMs: new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime(),
  };
}

function buildRunSummary(manifest: CustomerFeatureSnapshotManifest): CustomerFeatureSnapshotRunSummary {
  return {
    populationSize: manifest.populationSize,
    sourceDatasetChecksum: manifest.sourceDatasetChecksum,
    featureDatasetChecksum: manifest.featureDatasetChecksum,
  };
}
