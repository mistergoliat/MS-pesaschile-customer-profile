import type { PrefixDiscoveryResult, VariantTableDiscoveryResult } from './types.js';

// Generalized version of CP-R1-T06A's detectPrefix (scripts/audits/order-state-semantics/
// lib/schema-discovery.ts), which hardcodes its own 6-table required set. CP-R1-T07A
// needs a different required set (orders/order_state/order_state_lang/customer/currency
// — no order_history/order_carrier/carrier), so the required suffixes are a parameter
// here instead of a second hardcoded copy of the same scoring algorithm. T06A's file is
// left untouched — this is a new module, not an edit of a closed audit's deliverable.
//
// Never assumes `ps_`: derives candidate prefixes from whichever `<candidate>orders`
// table(s) actually exist in information_schema.tables, then scores each candidate by how
// many of the other required tables share that same prefix. A tie among top-scoring
// candidates is reported as ambiguous instead of silently guessed.
export function detectPrefix(tableNames: readonly string[], requiredSuffixes: readonly string[]): PrefixDiscoveryResult {
  const tableSet = new Set(tableNames);
  const rawCandidates = Array.from(
    new Set(tableNames.filter((name) => name.endsWith('orders')).map((name) => name.slice(0, name.length - 'orders'.length))),
  );

  if (rawCandidates.length === 0) {
    return { prefix: null, candidates: [], found: {}, missing: [...requiredSuffixes], ambiguous: false };
  }

  const scored = rawCandidates.map((prefix) => {
    const found: Record<string, string> = {};
    const missing: string[] = [];
    for (const suffix of requiredSuffixes) {
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
    return { prefix: null, candidates: rawCandidates, found: {}, missing: [...requiredSuffixes], ambiguous: true };
  }

  const winner = best[0]!;
  return { prefix: winner.prefix, candidates: rawCandidates, found: winner.found, missing: winner.missing, ambiguous: false };
}

// Generalized version of T06A's detectOrderDetailTable: checks a list of candidate table
// names (in preference order) against information_schema.tables, never guesses if none
// exist. Reused here for order_detail/order_details, and for the optional
// order_slip/order_slip_detail tables (section 2), which have no known naming variants in
// stock PrestaShop but are still verified rather than assumed.
export function detectVariantTable(tableNames: readonly string[], candidateNames: readonly string[]): VariantTableDiscoveryResult {
  const tableSet = new Set(tableNames);
  const tableName = candidateNames.find((name) => tableSet.has(name)) ?? null;
  return { tableName, candidatesChecked: candidateNames };
}
