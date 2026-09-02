import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('customer intelligence capability architecture guard', () => {
  it('keeps the neutral capability package free of provider, prompt, HTTP, and Copilot imports', () => {
    const root = resolve(process.cwd(), 'src/application/customer-intelligence-capability');
    const files = ['contracts.ts', 'budget.ts', 'errors.ts', 'analytics-query-capability.ts', 'registry.ts', 'selected-population-scope.ts', 'index.ts'];
    const forbiddenImport = /from ['"].*(customer-intelligence-copilot|openai|prompt|http\/routes|harness)/i;
    for (const file of files) expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(forbiddenImport);
  });

  it('requires both current Copilot entry points to consume the adapter and production wiring to use the registry', () => {
    const stateless = readFileSync(resolve(process.cwd(), 'src/application/customer-intelligence-copilot/answer-customer-intelligence-question.ts'), 'utf8');
    const session = readFileSync(resolve(process.cwd(), 'src/application/customer-intelligence-copilot-session/session-service.ts'), 'utf8');
    const bootstrap = readFileSync(resolve(process.cwd(), 'src/bootstrap.ts'), 'utf8');
    expect(stateless).toContain('CopilotAnalyticsCapabilityAdapter');
    expect(session).toContain('CopilotAnalyticsCapabilityAdapter');
    expect(bootstrap).toContain('createCustomerIntelligenceCapabilityRegistry');
    expect(bootstrap).toContain('createCopilotAnalyticsCapabilityAdapter');
  });
});
