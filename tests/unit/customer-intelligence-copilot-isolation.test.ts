import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const COPILOT_SOURCE_DIRS = [
  'src/domain/customer-intelligence-copilot',
  'src/application/customer-intelligence-copilot',
];

const FORBIDDEN = [
  /prestashop-pool/i,
  /PRESTASHOP_DB_/,
  /from ['"].*\/prestashop\//i,
  /createPrestashopPool/,
  /mysql2/,
  /createPool/,
];

describe('Customer Intelligence Copilot isolation', () => {
  it('domain/application Copilot code imports no PrestaShop or direct DB infrastructure', () => {
    const repoRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];
    for (const dir of COPILOT_SOURCE_DIRS) {
      for (const file of listTsFilesRecursive(join(repoRoot, dir))) {
        const content = readFileSync(file, 'utf8');
        for (const pattern of FORBIDDEN) {
          if (pattern.test(content)) offenders.push(`${file} matched ${pattern}`);
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
    if (entry.isDirectory()) files.push(...listTsFilesRecursive(fullPath));
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}
