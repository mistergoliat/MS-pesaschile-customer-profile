# CUSTOMER-INTELLIGENCE-AUDIENCE-A04.4 — Unified Download Contract

## Product contract

The user-facing export formats are exactly:

- CSV
- XLSX

The destination is implicit DOWNLOAD; there is no user-selectable destination in A04. The
artifact is transient and remains in memory only long enough for a future A04.5 HTTP response.
No persistent export storage, Brevo API call, or Brevo credential is introduced.

The downloadable CSV remains generic and readable with headers customerId, email, firstname, and
lastname. It is not shaped as a Brevo import file.

## Brevo boundary

Brevo readiness remains internal preview metadata only. It cannot change generic CSV/XLSX row
counts, membership, checksums, or lineage. The future A08 projection maps customerId converted to
String to EXT_ID; EXT_ID is intentionally absent from normal downloads.

For manual Brevo import, the generic CSV can be mapped in Brevo's import UI as:

| Download header | Brevo attribute |
| --- | --- |
| customerId | EXT_ID |
| email | EMAIL |
| firstname | FNAME |
| lastname | LNAME |

The current code keeps A04.2's readiness classifier as the single internal eligibility summary.
Full BrevoContactProjectionV1 and transport remain deferred to A08.
