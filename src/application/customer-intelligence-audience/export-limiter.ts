import type { AudienceExportFormatV1 } from '../../domain/customer-intelligence-audience/index.js';

export type AudienceExportLimiterRejection = 'CONCURRENCY_LIMIT' | 'RATE_LIMIT';

export type AudienceExportLimiterLease = {
  readonly release: () => void;
};

export type AudienceExportLimiter = {
  readonly tryAcquire: (format: AudienceExportFormatV1) =>
    | { readonly accepted: true; readonly lease: AudienceExportLimiterLease }
    | { readonly accepted: false; readonly reason: AudienceExportLimiterRejection };
  readonly active: () => Readonly<{ readonly CSV: number; readonly XLSX: number }>;
};

export type AudienceExportLimiterOptions = {
  readonly csvConcurrency?: number;
  readonly xlsxConcurrency?: number;
  readonly startsPerMinute?: number;
  readonly now?: () => number;
};

const DEFAULT_CSV_CONCURRENCY = 4;
const DEFAULT_XLSX_CONCURRENCY = 1;
const DEFAULT_STARTS_PER_MINUTE = 12;
const RATE_WINDOW_MS = 60_000;

/**
 * Process-local protection for synchronous, memory-heavy audience downloads.
 * A lease must be released exactly once by the HTTP boundary, including failures.
 */
export function createAudienceExportLimiter(options: AudienceExportLimiterOptions = {}): AudienceExportLimiter {
  const csvConcurrency = positiveInteger(options.csvConcurrency ?? DEFAULT_CSV_CONCURRENCY, 'csvConcurrency');
  const xlsxConcurrency = positiveInteger(options.xlsxConcurrency ?? DEFAULT_XLSX_CONCURRENCY, 'xlsxConcurrency');
  const startsPerMinute = positiveInteger(options.startsPerMinute ?? DEFAULT_STARTS_PER_MINUTE, 'startsPerMinute');
  const now = options.now ?? Date.now;
  const activeByFormat = { CSV: 0, XLSX: 0 };
  const starts: number[] = [];

  return {
    tryAcquire(format) {
      const current = now();
      while (starts[0] !== undefined && current - starts[0] >= RATE_WINDOW_MS) starts.shift();
      if (starts.length >= startsPerMinute) return { accepted: false, reason: 'RATE_LIMIT' };

      const maximum = format === 'XLSX' ? xlsxConcurrency : csvConcurrency;
      if (activeByFormat[format] >= maximum) return { accepted: false, reason: 'CONCURRENCY_LIMIT' };

      activeByFormat[format] += 1;
      starts.push(current);
      let released = false;
      return {
        accepted: true,
        lease: {
          release: () => {
            if (released) return;
            released = true;
            activeByFormat[format] -= 1;
          },
        },
      };
    },
    active: () => ({ CSV: activeByFormat.CSV, XLSX: activeByFormat.XLSX }),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid audience export limiter ${name}`);
  return value;
}
