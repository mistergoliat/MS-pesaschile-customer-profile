# CUSTOMER-INTELLIGENCE-AUDIENCE-A04.5.1 — Operational Rehearsal Closure

## OPERATIONAL_REHEARSAL

`PASS`

The production/EC2 rehearsal used the real audience definition:

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root": {
    "kind": "HAS_AFFINITY",
    "axis": "USE_CONTEXT",
    "code": "HOME_GYM",
    "minScore": "0.30"
  }
}
```

Authoritative membership resolved to `matched=3174`, `unknown=0`, with affinity lineage snapshot `6`.

## OPERATIONAL_RESULTS

| Case | HTTP | Matched | Unknown | Bytes | Rows/validation | Generation ms | Server total ms | Peak RSS KiB |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| CSV customerId-only | 200 | 3174 | 0 | 25018 | 3174 data + header | 218 | 1064 | 143808 |
| CSV full contact | 200 | 3174 | 0 | 168543 | 3174 data + header | 214 | 775 | 162488 |
| XLSX customerId-only | 200 | 3174 | 0 | 37405 | ZIP/workbook valid | 694 | 1287 | 173732 |
| XLSX full contact | 200 | 3174 | 0 | 143539 | ZIP/workbook valid | 507 | 1110 | 191456 |

All four paths returned binary HTTP attachments. CSV output contained 3175 lines including the header. XLSX ZIP and `workbook.xml` validation passed.

## MEMORY_ASSESSMENT

Observed post-rehearsal RSS stabilized at approximately `116900 KiB` (`116572`, `116884`, `116892`, `116904 KiB`). There is `NO LEAK EVIDENCE`. XLSX concurrency `1` remains appropriate.

## ROOT_CAUSE_AND_HOTFIX

The rehearsal script used `curl -w` without a terminating newline, then parsed the output with `read` under `set -euo pipefail`. Bash populated the fields but returned non-zero at EOF because the final line was unterminated, causing the script to stop after the first successful case.

The minimal fix adds `\n` to the `curl -w` format. A focused static regression test prevents removal of the terminator. No unrelated script refactor was made.

## USER_VISIBLE_EXPORT_CONTRACT

- Formats: `CSV`, `XLSX`.
- Destination: `DOWNLOAD_ONLY`.
- Brevo remains deferred/internal.
- No visible `BREVO_CONTACT_IMPORT_CSV`, `GENERIC_CSV`, `GENERIC_XLSX`, or destination selector.

## STORAGE_POLICY

`TRANSIENT_ONLY`

Persistent EC2 export storage: `NO`. Runtime output files are temporary rehearsal artifacts and are deleted by the script.

## OPERATIONAL_CONCLUSION

Authoritative membership, CSV/XLSX download, row-count invariant, binary attachment, PII hydration, transient storage, and memory recovery all passed. The A04 operational pipeline is validated and closed.
