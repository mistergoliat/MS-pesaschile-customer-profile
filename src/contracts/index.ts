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
