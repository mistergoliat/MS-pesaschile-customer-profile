import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CUSTOMER_INTELLIGENCE_DIRS = [
  'src/domain/customer-intelligence',
  'src/application/customer-intelligence',
  'src/infrastructure/customer-intelligence',
  'scripts/intelligence',
];

const FORBIDDEN_PATTERNS = [/prestashop-pool/i, /PRESTASHOP_DB_/, /from ['"].*\/prestashop\//i, /createPrestashopPool/];

// Task Section 38: "must not instantiate a PrestaShop DB connection... no source DB access
// anywhere in its request path." A structural test over the actual source files is the most
// direct way to make this an enforced invariant rather than a hoped-for convention — any
// future change that imports a PrestaShop-facing module into this capability fails this test
// immediately, before it could ever reach a runtime check.
describe('Customer Intelligence has zero PrestaShop dependency (task Section 38)', () => {
  it('no file under customer-intelligence source directories references PrestaShop connection code', () => {
    const repoRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const dir of CUSTOMER_INTELLIGENCE_DIRS) {
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
