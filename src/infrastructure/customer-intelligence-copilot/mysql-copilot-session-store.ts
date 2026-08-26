import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
  type CopilotAnalyticalReference,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../../application/customer-intelligence/ports.js';
import type {
  CopilotSession,
  CopilotSessionQueryResult,
  CopilotSessionStore,
  CopilotSessionStoreGetResult,
  CopilotSessionTurn,
  DeleteCopilotSessionResult,
} from '../../application/customer-intelligence-copilot-session/index.js';

type MysqlJsonValue = string | { readonly [key: string]: unknown } | readonly unknown[];

type ConversationRow = RowDataPacket & {
  conversation_id: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  created_at: Date | string;
  updated_at: Date | string;
  last_activity_at: Date | string;
  expires_at: Date | string | null;
  pinned_context_json: MysqlJsonValue;
  resolved_ids_json: MysqlJsonValue;
  summary_version: string | null;
  summary_text: string | null;
};

type MessageRow = RowDataPacket & {
  turn_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: string;
  query_ids_json: MysqlJsonValue;
  source_query_ids_json: MysqlJsonValue;
  created_at: Date | string;
};

type QueryRow = RowDataPacket & {
  query_id: string;
  turn_id: string;
  query_plan_hash: string;
  plan_json: MysqlJsonValue;
  snapshot_provenance_json: MysqlJsonValue;
  row_count: number;
  result_metadata_json: MysqlJsonValue;
  result_sample_json: MysqlJsonValue;
  created_at: Date | string;
};

export function createMysqlCopilotSessionStore(pool: Pool): CopilotSessionStore {
  return {
    async create(session) {
      await upsertConversation(pool, session);
      await replaceMessages(pool, session);
      await replaceQueries(pool, session);
    },

    async get(sessionId): Promise<CopilotSessionStoreGetResult> {
      const session = await loadSession(pool, sessionId);
      if (!session || session.status === 'deleted') return { status: 'session_not_found' };
      return { status: 'found', session };
    },

    async save(session) {
      await upsertConversation(pool, session);
      await replaceMessages(pool, session);
      await replaceQueries(pool, session);
    },

    async delete(sessionId, now): Promise<DeleteCopilotSessionResult> {
      const found = await this.get(sessionId, now);
      if (found.status !== 'found') return { status: found.status };
      await pool.execute('UPDATE customer_intelligence_copilot_conversation SET status = ?, updated_at = ?, last_activity_at = ? WHERE conversation_id = ?', [
        'deleted',
        toMysqlDate(now),
        toMysqlDate(now),
        sessionId,
      ]);
      return { status: 'deleted' };
    },

    async list(_now, limit) {
      const [rows] = await pool.execute<ConversationRow[]>(
        `SELECT *
           FROM customer_intelligence_copilot_conversation
          WHERE status <> 'deleted'
          ORDER BY last_activity_at DESC
          LIMIT ?`,
        [limit],
      );
      const sessions: CopilotSession[] = [];
      for (const row of rows) {
        const session = await loadSession(pool, row.conversation_id, row);
        if (session) sessions.push(session);
      }
      return sessions;
    },

    async activeCount() {
      const [rows] = await pool.execute<(RowDataPacket & { count: number })[]>(
        "SELECT COUNT(*) AS count FROM customer_intelligence_copilot_conversation WHERE status = 'active'",
        [],
      );
      return Number(rows[0]?.count ?? 0);
    },
  };
}

async function upsertConversation(pool: Pool, session: CopilotSession): Promise<void> {
  await pool.execute(
    `INSERT INTO customer_intelligence_copilot_conversation (
       conversation_id, version, title, status, created_at, updated_at, last_activity_at, expires_at,
       pinned_feature_snapshot_id, pinned_rfm_snapshot_id, pinned_cluster_snapshot_id,
       pinned_context_json, resolved_ids_json, summary_version, summary_text
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       status = VALUES(status),
       updated_at = VALUES(updated_at),
       last_activity_at = VALUES(last_activity_at),
       expires_at = VALUES(expires_at),
       pinned_feature_snapshot_id = VALUES(pinned_feature_snapshot_id),
       pinned_rfm_snapshot_id = VALUES(pinned_rfm_snapshot_id),
       pinned_cluster_snapshot_id = VALUES(pinned_cluster_snapshot_id),
       pinned_context_json = VALUES(pinned_context_json),
       resolved_ids_json = VALUES(resolved_ids_json),
       summary_version = VALUES(summary_version),
       summary_text = VALUES(summary_text)`,
    [
      session.sessionId,
      session.sessionVersion,
      session.title ?? null,
      session.status ?? 'active',
      toMysqlDate(session.createdAt),
      toMysqlDate(new Date()),
      toMysqlDate(session.lastActivityAt),
      toMysqlDate(session.expiresAt),
      session.pinnedContext.featureSnapshot.snapshotId,
      session.pinnedContext.rfmSnapshot?.snapshotId ?? null,
      session.pinnedContext.clusterSnapshot?.snapshotId ?? null,
      JSON.stringify(session.pinnedContext),
      JSON.stringify(session.resolvedIds),
      session.summaryVersion ?? null,
      session.summary ?? null,
    ],
  );
}

async function replaceMessages(pool: Pool, session: CopilotSession): Promise<void> {
  await pool.execute('DELETE FROM customer_intelligence_copilot_message WHERE conversation_id = ?', [session.sessionId]);
  for (const turn of session.turns) {
    if (turn.userQuestion.length > 0) {
      await insertMessage(pool, session.sessionId, turn, 'user', turn.userQuestion, 'user_message');
    }
    await insertMessage(pool, session.sessionId, turn, turn.assistantStatus.startsWith('system_') ? 'system' : 'assistant', turn.assistantAnswer ?? '', turn.assistantStatus);
  }
}

async function insertMessage(
  pool: Pool,
  sessionId: string,
  turn: CopilotSessionTurn,
  role: 'user' | 'assistant' | 'system',
  content: string,
  status: string,
): Promise<void> {
  await pool.execute(
    `INSERT INTO customer_intelligence_copilot_message (
       message_id, conversation_id, turn_id, role, content, status, query_ids_json, source_query_ids_json, created_at
     ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, turn.turnId, role, content, status, JSON.stringify(turn.queryIds), JSON.stringify(turn.sourceQueryIds), toMysqlDate(turn.createdAt)],
  );
}

async function replaceQueries(pool: Pool, session: CopilotSession): Promise<void> {
  await pool.execute('DELETE FROM customer_intelligence_copilot_query_execution WHERE conversation_id = ?', [session.sessionId]);
  for (const query of session.analyticalState.results) {
    await pool.execute(
      `INSERT INTO customer_intelligence_copilot_query_execution (
         conversation_id, turn_id, query_id, query_plan_hash, plan_json, snapshot_provenance_json,
         row_count, truncated, result_metadata_json, result_sample_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.sessionId,
        query.turnId,
        query.queryId,
        query.result.queryPlanHash,
        JSON.stringify(query.plan),
        JSON.stringify(query.result.context),
        query.result.rowCount,
        query.result.execution.truncated ? 1 : 0,
        JSON.stringify({ columns: query.result.columns, execution: query.result.execution }),
        JSON.stringify(query.result.rows),
        toMysqlDate(new Date()),
      ],
    );
  }
  await pool.execute(
    `REPLACE INTO customer_intelligence_copilot_reference (conversation_id, references_json, updated_at)
     VALUES (?, ?, ?)`,
    [session.sessionId, JSON.stringify(session.analyticalState.references), toMysqlDate(new Date())],
  );
}

async function loadSession(pool: Pool, sessionId: string, knownConversation?: ConversationRow): Promise<CopilotSession | null> {
  const conversation = knownConversation ?? (await loadConversation(pool, sessionId));
  if (!conversation) return null;
  const turns = await loadTurns(pool, sessionId);
  const results = await loadQueries(pool, sessionId);
  const references = await loadReferences(pool, sessionId);
  return {
    sessionId: conversation.conversation_id,
    sessionVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_VERSION,
    createdAt: toIso(conversation.created_at),
    lastActivityAt: toIso(conversation.last_activity_at),
    expiresAt: conversation.expires_at ? toIso(conversation.expires_at) : new Date('9999-12-31T23:59:59.000Z').toISOString(),
    status: conversation.status,
    title: conversation.title,
    summary: conversation.summary_text,
    summaryVersion: conversation.summary_version,
    pinnedContext: parseJson<CustomerIntelligenceSnapshotContext>(conversation.pinned_context_json),
    resolvedIds: parseJson<ResolvedCustomerIntelligenceSnapshotIds>(conversation.resolved_ids_json),
    turns,
    analyticalState: { references, results },
  };
}

async function loadConversation(pool: Pool, sessionId: string): Promise<ConversationRow | null> {
  const [rows] = await pool.execute<ConversationRow[]>('SELECT * FROM customer_intelligence_copilot_conversation WHERE conversation_id = ? LIMIT 1', [sessionId]);
  return rows[0] ?? null;
}

async function loadTurns(pool: Pool, sessionId: string): Promise<readonly CopilotSessionTurn[]> {
  const [rows] = await pool.execute<MessageRow[]>(
    `SELECT * FROM customer_intelligence_copilot_message
      WHERE conversation_id = ?
      ORDER BY created_at ASC, message_id ASC`,
    [sessionId],
  );
  const byTurn = new Map<string, CopilotSessionTurn>();
  for (const row of rows) {
    const existing = byTurn.get(row.turn_id);
    const queryIds = parseJson<readonly string[]>(row.query_ids_json);
    const sourceQueryIds = parseJson<readonly string[]>(row.source_query_ids_json);
    if (row.role === 'user') {
      byTurn.set(row.turn_id, {
        turnId: row.turn_id,
        createdAt: toIso(row.created_at),
        userQuestion: row.content,
        assistantStatus: existing?.assistantStatus ?? 'pending',
        assistantFinalResponseState: existing?.assistantFinalResponseState ?? finalResponseStateFromTurnStatus(existing?.assistantStatus ?? 'pending'),
        assistantAnswer: existing?.assistantAnswer ?? null,
        ...(existing?.synthesisFallbackUsed !== undefined ? { synthesisFallbackUsed: existing.synthesisFallbackUsed } : {}),
        queryIds,
        sourceQueryIds,
      });
    } else {
      byTurn.set(row.turn_id, {
        turnId: row.turn_id,
        createdAt: existing?.createdAt ?? toIso(row.created_at),
        userQuestion: existing?.userQuestion ?? '',
        assistantStatus: row.status,
        assistantFinalResponseState: finalResponseStateFromTurnStatus(row.status),
        assistantAnswer: row.content.length > 0 ? row.content : null,
        ...(existing?.synthesisFallbackUsed !== undefined ? { synthesisFallbackUsed: existing.synthesisFallbackUsed } : {}),
        queryIds,
        sourceQueryIds,
      });
    }
  }
  return [...byTurn.values()];
}

async function loadQueries(pool: Pool, sessionId: string): Promise<readonly CopilotSessionQueryResult[]> {
  const [rows] = await pool.execute<QueryRow[]>(
    `SELECT * FROM customer_intelligence_copilot_query_execution
      WHERE conversation_id = ?
      ORDER BY created_at ASC, query_id ASC`,
    [sessionId],
  );
  return rows.map((row) => {
    const metadata = parseJson<{ columns: CopilotSessionQueryResult['result']['columns']; execution: CopilotSessionQueryResult['result']['execution'] }>(row.result_metadata_json);
    return {
      queryId: row.query_id,
      turnId: row.turn_id,
      plan: parseJson<CopilotSessionQueryResult['plan']>(row.plan_json),
      result: {
        queryVersion: 'customer-intelligence-query-v1',
        queryPlanHash: row.query_plan_hash,
        context: parseJson<CustomerIntelligenceSnapshotContext>(row.snapshot_provenance_json),
        columns: metadata.columns,
        rows: parseJson<CopilotSessionQueryResult['result']['rows']>(row.result_sample_json),
        rowCount: Number(row.row_count),
        execution: metadata.execution,
      },
    };
  });
}

async function loadReferences(pool: Pool, sessionId: string): Promise<readonly CopilotAnalyticalReference[]> {
  const [rows] = await pool.execute<(RowDataPacket & { references_json: MysqlJsonValue })[]>(
    'SELECT references_json FROM customer_intelligence_copilot_reference WHERE conversation_id = ? LIMIT 1',
    [sessionId],
  );
  return rows[0] ? parseJson<readonly CopilotAnalyticalReference[]>(rows[0].references_json) : [];
}

function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    if (isJsonObjectOrArray(parsed)) return parsed as T;
    throw new TypeError(`Expected JSON string containing object or array, received ${parsed === null ? 'null' : typeof parsed}`);
  }

  if (isJsonObjectOrArray(value)) return value as T;

  throw new TypeError(`Expected JSON string or object, received ${value === null ? 'null' : typeof value}`);
}

function isJsonObjectOrArray(value: unknown): value is { readonly [key: string]: unknown } | readonly unknown[] {
  return value !== null && typeof value === 'object';
}

function toMysqlDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function toIso(value: string | Date): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function finalResponseStateFromTurnStatus(status: string): CopilotSessionTurn['assistantFinalResponseState'] {
  if (
    status === 'planner_invalid'
    || status === 'orchestrator_invalid'
    || status === 'analytics_unavailable'
    || status === 'analytics_timeout'
    || status === 'answer_generation_failed'
    || status === 'provider_authentication_error'
    || status === 'provider_billing_error'
    || status === 'provider_rate_limited'
    || status === 'provider_timeout'
    || status === 'provider_network_error'
    || status === 'provider_invalid_response'
  ) {
    return 'failure';
  }
  return 'success';
}
