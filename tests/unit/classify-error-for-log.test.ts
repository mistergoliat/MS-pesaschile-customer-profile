import { describe, expect, it } from 'vitest';
import {
  CrmSchemaIncompatibleError,
  CrmTimeoutError,
  CrmUnavailableError,
  CustomerProfileBuildError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import { classifyErrorForLog } from '../../src/observability/classify-error-for-log.js';

describe('classifyErrorForLog', () => {
  it.each([
    [new CrmUnavailableError('connect ECONNREFUSED secret-db.internal:3306'), 'crm_unavailable'],
    [new CrmTimeoutError('crm timed out'), 'crm_timeout'],
    [new CrmSchemaIncompatibleError('missing column'), 'crm_schema_incompatible'],
    [new PrestashopUnavailableError('ps down'), 'prestashop_unavailable'],
    [new PrestashopTimeoutError('ps timed out'), 'prestashop_timeout'],
    [new CustomerProfileBuildError('build failed'), 'profile_build_failed'],
    [new Error('some unrelated driver error'), 'unexpected_error'],
    ['not even an Error instance', 'unexpected_error'],
    [null, 'unexpected_error'],
  ] as const)('classifies %#', (error, expected) => {
    expect(classifyErrorForLog(error)).toBe(expected);
  });
});
