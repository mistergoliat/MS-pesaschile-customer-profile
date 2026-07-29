import { describe, expect, it } from 'vitest';
import { parseServerVersion } from '../../scripts/audits/commercial-summary/lib/version.js';

// CP-R1-T07A section 10 "fallback compatible con MariaDB": confirms the version floor is
// derived per engine (MariaDB >= 10.2, MySQL >= 8.0) instead of reusing T06A's
// "majorVersion >= 8" shortcut, which is not the correct MariaDB rule.
describe('parseServerVersion', () => {
  it('detects MariaDB and supports window functions at 10.6.25', () => {
    const result = parseServerVersion('10.6.25-MariaDB-log');

    expect(result.engine).toBe('mariadb');
    expect(result.majorVersion).toBe(10);
    expect(result.minorVersion).toBe(6);
    expect(result.supportsWindowFunctions).toBe(true);
  });

  it('detects MariaDB 10.1 as NOT supporting window functions (below the 10.2 floor)', () => {
    const result = parseServerVersion('10.1.48-MariaDB');

    expect(result.engine).toBe('mariadb');
    expect(result.supportsWindowFunctions).toBe(false);
  });

  it('detects MariaDB 10.2.0 exactly at the floor as supporting window functions', () => {
    const result = parseServerVersion('10.2.0-MariaDB');

    expect(result.supportsWindowFunctions).toBe(true);
  });

  it('detects a future MariaDB 11.x as supporting window functions', () => {
    const result = parseServerVersion('11.0.2-MariaDB');

    expect(result.engine).toBe('mariadb');
    expect(result.supportsWindowFunctions).toBe(true);
  });

  it('detects plain MySQL 8.0 as supporting window functions', () => {
    const result = parseServerVersion('8.0.34');

    expect(result.engine).toBe('mysql');
    expect(result.supportsWindowFunctions).toBe(true);
  });

  it('detects plain MySQL 5.7 as NOT supporting window functions', () => {
    const result = parseServerVersion('5.7.44');

    expect(result.engine).toBe('mysql');
    expect(result.supportsWindowFunctions).toBe(false);
  });

  it('handles an unparseable version string without throwing', () => {
    const result = parseServerVersion('');

    expect(result.engine).toBe('unknown');
    expect(result.supportsWindowFunctions).toBe(false);
  });
});
