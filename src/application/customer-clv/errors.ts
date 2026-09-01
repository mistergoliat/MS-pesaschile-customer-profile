import {
  AnalyticsSchemaIncompatibleError,
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
} from '../customer-profile/errors.js';

export class CustomerClvMalformedSnapshotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CustomerClvMalformedSnapshotError';
  }
}

export function isCustomerClvReadInfrastructureError(error: unknown): boolean {
  return error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError;
}

export function isCustomerClvMalformedSnapshotError(error: unknown): error is CustomerClvMalformedSnapshotError {
  return error instanceof CustomerClvMalformedSnapshotError;
}
