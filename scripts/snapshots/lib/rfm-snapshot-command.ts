import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { runRfmSnapshotOperation, getRfmSnapshotErrorMeta } from '../../../src/application/customer-rfm/run-rfm-snapshot-operation.js';
import { stableStringify, type RfmSnapshotManifest } from '../../../src/domain/customer-rfm/index.js';
import { createMysqlRfmCanonicalIdentityResolver } from '../../../src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.js';
import { createMysqlRfmSnapshotRepository } from '../../../src/infrastructure/rfm/mysql-rfm-snapshot-repository.js';
import { createMysqlRfmSnapshotRunRepository } from '../../../src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.js';
import { createQueryExecutor } from '../../../src/infrastructure/shared/query-executor.js';
import { createMysqlRfmPopulationReader } from '../../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';
import type { RfmSnapshotCliConfig, RfmSnapshotScheduledConfig } from '../../../src/rfm-snapshot-config.js';

type SnapshotCommandConfig = RfmSnapshotCliConfig | (RfmSnapshotScheduledConfig & { readonly dryRun: false; readonly referenceTime: null });

type CommandOptions = {
  readonly triggerSource: 'manual' | 'scheduled';
  readonly writeDryRunOutput: boolean;
};

const systemClock = {
  now: () => new Date(),
};

export async function runRfmSnapshotCommand(config: SnapshotCommandConfig, options: CommandOptions): Promise<void> {
  const prestashopPool = mysql.createPool({
    host: config.prestashopDb.host,
    port: config.prestashopDb.port,
    user: config.prestashopDb.user,
    password: config.prestashopDb.password,
    database: config.prestashopDb.database,
    connectionLimit: 1,
    dateStrings: true,
    timezone: 'Z',
  });

  const crmPool = mysql.createPool({
    host: config.crmDb.host,
    port: config.crmDb.port,
    user: config.crmDb.user,
    password: config.crmDb.password,
    database: config.crmDb.database,
    connectionLimit: 1,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  });

  const snapshotPool = config.snapshotDb
    ? mysql.createPool({
        host: config.snapshotDb.host,
        port: config.snapshotDb.port,
        user: config.snapshotDb.user,
        password: config.snapshotDb.password,
        database: config.snapshotDb.database,
        connectionLimit: config.snapshotDb.connectionLimit,
        supportBigNumbers: true,
        bigNumberStrings: true,
        // Required for calculatePersistedDatasetChecksum's re-read-and-verify step
        // (mysql-rfm-snapshot-repository.ts) to match the original checksum's string-typed
        // dates. Without this, mysql2 returns datetime(6) columns as JS Date objects, and
        // String(dateObject) produces a locale-formatted string instead of the MySQL
        // DATETIME format the checksum expects — every real (non-empty) snapshot would fail
        // publish-time verification. Confirmed directly (CP-R1-TRACK-A-A3B), not theoretical.
        dateStrings: true,
        timezone: 'Z',
      })
    : null;

  try {
    const result = await runRfmSnapshotOperation(
      {
        triggerSource: options.triggerSource,
        calculationVersion: config.calculationVersion,
        dryRun: config.dryRun,
        referenceTime: config.referenceTime,
        generatedAt: null,
      },
      {
        reader: createMysqlRfmPopulationReader(
          createQueryExecutor(prestashopPool, config.prestashopDb.queryTimeoutMs),
          config.prestashopDb.prefix,
        ),
        canonicalIdentityResolver: createMysqlRfmCanonicalIdentityResolver(
          createQueryExecutor(crmPool, config.crmDb.queryTimeoutMs),
        ),
        repository: snapshotPool ? createMysqlRfmSnapshotRepository(snapshotPool) : undefined,
        runRepository: snapshotPool ? createMysqlRfmSnapshotRunRepository(snapshotPool) : undefined,
        clock: systemClock,
      },
    );

    if (options.writeDryRunOutput && config.dryRun && result.manifest) {
      await writeDryRunOutput({
        mode: result.mode,
        snapshotKey: result.snapshotKey,
        snapshotId: result.snapshotId,
        calculationVersion: result.calculationVersion,
        manifest: result.manifest,
      });
    }

    console.info(
      stableStringify({
        runId: result.runId,
        triggerSource: result.triggerSource,
        status: result.status,
        mode: result.mode,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        referenceTime: result.referenceTime,
        calculationVersion: result.calculationVersion,
        segmentVersion: result.segmentVersion,
        snapshotKey: result.snapshotKey,
        snapshotId: result.snapshotId,
        skipReason: result.skipReason,
        summary: result.summary,
      }),
    );
  } catch (error) {
    const meta = getRfmSnapshotErrorMeta(error);
    console.error(
      stableStringify({
        triggerSource: options.triggerSource,
        status: 'failed',
        errorType: meta.errorType,
        errorCode: meta.errorCode,
      }),
    );
    process.exitCode = 1;
  } finally {
    await prestashopPool.end();
    await crmPool.end();
    if (snapshotPool) {
      await snapshotPool.end();
    }
  }
}

async function writeDryRunOutput(output: {
  readonly mode: string | null;
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly calculationVersion: string;
  readonly manifest: RfmSnapshotManifest;
}): Promise<void> {
  const outputDir = path.resolve('scripts/snapshots/rfm/outputs');
  await mkdir(outputDir, { recursive: true });
  const fileName = `rfm-snapshot-${output.manifest.referenceTime.replace(/[:.]/g, '-')}-${output.calculationVersion}.json`;
  await writeFile(path.join(outputDir, fileName), `${stableStringify(output)}\n`, 'utf8');
}
