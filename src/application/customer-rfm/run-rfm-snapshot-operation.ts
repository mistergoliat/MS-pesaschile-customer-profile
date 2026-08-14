import {
  buildRfmSnapshotWindow,
  buildSnapshotKey,
  rfmCommercialSegmentVersion,
  type RfmCommercialSegmentCode,
  type RfmSnapshotManifest,
} from '../../domain/customer-rfm/index.js';
import type { RfmCanonicalIdentityResolver } from './ports.js';
import {
  createRfmSnapshot,
  type CreateRfmSnapshotResult,
  type RfmSnapshotRepository,
} from './create-rfm-snapshot.js';
import type { RfmPopulationReader } from '../../infrastructure/prestashop/mysql-rfm-population-reader.js';
import type {
  RfmSnapshotRunRepository,
  RfmSnapshotRunSummary,
  RfmSnapshotRunTriggerSource,
} from '../../infrastructure/rfm/mysql-rfm-snapshot-run-repository.js';

type Clock = {
  now(): Date;
};

export type RunRfmSnapshotOperationInput = {
  readonly triggerSource: RfmSnapshotRunTriggerSource;
  readonly calculationVersion: string;
  readonly dryRun: boolean;
  readonly referenceTime: string | null;
  readonly generatedAt: string | null;
};

export type RunRfmSnapshotOperationResult = {
  readonly runId: string | null;
  readonly triggerSource: RfmSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateRfmSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly segmentVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: RfmSnapshotRunSummary | null;
  readonly manifest: RfmSnapshotManifest | null;
};

export async function runRfmSnapshotOperation(
  input: RunRfmSnapshotOperationInput,
  deps: {
    readonly reader: RfmPopulationReader;
    readonly canonicalIdentityResolver: RfmCanonicalIdentityResolver;
    readonly repository?: RfmSnapshotRepository;
    readonly runRepository?: RfmSnapshotRunRepository;
    readonly clock: Clock;
  },
): Promise<RunRfmSnapshotOperationResult> {
  const startedAt = deps.clock.now().toISOString();
  const generatedAt = input.generatedAt ?? startedAt;
  const referenceTime = input.referenceTime ?? buildScheduledReferenceTime(deps.clock.now());
  const snapshotKey = buildSnapshotKey(buildRfmSnapshotWindow(referenceTime).referenceTime, input.calculationVersion);

  if (input.dryRun) {
    const completed = await createRfmSnapshot(
      {
        referenceTime,
        calculationVersion: input.calculationVersion,
        generatedAt,
        dryRun: true,
      },
      {
        reader: deps.reader,
        canonicalIdentityResolver: deps.canonicalIdentityResolver,
      },
    );

    return buildCompletedResult({
      runId: null,
      triggerSource: input.triggerSource,
      status: 'succeeded',
      mode: completed.mode,
      startedAt,
      completedAt: deps.clock.now().toISOString(),
      referenceTime,
      calculationVersion: input.calculationVersion,
      snapshotKey,
      snapshotId: completed.snapshotId,
      skipReason: null,
      errorType: null,
      errorCode: null,
      summary: buildRunSummary(completed.manifest, completed.rows.length),
      manifest: completed.manifest,
    });
  }

  if (!deps.repository || !deps.runRepository) {
    throw new Error('RFM snapshot repository and run repository are required outside dry-run');
  }

  const executionLock = await deps.runRepository.tryAcquireExecutionLock();
  if (!executionLock) {
    const runId = await deps.runRepository.createRun({
      triggerSource: input.triggerSource,
      status: 'skipped',
      referenceTime,
      calculationVersion: input.calculationVersion,
      segmentVersion: rfmCommercialSegmentVersion,
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
      referenceTime,
      calculationVersion: input.calculationVersion,
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
      referenceTime,
      calculationVersion: input.calculationVersion,
      segmentVersion: rfmCommercialSegmentVersion,
      snapshotKey,
      startedAt,
      completedAt: null,
      snapshotId: null,
      errorType: null,
      errorCode: null,
      skipReason: null,
      summary: null,
    });

    const completed = await createRfmSnapshot(
      {
        referenceTime,
        calculationVersion: input.calculationVersion,
        generatedAt,
        dryRun: false,
      },
      {
        reader: deps.reader,
        canonicalIdentityResolver: deps.canonicalIdentityResolver,
        repository: deps.repository,
      },
    );

    const completedAt = deps.clock.now().toISOString();
    const status = completed.mode === 'skipped_existing' ? 'skipped' : 'succeeded';
    const skipReason = completed.mode === 'skipped_existing' ? 'snapshot_already_published' : null;
    const summary = buildRunSummary(completed.manifest, completed.rows.length);
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
      referenceTime,
      calculationVersion: input.calculationVersion,
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
    const meta = getRfmSnapshotErrorMeta(error);
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

export function buildScheduledReferenceTime(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function getRfmSnapshotErrorMeta(error: unknown): { errorType: string; errorCode: string } {
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
  readonly triggerSource: RfmSnapshotRunTriggerSource;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly mode: CreateRfmSnapshotResult['mode'] | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly skipReason: string | null;
  readonly errorType: string | null;
  readonly errorCode: string | null;
  readonly summary: RfmSnapshotRunSummary | null;
  readonly manifest: RfmSnapshotManifest | null;
}): RunRfmSnapshotOperationResult {
  return {
    ...input,
    segmentVersion: rfmCommercialSegmentVersion,
    durationMs: new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime(),
  };
}

function buildRunSummary(manifest: RfmSnapshotManifest, populationSize: number): RfmSnapshotRunSummary {
  return {
    populationSize,
    canonicalMatchedCount: manifest.canonicalMatchedCount,
    canonicalUnmatchedCount: manifest.canonicalUnmatchedCount,
    canonicalAmbiguousCount: manifest.canonicalAmbiguousCount,
    canonicalCoveragePct: manifest.canonicalCoveragePct,
    segmentCounts: manifest.segmentCounts as Record<RfmCommercialSegmentCode, number>,
  };
}
