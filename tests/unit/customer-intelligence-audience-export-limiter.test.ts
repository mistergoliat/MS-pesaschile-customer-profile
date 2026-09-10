import { describe, expect, it } from 'vitest';
import { createAudienceExportLimiter } from '../../src/application/customer-intelligence-audience/export-limiter.js';

describe('audience export limiter', () => {
  it('allows one XLSX export and rejects the next concurrent export', () => {
    const limiter = createAudienceExportLimiter({ startsPerMinute: 10 });
    const first = limiter.tryAcquire('XLSX');
    const second = limiter.tryAcquire('XLSX');

    expect(first.accepted).toBe(true);
    expect(second).toEqual({ accepted: false, reason: 'CONCURRENCY_LIMIT' });
    if (first.accepted) first.lease.release();
    expect(limiter.active()).toEqual({ CSV: 0, XLSX: 0 });
    expect(limiter.tryAcquire('XLSX').accepted).toBe(true);
  });

  it('releases a lease idempotently after a failed operation', () => {
    const limiter = createAudienceExportLimiter({ startsPerMinute: 10 });
    const lease = limiter.tryAcquire('CSV');
    expect(lease.accepted).toBe(true);
    if (lease.accepted) {
      lease.lease.release();
      lease.lease.release();
    }
    expect(limiter.active()).toEqual({ CSV: 0, XLSX: 0 });
    expect(limiter.tryAcquire('CSV').accepted).toBe(true);
  });

  it('applies a bounded process-local start rate', () => {
    let now = 1_000;
    const limiter = createAudienceExportLimiter({ startsPerMinute: 1, now: () => now });
    const first = limiter.tryAcquire('CSV');
    expect(first.accepted).toBe(true);
    if (first.accepted) first.lease.release();
    expect(limiter.tryAcquire('CSV')).toEqual({ accepted: false, reason: 'RATE_LIMIT' });
    now += 60_000;
    expect(limiter.tryAcquire('CSV').accepted).toBe(true);
  });
});
