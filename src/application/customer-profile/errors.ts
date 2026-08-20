// Thrown by PrestashopCustomerReader implementations. A ps_customer row genuinely not
// existing is NOT one of these — that is a valid `null` result (prestashop_customer_not_found).
export class PrestashopUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrestashopUnavailableError';
  }
}

export class PrestashopTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrestashopTimeoutError';
  }
}

export class PrestashopSchemaIncompatibleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrestashopSchemaIncompatibleError';
  }
}

// Thrown when master_customer and ps_customer were both read successfully but the
// snapshot itself could not be assembled (e.g. clock failure). Maps to profile_build_failed.
export class CustomerProfileBuildError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CustomerProfileBuildError';
  }
}

// Thrown by MasterCustomerReader implementations for CRM (master_customer) read failures.
// Mirrors the Prestashop* error split above: a missing row is a valid `null`, never one
// of these.
export class CrmUnavailableError extends Error {
  readonly code = 'crm_unavailable';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrmUnavailableError';
  }
}

export class CrmTimeoutError extends Error {
  readonly code = 'crm_timeout';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrmTimeoutError';
  }
}

// The CRM connection/credentials are fine, but the schema this service expects is not
// (e.g. master_customer.prestashop_customer_id missing because migration 001 wasn't run).
export class CrmSchemaIncompatibleError extends Error {
  readonly code = 'crm_schema_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CrmSchemaIncompatibleError';
  }
}

// Thrown by the RFM snapshot reader for RFM_SNAPSHOT_DB read failures once it IS
// configured. A missing row/snapshot is a valid null/degraded result, never one of these.
// Distinct from the "not configured at all" case, which never reaches the reader.
export class RfmUnavailableError extends Error {
  readonly code = 'rfm_unavailable';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RfmUnavailableError';
  }
}

export class RfmTimeoutError extends Error {
  readonly code = 'rfm_timeout';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RfmTimeoutError';
  }
}

export class RfmSchemaIncompatibleError extends Error {
  readonly code = 'rfm_schema_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RfmSchemaIncompatibleError';
  }
}

// Thrown by the cluster snapshot reader for CLUSTER_DB read failures once it IS configured.
// A missing row/snapshot is a valid null/degraded result, never one of these. Mirrors the
// Rfm*Error split above exactly.
export class ClusterUnavailableError extends Error {
  readonly code = 'cluster_unavailable';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClusterUnavailableError';
  }
}

export class ClusterTimeoutError extends Error {
  readonly code = 'cluster_timeout';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClusterTimeoutError';
  }
}

export class ClusterSchemaIncompatibleError extends Error {
  readonly code = 'cluster_schema_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClusterSchemaIncompatibleError';
  }
}

// Thrown by the customer-analytics readers/repositories for ANALYTICS_DB read/write failures
// once it IS configured. A missing row/snapshot is a valid null/degraded result, never one of
// these. Mirrors the Cluster*Error split above exactly (CP-R3-T01).
export class AnalyticsUnavailableError extends Error {
  readonly code = 'analytics_unavailable';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalyticsUnavailableError';
  }
}

export class AnalyticsTimeoutError extends Error {
  readonly code = 'analytics_timeout';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalyticsTimeoutError';
  }
}

export class AnalyticsSchemaIncompatibleError extends Error {
  readonly code = 'analytics_schema_incompatible';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalyticsSchemaIncompatibleError';
  }
}
