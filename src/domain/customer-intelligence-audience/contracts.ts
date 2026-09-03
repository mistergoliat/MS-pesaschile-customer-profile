export const AUDIENCE_DEFINITION_VERSION = 'customer-intelligence-audience-definition-v1' as const;
export const AUDIENCE_CONTEXT_VERSION = 'customer-intelligence-audience-context-v1' as const;
export const AUDIENCE_EVALUATION_VERSION = 'customer-intelligence-audience-evaluation-v1' as const;
export const AUDIENCE_LINEAGE_RESOLUTION_VERSION = 'customer-intelligence-audience-lineage-v1' as const;

export type AudienceDecimalV1 = string;
export type AudienceFieldIdV1 =
  | 'rfm.segmentCode' | 'rfm.segmentVersion' | 'rfm.rfmCode'
  | 'rfm.recencyDays' | 'rfm.frequencyOrders' | 'rfm.grossOrderValueTaxIncl'
  | 'rfm.recencyScore' | 'rfm.frequencyScore' | 'rfm.monetaryScore'
  | 'cluster.clusterId' | 'cluster.modelVersion'
  | 'clv.expectedRevenueTaxIncl' | 'clv.expectedOrders' | 'clv.estimateSupportLevel'
  | 'commercial.validOrders' | 'commercial.totalSpentTaxIncl' | 'commercial.averageOrderValueTaxIncl'
  | 'commercial.firstOrderAt' | 'commercial.lastOrderAt' | 'commercial.daysSinceLastOrder'
  | 'commercial.customerTenureDays' | 'commercial.distinctProducts' | 'commercial.repeatProductRate'
  | 'commercial.top1Share' | 'commercial.top3Share' | 'commercial.effectiveDiversity'
  | 'commercial.averageUnitsPerOrder' | 'commercial.purchaseFrequencyDays' | 'commercial.orders365d'
  | 'commercial.cancelledOrderRatio' | 'commercial.discountShare' | 'commercial.shippingShare';

export type AudienceScalarOperatorV1 = 'EQ' | 'NEQ' | 'IN' | 'NOT_IN' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'BETWEEN' | 'IS_NULL' | 'IS_NOT_NULL';
export type AudienceScalarValueV1 = string | number | readonly (string | number)[];
export type AudienceAffinityAxisV1 = 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';

export type AudienceConditionV1 =
  | { readonly kind: 'SCALAR'; readonly field: AudienceFieldIdV1 | string; readonly operator: AudienceScalarOperatorV1 | string; readonly value?: AudienceScalarValueV1 }
  | {
      readonly kind: 'HAS_AFFINITY';
      readonly axis: AudienceAffinityAxisV1 | string;
      readonly code: string;
      readonly minScore?: AudienceDecimalV1;
      readonly minSupportingOrderCount?: number;
      readonly minSupportingProductCount?: number;
      readonly minSupportingSpend?: AudienceDecimalV1;
      readonly minExplicitEvidenceCoverage?: AudienceDecimalV1;
      readonly lastEvidenceAt?: { readonly operator: 'EQ' | 'GT' | 'GTE' | 'LT' | 'LTE'; readonly value: string };
    };

export type AudienceFilterV1 =
  | AudienceConditionV1
  | { readonly kind: 'AND'; readonly children: readonly AudienceFilterV1[] }
  | { readonly kind: 'OR'; readonly children: readonly AudienceFilterV1[] }
  | { readonly kind: 'NOT'; readonly child: AudienceFilterV1 };

export type AudienceDefinitionV1 = {
  readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
  readonly root: AudienceFilterV1;
};

export type AudienceFeatureSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly featureDatasetChecksum: string;
  readonly populationChecksum?: string;
};
export type AudienceRfmSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly segmentVersion: string | null;
  readonly datasetChecksum?: string;
};
export type AudienceClusterSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly populationPolicyVersion?: string;
  readonly assignmentChecksum?: string;
};
export type AudienceClvSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly snapshotKey: string;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly estimatorPolicyVersion: string;
  readonly horizonMonths: 12;
  readonly currencyIsoCode: 'CLP';
  readonly outputChecksum?: string;
};
export type AudienceAffinitySnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSchemaVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly sourceSemanticChecksum: string;
  readonly consumerSemanticChecksum: string;
  readonly affinityDatasetChecksum: string;
  readonly populationChecksum: string;
};
export type AudienceSnapshotLineageV1 = {
  readonly feature: AudienceFeatureSnapshotLineageV1;
  readonly rfm: AudienceRfmSnapshotLineageV1 | null;
  readonly cluster: AudienceClusterSnapshotLineageV1 | null;
  readonly clv: AudienceClvSnapshotLineageV1 | null;
  readonly commercialAffinity: AudienceAffinitySnapshotLineageV1 | null;
};
export type AudienceAvailabilityStateV1 = 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
export type AudienceAvailabilityV1 = {
  readonly feature: 'AVAILABLE' | 'UNAVAILABLE';
  readonly rfm: AudienceAvailabilityStateV1;
  readonly cluster: AudienceAvailabilityStateV1;
  readonly clv: AudienceAvailabilityStateV1;
  readonly commercialAffinity: AudienceAvailabilityStateV1;
};
export type AudienceEvaluationContextV1 = {
  readonly contextVersion: typeof AUDIENCE_CONTEXT_VERSION;
  readonly referenceTime: string;
  readonly population: {
    readonly universeId: 'customer-analytics-population-b-v1';
    readonly identityAuthority: 'prestashop_customer';
    readonly policyVersion: string;
    readonly populationSize: number;
    readonly populationChecksum: string;
  };
  readonly lineage: AudienceSnapshotLineageV1;
  readonly resolutionPolicyVersion: typeof AUDIENCE_LINEAGE_RESOLUTION_VERSION;
};

export type AudienceValidationErrorCodeV1 =
  | 'UNSUPPORTED_FIELD' | 'INCOMPATIBLE_OPERATOR' | 'INVALID_SCALAR_TYPE' | 'INVALID_AFFINITY_AXIS'
  | 'UNKNOWN_AFFINITY_CODE' | 'MALFORMED_BOOLEAN_TREE' | 'EXCESSIVE_DEPTH' | 'EXCESSIVE_CONDITIONS'
  | 'EMPTY_BOOLEAN_GROUP' | 'INVALID_BETWEEN' | 'DUPLICATE_ALIAS' | 'UNSUPPORTED_NULL_TEST'
  | 'INVALID_REFERENCE_TIME' | 'INVALID_AFFINITY_QUALIFIER';
export type AudienceValidationErrorV1 = {
  readonly code: AudienceValidationErrorCodeV1;
  readonly path: string;
  readonly message: string;
};

export type AudienceMemberV1 = { readonly customerId: number };
export type AudienceTruthV1 = 'TRUE' | 'FALSE' | 'UNKNOWN';
export type AudienceEvaluationResultV1 =
  | {
      readonly status: 'completed';
      readonly resultVersion: typeof AUDIENCE_EVALUATION_VERSION;
      readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
      readonly definitionChecksum: string;
      readonly audienceDefinitionChecksum: string;
      readonly evaluationId: string | null;
      readonly evaluatedAt: string;
      readonly referenceTime: string;
      readonly populationUniverseCount: number;
      readonly trueCount: number;
      readonly falseCount: number;
      readonly unknownCount: number;
      readonly matchedCount: number;
      readonly returnedCount: number;
      readonly previewMembers: readonly AudienceMemberV1[];
      readonly members: readonly AudienceMemberV1[];
      readonly truncated: boolean;
      readonly context: AudienceEvaluationContextV1;
      readonly componentAvailability: AudienceAvailabilityV1;
      readonly durationMs: number;
      readonly performance: { readonly queryDurationMs: number; readonly totalDurationMs: number };
      readonly provenance: { readonly definitionChecksum: string; readonly context: AudienceSnapshotLineageV1 };
      readonly warnings: readonly string[];
      readonly canonicalDefinition: AudienceDefinitionV1;
    }
  | {
      readonly status: 'blocked';
      readonly resultVersion: typeof AUDIENCE_EVALUATION_VERSION;
      readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
      readonly definitionChecksum: string | null;
      readonly audienceDefinitionChecksum: string | null;
      readonly evaluationId: string | null;
      readonly evaluatedAt: string;
      readonly referenceTime: string | null;
      readonly context: AudienceEvaluationContextV1 | null;
      readonly componentAvailability: AudienceAvailabilityV1;
      readonly blockingComponents: readonly string[];
      readonly validationErrors?: readonly AudienceValidationErrorV1[];
      readonly reason: 'UNAVAILABLE_COMPONENT' | 'INCOMPATIBLE_SNAPSHOT' | 'INVALID_DEFINITION' | 'BUDGET_EXCEEDED' | 'QUERY_TIMEOUT' | 'EXECUTION_FAILED';
      readonly warnings: readonly string[];
    };
