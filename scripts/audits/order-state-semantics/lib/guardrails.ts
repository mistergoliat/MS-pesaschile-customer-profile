import type { GrantAssessment, LoadAssessment } from './types.js';

const ALLOWED_PRIVILEGES = new Set(['SELECT', 'USAGE']);
const LOAD_THREADS_ABSOLUTE_LIMIT = 50;
const LOAD_RATIO_LIMIT = 0.7;

// Parses `SHOW GRANTS FOR CURRENT_USER()` output (one GRANT statement per row). Every
// statement must resolve to SELECT/USAGE only — a single INSERT/UPDATE/ALL PRIVILEGES/
// WITH GRANT OPTION grant anywhere aborts the whole audit before any data query runs.
// USAGE is always allowed: it is the "no privileges" baseline grant MySQL emits first.
export function assessGrants(grantStatements: readonly string[]): GrantAssessment {
  const disallowed = new Set<string>();
  let hasGrantOption = false;

  for (const statement of grantStatements) {
    if (/WITH\s+GRANT\s+OPTION/i.test(statement)) {
      hasGrantOption = true;
    }

    const match = /^GRANT\s+(.+?)\s+ON\s/i.exec(statement.trim());
    if (!match) continue;

    const privileges = match[1]!
      .split(',')
      .map((privilege) => privilege.trim().toUpperCase())
      .filter((privilege) => privilege.length > 0);

    for (const privilege of privileges) {
      if (!ALLOWED_PRIVILEGES.has(privilege)) {
        disallowed.add(privilege);
      }
    }
  }

  return {
    safe: disallowed.size === 0 && !hasGrantOption,
    disallowedPrivileges: Array.from(disallowed).sort(),
    hasGrantOption,
  };
}

// Aborts before any costly query if the server is already busy — this exists so the
// audit itself never becomes the thing that degrades a shared production database,
// independent of how cheap any single query in this tool looks in isolation.
export function evaluateLoad(threadsRunning: number, maxConnections: number): LoadAssessment {
  const ratio = maxConnections > 0 ? threadsRunning / maxConnections : 0;
  const overAbsoluteLimit = threadsRunning >= LOAD_THREADS_ABSOLUTE_LIMIT;
  const overRatioLimit = maxConnections > 0 && ratio >= LOAD_RATIO_LIMIT;

  let reason: string | null = null;
  if (overAbsoluteLimit) {
    reason = `Threads_running (${threadsRunning}) >= ${LOAD_THREADS_ABSOLUTE_LIMIT}`;
  } else if (overRatioLimit) {
    reason = `Threads_running / max_connections (${ratio.toFixed(2)}) >= ${LOAD_RATIO_LIMIT}`;
  }

  return {
    safe: !overAbsoluteLimit && !overRatioLimit,
    threadsRunning,
    maxConnections,
    ratio,
    reason,
  };
}
