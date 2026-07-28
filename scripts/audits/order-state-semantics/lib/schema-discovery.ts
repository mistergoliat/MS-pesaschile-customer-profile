import type { OrderDetailDiscoveryResult, PrefixDiscoveryResult } from './types.js';

const REQUIRED_SUFFIXES = [
  'orders',
  'order_state',
  'order_state_lang',
  'order_history',
  'order_carrier',
  'carrier',
] as const;

// Never assumes `ps_`: derives candidate prefixes from whichever `<candidate>orders`
// table(s) actually exist in information_schema.tables, then scores each candidate by
// how many of the other 5 required tables share that same prefix. The candidate with
// the most matches wins; a tie among top-scoring candidates (e.g. two parallel schemas)
// is reported as ambiguous instead of silently guessed. See CP-R1-T06A section 5.
export function detectPrefix(tableNames: readonly string[]): PrefixDiscoveryResult {
  const tableSet = new Set(tableNames);
  const rawCandidates = Array.from(
    new Set(tableNames.filter((name) => name.endsWith('orders')).map((name) => name.slice(0, name.length - 'orders'.length))),
  );

  if (rawCandidates.length === 0) {
    return { prefix: null, candidates: [], found: {}, missing: [...REQUIRED_SUFFIXES], ambiguous: false };
  }

  const scored = rawCandidates.map((prefix) => {
    const found: Record<string, string> = {};
    const missing: string[] = [];
    for (const suffix of REQUIRED_SUFFIXES) {
      const tableName = `${prefix}${suffix}`;
      if (tableSet.has(tableName)) {
        found[suffix] = tableName;
      } else {
        missing.push(suffix);
      }
    }
    return { prefix, found, missing, matchCount: Object.keys(found).length };
  });

  const maxMatches = Math.max(...scored.map((entry) => entry.matchCount));
  const best = scored.filter((entry) => entry.matchCount === maxMatches);

  if (best.length > 1) {
    return { prefix: null, candidates: rawCandidates, found: {}, missing: [...REQUIRED_SUFFIXES], ambiguous: true };
  }

  const winner = best[0]!;
  return { prefix: winner.prefix, candidates: rawCandidates, found: winner.found, missing: winner.missing, ambiguous: false };
}

// Never assumes `<prefix>order_detail`: checks both known PrestaShop variants against
// information_schema.tables, in preference order, and reports which one (if any) was
// actually found — never guesses if neither exists. See CP-R1-T06A (order detail scope
// extension), section 1.
export function detectOrderDetailTable(tableNames: readonly string[], prefix: string): OrderDetailDiscoveryResult {
  const tableSet = new Set(tableNames);
  const candidatesChecked = [`${prefix}order_detail`, `${prefix}order_details`];
  const tableName = candidatesChecked.find((name) => tableSet.has(name)) ?? null;
  return { tableName, candidatesChecked };
}
