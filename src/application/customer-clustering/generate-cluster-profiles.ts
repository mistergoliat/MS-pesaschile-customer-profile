import { buildClusterSnapshotProfiles, type ClusterSnapshotProfile } from '../../domain/customer-clustering/index.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { ClusterSnapshotProfileRepository } from '../../infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import type {
  ClusterCommercialAggregateReader,
  ClusterPopulationReader,
} from '../../infrastructure/prestashop/mysql-cluster-population-reader.js';

type Clock = { now(): Date };

export type GenerateClusterProfilesInput = {
  readonly snapshotId: string;
};

export type GenerateClusterProfilesResult = {
  readonly mode: 'generated' | 'updated' | 'skipped_unchanged';
  readonly snapshotId: string;
  readonly profiles: readonly ClusterSnapshotProfile[];
  readonly upserted: number;
  readonly skipped: number;
};

// Backfill/generation entry point (task Section 16/41). Re-derives Feature-Set-A vectors and
// commercial post-hoc aggregates from PrestaShop AT THE SNAPSHOT'S OWN referenceTime — the
// factories below are only invoked once that referenceTime is known, which is why they're
// factories (referenceTimeMysql: string) => reader rather than pre-built readers. This is heavy
// calculation done once, here, never at HTTP query time (task Section 15).
//
// KNOWN LIMITATION (undocumented by the task, discovered during implementation): re-extraction
// reads PrestaShop's CURRENT `valid`/`total_paid_tax_incl` state filtered by historical
// `date_add < referenceTime`, not a point-in-time snapshot of order validity. If an order's
// validity changed after the snapshot was originally published (e.g. a retroactive refund),
// re-extraction can produce a population that no longer exactly matches
// customer_cluster_snapshot_row. Rather than silently drop or fabricate data for the missing
// customer(s), this throws — a partial/inconsistent profile is never persisted (task Section
// 43: "Fail if mismatch").
export async function generateClusterProfiles(
  input: GenerateClusterProfilesInput,
  deps: {
    readonly clusterAnalyticsReader: ClusterAnalyticsReader;
    readonly createFeatureReader: (referenceTimeMysql: string, window365StartMysql: string) => ClusterPopulationReader;
    readonly createCommercialAggregateReader: (referenceTimeMysql: string) => ClusterCommercialAggregateReader;
    readonly profileRepository: ClusterSnapshotProfileRepository;
    readonly clock: Clock;
  },
): Promise<GenerateClusterProfilesResult> {
  const meta = await deps.clusterAnalyticsReader.getPublishedSnapshotById(input.snapshotId);
  if (!meta) {
    throw new Error(`Cluster snapshot ${input.snapshotId} is not published (or does not exist) — cannot generate a profile for it`);
  }

  const rows = await deps.clusterAnalyticsReader.listSnapshotRows(meta.snapshotId);
  if (rows.length !== meta.populationSize) {
    throw new Error(
      `Cluster snapshot ${meta.snapshotId} row count (${rows.length}) does not match its own populationSize (${meta.populationSize})`,
    );
  }

  const referenceTimeIso = meta.referenceTime.toISOString();
  const referenceTimeMysql = toMysqlDateTime(referenceTimeIso);
  const window365StartMysql = toMysqlDateTime(windowStart365dInclusive(referenceTimeIso));

  const featureReader = deps.createFeatureReader(referenceTimeMysql, window365StartMysql);
  const commercialAggregateReader = deps.createCommercialAggregateReader(referenceTimeMysql);

  const [populationRows, commercialRows] = await Promise.all([
    featureReader.readPopulation(),
    commercialAggregateReader.readCommercialAggregates(),
  ]);

  const featuresByCustomerId = new Map(populationRows.map((row) => [row.prestashopCustomerId, row.features]));
  const commercialByCustomerId = new Map(commercialRows.map((row) => [row.prestashopCustomerId, row]));

  const missingFromReExtraction = rows.filter((row) => !featuresByCustomerId.has(row.prestashopCustomerId));
  if (missingFromReExtraction.length > 0) {
    throw new Error(
      `Re-extracting the population at snapshot ${meta.snapshotId}'s referenceTime (${referenceTimeIso}) is missing ` +
        `${missingFromReExtraction.length} customer(s) present in the published snapshot (e.g. customer ` +
        `${missingFromReExtraction[0]!.prestashopCustomerId}) — PrestaShop order-validity state likely changed since ` +
        `publication. Refusing to generate a partial profile.`,
    );
  }

  const generatedAt = deps.clock.now().toISOString();
  const profiles = buildClusterSnapshotProfiles({
    snapshotId: meta.snapshotId,
    populationSize: meta.populationSize,
    generatedAt,
    rows,
    featuresByCustomerId,
    commercialByCustomerId,
  });

  const { upserted, skipped } = await deps.profileRepository.upsertProfiles(profiles);
  return {
    mode: upserted === 0 ? 'skipped_unchanged' : skipped === 0 ? 'generated' : 'updated',
    snapshotId: meta.snapshotId,
    profiles,
    upserted,
    skipped,
  };
}

const MS_PER_DAY = 86_400_000;
const DAYS_365_MS = 365 * MS_PER_DAY;

function windowStart365dInclusive(referenceTimeIso: string): string {
  return new Date(new Date(referenceTimeIso).getTime() - DAYS_365_MS).toISOString();
}

function toMysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}
