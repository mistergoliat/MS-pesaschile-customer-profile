import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrmUnavailableError } from '../../src/application/customer-profile/errors.js';
import { logShutdownFailure } from '../../src/observability/log-shutdown-failure.js';

describe('logShutdownFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a safe classification and never the original sensitive message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = Object.assign(new CrmUnavailableError('connect ECONNREFUSED secret-db.internal:3306 user root'), {
      code: 'ECONNREFUSED',
    });

    logShutdownFailure(error);

    expect(spy).toHaveBeenCalledTimes(1);
    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('secret-db.internal');
    expect(serialized).not.toContain('3306');
    expect(serialized).not.toContain('root');
    expect(serialized).not.toContain(error.message);
    expect(loggedArgs[0]).toMatchObject({ event: 'service_shutdown_failed', errorType: 'crm_unavailable' });
  });

  it('classifies an unrecognized error as unexpected_error, not crm_unavailable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logShutdownFailure(new Error('something else entirely'));

    expect(spy.mock.calls[0]?.[0]).toMatchObject({ errorType: 'unexpected_error' });
  });
});
