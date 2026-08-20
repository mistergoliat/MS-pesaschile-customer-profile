import {
  CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION,
  getRegisteredFields,
  type AnalyticalSchema,
} from '../../domain/customer-intelligence-query/index.js';
import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION } from '../../domain/customer-intelligence/index.js';
import { allowedAggregationsFor, allowedOperatorsFor } from '../../domain/customer-intelligence-query/schema-registry.js';

// task Section 34/74 — the machine-readable dictionary a future LLM (or this task's own CLI)
// consumes to build a plan. Strips the registry's internal sqlExpression before returning
// (task Section 8: never expose a physical column/table identifier as a public analytical
// field) — the only thing carried over is the public {logicalName, type, nullable, source,
// operators, aggregations, description} shape.
export function getAnalyticalSchema(): AnalyticalSchema {
  return {
    schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION,
    readModelVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
    fields: getRegisteredFields().map((f) => ({
      logicalName: f.logicalName,
      type: f.type,
      nullable: f.nullable,
      source: f.source,
      allowedOperators: allowedOperatorsFor(f),
      allowedAggregations: allowedAggregationsFor(f),
      description: f.description,
    })),
  };
}
