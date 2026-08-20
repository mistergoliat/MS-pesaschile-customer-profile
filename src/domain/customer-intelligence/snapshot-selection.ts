export type SnapshotHeaderCandidate = {
  readonly snapshotId: string;
  readonly referenceTime: string;
};

// The canonical statement of task Section 8's recommended policy: the feature snapshot is
// the anchor, and any composed RFM/cluster snapshot must have a referenceTime at or before
// the anchor's — never a "future" output relative to the feature snapshot being described
// (task Section 31/44). Pure and DB-free so the policy itself is unit-testable with plain
// fixtures (task Section 44), independent of whatever SQL a reader uses to fetch candidates.
//
// Tie-break: if two candidates share the exact same referenceTime (an edge case — two
// snapshots published back-to-back), the one with the higher numeric snapshotId wins, on the
// assumption that ids are assigned in creation order (AUTO_INCREMENT) even when clocks tie.
export function selectLatestSnapshotAtOrBefore<T extends SnapshotHeaderCandidate>(
  candidates: readonly T[],
  referenceTimeInclusive: string,
): T | null {
  const anchorMs = new Date(referenceTimeInclusive).getTime();
  if (Number.isNaN(anchorMs)) {
    throw new Error(`Invalid referenceTimeInclusive: ${referenceTimeInclusive}`);
  }

  let selected: T | null = null;
  let selectedMs = -Infinity;
  for (const candidate of candidates) {
    const candidateMs = new Date(candidate.referenceTime).getTime();
    if (Number.isNaN(candidateMs)) {
      throw new Error(`Invalid candidate referenceTime: ${candidate.referenceTime}`);
    }
    if (candidateMs > anchorMs) continue; // never select a future output relative to the anchor
    if (
      selected === null ||
      candidateMs > selectedMs ||
      (candidateMs === selectedMs && compareSnapshotIdDesc(candidate.snapshotId, selected.snapshotId) < 0)
    ) {
      selected = candidate;
      selectedMs = candidateMs;
    }
  }
  return selected;
}

function compareSnapshotIdDesc(a: string, b: string): number {
  const numericA = Number(a);
  const numericB = Number(b);
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) {
    return numericB - numericA;
  }
  return b.localeCompare(a);
}
