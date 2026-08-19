import { buildClusterSnapshotKey, type ClusterModelArtifact, type ClusterSnapshotManifest } from '../../domain/customer-clustering/index.js';
import { createClusterSnapshot, type CreateClusterSnapshotResult } from './create-cluster-snapshot.js';
import type { ClusterPopulationReader, ClusterSnapshotRepository } from './ports.js';
import type {
  ClusterSnapshotRunRepository,
  ClusterSnapshotRunSummary,
  ClusterSnapshotRunTriggerSource,
} from '../../infrastructure/clustering/mysql-cluster-snapshot-run-repository.js';

type Clock = { now(): Date };

export type RunClusterSnapshotOperationInput = {
  readonly triggerSource: ClusterSnapshotRunTriggerSource;
  readonly artifact: ClusterModelArtifact;
  readonly modelId: string;
  readonly dryRun: boolean;
  readonly referenceTime: string;
  readonly generatedAt: string | null;
};

export type RunClusterSnapshotOperationResult = {
  readonly runId: string | null;
  readonly triggerSource: ClusterSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateClusterSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly referenceTime: string;
  readonly modelVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: ClusterSnapshotRunSummary | null;
  readonly manifest: ClusterSnapshotManifest | null;
};

// Mirrors run-rfm-snapshot-operation.ts's execution-lock + run-log orchestration exactly —
// same idempotency guarantee, same fail-closed behavior on error (task Section 25).
export async function runClusterSnapshotOperation(
  input: RunClusterSnapshotOperationInput,
  deps: {
    readonly reader: ClusterPopulationReader;
    readonly repository?: ClusterSnapshotRepository;
    readonly runRepository?: ClusterSnapshotRunRepository;
    readonly clock: Clock;
  },
): Promise<RunClusterSnapshotOperationResult> {
  const startedAt = deps.clock.now().toISOString();
  const generatedAt = input.generatedAt ?? startedAt;
  const snapshotKey = buildClusterSnapshotKey(input.artifact.modelVersion, input.artifact.populationPolicyVersion, input.referenceTime);

  if (input.dryRun) {
    const completed = await createClusterSnapshot(
      {
        artifact: input.artifact,
        modelId: input.modelId,
        referenceTime: input.referenceTime,
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
      modelVersion: input.artifact.modelVersion,
      snapshotKey,
      snapshotId: completed.snapshotId,
      skipReason: null,
      errorType: null,
      errorCode: null,
      summary: buildRunSummary(completed.manifest),
      manifest: completed.manifest,
    });
  }

  if (!deps.repository || !deps.runRepository) {
    throw new Error('Cluster snapshot repository and run repository are required outside dry-run');
  }

  const executionLock = await deps.runRepository.tryAcquireExecutionLock();
  if (!executionLock) {
    const runId = await deps.runRepository.createRun({
      triggerSource: input.triggerSource,
      status: 'skipped',
      referenceTime: input.referenceTime,
      modelVersion: input.artifact.modelVersion,
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
      modelVersion: input.artifact.modelVersion,
      snapshotKey,
      snapshotId: null,
      skipReason: 'execution_lock_not_acquired',
      errorType: null,
      errorCode: null,
      summary: null,
      manifest: null,
    });
  }

  let runId: string | null = null;
  try {
    runId = await deps.runRepository.createRun({
      triggerSource: input.triggerSource,
      status: 'started',
      referenceTime: input.referenceTime,
      modelVersion: input.artifact.modelVersion,
      snapshotKey,
      startedAt,
      completedAt: null,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      skipReason: null,
      summary: null,
    });

    const completed = await createClusterSnapshot(
      {
        artifact: input.artifact,
        modelId: input.modelId,
        referenceTime: input.referenceTime,
        generatedAt,
        dryRun: false,
      },
      { reader: deps.reader, repository: deps.repository },
    );

    const completedAt = deps.clock.now().toISOString();
    const status = completed.mode === 'skipped_existing' ? 'skipped' : 'succeeded';
    const skipReason = completed.mode === 'skipped_existing' ? 'snapshot_already_published' : null;
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
      modelVersion: input.artifact.modelVersion,
      snapshotKey,
      snapshotId: completed.snapshotId,
      skipReason,
      errorType: null,
      errorCode: null,
      summary,
      manifest: completed.manifest,
    });
  } catch (error) {
    const completedAt = deps.clock.now().toISOString();
    const meta = getClusterSnapshotErrorMeta(error);
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

export function getClusterSnapshotErrorMeta(error: unknown): { errorType: string; errorCode: string } {
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
  readonly triggerSource: ClusterSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateClusterSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly referenceTime: string;
  readonly modelVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: ClusterSnapshotRunSummary | null;
  readonly manifest: ClusterSnapshotManifest | null;
}): RunClusterSnapshotOperationResult {
  return {
    ...input,
    durationMs: new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime(),
  };
}

function buildRunSummary(manifest: ClusterSnapshotManifest): ClusterSnapshotRunSummary {
  return {
    populationSize: manifest.populationSize,
    clusterSizeDistribution: manifest.clusterSizeDistribution as Record<string, number>,
  };
}
