import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import {
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import { createMysqlPrestaShopCustomerIdentityRepository } from '../../src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function fakeExecutor(rows: RowDataPacket[]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
  };
  return { executor, calls };
}

function throwingExecutor(error: unknown): QueryExecutor {
  return {
    async execute() {
      throw error;
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('createMysqlPrestaShopCustomerIdentityRepository', () => {
  it('queries ps_customer by id_customer only, LIMIT 1, without selecting PII', async () => {
    const { executor, calls } = fakeExecutor([]);
    const repository = createMysqlPrestaShopCustomerIdentityRepository(executor, 'ps_');

    await repository.findByCustomerId(22066);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('SELECT ID_CUSTOMER');
    expect(sql).toContain('FROM PS_CUSTOMER');
    expect(sql).toContain('WHERE ID_CUSTOMER = ?');
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toContain('EMAIL');
    expect(sql).not.toContain('FIRSTNAME');
    expect(sql).not.toContain('LASTNAME');
    expect(calls[0]!.params).toEqual([22066]);
  });

  it('returns null when the customer does not exist', async () => {
    const { executor } = fakeExecutor([]);
    const repository = createMysqlPrestaShopCustomerIdentityRepository(executor, 'ps_');

    await expect(repository.findByCustomerId(22066)).resolves.toBeNull();
  });

  it('maps a found row into the direct-source identity contract', async () => {
    const { executor } = fakeExecutor([{ id_customer: 22066 } as unknown as RowDataPacket]);
    const repository = createMysqlPrestaShopCustomerIdentityRepository(executor, 'ps_');

    await expect(repository.findByCustomerId(22066)).resolves.toEqual({
      customerId: 22066,
      externalCustomerId: 22066,
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      sourceMetadata: {
        platform: 'PRESTASHOP',
        entity: 'ps_customer',
        primaryKey: 'id_customer',
      },
    });
  });

  it('maps timeout, unavailable and schema errors to sanitized typed errors', async () => {
    await expect(
      createMysqlPrestaShopCustomerIdentityRepository(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_').findByCustomerId(
        22066,
      ),
    ).rejects.toBeInstanceOf(PrestashopTimeoutError);
    await expect(
      createMysqlPrestaShopCustomerIdentityRepository(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_').findByCustomerId(
        22066,
      ),
    ).rejects.toBeInstanceOf(PrestashopUnavailableError);
    await expect(
      createMysqlPrestaShopCustomerIdentityRepository(throwingExecutor({ code: 'ER_BAD_FIELD_ERROR' }), 'ps_').findByCustomerId(
        22066,
      ),
    ).rejects.toBeInstanceOf(PrestashopSchemaIncompatibleError);
  });
});

