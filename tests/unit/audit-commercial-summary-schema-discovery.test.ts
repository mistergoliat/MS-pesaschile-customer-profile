import { describe, expect, it } from 'vitest';
import { detectPrefix, detectVariantTable } from '../../scripts/audits/commercial-summary/lib/schema-discovery.js';

const REQUIRED_SUFFIXES = ['orders', 'order_state', 'order_state_lang', 'customer', 'currency'];

const ALL_PS_TABLES = ['ps_orders', 'ps_order_state', 'ps_order_state_lang', 'ps_customer', 'ps_currency', 'ps_address'];

describe('detectPrefix (generalized, parameterized required suffixes)', () => {
  it('detects ps_ when all required tables exist under it', () => {
    const result = detectPrefix(ALL_PS_TABLES, REQUIRED_SUFFIXES);

    expect(result.ambiguous).toBe(false);
    expect(result.prefix).toBe('ps_');
    expect(result.missing).toEqual([]);
    expect(result.found).toEqual({
      orders: 'ps_orders',
      order_state: 'ps_order_state',
      order_state_lang: 'ps_order_state_lang',
      customer: 'ps_customer',
      currency: 'ps_currency',
    });
  });

  it('still resolves the prefix when one required table is missing, and reports it', () => {
    const withoutCurrency = ALL_PS_TABLES.filter((name) => name !== 'ps_currency');

    const result = detectPrefix(withoutCurrency, REQUIRED_SUFFIXES);

    expect(result.prefix).toBe('ps_');
    expect(result.missing).toEqual(['currency']);
  });

  it('returns no prefix when there is no *orders table at all', () => {
    const result = detectPrefix(['ps_customer', 'ps_address'], REQUIRED_SUFFIXES);

    expect(result.prefix).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.missing.length).toBe(REQUIRED_SUFFIXES.length);
  });

  it('reports ambiguous when two prefixes tie on the same (best) number of matches', () => {
    const twoFullSchemas = [
      'ps_orders',
      'ps_order_state',
      'ps_order_state_lang',
      'ps_customer',
      'ps_currency',
      'shop2_orders',
      'shop2_order_state',
      'shop2_order_state_lang',
      'shop2_customer',
      'shop2_currency',
    ];

    const result = detectPrefix(twoFullSchemas, REQUIRED_SUFFIXES);

    expect(result.ambiguous).toBe(true);
    expect(result.prefix).toBeNull();
    expect([...result.candidates].sort()).toEqual(['ps_', 'shop2_']);
  });

  it('works with a different required-suffix set entirely (proves it is not hardcoded)', () => {
    const result = detectPrefix(['x_orders', 'x_customer'], ['orders', 'customer']);

    expect(result.prefix).toBe('x_');
    expect(result.missing).toEqual([]);
  });
});

describe('detectVariantTable', () => {
  it('finds the standard ps_order_detail table', () => {
    const result = detectVariantTable([...ALL_PS_TABLES, 'ps_order_detail'], ['ps_order_detail', 'ps_order_details']);

    expect(result.tableName).toBe('ps_order_detail');
    expect(result.candidatesChecked).toEqual(['ps_order_detail', 'ps_order_details']);
  });

  it('falls back to the plural variant when that is the one present', () => {
    const result = detectVariantTable([...ALL_PS_TABLES, 'ps_order_details'], ['ps_order_detail', 'ps_order_details']);

    expect(result.tableName).toBe('ps_order_details');
  });

  it('returns null (never guesses) when no candidate exists', () => {
    const result = detectVariantTable(ALL_PS_TABLES, ['ps_order_slip']);

    expect(result.tableName).toBeNull();
  });

  it('supports a single-candidate check (e.g. optional ps_order_slip)', () => {
    const result = detectVariantTable([...ALL_PS_TABLES, 'ps_order_slip'], ['ps_order_slip']);

    expect(result.tableName).toBe('ps_order_slip');
  });
});
