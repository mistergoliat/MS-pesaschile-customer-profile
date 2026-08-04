import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPrestashopTables,
  crossShopCustomerCountSql,
  populationDatasetParams,
  populationDatasetSql,
  shopLifetimeTotalsSql,
  shopScopedLifetimePopulationSql,
} from '../../scripts/audits/rfm-population/lib/sql.js';
import { classifyEligibility, isFutureOnlyCustomer } from '../../scripts/audits/rfm-population/lib/lifecycle.js';
import {
  assertLifetimeDateWithinBound,
  buildHistoricalInactiveSummary,
  type HistoricalInactiveSourceRow,
} from '../../scripts/audits/rfm-population/rfm-finalization.js';

const tables = buildPrestashopTables('ps_');

function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('CP-R1-T10A-3 follow-up audit corrections', () => {
  // 1. populationDatasetSql includes date_add < windowEndExclusive on every lifetime column
  it('bounds every lifetime column of populationDatasetSql by date_add < windowEndExclusive', () => {
    const sql = normalized(populationDatasetSql(tables));
    expect(sql).toContain('MIN(CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.DATE_ADD ELSE NULL END) AS FIRSTVALIDORDERAT');
    expect(sql).toContain('MAX(CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.DATE_ADD ELSE NULL END) AS LASTVALIDORDERAT');
    expect(sql).toContain('COUNT(DISTINCT CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.ID_ORDER ELSE NULL END) AS LIFETIMEVALIDORDERCOUNT');
    expect(sql).toContain('SUM(CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.TOTAL_PAID_TAX_INCL ELSE 0 END), 0) AS LIFETIMEGROSSMONETARYTAXINCL');
    expect(sql).toContain('COUNT(DISTINCT CASE WHEN O.VALID = 1 AND O.DATE_ADD < ? THEN O.ID_SHOP ELSE NULL END) AS LIFETIMEDISTINCTSHOPS');
    // window columns must remain untouched (still bounded by [windowStart, windowEnd))
    expect(sql).toContain('COUNT(DISTINCT CASE WHEN O.VALID = 1 AND O.DATE_ADD >= ? AND O.DATE_ADD < ? THEN O.ID_ORDER ELSE NULL END) AS WINDOWVALIDORDERCOUNT');
    // diagnostic flag for identities whose only activity is future-dated
    expect(sql).toContain('MAX(CASE WHEN O.VALID = 1 AND O.DATE_ADD >= ? THEN 1 ELSE 0 END) AS HASFUTUREONLYORDERFLAG');
  });

  it('populationDatasetParams produces exactly one bind value per `?` placeholder, in order', () => {
    const sql = populationDatasetSql(tables);
    const placeholderCount = (sql.match(/\?/g) ?? []).length;
    const params = populationDatasetParams('2025-07-29', '2026-07-30');
    expect(params).toHaveLength(placeholderCount);
    // every lifetime-bound placeholder must be windowEndExclusive, never windowStartInclusive
    expect(params[0]).toBe('2026-07-30'); // firstValidOrderAt
    expect(params[params.length - 1]).toBe('2026-07-30'); // hasFutureOnlyOrderFlag
  });

  // 2. shopScopedLifetimePopulationSql includes the same bound
  it('bounds shopScopedLifetimePopulationSql by date_add < windowEndExclusive', () => {
    const sql = normalized(shopScopedLifetimePopulationSql(tables));
    expect(sql).toContain('WHERE O.VALID = 1 AND O.DATE_ADD < ?');
    expect(sql).toContain('MIN(O.DATE_ADD) AS FIRSTVALIDORDERAT');
    expect(sql).toContain('MAX(O.DATE_ADD) AS LASTVALIDORDERAT');
  });

  it('bounds shopLifetimeTotalsSql and crossShopCustomerCountSql by date_add < windowEndExclusive', () => {
    expect(normalized(shopLifetimeTotalsSql(tables))).toContain('WHERE O.VALID = 1 AND O.DATE_ADD < ?');
    expect(normalized(crossShopCustomerCountSql(tables))).toContain('WHERE O.VALID = 1 AND O.DATE_ADD < ?');
  });

  // 3/4. a future order can never inflate lifetime count/monetary — verified at the SQL
  // level above (the CASE WHEN that feeds COUNT/SUM excludes date_add >= windowEndExclusive
  // outright, so a future-dated row contributes 0 to both, by construction — there is no
  // separate application-level filter that could be forgotten).

  // 5. an identity whose only valid order is future-dated -> no_valid_purchases, and is
  // flagged separately as future-only (never historical_inactive).
  it('classifies an identity whose only order is future-dated as no_valid_purchases, flagged futureOnly', () => {
    // Once bounded, lifetimeValidOrderCount for such an identity is 0 (the SQL CASE WHEN
    // excludes the future order), and windowValidOrderCount is 0 too (window is a subset of
    // "before windowEndExclusive"). hasFutureOnlyOrderFlag is 1 because a valid order exists,
    // just dated on/after windowEndExclusive.
    const lifetimeValidOrderCount = 0;
    const windowValidOrderCount = 0;
    expect(classifyEligibility(lifetimeValidOrderCount, windowValidOrderCount)).toBe('no_valid_purchases');
    expect(isFutureOnlyCustomer(true, lifetimeValidOrderCount)).toBe(true);
  });

  it('does not flag a customer with real historical orders as future-only, even if they also have a future order', () => {
    // hasFutureOnlyOrderFlag can be 1 for a customer with BOTH historical and future orders
    // — isFutureOnlyCustomer must stay false there, since lifetimeValidOrderCount > 0.
    expect(isFutureOnlyCustomer(true, 3)).toBe(false);
  });

  it('does not flag a customer with no orders at all as future-only', () => {
    expect(isFutureOnlyCustomer(false, 0)).toBe(false);
  });

  // 6. historical_inactive reproducibility for the same asOfDate is an integration-level
  // property (depends on the live database not being queried with an unbounded date range).
  // There is no DB-mocking harness in this codebase (every other test here is a pure-function
  // or SQL-text test) — reproducibility for a fixed asOfDate is verified by running the real
  // audit twice consecutively against the live source (see CP-R1-T10A-3 follow-up report,
  // section 8), not by a mocked unit test. What IS unit-testable, and is tested above, is that
  // every lifetime query is bounded by date_add < windowEndExclusive, which is the mechanism
  // that makes that reproducibility possible.

  // 7. explicit P0/P1 scope on the historical-inactive summary — never implicit.
  it('buildHistoricalInactiveSummary always carries an explicit populationScope', () => {
    const rows: HistoricalInactiveSourceRow[] = [
      { lifetimeGrossMonetaryTaxIncl: '100.000000', lastValidOrderAt: '2025-01-01 00:00:00', firstValidOrderAt: '2024-01-01 00:00:00', lifetimeValidOrderCount: 2 },
    ];
    const p0Summary = buildHistoricalInactiveSummary(rows, '2026-07-29', 'P0_all_shops');
    const p1Summary = buildHistoricalInactiveSummary(rows, '2026-07-29', 'P1_main_commercial_shop');
    expect(p0Summary.populationScope).toBe('P0_all_shops');
    expect(p1Summary.populationScope).toBe('P1_main_commercial_shop');
    expect(p0Summary.count).toBe(1);
  });

  it('buildHistoricalInactiveSummary never throws for dates within the lifetime bound', () => {
    const rows: HistoricalInactiveSourceRow[] = [
      { lifetimeGrossMonetaryTaxIncl: '0.000000', lastValidOrderAt: null, firstValidOrderAt: null, lifetimeValidOrderCount: 0 },
    ];
    expect(() => buildHistoricalInactiveSummary(rows, '2026-07-29', 'P0_all_shops')).not.toThrow();
  });

  // 4 (workaround simplification): a defensive assertion, not a silent try/catch — a
  // contract violation (a future-dated lifetime value slipping through despite the SQL
  // bound) must fail loudly with a clear message, never be swallowed into a counter again.
  it('assertLifetimeDateWithinBound throws a contractual error if a future date ever appears (regression guard)', () => {
    expect(() => assertLifetimeDateWithinBound('2026-08-15 00:00:00', '2026-07-29', 'P1_main_commercial_shop.lastValidOrderAt')).toThrow(
      /Contract violation in P1_main_commercial_shop\.lastValidOrderAt/,
    );
  });

  it('assertLifetimeDateWithinBound returns real recencyDays for an in-bound date', () => {
    expect(assertLifetimeDateWithinBound('2026-07-01 00:00:00', '2026-07-29', 'test')).toBe(28);
  });

  // 8. futureOnlyCustomersExcluded is a real, separately reported counter.
  it('isFutureOnlyCustomer is the exact predicate documented as futureOnlyCustomersExcluded', () => {
    const rows = [
      { hasFutureOnlyOrderFlag: true, lifetimeValidOrderCount: 0 }, // future-only -> counted
      { hasFutureOnlyOrderFlag: false, lifetimeValidOrderCount: 5 }, // ordinary active/historical customer
      { hasFutureOnlyOrderFlag: true, lifetimeValidOrderCount: 2 }, // has real history too -> not future-only
    ];
    const futureOnlyCount = rows.filter((row) => isFutureOnlyCustomer(row.hasFutureOnlyOrderFlag, row.lifetimeValidOrderCount)).length;
    expect(futureOnlyCount).toBe(1);
  });

  // Minor correction: commercial-validity-analysis.json (CP-R1-T10A-2) compares R1 against
  // historical_inactive using the same P0-pooled population on both sides (self-consistent,
  // unlike the cross-scope bug fixed in commercial-score-validity.json) — but had no
  // explicit populationScope. buildCommercialValidityAnalysis is not exported (the script
  // has a top-level main() that runs on import), so this checks the source text directly,
  // the same pattern used elsewhere in this file for SQL text assertions.
  it('commercial-validity-analysis.json basis blocks carry an explicit P0_all_shops populationScope', () => {
    const source = readFileSync('scripts/audits/rfm-population/audit-rfm-population.ts', 'utf8');
    const fnMatch = source.match(/function buildCommercialValidityAnalysis[\s\S]*?function compareDataDriven/);
    expect(fnMatch).not.toBeNull();
    const fn = fnMatch![0];
    expect(fn).toContain('doesLowRIdentifyRealInactivity');
    expect(fn).toContain('doesHistoricalInactiveHaveReactivationValue');
    const occurrences = fn.match(/populationScope:\s*'P0_all_shops'/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });
});

describe('CP-R1-T10A-3 documentation: explicit R and M boundary tables (sections 5/6 of the follow-up audit)', () => {
  const methodDoc = readFileSync('docs/audits/rfm-population/CP-R1-T10A-3-rfm-method-finalization.md', 'utf8');

  // 9. R table present in documentation
  it('documents the R5-R1 day ranges explicitly, matching classifyByFrozenRecencyBoundaries (<=, inclusive on the better side)', () => {
    expect(methodDoc).toContain('R5 = 0–69 días');
    expect(methodDoc).toContain('R4 = 70–147 días');
    expect(methodDoc).toContain('R3 = 148–224 días');
    expect(methodDoc).toContain('R2 = 225–290 días');
    expect(methodDoc).toContain('R1 = 291+ días');
    expect(methodDoc).toContain('scores: null');
    expect(methodDoc).toMatch(/R1 is a statement about recency within the active population, not a synonym for `historical_inactive`/);
  });

  // 10. M table present in documentation
  it('documents the M1-M5 monetary ranges explicitly, matching classifyByFrozenMonetaryBoundaries (>=, inclusive on the better side)', () => {
    expect(methodDoc).toContain('19.990');
    expect(methodDoc).toContain('38.295');
    expect(methodDoc).toContain('81.233');
    expect(methodDoc).toContain('206.188');
    expect(methodDoc).toMatch(/M1\s*<\s*19\.990/);
    expect(methodDoc).toMatch(/M5\s*>=\s*206\.188/);
  });
});
