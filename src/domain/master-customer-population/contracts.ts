// Resume-state for the offline population job (CP-R1-T02A). Not implemented yet —
// this defines the shape and the resume/abort rule; the job itself is a later task.
//
// Resume rule (enforced by the job, not by this type): if a stored checkpoint's
// environment, sourceDatabase or candidateMapHash does not match the current run,
// the job must abort with an explicit error instead of resuming — environment and
// sourceDatabase stop a staging run from resuming into production or against the
// wrong database; candidateMapHash stops resuming against a stale phase-1 global
// email map (see CP-R1-T02A section 5) after the underlying data has changed.
export type PopulationCheckpoint = {
  readonly runId: string;
  readonly environment: string;
  readonly sourceDatabase: string;
  readonly startedAt: string;
  readonly sourceSnapshotAt: string;
  readonly candidateMapHash: string;
  readonly lastProcessedPrestashopCustomerId: number;
  readonly updatedAt: string;
};
