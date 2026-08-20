import { describe, expect, it } from 'vitest';
import { selectLatestSnapshotAtOrBefore } from '../../src/domain/customer-intelligence/snapshot-selection.js';

function candidate(snapshotId: string, referenceTime: string) {
  return { snapshotId, referenceTime };
}

// Task Section 44's exact worked fixture.
describe('selectLatestSnapshotAtOrBefore (task Section 8/44 — never select a future snapshot)', () => {
  it('selects the RFM snapshot at 90 (not 110) when the anchor is at 100', () => {
    const candidates = [candidate('1', '1970-01-01T00:01:30.000Z'), candidate('2', '1970-01-01T00:01:50.000Z')]; // 90s, 110s
    const anchor = '1970-01-01T00:01:40.000Z'; // 100s
    const selected = selectLatestSnapshotAtOrBefore(candidates, anchor);
    expect(selected?.snapshotId).toBe('1');
  });

  it('selects the cluster snapshot at 95 (not 120) among 80/95/120 when the anchor is at 100', () => {
    const candidates = [
      candidate('80', '1970-01-01T00:01:20.000Z'),
      candidate('95', '1970-01-01T00:01:35.000Z'),
      candidate('120', '1970-01-01T00:02:00.000Z'),
    ];
    const anchor = '1970-01-01T00:01:40.000Z';
    const selected = selectLatestSnapshotAtOrBefore(candidates, anchor);
    expect(selected?.snapshotId).toBe('95');
  });

  it('never selects a candidate strictly after the anchor', () => {
    const candidates = [candidate('future', '2026-08-20T00:00:01.000Z')];
    const selected = selectLatestSnapshotAtOrBefore(candidates, '2026-08-20T00:00:00.000Z');
    expect(selected).toBeNull();
  });

  it('is inclusive of a candidate exactly equal to the anchor', () => {
    const candidates = [candidate('exact', '2026-08-20T00:00:00.000Z')];
    const selected = selectLatestSnapshotAtOrBefore(candidates, '2026-08-20T00:00:00.000Z');
    expect(selected?.snapshotId).toBe('exact');
  });

  it('returns null for an empty candidate list', () => {
    expect(selectLatestSnapshotAtOrBefore([], '2026-08-20T00:00:00.000Z')).toBeNull();
  });

  it('returns null when every candidate is after the anchor', () => {
    const candidates = [candidate('a', '2026-08-21T00:00:00.000Z'), candidate('b', '2026-08-22T00:00:00.000Z')];
    expect(selectLatestSnapshotAtOrBefore(candidates, '2026-08-20T00:00:00.000Z')).toBeNull();
  });

  it('tie-breaks equal referenceTime candidates by the higher numeric snapshotId', () => {
    const candidates = [candidate('5', '2026-08-20T00:00:00.000Z'), candidate('9', '2026-08-20T00:00:00.000Z')];
    const selected = selectLatestSnapshotAtOrBefore(candidates, '2026-08-20T00:00:00.000Z');
    expect(selected?.snapshotId).toBe('9');
  });

  it('throws for an invalid anchor referenceTime', () => {
    expect(() => selectLatestSnapshotAtOrBefore([], 'not-a-date')).toThrow(/Invalid referenceTimeInclusive/);
  });

  it('throws for an invalid candidate referenceTime', () => {
    expect(() => selectLatestSnapshotAtOrBefore([candidate('1', 'not-a-date')], '2026-08-20T00:00:00.000Z')).toThrow(
      /Invalid candidate referenceTime/,
    );
  });
});
