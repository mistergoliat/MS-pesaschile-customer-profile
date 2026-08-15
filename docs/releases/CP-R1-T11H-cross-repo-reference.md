# CP-R1-T11H - CRM / Sales Agent RFM Consumption Adapter (Cross-Repo Reference)

Fecha: 2026-08-15.

## Estado

T11H y T11H.1 no se implementan en este repo (`MS-pesaschile-customer-profile`).
Este documento existe solo como puntero de cierre para la linea CP-R1-T11.

## Ubicacion real

Implementados y validados en el repo externo `CRM-Customer-360`:

- `docs/releases/CP-R1-T11H-crm-sales-agent-rfm-consumption-adapter.md`
  - Veredicto: `CRM_SALES_AGENT_RFM_CONSUMPTION_ADAPTER_IMPLEMENTED`
  - Commit: `628f6e2` - "CP-R1-T11H add sales agent RFM consumption adapter"
- `docs/releases/CP-R1-T11H.1-full-suite-stabilization.md`
  - Veredicto: `T11H_VALIDATED_WITH_PREEXISTING_SUITE_DEBT`
  - Commit: `59a74e2`, merged via PR #93 (`6ee20e7`)

## Por que no vive aqui

Customer Profile expone unicamente el contrato runtime canonico
(`GET /v1/customers/:masterCustomerId/rfm`, cerrado en
[T11F](CP-R1-T11F-rfm-runtime-exposure.md)) y su operacionalizacion
([T11G](CP-R1-T11G-rfm-snapshot-scheduling-and-publication-operations.md)).
El consumo, el wiring de agente y la logica de Sales Agent pertenecen al
dominio de `CRM-Customer-360` y no deben vivir como adapter local ni como
codigo de Sales Agent dentro de este servicio.

## Contrato consumido

`CRM-Customer-360` consume exactamente el contrato publicado en T11F, sin
modificarlo:

- `contractVersion: customer-rfm-runtime-v1`
- identidad publica: `masterCustomerId`
- estados: `available`, `rfm_not_available`, `customer_not_found`, `degraded`

Sin fallback desde `customerId`, sin recalculo de segmentacion en el
consumidor, y RFM usado solo como evidencia interna del agente (no como
policy comercial automatica, ranking o descuento).

## Cierre de T11

Con T11A-T11G implementados en este repo y T11H / T11H.1 confirmados en
`CRM-Customer-360`, la linea CP-R1-T11 (RFM) se considera cerrada
end-to-end. Este repo no requiere trabajo adicional de T11H.
