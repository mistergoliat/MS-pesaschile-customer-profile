import type { CopilotFinalResponseState, CustomerIntelligenceCopilotResponse } from './contracts.js';

export function finalResponseStateForCopilotResponse(response: CustomerIntelligenceCopilotResponse): CopilotFinalResponseState {
  return response.finalResponseState;
}
