import type { CopilotAnalyticalReference, CopilotSemanticFocus } from '../../domain/customer-intelligence-copilot/index.js';
import type { CopilotSession } from './contracts.js';
import { deriveAnalyticalReferences, deriveSemanticFocus } from './session-context.js';

export type CustomerIntelligenceApplicationState = {
  readonly pinnedContext: CopilotSession['pinnedContext'];
  readonly resolvedIds: CopilotSession['resolvedIds'];
  readonly analyticalReferences: readonly CopilotAnalyticalReference[];
  readonly semanticFocus: CopilotSemanticFocus;
  readonly selectedPopulation: CopilotSession['uiContext'];
};

/** Deterministic session projection kept independent from prompts, providers, and HTTP. */
export function deriveCustomerIntelligenceApplicationState(session: CopilotSession): CustomerIntelligenceApplicationState {
  return {
    pinnedContext: session.pinnedContext,
    resolvedIds: session.resolvedIds,
    analyticalReferences: session.analyticalState.references.length > 0
      ? session.analyticalState.references
      : deriveAnalyticalReferences(session.analyticalState.results),
    semanticFocus: deriveSemanticFocus(session),
    selectedPopulation: session.uiContext,
  };
}
