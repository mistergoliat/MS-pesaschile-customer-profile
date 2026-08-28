import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOMAIN_DIR = 'src/domain/customer-commercial-affinity';

// Banned everywhere, including comments: no Product Semantic classifier implementation may
// re-enter this repo (task Section 21 — both modules were removed from customer-profile in the
// prior cleanup slice), and this field was deliberately removed from Catalog Product Semantics
// (task Section 4) — customer-profile must never reintroduce it even as a code comment.
const FORBIDDEN_ANYWHERE = ['commercial-product-ontology', 'product-semantic-classification', 'positiveAffinitySignal'];

// Banned only as an import source: prose explaining the service boundary (this module's own
// doc comments) legitimately names "catalog-service" without importing from it. What Section 21
// actually forbids is a runtime dependency, i.e. an import path, not the word in a comment.
const FORBIDDEN_IMPORT_SOURCES = ['commercial-product-ontology', 'product-semantic-classification', 'catalog-service'];

function domainSourceFiles(): readonly string[] {
  return readdirSync(DOMAIN_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(DOMAIN_DIR, name));
}

describe('customer-commercial-affinity architecture guard', () => {
  const files = domainSourceFiles();

  it('finds the expected domain module files (guards against a silently empty scan)', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.some((file) => file.endsWith('contracts.ts'))).toBe(true);
  });

  it.each(files)('%s never mentions a removed ontology module or field, even in a comment', (file) => {
    const source = readFileSync(file, 'utf8');

    for (const forbidden of FORBIDDEN_ANYWHERE) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each(files)('%s has no import statement sourcing from catalog-service or a removed ontology module', (file) => {
    const source = readFileSync(file, 'utf8');
    const importLines = source.split('\n').filter((line) => /^\s*import /.test(line));

    for (const line of importLines) {
      for (const forbidden of FORBIDDEN_IMPORT_SOURCES) {
        expect(line).not.toContain(forbidden);
      }
    }
  });
});
