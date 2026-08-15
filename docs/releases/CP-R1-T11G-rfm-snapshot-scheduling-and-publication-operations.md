# CP-R1-T11G - RFM Snapshot Scheduling and Publication Operations

Date: 2026-08-14

## Goal

Operationalize the existing RFM snapshot pipeline without changing the R/F/M
calculation itself.

This task closes the gap left after T11F:

```text
runtime RFM endpoint
-> depends on
-> manually executed snapshot CLI
```

T11G adds:

- a production worker entrypoint for scheduled execution;
- DB-backed cross-process locking;
- persistent run tracing;
- explicit idempotence for repeated snapshot keys;
- sanitized operational logging.

It does not add clustering, CRM writeback, Sales Agent integration, HTTP
contract changes or in-process timers inside the HTTP runtime.

## Audit Summary

### Existing pipeline before T11G

Before this task, the repo already had:

- `scripts/snapshots/rfm-snapshot.ts` as the only execution entrypoint;
- `createRfmSnapshot(...)` for schema verification, PrestaShop read,
  canonical identity wiring, segmentation, manifest build and optional
  persistence;
- `createMysqlRfmSnapshotRepository(...)` for transactional publication;
- `customer_rfm_snapshot.status` lifecycle:
  `building -> validated -> published`, with previous published snapshots moved
  to `superseded`;
- current snapshot selection based only on:

```sql
status = 'published'
ORDER BY published_at DESC, id DESC
LIMIT 1
```

### What was missing

The repo did not contain:

- any scheduler or worker process pattern;
- any platform-specific cron/PM2/systemd/docker deployment contract;
- any persistent run log;
- any cross-instance execution lock;
- any explicit distinction between:
  - same snapshot key + same checksum;
  - same snapshot key + different checksum.

### Atomicity and failure behavior already present

The snapshot writer already persisted inside a single MySQL transaction:

1. insert header as `building`;
2. insert all rows;
3. verify row count;
4. verify persisted checksum;
5. persist manifest with `snapshotId`;
6. supersede previous published snapshots of the same publication stream;
7. mark `validated`;
8. mark `published`;
9. commit.

If any step failed, the transaction rolled back and the previously published
snapshot remained intact.

### Recovery policy for abandoned `building` / `validated`

Because publication is transactional, an application crash during persistence
normally rolls back the entire transaction and should not leave partial rows as
current.

T11G keeps two explicit guarantees:

- `building` and `validated` snapshots are never selected as current;
- no automatic destructive cleanup of those states is introduced.

If a historical abandoned row exists for any external reason, it remains a
non-current diagnostic artifact until handled manually.

## Architectural Decision

T11G adopts **Option C - external scheduler -> worker CLI**.

Implemented shape:

```text
external scheduler
-> npm run snapshot:rfm:scheduled
-> DB execution lock
-> run log row
-> existing snapshot application pipeline
```

Why this option:

- avoids naive per-instance timers inside the HTTP service;
- preserves failure isolation between synchronous HTTP traffic and background
  snapshot generation;
- works safely in multi-instance deployments when combined with a DB lock;
- keeps manual/backfill execution available through the existing CLI family.

What was explicitly not chosen:

- no in-process timer inside `src/index.ts` / `src/bootstrap.ts`;
- no scheduler state inside HTTP readiness;
- no platform-specific cron expression baked into repo config.

Cadence remains an operational decision outside this repository. Initial SLO:

```text
expected snapshot frequency = daily
```

The scheduled worker computes `referenceTime` deterministically at the
**UTC start-of-day boundary** of the run date. On 2026-08-14 at any time of
day, the scheduled worker uses:

```text
2026-08-14T00:00:00.000Z
```

Manual/backfill CLI still accepts explicit `RFM_REFERENCE_TIME`.

## Implementation

### 1. Separate scheduled worker entrypoint

Added:

- `npm run snapshot:rfm:scheduled`
- `scripts/snapshots/rfm-snapshot-scheduled.ts`

Kept:

- `npm run snapshot:rfm`
- manual `RFM_REFERENCE_TIME` override
- `RFM_DRY_RUN=true` support for manual debugging/backfills

Both entrypoints now reuse the same application orchestration through:

- `src/application/customer-rfm/run-rfm-snapshot-operation.ts`
- `scripts/snapshots/lib/rfm-snapshot-command.ts`

### 2. DB-backed cross-process execution lock

Added:

- `src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.ts`

The scheduled/manual persisted path acquires a MySQL advisory lock:

```text
customer_rfm_snapshot_execution_v1
```

Behavior:

- first worker acquires lock and executes;
- second concurrent worker does not execute the snapshot pipeline;
- second worker records a skipped run with
  `skipReason = execution_lock_not_acquired`.

This protection is process-safe and multi-instance safe as long as workers share
the same snapshot DB.

### 3. Persistent operational run log

Added migration:

- `migrations/004_create_customer_rfm_snapshot_run_table.sql`
- `migrations/004_create_customer_rfm_snapshot_run_table.rollback.sql`

New table:

```text
customer_rfm_snapshot_run
```

Stored fields include:

- trigger source (`manual` / `scheduled`);
- run status (`started`, `succeeded`, `failed`, `skipped`);
- `reference_time`;
- `calculation_version`;
- `segment_version`;
- `snapshot_key`;
- `started_at`;
- `completed_at`;
- `snapshot_id`;
- `error_type`;
- `error_code`;
- `summary_json`.

`summary_json` persists:

- population size;
- canonical matched / unmatched / ambiguous counts;
- canonical coverage pct;
- segment counts.

### 4. Explicit idempotence on repeated snapshot keys

`createRfmSnapshot(...)` no longer treats every repeated published key as the
same outcome.

New behavior:

1. If the same `snapshotKey` is already published with the **same**
   `datasetChecksum`:

```text
-> skip safely
-> do not republish
-> record run as skipped
-> reuse existing snapshotId
```

2. If the same `snapshotKey` is already published with a **different**
   `datasetChecksum`:

```text
-> fail explicitly with RfmSnapshotKeyConflictError
-> do not overwrite historical data
```

This makes repeated runs deterministic and auditable.

### 5. Sanitized operational logging

Both CLI entrypoints now log structured JSON with:

- `runId`;
- timestamps;
- duration;
- status;
- `referenceTime`;
- `calculationVersion`;
- `segmentVersion`;
- `snapshotKey`;
- `snapshotId`;
- summary counts.

Failure logs expose only:

- `errorType`;
- `errorCode`.

They do not print raw DB error messages, hostnames or credentials.

## Health / Readiness Decision

No change was made to `GET /health/ready`.

Reason:

- the service can keep serving non-RFM endpoints even if no current RFM snapshot
  exists or the snapshot worker is degraded;
- turning a degraded RFM capability into global service unready would be too
  broad for this task.

Operational freshness should instead be monitored through:

- the latest `customer_rfm_snapshot_run` rows;
- the latest `customer_rfm_snapshot.published_at`;
- the delta between current date and latest published `reference_time`.

For the initial daily SLO, the operational alarm condition is conceptually:

```text
latest published reference_time older than 1 day boundary
or
latest scheduled run failed repeatedly
```

## Files Added / Modified

Added:

- `docs/releases/CP-R1-T11G-rfm-snapshot-scheduling-and-publication-operations.md`
- `migrations/004_create_customer_rfm_snapshot_run_table.sql`
- `migrations/004_create_customer_rfm_snapshot_run_table.rollback.sql`
- `scripts/snapshots/lib/rfm-snapshot-command.ts`
- `scripts/snapshots/rfm-snapshot-scheduled.ts`
- `src/application/customer-rfm/run-rfm-snapshot-operation.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.ts`
- `tests/unit/mysql-rfm-snapshot-run-repository.test.ts`
- `tests/unit/run-rfm-snapshot-operation.test.ts`

Modified:

- `README.md`
- `package.json`
- `scripts/snapshots/rfm-snapshot.ts`
- `src/application/customer-rfm/create-rfm-snapshot.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts`
- `src/rfm-snapshot-config.ts`
- `tests/unit/create-rfm-snapshot.test.ts`
- `tests/unit/customer-rfm-migrations.test.ts`
- `tests/unit/rfm-snapshot-cli.test.ts`
- `tests/unit/rfm-snapshot-config.test.ts`

## Validation

Executed on 2026-08-14:

- `npm run typecheck` -> PASS
- `npm run lint` -> PASS
- `npm test` -> PASS (`103` files, `796` tests)

Operational path validation in this environment:

- `npm run snapshot:rfm` with synthetic localhost DB envs ->
  reached runtime path and failed cleanly at external infrastructure with
  sanitized output:
  `{"errorCode":"PrestashopUnavailableError","errorType":"PrestashopUnavailableError","status":"failed","triggerSource":"manual"}`
- `npm run snapshot:rfm:scheduled` with synthetic localhost DB envs ->
  reached scheduled worker path and failed cleanly at external infrastructure
  with sanitized output:
  `{"errorCode":"ECONNREFUSED","errorType":"Error","status":"failed","triggerSource":"scheduled"}`

No real production DB validation was possible in this environment.

## Remaining Risks / Debt

- The repo now provides the worker command, lock and run log, but the actual
  platform scheduler wiring (cron, container job, EventBridge, etc.) still has
  to be configured outside the codebase.
- Freshness alerting is documented but not yet enforced by a dedicated health
  detail endpoint or monitoring integration.
- Historical abandoned `building` / `validated` rows remain diagnostic artifacts;
  no automated cleanup/mark-failed routine was introduced in T11G.
- No clustering was implemented.
- No commercial activation, CRM writeback or Sales Agent consumption was
  implemented.

## Out of Scope Confirmed

T11G did **not** implement:

- clustering;
- commercial segmentation changes;
- new RFM HTTP endpoint work;
- scheduler inside the HTTP runtime;
- Sales Agent integration;
- CRM write integration;
- broad readiness redesign.

## Next Work

Recommended next operational/consumption step after T11G:

**CP-R1 post-T11G: integrate actual platform scheduling + downstream consumer
activation against the already published RFM contract.**

**Update (2026-08-15):** downstream consumer activation is done. It shipped
cross-repo as T11H / T11H.1 in `CRM-Customer-360`, consuming the T11F
contract as-is — see
[CP-R1-T11H-cross-repo-reference.md](CP-R1-T11H-cross-repo-reference.md).
Platform scheduler wiring (cron/container job/EventBridge) outside this repo
remains the only open item from this section.
