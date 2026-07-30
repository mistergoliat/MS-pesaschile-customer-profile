# CP-R1-T10A Snapshot Architecture

## Facts

Proposed future snapshot:

```ts
type CustomerRfmSnapshot = {
  masterCustomerId: string;
  status: 'active' | 'historical_inactive' | 'no_valid_purchases';
  modelVersion: string;
  calculatedAt: string;
  asOfDate: string;
  windowStartInclusive: string;
  windowEndExclusive: string;
  metrics: {
    recencyDays: number | null;
    frequencyOrders: number;
    grossMonetaryTaxIncl: string;
  };
  scores: {
    recency: number | null;
    frequency: number | null;
    monetary: number | null;
    rfmCode: string | null;
  };
  percentiles: {
    recency: string | null;
    frequency: string | null;
    monetary: string | null;
  };
  lifecycleStage: 'new_customer' | 'active' | 'historical_inactive' | 'no_purchase_history';
};
```

Pipeline:

```text
PrestaShop + master_customer
-> dataset poblacional
-> scoring versionado
-> snapshot por masterCustomerId
-> Customer Profile reader
-> Sales Agent / CRM / Campaign Engine
```

## Interpretations

A snapshot is appropriate because RFM scores are population-relative. Direct runtime calculation would either be expensive or unstable across requests.

The `masterCustomerId` key above describes the future canonical snapshot (`RFM_IDENTITY_MODE=master_customer`). Nothing produced under `RFM_IDENTITY_MODE=prestashop_customer` today is written to this shape, or to any production table — this audit's provisional outputs stay under ignored `outputs/`, keyed by `prestashopCustomerId`, and are not a snapshot. Before a provisional snapshot keyed by `prestashopCustomerId` could ever be considered, it would need its own explicit decision, separate from this document's canonical design.

## Decisions

- Snapshot frequency: daily.
- Suggested run time: off-peak local early morning after order ingestion settles.
- Publication: idempotent and atomic by `modelVersion` + `asOfDate`.
- Retries: safe because outputs are immutable for the same asOfDate/modelVersion.
- Historical retention: retain enough versions to compare score stability and campaign outcomes.
- Observability: publish aggregate counts, duration, status, and failed guardrail reason only.
- Identity merges: invalidate and rebuild affected snapshots or the full asOfDate partition.
- Percentiles should be persisted with scores for explainability.

## Follow-up

- Design the production table and writer in a later task.
- Add batch sizing after live `EXPLAIN` and load evidence.
