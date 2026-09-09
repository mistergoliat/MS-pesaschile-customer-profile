import { describe, expect, it } from 'vitest';
import { parseSourceMode } from '../../scripts/customer-commercial-affinity/lib/semantic-source.js';

describe('customer affinity semantic source selection', () => {
  it('defaults operational selection to HTTP and keeps filesystem explicit', () => {
    expect(parseSourceMode(undefined)).toBe('http');
    expect(parseSourceMode('http')).toBe('http');
    expect(parseSourceMode('file')).toBe('file');
    expect(() => parseSourceMode('fallback')).toThrow();
  });
});
