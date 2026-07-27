import { describe, expect, it } from 'vitest';
import type { CustomerProfileSnapshot } from '../../src/contracts/index.js';

describe('Customer Profile contracts', () => {
  it('keeps the initial snapshot contract intentionally small', () => {
    const snapshot = {
      masterCustomerId: '1',
      identityStatus: 'provisional',
      generatedAt: '2026-07-27T00:00:00.000Z',
      warnings: [],
    } satisfies CustomerProfileSnapshot;

    expect(snapshot.masterCustomerId).toBe('1');
    expect(snapshot.identityStatus).toBe('provisional');
  });
});
