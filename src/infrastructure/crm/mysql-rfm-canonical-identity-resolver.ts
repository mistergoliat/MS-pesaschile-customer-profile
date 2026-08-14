import type { RowDataPacket } from 'mysql2/promise';
import type { RfmCanonicalIdentityResolver } from '../../application/customer-rfm/ports.js';
import type {
  CanonicalIdentityCoverageSummary,
  CanonicalIdentityResolution,
} from '../../domain/customer-rfm/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { mapCrmReadError } from './crm-read-error.js';

interface CanonicalIdentityRow extends RowDataPacket {
  master_customer_id: string;
  prestashop_customer_id: number;
}

const CHUNK_SIZE = 1000;

export function createMysqlRfmCanonicalIdentityResolver(executor: QueryExecutor): RfmCanonicalIdentityResolver {
  return {
    async resolvePrestashopCustomerIds(prestashopCustomerIds) {
      const uniqueIds = uniquePrestashopCustomerIds(prestashopCustomerIds);
      if (uniqueIds.length === 0) {
        return {
          resolutions: [],
          coverage: emptyCoverage(),
        };
      }

      const groupedMatches = new Map<number, string[]>();
      try {
        for (const chunk of chunkIds(uniqueIds, CHUNK_SIZE)) {
          const rows = await executor.execute(selectMappingsSql(chunk.length), chunk);
          for (const row of rows as CanonicalIdentityRow[]) {
            const prestashopCustomerId = Number(row.prestashop_customer_id);
            const masterCustomerId = String(row.master_customer_id);
            groupedMatches.set(prestashopCustomerId, [...(groupedMatches.get(prestashopCustomerId) ?? []), masterCustomerId]);
          }
        }
      } catch (error) {
        throw mapCrmReadError(error);
      }

      const resolutions = uniqueIds.map((prestashopCustomerId) => {
        const matches = groupedMatches.get(prestashopCustomerId) ?? [];
        if (matches.length === 0) {
          return {
            prestashopCustomerId,
            status: 'unmatched',
            masterCustomerId: null,
          } satisfies CanonicalIdentityResolution;
        }
        if (matches.length === 1) {
          return {
            prestashopCustomerId,
            status: 'matched',
            masterCustomerId: matches[0]!,
          } satisfies CanonicalIdentityResolution;
        }
        return {
          prestashopCustomerId,
          status: 'ambiguous',
          masterCustomerId: null,
        } satisfies CanonicalIdentityResolution;
      });

      return {
        resolutions,
        coverage: summarizeCoverage(resolutions),
      };
    },
  };
}

function selectMappingsSql(count: number): string {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`Invalid canonical identity resolver chunk size: ${String(count)}`);
  }
  return `
    SELECT
      id AS master_customer_id,
      prestashop_customer_id
    FROM master_customer
    WHERE prestashop_customer_id IN (${Array.from({ length: count }, () => '?').join(', ')})
  `;
}

function uniquePrestashopCustomerIds(prestashopCustomerIds: readonly number[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const id of prestashopCustomerIds) {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Invalid PrestaShop customer id for canonical resolution: ${String(id)}`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function* chunkIds(ids: readonly number[], chunkSize: number): Generator<readonly number[]> {
  for (let index = 0; index < ids.length; index += chunkSize) {
    yield ids.slice(index, index + chunkSize);
  }
}

function summarizeCoverage(resolutions: readonly CanonicalIdentityResolution[]): CanonicalIdentityCoverageSummary {
  const canonicalMatchedCount = resolutions.filter((resolution) => resolution.status === 'matched').length;
  const canonicalUnmatchedCount = resolutions.filter((resolution) => resolution.status === 'unmatched').length;
  const canonicalAmbiguousCount = resolutions.filter((resolution) => resolution.status === 'ambiguous').length;
  const populationSize = resolutions.length;

  return {
    populationSize,
    canonicalMatchedCount,
    canonicalUnmatchedCount,
    canonicalAmbiguousCount,
    canonicalCoveragePct: populationSize === 0 ? '0.000000' : ((canonicalMatchedCount / populationSize) * 100).toFixed(6),
  };
}

function emptyCoverage(): CanonicalIdentityCoverageSummary {
  return {
    populationSize: 0,
    canonicalMatchedCount: 0,
    canonicalUnmatchedCount: 0,
    canonicalAmbiguousCount: 0,
    canonicalCoveragePct: '0.000000',
  };
}
