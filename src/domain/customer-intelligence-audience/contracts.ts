export const AUDIENCE_DEFINITION_VERSION = 'customer-intelligence-audience-definition-v1' as const;
export const AUDIENCE_CONTEXT_VERSION = 'customer-intelligence-audience-context-v1' as const;
export const AUDIENCE_EVALUATION_VERSION = 'customer-intelligence-audience-evaluation-v1' as const;
export const AUDIENCE_LINEAGE_RESOLUTION_VERSION = 'customer-intelligence-audience-lineage-v1' as const;
export const AUDIENCE_EVALUATION_LINEAGE_VERSION = 'customer-intelligence-audience-evaluation-lineage-v1' as const;
export const AUDIENCE_MEMBERSHIP_VERSION = 'customer-intelligence-audience-membership-v1' as const;
export const AUDIENCE_EVALUATION_CHECKSUM_VERSION = 'audience-evaluation-checksum-v1' as const;
export const AUDIENCE_MEMBERSHIP_CHECKSUM_VERSION = 'audience-membership-checksum-v1' as const;
export const AUDIENCE_REPRODUCIBILITY_LEVEL = 'ACTIVE_SNAPSHOT_CONSISTENT' as const;
export const AUDIENCE_EXPORT_CONTACT_VERSION = 'customer-intelligence-audience-export-contact-v1' as const;
export const AUDIENCE_EXPORT_PREVIEW_VERSION = 'customer-intelligence-audience-export-preview-v1' as const;
export const AUDIENCE_EXPORT_ARTIFACT_VERSION = 'customer-intelligence-audience-export-artifact-v1' as const;

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

export type AudienceRelevantSnapshotLineageV1 = {
  readonly feature: AudienceFeatureSnapshotLineageV1;
  readonly rfm?: AudienceRfmSnapshotLineageV1;
  readonly cluster?: AudienceClusterSnapshotLineageV1;
  readonly clv?: AudienceClvSnapshotLineageV1;
  readonly commercialAffinity?: AudienceAffinitySnapshotLineageV1;
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

export type AudienceEvaluationLineageV1 = {
  readonly lineageVersion: typeof AUDIENCE_EVALUATION_LINEAGE_VERSION;
  readonly evaluatorVersion: typeof AUDIENCE_EVALUATION_VERSION;
  readonly reproducibilityLevel: typeof AUDIENCE_REPRODUCIBILITY_LEVEL;
  readonly definitionChecksum: string;
  readonly contextVersion: typeof AUDIENCE_CONTEXT_VERSION;
  readonly referenceTime: string;
  readonly population: AudienceEvaluationContextV1['population'];
  readonly resolutionPolicyVersion: typeof AUDIENCE_LINEAGE_RESOLUTION_VERSION;
  readonly relevantSnapshotLineage: AudienceRelevantSnapshotLineageV1;
  readonly evaluatedAt: string;
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

export type AudienceMembershipResultV1 = {
  readonly status: 'completed';
  readonly membershipVersion: typeof AUDIENCE_MEMBERSHIP_VERSION;
  readonly definition: AudienceDefinitionV1;
  readonly definitionChecksum: string;
  readonly evaluationContext: AudienceEvaluationContextV1;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly evaluatedAt: string;
  readonly counts: {
    readonly population: number;
    readonly matched: number;
    readonly notMatched: number;
    readonly unknown: number;
  };
  readonly members: readonly AudienceMemberV1[];
  readonly evaluationChecksum: string;
  readonly membershipChecksum: string;
  readonly completeness: 'COMPLETE';
  readonly warnings: readonly string[];
};

/** The deliberately small PII boundary used by the A04.2 preview. */
export type AudienceExportContactV1 = {
  readonly customerId: number;
  readonly email: string | null;
  readonly firstname: string | null;
  readonly lastname: string | null;
};

export type AudienceExportFieldIdV1 = 'customerId' | 'email' | 'firstname' | 'lastname';
export type AudienceExportFormatV1 = 'GENERIC_CSV' | 'GENERIC_XLSX' | 'BREVO_CONTACT_IMPORT_CSV';
export type AudienceGenericExportFormatV1 = Exclude<AudienceExportFormatV1, 'BREVO_CONTACT_IMPORT_CSV'>;
export type AudienceExportDestinationV1 = 'DOWNLOAD' | 'BREVO_CONTACT_IMPORT_FILE';
export type AudienceExportPreviewStatusV1 = 'READY' | 'BLOCKED';
export type AudienceExportRejectionReasonV1 =
  | 'MISSING_CONTACT_IDENTIFIER'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'DUPLICATE_IDENTIFIER'
  | 'UNSUPPORTED_FIELD'
  | 'ATTRIBUTE_MAPPING_UNAVAILABLE';

export type AudienceExportRejectionReasonCountsV1 = Readonly<Record<AudienceExportRejectionReasonV1, number>>;

export type AudienceExportPreviewV1 = {
  readonly previewVersion: typeof AUDIENCE_EXPORT_PREVIEW_VERSION;
  readonly status: AudienceExportPreviewStatusV1;
  readonly audienceMatchedCount: number;
  readonly unknownCount: number;
  readonly customersWithEmail: number;
  readonly customersWithoutEmail: number;
  readonly customersWithPhone: number | null;
  readonly customersWithoutPhone: number | null;
  readonly duplicateEmailCount: number;
  readonly duplicatePhoneCount: number;
  readonly exportableCount: number;
  readonly excludedFromExportCount: number;
  readonly brevoEligibleCount: number;
  readonly brevoRejectedCount: number;
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly selectedFormat: AudienceExportFormatV1;
  readonly selectedDestination: AudienceExportDestinationV1;
  readonly estimatedFileRows: number;
  readonly estimatedFileSizeBytes: number | null;
  readonly membershipChecksum: string;
  readonly evaluationChecksum: string;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly validationWarnings: readonly string[];
  /** Aggregate counts only; rejected contact values are intentionally not exposed. */
  readonly rejectionReasonCounts: AudienceExportRejectionReasonCountsV1;
  /** Present when the preview is blocked before a usable projection can be produced. */
  readonly blockingReasons?: readonly string[];
};

export type AudienceExportRowV1 = {
  readonly customerId: number;
  readonly email?: string | null;
  readonly firstname?: string | null;
  readonly lastname?: string | null;
};

export type AudienceExportMetadataV1 = {
  readonly exportVersion: typeof AUDIENCE_EXPORT_ARTIFACT_VERSION;
  readonly format: AudienceGenericExportFormatV1;
  readonly rowCount: number;
  readonly definitionChecksum: string;
  readonly evaluationChecksum: string;
  readonly membershipChecksum: string;
  readonly population: number;
  readonly matched: number;
  readonly notMatched: number;
  readonly unknown: number;
  readonly referenceTime: string;
  readonly evaluatedAt: string;
  readonly evaluatorVersion: string;
  readonly reproducibilityLevel: string;
  readonly featureSnapshotId: string;
  readonly resolutionPolicyVersion: string;
  readonly relevantSnapshotLineage: AudienceRelevantSnapshotLineageV1;
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly selectedDestination: 'DOWNLOAD';
  readonly generatedAt: string;
  readonly validationWarnings: readonly string[];
};

export type AudienceExportArtifactV1 = {
  readonly exportVersion: typeof AUDIENCE_EXPORT_ARTIFACT_VERSION;
  readonly format: AudienceGenericExportFormatV1;
  readonly rowCount: number;
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly membershipChecksum: string;
  readonly evaluationChecksum: string;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly contentType: 'text/csv; charset=utf-8' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly filename: string;
  readonly byteLength: number;
  readonly generatedAt: string;
  readonly metadata: AudienceExportMetadataV1;
  readonly artifact: Buffer;
};
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
