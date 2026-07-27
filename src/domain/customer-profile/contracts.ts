import type { IdentityResolutionStatus } from '../identity-resolution/index.js';

export type CustomerProfileSnapshot = {
  readonly masterCustomerId: string;
  readonly identityStatus: IdentityResolutionStatus;
  readonly generatedAt: string;
  readonly warnings: readonly string[];
};
