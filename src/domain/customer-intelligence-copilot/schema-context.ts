import type { AnalyticalSchema } from '../customer-intelligence-query/index.js';
import type { CompactAnalyticalSchema } from './contracts.js';

export function serializeAnalyticalSchemaForCopilot(schema: AnalyticalSchema): CompactAnalyticalSchema {
  return {
    schemaVersion: schema.schemaVersion,
    readModelVersion: schema.readModelVersion,
    fields: schema.fields.map((field) => ({
      logicalName: field.logicalName,
      type: field.type,
      nullable: field.nullable,
      description: field.description,
      allowedOperators: field.allowedOperators,
      allowedAggregations: field.allowedAggregations,
    })),
  };
}
