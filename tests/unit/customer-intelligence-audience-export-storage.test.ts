import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('A04.5 transient export storage guard', () => {
  it('keeps the HTTP export path free of persistent file/storage writes', () => {
    const routeSource = readFileSync(new URL('../../src/http/routes/index.ts', import.meta.url), 'utf8');
    const exportSource = readFileSync(new URL('../../src/application/customer-intelligence-audience/export-artifact.ts', import.meta.url), 'utf8');
    expect(routeSource).not.toMatch(/writeFile|appendFile|createWriteStream|artifacts\/|uploads\//u);
    expect(exportSource).not.toMatch(/from ['"]node:fs|writeFile|appendFile|createWriteStream/u);
    expect(exportSource).toContain('artifact.byteLength');
    expect(exportSource).toContain('artifact,');
  });
});
