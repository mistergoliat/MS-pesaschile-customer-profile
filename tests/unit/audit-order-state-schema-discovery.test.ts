import { describe, expect, it } from 'vitest';
import { detectOrderDetailTable, detectPrefix } from '../../scripts/audits/order-state-semantics/lib/schema-discovery.js';

const ALL_PS_TABLES = [
  'ps_orders',
  'ps_order_state',
  'ps_order_state_lang',
  'ps_order_history',
  'ps_order_carrier',
  'ps_carrier',
  'ps_customer',
  'ps_address',
];

describe('detectPrefix', () => {
  it('detects ps_ when all six required tables exist under it', () => {
    const result = detectPrefix(ALL_PS_TABLES);

    expect(result.ambiguous).toBe(false);
    expect(result.prefix).toBe('ps_');
    expect(result.missing).toEqual([]);
    expect(result.found).toEqual({
      orders: 'ps_orders',
      order_state: 'ps_order_state',
      order_state_lang: 'ps_order_state_lang',
      order_history: 'ps_order_history',
      order_carrier: 'ps_order_carrier',
      carrier: 'ps_carrier',
    });
  });

  it('still resolves the prefix when one required table is missing, and reports it', () => {
    const withoutOrderCarrier = ALL_PS_TABLES.filter((name) => name !== 'ps_order_carrier');

    const result = detectPrefix(withoutOrderCarrier);

    expect(result.prefix).toBe('ps_');
    expect(result.missing).toEqual(['order_carrier']);
  });

  it('returns no prefix when there is no *orders table at all', () => {
    const result = detectPrefix(['ps_customer', 'ps_address']);

    expect(result.prefix).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.missing.length).toBe(6);
  });

  it('reports ambiguous when two prefixes tie on the same (best) number of matches', () => {
    const twoFullSchemas = [
      'ps_orders',
      'ps_order_state',
      'ps_order_state_lang',
      'ps_order_history',
      'ps_order_carrier',
      'ps_carrier',
      'shop2_orders',
      'shop2_order_state',
      'shop2_order_state_lang',
      'shop2_order_history',
      'shop2_order_carrier',
      'shop2_carrier',
    ];

    const result = detectPrefix(twoFullSchemas);

    expect(result.ambiguous).toBe(true);
    expect(result.prefix).toBeNull();
    expect([...result.candidates].sort()).toEqual(['ps_', 'shop2_']);
  });

  it('does not get confused by an unrelated table that happens to end in "orders"', () => {
    const withDecoyTable = [...ALL_PS_TABLES, 'backorders'];

    const result = detectPrefix(withDecoyTable);

    // 'back' only matches its own orders table (score 1); 'ps_' matches all 6 — ps_ wins outright.
    expect(result.ambiguous).toBe(false);
    expect(result.prefix).toBe('ps_');
  });
});

describe('detectOrderDetailTable', () => {
  it('finds the standard ps_order_detail table', () => {
    const result = detectOrderDetailTable([...ALL_PS_TABLES, 'ps_order_detail'], 'ps_');

    expect(result.tableName).toBe('ps_order_detail');
    expect(result.candidatesChecked).toEqual(['ps_order_detail', 'ps_order_details']);
  });

  it('falls back to the plural ps_order_details when that is the one present', () => {
    const result = detectOrderDetailTable([...ALL_PS_TABLES, 'ps_order_details'], 'ps_');

    expect(result.tableName).toBe('ps_order_details');
  });

  it('prefers the singular form when both variants exist', () => {
    const result = detectOrderDetailTable([...ALL_PS_TABLES, 'ps_order_detail', 'ps_order_details'], 'ps_');

    expect(result.tableName).toBe('ps_order_detail');
  });

  it('returns null (never guesses) when neither variant exists', () => {
    const result = detectOrderDetailTable(ALL_PS_TABLES, 'ps_');

    expect(result.tableName).toBeNull();
  });
});
