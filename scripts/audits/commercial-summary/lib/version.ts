export type ServerVersionInfo = {
  readonly raw: string;
  readonly engine: 'mysql' | 'mariadb' | 'unknown';
  readonly majorVersion: number;
  readonly minorVersion: number;
  readonly supportsWindowFunctions: boolean;
};

// MariaDB's VERSION() string embeds "MariaDB" (e.g. "10.6.25-MariaDB-log"); MySQL's does
// not. Window functions landed in MariaDB 10.2 and in MySQL 8.0 — two different version
// floors for the same feature. The CP-R1-T06A script used a single "majorVersion >= 8"
// check, which happens to also be true for MariaDB 10.x (10 >= 8) but is not actually the
// MariaDB rule (a hypothetical MariaDB 9.x would wrongly report window-function support
// under that check). This module derives the real floor per engine instead of reusing
// that shortcut — see CP-R1-T07A section 10 "fallback compatible con MariaDB".
export function parseServerVersion(raw: string): ServerVersionInfo {
  const isMariaDb = /mariadb/i.test(raw);
  const versionMatch = /^(\d+)\.(\d+)/.exec(raw);
  const majorVersion = versionMatch ? Number(versionMatch[1]) : 0;
  const minorVersion = versionMatch ? Number(versionMatch[2]) : 0;
  const engine: ServerVersionInfo['engine'] = isMariaDb ? 'mariadb' : versionMatch ? 'mysql' : 'unknown';

  const supportsWindowFunctions = isMariaDb
    ? majorVersion > 10 || (majorVersion === 10 && minorVersion >= 2)
    : majorVersion >= 8;

  return { raw, engine, majorVersion, minorVersion, supportsWindowFunctions };
}
