import {
  ANALYTICAL_AGGREGATIONS,
  ANALYTICAL_FILTER_OPERATORS,
  ANALYTICAL_METRIC_ALIAS_PATTERN,
  CUSTOMER_INTELLIGENCE_COMPACT_QUERY_VERSION,
  DEFAULT_LIMIT,
  MAX_DIMENSIONS,
  MAX_FILTER_DEPTH,
  MAX_FILTER_LEAVES,
  MAX_IN_VALUES,
  MAX_RESULT_ROWS,
  type AnalyticalSchema,
  compactFieldNameForLogicalName,
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
    fields: Object.fromEntries(schema.fields.map((field) => [
      compactFieldNameForLogicalName(field.logicalName),
      {
        f: field.logicalName,
        t: compactType(field.logicalName, field.type),
        n: field.nullable,
        d: compactDescription(field.logicalName),
        ops: field.allowedOperators,
        aggs: field.allowedAggregations,
      },
    ])),
  };
}

export function serializeAnalyticalQueryContractForCopilot(): CompactAnalyticalQueryContract {
  return {
    contractVersion: CUSTOMER_INTELLIGENCE_COMPACT_QUERY_VERSION,
    maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
    queryShape: {
      aggregate: 'dimensions? + metrics',
      row: 'select + filters/orderBy/limit',
      fieldNames: 'use schema.fields keys',
      noSql: true,
    },
    metrics: {
      ops: ANALYTICAL_AGGREGATIONS,
      shape: '{ op, field?, alias }',
      count: 'omit field',
      fieldRequiredFor: ['count_distinct', 'sum', 'avg', 'min', 'max'],
      alias: {
        required: true,
        pattern: ANALYTICAL_METRIC_ALIAS_PATTERN,
      },
    },
    filters: {
      shape: '{ field, op, value? } or bounded { and|or: [...] }',
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
      fieldsMustReference: 'a select field key, compact dimension key, or metric alias already produced by the same query',
      directions: ['asc', 'desc'],
    },
    limits: {
      default: DEFAULT_LIMIT,
      maxRows: MAX_RESULT_ROWS,
    },
    semanticRules: {
      nullableDimensions: [
        {
          field: 'cluster.clusterId',
          nullMeaning: 'customer has no cluster assignment in the pinned cluster snapshot',
          excludeNullWhen: ['comparing named clusters', 'ranking clusters', 'asking which cluster or group is best/worst/highest/lowest'],
          includeNullWhen: ['asking for the whole base distribution', 'explicitly asking to include unclustered customers'],
        },
        {
          field: 'rfm.segmentCode',
          nullMeaning: 'customer has no RFM segment in the pinned RFM snapshot',
          excludeNullWhen: ['comparing named RFM segments', 'ranking segments'],
          includeNullWhen: ['asking for whole base RFM coverage or explicitly including unsegmented customers'],
        },
      ],
      exploratoryAnalysis: {
        maxQueries: CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
        preferredMetricFamilies: [
          'population and coverage',
          'cluster distribution',
          'revenue and average ticket',
          'frequency and recency',
          'product diversity and repeat behavior',
          'RFM segment distribution',
        ],
        stateLimitations: true,
      },
      unsupportedConcepts: [
        {
          concept: 'profitability',
          reason: 'current logical fields do not include margin, cost, or profit',
          closestSupportedAnalyses: ['revenue via commercial.totalSpentTaxIncl', 'average ticket via commercial.averageOrderValueTaxIncl', 'frequency via commercial.validOrders or commercial.orders365d'],
        },
        {
          concept: 'future prediction',
          reason: 'runtime has historical snapshot features but no predictive model output',
          closestSupportedAnalyses: ['recent activity', 'frequency', 'recency', 'historical spending patterns'],
        },
      ],
    },
    examples: [
      {
        question: 'Cuantos clientes hay?',
        query: {
          metrics: [{ op: 'count', alias: 'customer_count' }],
        },
      },
      {
        question: 'Cuantos hay en cada cluster?',
        query: {
          dimensions: ['clusterId'],
          metrics: [{ op: 'count', alias: 'customer_count' }],
          orderBy: [{ field: 'customer_count', direction: 'desc' }],
        },
      },
      {
        question: 'Cual cluster tiene mayor ticket promedio?',
        query: {
          dimensions: ['clusterId'],
          filters: [{ field: 'clusterId', op: 'is_not_null' }],
          metrics: [{ op: 'avg', field: 'averageOrderValue', alias: 'avg_ticket' }],
          orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
          limit: 1,
        },
      },
      {
        question: 'Cuantos clientes de alto valor estan en el cluster 1?',
        query: {
          filters: [
            { field: 'clusterId', op: 'eq', value: 1 },
            { field: 'totalSpent', op: 'gte', value: '100000' },
          ],
          metrics: [{ op: 'count', alias: 'customer_count' }],
        },
      },
      {
        question: 'Que cluster tiene mayor gasto total?',
        query: {
          dimensions: ['clusterId'],
          filters: [{ field: 'clusterId', op: 'is_not_null' }],
          metrics: [{ op: 'sum', field: 'totalSpent', alias: 'total_spent' }],
          orderBy: [{ field: 'total_spent', direction: 'desc' }],
          limit: 1,
        },
      },
      {
        question: 'Muestra hasta 20 clientes del cluster 1 con su gasto total.',
        query: {
          select: ['customerId', 'totalSpent'],
          filters: [{ field: 'clusterId', op: 'eq', value: 1 }],
          orderBy: [{ field: 'totalSpent', direction: 'desc' }],
          limit: 20,
        },
      },
    ],
  };
}

function compactType(logicalName: string, type: string): string {
  if (/totalSpent|averageOrderValue/i.test(logicalName)) return 'currency';
  if (/Rate|Ratio|Share/i.test(logicalName)) return 'ratio';
  if (/Orders|Count|Products|days|Score|clusterId|customerId/i.test(logicalName)) return 'count';
  return type;
}

function compactDescription(logicalName: string): string {
  const descriptions: Record<string, string> = {
    'customer.customerId': 'customer id',
    'commercial.validOrders': 'valid order count',
    'commercial.totalSpentTaxIncl': 'lifetime revenue tax incl',
    'commercial.averageOrderValueTaxIncl': 'average ticket tax incl',
    'commercial.firstOrderAt': 'first valid order time',
    'commercial.lastOrderAt': 'last valid order time',
    'commercial.daysSinceLastOrder': 'recency days',
    'commercial.customerTenureDays': 'account tenure days',
    'commercial.distinctProducts': 'product breadth',
    'commercial.repeatProductRate': 'repeat product rate',
    'commercial.top1Share': 'top product spend concentration',
    'commercial.top3Share': 'top 3 product spend concentration',
    'commercial.effectiveDiversity': 'product diversity',
    'commercial.averageUnitsPerOrder': 'units per order',
    'commercial.purchaseFrequencyDays': 'avg days between orders',
    'commercial.orders365d': 'orders last 365d',
    'commercial.cancelledOrderRatio': 'cancelled/all orders ratio',
    'commercial.discountShare': 'discount/revenue share',
    'commercial.shippingShare': 'shipping/revenue share',
    'rfm.rScore': 'RFM recency score',
    'rfm.fScore': 'RFM frequency score',
    'rfm.mScore': 'RFM monetary score',
    'rfm.rfmCode': 'combined RFM code',
    'rfm.segmentCode': 'RFM segment',
    'cluster.clusterId': 'cluster id',
    'cluster.distanceToCentroid': 'cluster distance',
    'cluster.label': 'cluster label',
    'cluster.description': 'cluster description',
    'cluster.interpretationVersion': 'cluster interpretation version',
    'cluster.modelVersion': 'cluster model version',
  };
  return descriptions[logicalName] ?? logicalName;
}
