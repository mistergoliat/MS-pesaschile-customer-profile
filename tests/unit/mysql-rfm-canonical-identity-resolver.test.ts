import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { CrmSchemaIncompatibleError, CrmUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlRfmCanonicalIdentityResolver } from '../../src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function queuedExecutor(responses: ReadonlyArray<readonly RowDataPacket[] | Error>) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  let index = 0;
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      const response = responses[index++];
      if (response instanceof Error) {
        throw response;
      }
      return response ? [...response] : [];
    },
  };
  return { executor, calls };
}

const matchedRow = {
  master_customer_id: '9001',
  prestashop_customer_id: 777,
} as unknown as RowDataPacket;

describe('createMysqlRfmCanonicalIdentityResolver', () => {
  it('classifies matched and unmatched customers deterministically from the persisted CRM link', async () => {
    const { executor } = queuedExecutor([[matchedRow]]);
    const resolver = createMysqlRfmCanonicalIdentityResolver(executor);

    const result = await resolver.resolvePrestashopCustomerIds([777, 888]);

    expect(result).toEqual({
      resolutions: [
        { prestashopCustomerId: 777, status: 'matched', masterCustomerId: '9001' },
        { prestashopCustomerId: 888, status: 'unmatched', masterCustomerId: null },
      ],
      coverage: {
        populationSize: 2,
        canonicalMatchedCount: 1,
        canonicalUnmatchedCount: 1,
        canonicalAmbiguousCount: 0,
        canonicalCoveragePct: '50.000000',
      },
    });
  });

  it('classifies duplicate CRM links as ambiguous instead of picking a best candidate', async () => {
    const { executor } = queuedExecutor([[
      { ...matchedRow, master_customer_id: '9001', prestashop_customer_id: 777 } as unknown as RowDataPacket,
      { ...matchedRow, master_customer_id: '9002', prestashop_customer_id: 777 } as unknown as RowDataPacket,
    ]]);
    const resolver = createMysqlRfmCanonicalIdentityResolver(executor);

    const result = await resolver.resolvePrestashopCustomerIds([777]);

    expect(result).toEqual({
      resolutions: [{ prestashopCustomerId: 777, status: 'ambiguous', masterCustomerId: null }],
      coverage: {
        populationSize: 1,
        canonicalMatchedCount: 0,
        canonicalUnmatchedCount: 0,
        canonicalAmbiguousCount: 1,
        canonicalCoveragePct: '0.000000',
      },
    });
  });

  it('deduplicates input ids before querying and preserves one resolution per customer', async () => {
    const { executor, calls } = queuedExecutor([[matchedRow]]);
    const resolver = createMysqlRfmCanonicalIdentityResolver(executor);

    const result = await resolver.resolvePrestashopCustomerIds([777, 777, 777]);

    expect(result.resolutions).toEqual([{ prestashopCustomerId: 777, status: 'matched', masterCustomerId: '9001' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([777]);
  });

  it('maps schema and availability failures as CRM infrastructure errors', async () => {
    const schema = createMysqlRfmCanonicalIdentityResolver(
      queuedExecutor([Object.assign(new Error('bad field'), { code: 'ER_BAD_FIELD_ERROR' })]).executor,
    );
    await expect(schema.resolvePrestashopCustomerIds([777])).rejects.toBeInstanceOf(CrmSchemaIncompatibleError);

    const unavailable = createMysqlRfmCanonicalIdentityResolver(
      queuedExecutor([Object.assign(new Error('down'), { code: 'ECONNREFUSED' })]).executor,
    );
    await expect(unavailable.resolvePrestashopCustomerIds([777])).rejects.toBeInstanceOf(CrmUnavailableError);
  });
});
