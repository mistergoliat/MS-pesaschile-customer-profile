import type { Pool, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createMysqlCopilotSessionStore } from '../../src/infrastructure/customer-intelligence-copilot/mysql-copilot-session-store.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

const PINNED_CONTEXT = {
  featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1' },
  rfmSnapshot: { snapshotId: '3', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
  clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '2', modelVersion: 'cluster-v1' },
  population: { featurePopulation: 10, rfmMatched: 7, clusterMatched: 4, bothMatched: 3, neitherMatched: 2, rfmCoveragePct: 70, clusterCoveragePct: 40 },
  contractVersion: 'customer-intelligence-read-model-v1',
};

const RESOLVED_IDS = {
  featureSnapshotId: '17',
  featureReferenceTime: '2026-08-19T00:00:00.000Z',
  featureVersion: 'features-v1',
  populationPolicyVersion: 'population-v1',
  rfmSnapshotId: '3',
  rfmReferenceTime: '2026-08-18T00:00:00.000Z',
  calculationVersion: 'rfm-v1',
  clusterSnapshotId: '5',
  clusterReferenceTime: '2026-08-18T00:00:00.000Z',
  clusterModelId: '2',
  clusterModelVersion: 'cluster-v1',
};

const QUERY_PLAN = {
  metrics: [{ aggregation: 'count', alias: 'customers' }],
};

const RESULT_METADATA = {
  columns: [{ name: 'customers', type: 'integer' }],
  execution: { durationMs: 7, truncated: false },
};

const RESULT_SAMPLE = [{ customers: 10 }];
const REFERENCES = [{ name: 'currentAudience', sourceQueryId: 'q1', filters: [{ field: 'cluster.clusterId', operator: 'eq', value: 3 }] }];

type JsonMode = 'string' | 'materialized';

function jsonValue<T extends Record<string, unknown> | readonly unknown[]>(value: T, mode: JsonMode): string | T {
  return mode === 'string' ? JSON.stringify(value) : value;
}

function conversationRow(mode: JsonMode, overrides: Record<string, unknown> = {}): RowDataPacket {
  return {
    conversation_id: SESSION_ID,
    title: null,
    status: 'active',
    created_at: new Date('2026-08-20T12:00:00.000Z'),
    updated_at: new Date('2026-08-20T12:00:00.000Z'),
    last_activity_at: new Date('2026-08-20T12:01:00.000Z'),
    expires_at: new Date('2026-08-20T13:00:00.000Z'),
    pinned_context_json: jsonValue(PINNED_CONTEXT, mode),
    resolved_ids_json: jsonValue(RESOLVED_IDS, mode),
    summary_version: null,
    summary_text: null,
    ...overrides,
  } as RowDataPacket;
}

function messageRows(mode: JsonMode, overrides: Record<string, unknown> = {}): RowDataPacket[] {
  return [
    {
      message_id: 'm1',
      turn_id: 'turn1',
      role: 'user',
      content: 'Cuantos clientes hay?',
      status: 'user_message',
      query_ids_json: jsonValue([], mode),
      source_query_ids_json: jsonValue([], mode),
      created_at: new Date('2026-08-20T12:01:00.000Z'),
      ...overrides,
    } as RowDataPacket,
    {
      message_id: 'm2',
      turn_id: 'turn1',
      role: 'assistant',
      content: 'Hay 10 clientes.',
      status: 'answered',
      query_ids_json: jsonValue(['q1', 'q2'], mode),
      source_query_ids_json: jsonValue(['source1'], mode),
      created_at: new Date('2026-08-20T12:01:01.000Z'),
      ...overrides,
    } as RowDataPacket,
  ];
}

function queryRows(mode: JsonMode, overrides: Record<string, unknown> = {}): RowDataPacket[] {
  return [
    {
      query_id: 'q1',
      turn_id: 'turn1',
      query_plan_hash: 'a'.repeat(64),
      plan_json: jsonValue(QUERY_PLAN, mode),
      snapshot_provenance_json: jsonValue(PINNED_CONTEXT, mode),
      row_count: 1,
      truncated: 0,
      result_metadata_json: jsonValue(RESULT_METADATA, mode),
      result_sample_json: jsonValue(RESULT_SAMPLE, mode),
      created_at: new Date('2026-08-20T12:01:02.000Z'),
      ...overrides,
    } as RowDataPacket,
  ];
}

function referenceRows(mode: JsonMode, overrides: Record<string, unknown> = {}): RowDataPacket[] {
  return [
    {
      references_json: jsonValue(REFERENCES, mode),
      ...overrides,
    } as RowDataPacket,
  ];
}

function poolForRows(args: {
  readonly mode?: JsonMode;
  readonly conversationOverrides?: Record<string, unknown>;
  readonly messageOverrides?: Record<string, unknown>;
  readonly queryOverrides?: Record<string, unknown>;
  readonly referenceOverrides?: Record<string, unknown>;
} = {}): Pool {
  const mode = args.mode ?? 'string';
  const execute = vi.fn(async (sql: string) => {
    if (sql.includes('FROM customer_intelligence_copilot_conversation')) {
      return [[conversationRow(mode, args.conversationOverrides)], []];
    }
    if (sql.includes('FROM customer_intelligence_copilot_message')) {
      return [messageRows(mode, args.messageOverrides), []];
    }
    if (sql.includes('FROM customer_intelligence_copilot_query_execution')) {
      return [queryRows(mode, args.queryOverrides), []];
    }
    if (sql.includes('FROM customer_intelligence_copilot_reference')) {
      return [referenceRows(mode, args.referenceOverrides), []];
    }
    throw new Error(`unexpected SQL in fake pool: ${sql}`);
  });
  return { execute } as unknown as Pool;
}

describe('mysql copilot session store JSON deserialization', () => {
  it('loads sessions when MariaDB/mysql2 returns JSON fields as strings', async () => {
    const store = createMysqlCopilotSessionStore(poolForRows({ mode: 'string' }));

    const result = await store.get(SESSION_ID, new Date('2026-08-20T12:02:00.000Z'));

    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.session.pinnedContext.featureSnapshot.snapshotId).toBe('17');
    expect(result.session.resolvedIds.clusterSnapshotId).toBe('5');
    expect(result.session.turns[0]?.queryIds).toEqual(['q1', 'q2']);
    expect(result.session.turns[0]?.sourceQueryIds).toEqual(['source1']);
    expect(result.session.analyticalState.results[0]?.plan).toEqual(QUERY_PLAN);
    expect(result.session.analyticalState.references).toEqual(REFERENCES);
  });

  it('loads sessions when MariaDB/mysql2 returns JSON fields as materialized objects and arrays', async () => {
    const store = createMysqlCopilotSessionStore(poolForRows({ mode: 'materialized' }));

    const result = await store.get(SESSION_ID, new Date('2026-08-20T12:02:00.000Z'));

    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.session.pinnedContext).toEqual(PINNED_CONTEXT);
    expect(result.session.resolvedIds).toEqual(RESOLVED_IDS);
    expect(result.session.turns[0]?.queryIds).toEqual(['q1', 'q2']);
    expect(result.session.analyticalState.results[0]?.result.rows).toEqual(RESULT_SAMPLE);
    expect(result.session.analyticalState.results[0]?.result.context).toEqual(PINNED_CONTEXT);
    expect(result.session.analyticalState.references).toEqual(REFERENCES);
  });

  it('fails closed on invalid JSON strings', async () => {
    const store = createMysqlCopilotSessionStore(
      poolForRows({
        mode: 'string',
        conversationOverrides: { pinned_context_json: '{"featureSnapshot":' },
      }),
    );

    await expect(store.get(SESSION_ID, new Date('2026-08-20T12:02:00.000Z'))).rejects.toThrow(SyntaxError);
  });

  it.each([
    ['number', 42],
    ['boolean', true],
    ['undefined', undefined],
    ['null', null],
  ])('fails closed when a required JSON field is %s', async (_name, value) => {
    const store = createMysqlCopilotSessionStore(
      poolForRows({
        mode: 'materialized',
        messageOverrides: { query_ids_json: value },
      }),
    );

    await expect(store.get(SESSION_ID, new Date('2026-08-20T12:02:00.000Z'))).rejects.toThrow(TypeError);
  });

  it.each([
    ['conversation pinned_context_json', { conversationOverrides: { pinned_context_json: 42 } }],
    ['conversation resolved_ids_json', { conversationOverrides: { resolved_ids_json: true } }],
    ['message source_query_ids_json', { messageOverrides: { source_query_ids_json: null } }],
    ['query plan_json', { queryOverrides: { plan_json: 42 } }],
    ['query snapshot_provenance_json', { queryOverrides: { snapshot_provenance_json: false } }],
    ['query result_metadata_json', { queryOverrides: { result_metadata_json: undefined } }],
    ['query result_sample_json', { queryOverrides: { result_sample_json: null } }],
    ['reference references_json', { referenceOverrides: { references_json: 42 } }],
  ])('fails closed for unsupported primitive in %s', async (_field, overrides) => {
    const store = createMysqlCopilotSessionStore(poolForRows({ mode: 'materialized', ...overrides }));

    await expect(store.get(SESSION_ID, new Date('2026-08-20T12:02:00.000Z'))).rejects.toThrow(TypeError);
  });
});
