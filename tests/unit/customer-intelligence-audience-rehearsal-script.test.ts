import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('A04.5 rehearsal script parsing guard', () => {
  it('keeps a terminating newline in curl output before shell read parsing', () => {
    const script = readFileSync(new URL('../../scripts/customer-intelligence-audience/a04-5-export-rehearsal.sh', import.meta.url), 'utf8');
    const formatLine = script.split('\n').find((line) => line.includes("-w '%{http_code}"));
    const expected = "-w '%{http_code} %{size_download} %{time_starttransfer} %{time_total}\\n' " + '\\';
    expect(formatLine?.trim()).toBe(expected);
    expect(script).toContain('read -r status size ttfb total < "$TMP_DIR/$name.curl"');
  });
});
