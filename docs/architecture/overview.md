# Customer Profile Architecture

Current runtime flow:

```text
incoming HTTP request
-> customerId
-> ps_customer identity existence check
-> PrestaShop reads
-> provenance-enriched HTTP response
-> Sales Agent future HTTP client
```

`customerId` is currently the direct runtime identifier and maps to `ps_customer.id_customer`.

This service is read-oriented and intentionally direct in the current stage:

- identity source: `PRESTASHOP`
- identity status: `DIRECT_SOURCE`
- contract version: `customer-profile-prestashop-direct-v1`

Future canonical migration to `master_customer.id` is deferred and not active at runtime.
