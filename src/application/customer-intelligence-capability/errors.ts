import { AnalyticsSchemaIncompatibleError, AnalyticsTimeoutError, AnalyticsUnavailableError } from '../customer-profile/errors.js';
import { CapabilityError } from './contracts.js';

export function normalizeCapabilityError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof AnalyticsTimeoutError) return new CapabilityError('TIMEOUT', error.message, undefined, true);
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsSchemaIncompatibleError) {
    return new CapabilityError('ANALYTICS_UNAVAILABLE', error.message, undefined, true);
  }
  return new CapabilityError('EXECUTION_FAILED', error instanceof Error ? error.message : 'Capability execution failed');
}

export function capabilityErrorForContextFailure(reason: string): CapabilityError {
  if (reason === 'no_published_feature_snapshot' || reason === 'feature_snapshot_not_found') {
    return new CapabilityError('UNAVAILABLE_SNAPSHOT', reason, undefined, true);
  }
  if (reason === 'analytics_not_configured' || reason === 'analytics_unavailable') {
    return new CapabilityError('ANALYTICS_UNAVAILABLE', reason, undefined, true);
  }
  return new CapabilityError('EXECUTION_FAILED', reason);
}
