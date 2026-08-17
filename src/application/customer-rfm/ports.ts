import type {
  CurrentMasterCustomerRfmLookup,
  CurrentPrestashopCustomerRfmLookup,
  CanonicalIdentityCoverageSummary,
  CanonicalIdentityResolution,
  CurrentRfmSnapshotMetadata,
  CurrentMasterCustomerRfmRecord,
  CurrentPrestashopCustomerRfmRecord,
} from '../../domain/customer-rfm/index.js';

export interface CurrentRfmSnapshotReader {
  getCurrentSnapshot(): Promise<CurrentRfmSnapshotMetadata | null>;
  getCurrentPrestashopCustomerRfm(prestashopCustomerId: number): Promise<CurrentPrestashopCustomerRfmRecord | null>;
  getCurrentPrestashopCustomerRfmLookup(prestashopCustomerId: number): Promise<CurrentPrestashopCustomerRfmLookup>;
  getCurrentMasterCustomerRfm(masterCustomerId: string): Promise<CurrentMasterCustomerRfmRecord | null>;
  getCurrentMasterCustomerRfmLookup(masterCustomerId: string): Promise<CurrentMasterCustomerRfmLookup>;
}

export interface RfmCanonicalIdentityResolver {
  resolvePrestashopCustomerIds(prestashopCustomerIds: readonly number[]): Promise<{
    readonly resolutions: readonly CanonicalIdentityResolution[];
    readonly coverage: CanonicalIdentityCoverageSummary;
  }>;
}
