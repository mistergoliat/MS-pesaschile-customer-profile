export type {
  CustomerOrderStateContext,
  CustomerOrderSummary,
  CustomerProfileDegradedReason,
  CustomerProfileLinkStatus,
  CustomerProfileLookupResult,
  CustomerProfileSnapshot,
  GetCustomerProfileInput,
} from '../domain/customer-profile/index.js';
export type {
  CustomerIdentityResolution,
  IdentityResolutionReason,
  IdentityResolutionStatus,
} from '../domain/identity-resolution/index.js';
export type {
  CustomerDataProvenance,
  CustomerDataSource,
  CustomerDataSourceEntity,
  CustomerIdentity,
  ResolveCustomerIdentityResult,
} from '../domain/customer-identity/index.js';
export type {
  CustomerOrderStatus,
  CustomerOrderStatusWarning,
  DeliveryEstimate,
  DeliveryMethod,
  GetCustomerOrderStatusDegradedReason,
  GetCustomerOrderStatusInput,
  GetCustomerOrderStatusResult,
} from '../domain/customer-order-status/index.js';
export type {
  CustomerCommercialSummary,
  GetCustomerCommercialSummaryDegradedReason,
  GetCustomerCommercialSummaryInput,
  GetCustomerCommercialSummaryResult,
} from '../domain/customer-commercial-summary/index.js';
export type {
  GetPurchasedProductsDegradedReason,
  GetPurchasedProductsInput,
  GetPurchasedProductsResult,
  PurchasedProduct,
  PurchasedProductsPagination,
} from '../domain/customer-purchased-products/index.js';
export type {
  GetCustomerPurchaseBehaviorDegradedReason,
  GetCustomerPurchaseBehaviorInput,
  GetCustomerPurchaseBehaviorResult,
  PurchaseBehaviorConcentration,
  PurchaseBehaviorProduct,
  PurchaseBehaviorSummary,
  PurchaseBehaviorVariant,
} from '../domain/customer-purchase-behavior/index.js';
export type {
  CustomerRfmDegradedReason,
  CustomerRfmMetricsPayload,
  CustomerRfmNotAvailableReason,
  CustomerRfmSegmentPayload,
  CustomerRfmSnapshotPayload,
  GetCustomerRfmResult,
} from '../domain/customer-rfm/index.js';
export type {
  AudienceDefinitionV1,
  AudienceFilterV1,
  AudienceConditionV1,
  AudienceFieldIdV1,
  AudienceScalarOperatorV1,
  AudienceEvaluationContextV1,
  AudienceSnapshotLineageV1,
  AudienceAvailabilityV1,
  AudienceEvaluationResultV1,
  AudienceMemberV1,
  AudienceValidationErrorV1,
} from '../domain/customer-intelligence-audience/index.js';
export {
  PRODUCT_SEMANTIC_BATCH_MAX_SIZE,
  PRODUCT_SEMANTIC_BATCH_SCHEMA_VERSION,
  type ProductSemanticBatchMetadata,
  type ProductSemanticBatchProduct,
  type ProductSemanticBatchResult,
  type ProductSemanticBatchTag,
  type ProductSemanticFactsSource,
  type ProductSemanticFactsSourceInput,
} from '../application/product-semantic-snapshot/batch-contract.js';
