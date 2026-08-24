import type { CopilotSession, CopilotSessionLimits, CopilotSessionStore, CopilotSessionStoreGetResult, DeleteCopilotSessionResult } from './contracts.js';

export function createInMemoryCopilotSessionStore(limits: Pick<CopilotSessionLimits, 'maxActiveSessions'>): CopilotSessionStore {
  const sessions = new Map<string, CopilotSession>();

  function purgeExpired(now: Date): void {
    for (const [sessionId, session] of sessions.entries()) {
      if (isExpired(session, now)) sessions.delete(sessionId);
    }
  }

  function enforceMaxActiveSessions(): void {
    while (sessions.size > limits.maxActiveSessions) {
      const oldest = [...sessions.values()].sort((left, right) => left.lastActivityAt.localeCompare(right.lastActivityAt))[0];
      if (!oldest) return;
      sessions.delete(oldest.sessionId);
    }
  }

  return {
    async create(session, now) {
      purgeExpired(now);
      sessions.set(session.sessionId, session);
      enforceMaxActiveSessions();
    },
    async get(sessionId, now): Promise<CopilotSessionStoreGetResult> {
      const session = sessions.get(sessionId);
      if (!session) return { status: 'session_not_found' };
      if (isExpired(session, now)) {
        sessions.delete(sessionId);
        return { status: 'session_expired' };
      }
      purgeExpired(now);
      return { status: 'found', session };
    },
    async save(session, now) {
      purgeExpired(now);
      sessions.set(session.sessionId, session);
      enforceMaxActiveSessions();
    },
    async delete(sessionId, now): Promise<DeleteCopilotSessionResult> {
      const current = await this.get(sessionId, now);
      if (current.status !== 'found') return { status: current.status };
      sessions.delete(sessionId);
      return { status: 'deleted' };
    },
    async list(now, limit) {
      purgeExpired(now);
      return [...sessions.values()]
        .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
        .slice(0, limit);
    },
    async activeCount(now) {
      purgeExpired(now);
      return sessions.size;
    },
  };
}

function isExpired(session: CopilotSession, now: Date): boolean {
  return Date.parse(session.expiresAt) <= now.getTime();
}
