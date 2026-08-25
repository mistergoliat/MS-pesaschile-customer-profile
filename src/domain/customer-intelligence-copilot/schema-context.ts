import {
  ANALYTICAL_AGGREGATIONS,
  ANALYTICAL_FILTER_OPERATORS,
  ANALYTICAL_METRIC_ALIAS_PATTERN,
  CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
  DEFAULT_LIMIT,
  MAX_DIMENSIONS,
  MAX_FILTER_DEPTH,
  MAX_FILTER_LEAVES,
  MAX_IN_VALUES,
  MAX_RESULT_ROWS,
  type AnalyticalSchema,
} from '../customer-intelligence-query/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  type CompactAnalyticalQueryContract,
  type CompactAnalyticalSchema,
} from './contracts.js';

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

export function serializeAnalyticalQueryContractForCopilot(): CompactAnalyticalQueryContract {
  return {
    planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
    maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
    modes: {
      row: {
        useFor: ['bounded individual customer rows', 'exports or lists of selected logical fields'],
        required: ['planVersion', 'select'],
        forbidden: ['metrics'],
        optional: ['filters', 'orderBy', 'limit'],
      },
      aggregate: {
        useFor: ['counts', 'sums', 'averages', 'minima', 'maxima', 'grouped summaries', 'rankings based on aggregate metrics'],
        required: ['planVersion', 'metrics'],
        forbidden: ['select'],
        optional: ['dimensions', 'filters', 'orderBy', 'limit'],
      },
    },
    metricSchema: {
      required: ['aggregation', 'alias'],
      aggregation: {
        allowed: ANALYTICAL_AGGREGATIONS,
        count: { field: 'omit_for_count_all' },
        count_distinct: { field: 'required' },
        sum: { field: 'required_numeric' },
        avg: { field: 'required_numeric' },
        min: { field: 'required' },
        max: { field: 'required' },
      },
      alias: {
        required: true,
        pattern: ANALYTICAL_METRIC_ALIAS_PATTERN,
        validExamples: ['customer_count', 'avg_ticket', 'total_spent', 'order_count'],
        invalidExamples: ['customer count', 'clientes-total', '123count'],
      },
    },
    filters: {
      shape: 'condition { field, operator, value? }, group { and: [...] } or { or: [...] }, or a top-level array as implicit AND',
      operators: ANALYTICAL_FILTER_OPERATORS,
      maxLeaves: MAX_FILTER_LEAVES,
      maxDepth: MAX_FILTER_DEPTH,
      maxInValues: MAX_IN_VALUES,
    },
    dimensions: {
      max: MAX_DIMENSIONS,
      fieldsMustBeLogicalNames: true,
      requireMetrics: true,
    },
    orderBy: {
      fieldsMustReference: 'a selected field alias, dimension alias, or metric alias. Dimension aliases are the part after the final dot, such as clusterId for cluster.clusterId.',
      directions: ['asc', 'desc'],
    },
    limits: {
      default: DEFAULT_LIMIT,
      maxRows: MAX_RESULT_ROWS,
    },
    examples: [
      {
        question: 'Cuantos clientes hay?',
        plan: {
          planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
          metrics: [{ aggregation: 'count', alias: 'customer_count' }],
        },
      },
      {
        question: 'Cuantos hay en cada cluster?',
        plan: {
          planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
          dimensions: ['cluster.clusterId'],
          metrics: [{ aggregation: 'count', alias: 'customer_count' }],
          orderBy: [{ field: 'customer_count', direction: 'desc' }],
        },
      },
      {
        question: 'Cual cluster tiene mayor ticket promedio?',
        plan: {
          planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
          dimensions: ['cluster.clusterId'],
          metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }],
          orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
          limit: 1,
        },
      },
      {
        question: 'Cuantos clientes de alto valor estan en el cluster 1?',
        plan: {
          planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
          filters: [
            { field: 'cluster.clusterId', operator: 'eq', value: 1 },
            { field: 'commercial.totalSpentTaxIncl', operator: 'gte', value: '100000' },
          ],
          metrics: [{ aggregation: 'count', alias: 'customer_count' }],
        },
      },
      {
        question: 'Muestra hasta 20 clientes del cluster 1 con su gasto total.',
        plan: {
          planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
          select: ['customer.customerId', 'commercial.totalSpentTaxIncl'],
          filters: [{ field: 'cluster.clusterId', operator: 'eq', value: 1 }],
          orderBy: [{ field: 'totalSpentTaxIncl', direction: 'desc' }],
          limit: 20,
        },
      },
    ],
  };
}
