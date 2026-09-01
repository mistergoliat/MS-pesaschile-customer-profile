import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Product Semantic Snapshot consumer architecture boundary', () => {
  it('does not import catalog implementation or classifier/ontology logic', () => {
    const files = [
      'src/application/product-semantic-snapshot/consumer.ts',
      'src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.ts',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ['"].*(catalog-service|product-semantic-classification|ontology-registry|classifier)/i);
      expect(source).not.toMatch(/from ['"].*\/catalog\//i);
    }
  });
});
