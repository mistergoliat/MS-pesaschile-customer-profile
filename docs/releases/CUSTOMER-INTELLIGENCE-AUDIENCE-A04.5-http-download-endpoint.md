# CUSTOMER-INTELLIGENCE-AUDIENCE-A04.5 — HTTP Download Endpoint + Operational Hardening

## BASELINE

A04.1 authoritative membership, A04.2 bulk contact hydration/preview, A04.3 CSV/XLSX artifact generation, and A04.4 unified download contract are retained. The download route resolves a fresh authoritative membership; it never consumes the bounded A02 preview IDs.

## ENDPOINT

`POST /v1/customer-intelligence/audiences/export`

The route orchestrates request validation → authoritative membership → bulk contact hydration → in-memory artifact → HTTP attachment. CSV and XLSX serialization remains in the A04 application writers.

Successful responses also include `X-Audience-Export-Matched-Count`, `X-Audience-Export-Unknown-Count`, `X-Audience-Export-Generation-Ms`, and `X-Audience-Export-Total-Ms` for operational rehearsal; clients may ignore these headers.

## REQUEST_CONTRACT

```json
{
  "definition": { "definitionVersion": "customer-intelligence-audience-definition-v1", "root": {} },
  "format": "CSV",
  "fields": ["customerId", "email", "firstname", "lastname"]
}
```

`fields` is optional and defaults to `customerId`. The server allowlist is `customerId`, `email`, `firstname`, and `lastname`; `customerId` is always required. The body is strict: destination, member IDs, SQL, snapshots, lineage, checksums, filenames, and storage locations are rejected.

## AUTHENTICATION

Audience evaluation keeps the existing `x-internal-customer-intelligence-token` boundary. Bulk download uses a separate `CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_TOKEN`, sent as `x-internal-customer-intelligence-export-token`. Missing configuration fails closed with `503`; missing credentials return `401`.

## AUTHORIZATION

The export token grants bulk download capability only. `email`, `firstname`, and `lastname` additionally require `CUSTOMER_INTELLIGENCE_AUDIENCE_PII_EXPORT_TOKEN`, sent as `x-internal-customer-intelligence-pii-export-token`; missing or invalid PII permission returns `503`/`403`. `customerId`-only downloads do not require the PII token.

## PII_POLICY

Only the four allowlisted fields can be selected. No phone source, custom attributes, email/name values, member IDs, SQL, or file contents are written to logs. Filenames contain only a checksum prefix and generated timestamp.

## CSV_RESPONSE

`200` with `Content-Type: text/csv; charset=utf-8`, safe `Content-Disposition: attachment`, exact `Content-Length`, and raw UTF-8 CSV bytes. There is no JSON envelope.

## XLSX_RESPONSE

`200` with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, safe attachment disposition, exact byte length, and raw XLSX bytes. The workbook retains the A04.4 `Audience` and `Metadata` sheets.

## STORAGE_POLICY

`TRANSIENT_ONLY`. The current implementation uses in-memory `Buffer` artifacts and does not write `artifacts/`, `uploads/`, a database row, or a persistent export directory. The client/browser saves the response locally.

## ROW_LIMIT

`50,000` matched rows by default (`CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_MAX_MATCHED_ROWS`). No truncation. Exceeding the limit returns `413` with `EXPORT_ROW_LIMIT_EXCEEDED`.

## BYTE_LIMIT

`50 MiB` by default (`CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_MAX_OUTPUT_BYTES`). Exceeding the final artifact limit returns `413` with `EXPORT_SIZE_LIMIT_EXCEEDED`.

## TIMEOUT

`120,000 ms` by default (`CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_TIMEOUT_MS`), covering membership evaluation, contact hydration, and artifact generation. A timeout returns `504` before binary headers are sent. The limiter lease remains held until the underlying operation settles when downstream cancellation is unavailable.

## CONCURRENCY_POLICY

Process-local bounded leases: CSV maximum `4`, XLSX maximum `1` (`CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_CSV_CONCURRENCY` and `CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_XLSX_CONCURRENCY`). XLSX remains serialized because the observed ~45k-row run reached approximately 442 MiB RSS. Every success, failure, timeout, and disconnect path releases its lease.

## RATE_LIMIT_POLICY

Process-local export start window: `12` accepted export starts per minute by default (`CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_RATE_LIMIT_PER_MINUTE`). Saturated concurrency or rate returns `429`. This is intentionally stricter than ordinary read routes and should be complemented by the edge/service rate limiter in deployment.

## ERROR_MAPPING

| Condition | HTTP | Error |
| --- | ---: | --- |
| malformed request, unsupported field/format | 400 | `invalid_audience_export_request` or typed validation code |
| missing export auth | 401/503 | `unauthorized` / auth-not-configured |
| missing PII permission | 403/503 | `audience_pii_export_forbidden` / auth-not-configured |
| snapshot/dependency conflict | 409 | `AUDIENCE_SNAPSHOT_CONFLICT` |
| membership/SQL timeout | 504 | `AUDIENCE_MEMBERSHIP_TIMEOUT` / `EXPORT_TIMEOUT` |
| row/byte budget | 413 | `EXPORT_ROW_LIMIT_EXCEEDED` / `EXPORT_SIZE_LIMIT_EXCEEDED` |
| limiter saturated | 429 | `audience_export_concurrency_limited` / `audience_export_rate_limited` |
| hydration/dependency failure | 503 | typed membership/hydration error |
| writer or invariant failure | 500 | `internal_error` |

Zero matches and all-UNKNOWN membership are successful `200` downloads. CSV is header-only; XLSX keeps `Audience` headers and `Metadata`.

## AUDIT_LOGGING

The route emits metadata-only audit records containing actor/service identity, definition/evaluation/membership checksums, format, selected fields, matched/unknown counts, artifact row count/bytes, relevant snapshot IDs, duration, and outcome. It never logs emails, names, raw member IDs, SQL, parameters, credentials, or file contents.

## FILES_CHANGED

- `src/http/routes/index.ts` — authenticated binary download route, response/error contract, audit logging, disconnect/timeout handling.
- `src/application/customer-intelligence-audience/export-limiter.ts` — bounded concurrency and process-local rate limiter.
- `src/bootstrap.ts` — authoritative membership wiring shared with the A02 evaluator context/SQL executor.
- `src/index.ts`, `src/config.ts`, `.env.example` — export credentials and operational limits.
- `tests/integration/customer-intelligence-audience-export-route.test.ts` — HTTP contract and failure coverage.
- `tests/unit/customer-intelligence-audience-export-limiter.test.ts`, `tests/unit/customer-intelligence-audience-export-storage.test.ts` — lease/rate/concurrency and no-persistence coverage.
- `scripts/customer-intelligence-audience/a04-5-export-rehearsal.sh` — EC2 rehearsal.

## TEST_RESULTS

- `npm run typecheck` — pass.
- `npm run lint` — pass, 0 errors.
- Focused export/A04.5 tests — 5 files, 29 tests passed.
- `npm test` — 237 test files passed; 2,151 tests passed; 1 skipped (2,152 total).
- `npm run build` — pass.

## EC2_REHEARSAL_PLAN

Run `bash scripts/customer-intelligence-audience/a04-5-export-rehearsal.sh <base-url> <definition.json> <export-token> <pii-token> [customer-profile-pid]` with a non-zero real audience definition JSON. The script exercises customerId-only CSV, full-field CSV, customerId-only XLSX, and full-field XLSX; captures matched/file rows/file bytes/generation and request timing plus idle/peak/post RSS; validates CSV headers and XLSX ZIP structure/sheets; and deletes its temporary outputs on exit.

## MIGRATION

`NO`

## PERSISTENT_EXPORT_STORAGE

`NO`

## NETWORK_DESTINATIONS

`NONE` beyond the existing internal HTTP caller and configured local database readers.

## IMPLEMENTATION_DECISION

`READY_FOR_OPERATIONAL_REHEARSAL`
