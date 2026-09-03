import { AUDIENCE_DEFINITION_VERSION, MAX_CONDITIONS, MAX_FILTER_DEPTH, MAX_IN_VALUES, MAX_PREVIEW_MEMBERS, type AudienceAffinityAxisV1, type AudienceScalarOperatorV1 } from '../../domain/customer-intelligence-audience/index.js';
import { AUDIENCE_FIELD_REGISTRY_V1 } from '../../domain/customer-intelligence-audience/index.js';

export const CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION = 'customer-intelligence-audience-capability-v1' as const;
export const CUSTOMER_INTELLIGENCE_AUDIENCE_SCHEMA_VERSION = 'customer-intelligence-audience-schema-v1' as const;
export const CUSTOMER_INTELLIGENCE_AUDIENCE_PREVIEW_VERSION = 'customer-intelligence-audience-preview-v1' as const;
export const CUSTOMER_INTELLIGENCE_AUDIENCE_DEFAULT_PREVIEW_LIMIT = 50;
export const CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_LIMIT = Math.min(MAX_PREVIEW_MEMBERS, 100);
export const CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_AFFINITIES_PER_AXIS = 3;

export type AudienceSchemaFieldV1 = {
  readonly fieldId: string;
  readonly displayDescription: string;
  readonly scalarType: string;
  readonly component: string;
  readonly nullable: boolean;
  readonly allowedOperators: readonly AudienceScalarOperatorV1[];
  readonly unit?: string;
};

export type AudienceCapabilitySchemaV1 = {
  readonly capabilityVersion: typeof CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION;
  readonly schemaVersion: typeof CUSTOMER_INTELLIGENCE_AUDIENCE_SCHEMA_VERSION;
  readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
  readonly fields: readonly AudienceSchemaFieldV1[];
  readonly specialConditions: {
    readonly hasAffinity: {
      readonly kind: 'HAS_AFFINITY';
      readonly allowedAxes: readonly AudienceAffinityAxisV1[];
      readonly code: { readonly type: 'opaque-string'; readonly enumerationStatus: 'CATALOG_REGISTRY_NOT_AVAILABLE' };
      readonly qualifierLimits: Readonly<Record<string, number>>;
    };
  };
  readonly versionPairing: {
    readonly rfm: string;
    readonly cluster: string;
  };
  readonly limits: {
    readonly maxFilterDepth: number;
    readonly maxConditions: number;
    readonly maxInValues: number;
    readonly defaultPreviewLimit: number;
    readonly maxPreviewLimit: number;
    readonly maxPreviewAffinitiesPerAxis: number;
  };
  readonly pii: { readonly exposedFields: readonly ['customerId']; readonly excludedFields: readonly string[] };
};

export function getAudienceCapabilitySchema(): AudienceCapabilitySchemaV1 {
  return {
    capabilityVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION,
    schemaVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_SCHEMA_VERSION,
    definitionVersion: AUDIENCE_DEFINITION_VERSION,
    fields: [...AUDIENCE_FIELD_REGISTRY_V1.values()].map((definition) => ({
      fieldId: definition.field,
      displayDescription: definition.description,
      scalarType: definition.type,
      component: definition.component,
      nullable: definition.nullable,
      allowedOperators: definition.allowedOperators,
      ...(definition.unit === undefined ? {} : { unit: definition.unit }),
    })),
    specialConditions: {
      hasAffinity: {
        kind: 'HAS_AFFINITY',
        allowedAxes: ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'],
        code: { type: 'opaque-string', enumerationStatus: 'CATALOG_REGISTRY_NOT_AVAILABLE' },
        qualifierLimits: { maxCodeLength: 191, maxMinSupportingOrderCount: Number.MAX_SAFE_INTEGER, maxMinSupportingProductCount: Number.MAX_SAFE_INTEGER },
      },
    },
    versionPairing: {
      rfm: 'rfm.segmentCode is interpreted within the resolved rfm.segmentVersion; an explicit segmentVersion condition must match it when supplied.',
      cluster: 'cluster.clusterId is interpreted within the resolved cluster.modelVersion; an explicit modelVersion condition must match it when supplied.',
    },
    limits: { maxFilterDepth: MAX_FILTER_DEPTH, maxConditions: MAX_CONDITIONS, maxInValues: MAX_IN_VALUES, defaultPreviewLimit: CUSTOMER_INTELLIGENCE_AUDIENCE_DEFAULT_PREVIEW_LIMIT, maxPreviewLimit: CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_LIMIT, maxPreviewAffinitiesPerAxis: CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_AFFINITIES_PER_AXIS },
    pii: { exposedFields: ['customerId'], excludedFields: ['email', 'phone', 'address', 'RUT', 'consent', 'channelEligibility'] },
  };
}
