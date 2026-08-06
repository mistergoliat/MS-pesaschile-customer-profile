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
