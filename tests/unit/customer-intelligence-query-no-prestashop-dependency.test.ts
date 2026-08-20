import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// scripts/intelligence/query.ts (this task's own CLI) is already covered by T02's own
// structural test, which scans the whole scripts/intelligence directory (task Section 62 —
// no need for a second, overlapping scan of the same file).
const CUSTOMER_INTELLIGENCE_QUERY_DIRS = [
  'src/domain/customer-intelligence-query',
  'src/application/customer-intelligence-query',
  'src/infrastructure/customer-intelligence-query',
];

const FORBIDDEN_PATTERNS = [/prestashop-pool/i, /PRESTASHOP_DB_/, /from ['"].*\/prestashop\//i, /createPrestashopPool/];

// task Section 6/38/62: the Analytical Query Runtime must never query PrestaShop. A structural
// test over the actual source files makes this an enforced invariant rather than a hoped-for
// convention — mirrors CP-R3-T02's own customer-intelligence-no-prestashop-dependency.test.ts
// exactly, scoped to this task's new directories.
describe('Customer Intelligence Query Runtime has zero PrestaShop dependency (task Section 6/38/62)', () => {
  it('no file under the query-runtime source directories references PrestaShop connection code', () => {
    const repoRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const dir of CUSTOMER_INTELLIGENCE_QUERY_DIRS) {
      const absoluteDir = join(repoRoot, dir);
      for (const file of listTsFilesRecursive(absoluteDir)) {
        const content = readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(content)) {
            offenders.push(`${file} matched ${pattern}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function listTsFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}
