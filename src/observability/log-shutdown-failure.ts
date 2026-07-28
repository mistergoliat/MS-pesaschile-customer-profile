import { classifyErrorForLog } from './classify-error-for-log.js';

// No side effects on import (unlike src/index.ts, which starts the server as soon as
// it's loaded) — kept separate so this can be unit tested without booting the service.
export function logShutdownFailure(error: unknown): void {
  console.error({
    event: 'service_shutdown_failed',
    errorType: classifyErrorForLog(error),
  });
}
