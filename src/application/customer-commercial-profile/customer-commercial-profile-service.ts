import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import type { GetCustomerRfmByCustomerId } from '../customer-rfm/get-customer-rfm-by-customer-id.js';
import type { GetCustomerRfmByCustomerIdResult } from '../../domain/customer-rfm/index.js';
import type { GetCustomerCluster } from '../customer-clustering/get-customer-cluster.js';
import type { GetCustomerClusterResult } from '../../domain/customer-clustering/index.js';
import type { GetCustomerClv, GetCustomerClvResult } from '../customer-clv/get-customer-clv.js';
import type { GetCustomerCommercialAffinity, GetCustomerCommercialAffinities, CustomerCommercialAffinityLookupResult } from '../customer-commercial-affinity/index.js';
import {
  CUSTOMER_COMMERCIAL_PROFILE_IDENTITY_AUTHORITY,
  CUSTOMER_COMMERCIAL_PROFILE_VERSION,
  type CustomerCommercialProfile,
  type CustomerCommercialProfileAvailabilityState,
  type CustomerCommercialProfileClusterProvenance,
  type CustomerCommercialProfileClvProvenance,
  type CustomerCommercialProfileRfmProvenance,
  type CustomerCommercialProfileCommercialAffinityProvenance,
} from '../../domain/customer-commercial-profile/index.js';

export const CUSTOMER_COMMERCIAL_PROFILE_MAX_BATCH_SIZE = 100;

export type GetCustomerCommercialProfileInput = { readonly customerId: number };

export type GetCustomerCommercialProfileResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly profile: CustomerCommercialProfile;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_PROFILE_VERSION;
    }
  | {
      readonly status: 'customer_not_found';
      readonly customerId: number;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_PROFILE_VERSION;
    }
  | {
      readonly status: 'degraded';
      readonly customerId: number;
      readonly reason: 'identity_unavailable';
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_PROFILE_VERSION;
    };

export type GetCustomerCommercialProfile = (
  input: GetCustomerCommercialProfileInput,
) => Promise<GetCustomerCommercialProfileResult>;

export type GetCustomerCommercialProfileBatch = (input: {
  readonly customerIds: readonly number[];
}) => Promise<readonly GetCustomerCommercialProfileResult[]>;

export type CustomerCommercialProfileService = {
  readonly getByCustomerId: GetCustomerCommercialProfile;
  readonly getByCustomerIds: GetCustomerCommercialProfileBatch;
};

export function createCustomerCommercialProfileService(deps: {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly getCustomerRfm: GetCustomerRfmByCustomerId;
  readonly getCustomerCluster: GetCustomerCluster;
  readonly getCustomerClv: GetCustomerClv;
  readonly getCustomerCommercialAffinity?: GetCustomerCommercialAffinity;
  readonly getCustomerCommercialAffinities?: GetCustomerCommercialAffinities;
  readonly clock?: { now(): Date };
}): CustomerCommercialProfileService {
  const compose = async (customerId: number, affinityOverride?: CustomerCommercialAffinityLookupResult): Promise<GetCustomerCommercialProfileResult> => {
    let identityResult: Awaited<ReturnType<ResolveCustomerIdentity>>;
    try {
      identityResult = await deps.resolveCustomerIdentity(customerId);
    } catch {
      return { status: 'degraded', customerId, reason: 'identity_unavailable', contractVersion: CUSTOMER_COMMERCIAL_PROFILE_VERSION };
    }

    if (identityResult.status === 'invalid_id' || identityResult.status === 'not_found') {
      return { status: 'customer_not_found', customerId, contractVersion: CUSTOMER_COMMERCIAL_PROFILE_VERSION };
    }

    const [rfmSettled, clusterSettled, clvSettled, affinitySettled] = await Promise.allSettled([
      deps.getCustomerRfm({ customerId }),
      deps.getCustomerCluster({ customerId }),
      deps.getCustomerClv({ customerId }),
      affinityOverride === undefined
        ? (deps.getCustomerCommercialAffinity?.({ customerId }) ?? Promise.resolve(unavailableAffinityResult(customerId)))
        : Promise.resolve(affinityOverride),
    ]);

    const rfm = rfmSettled.status === 'fulfilled' ? mapRfm(rfmSettled.value) : unavailableRfm();
    const cluster = clusterSettled.status === 'fulfilled' ? mapCluster(clusterSettled.value) : unavailableCluster();
    const clv = clvSettled.status === 'fulfilled' ? mapClv(clvSettled.value) : unavailableClv();
    const affinity = affinitySettled.status === 'fulfilled' ? mapAffinity(affinitySettled.value) : unavailableAffinity();
    const generatedAt = (deps.clock?.now() ?? new Date()).toISOString();
    const referenceTimes = [rfm.provenance?.referenceTime, cluster.provenance?.referenceTime, clv.provenance?.referenceTime, affinity.provenance?.referenceTime]
      .filter((value): value is string => value !== null && value !== undefined)
      .sort();

    const profile: CustomerCommercialProfile = {
      customerId,
      identityAuthority: CUSTOMER_COMMERCIAL_PROFILE_IDENTITY_AUTHORITY,
      rfm: rfm.value,
      behavioralCluster: cluster.value,
      clv: clv.value,
      commercialAffinity: affinity.value,
      availability: {
        rfm: rfm.availability,
        behavioralCluster: cluster.availability,
        clv: clv.availability,
        commercialAffinity: affinity.availability,
      },
      provenance: {
        generatedAt,
        oldestReferenceTime: referenceTimes[0] ?? null,
        newestReferenceTime: referenceTimes.at(-1) ?? null,
        rfm: rfm.provenance,
        behavioralCluster: cluster.provenance,
        clv: clv.provenance,
        commercialAffinity: affinity.provenance,
      },
    };

    return { status: 'available', customerId, profile, contractVersion: CUSTOMER_COMMERCIAL_PROFILE_VERSION };
  };

  const getByCustomerId: GetCustomerCommercialProfile = ({ customerId }) => compose(customerId);

  const getByCustomerIds: GetCustomerCommercialProfileBatch = async ({ customerIds }) => {
    if (customerIds.length > CUSTOMER_COMMERCIAL_PROFILE_MAX_BATCH_SIZE) {
      throw new Error(`Customer Commercial Profile batch exceeds maximum size of ${CUSTOMER_COMMERCIAL_PROFILE_MAX_BATCH_SIZE}`);
    }
    const uniqueCustomerIds = [...new Set(customerIds)];
    const affinityResults = deps.getCustomerCommercialAffinities
      ? await deps.getCustomerCommercialAffinities({ customerIds: uniqueCustomerIds })
      : [];
    const affinityByCustomerId = new Map(affinityResults.map((result) => [result.customerId, result]));
    return Promise.all(uniqueCustomerIds.map((customerId) => compose(customerId, deps.getCustomerCommercialAffinities ? affinityByCustomerId.get(customerId) : undefined)));
  };

  return { getByCustomerId, getByCustomerIds };
}

type MappedComponent<T, P> = {
  readonly value: T | null;
  readonly availability: CustomerCommercialProfileAvailabilityState;
  readonly provenance: P | null;
};

function mapRfm(result: GetCustomerRfmByCustomerIdResult): MappedComponent<CustomerCommercialProfile['rfm'], CustomerCommercialProfileRfmProvenance> {
  if (result.status === 'available') {
    return {
      value: {
        recency: result.rfm.recencyDays,
        frequency: result.rfm.frequencyOrders,
        monetary: result.rfm.grossOrderValueTaxIncl,
        recencyScore: result.rfm.recencyScore,
        frequencyScore: result.rfm.frequencyScore,
        monetaryScore: result.rfm.monetaryScore,
        rfmCode: result.rfm.rfmCode,
        segmentCode: result.segment.code,
        segmentVersion: result.segment.version,
      },
      availability: 'AVAILABLE',
      provenance: { snapshotId: result.snapshot.snapshotId, referenceTime: result.snapshot.referenceTime, calculationVersion: result.snapshot.calculationVersion },
    };
  }
  if (result.status === 'rfm_not_available' || result.status === 'customer_not_found') return { value: null, availability: 'NOT_IN_POPULATION', provenance: null };
  return unavailableRfm();
}

function mapCluster(result: GetCustomerClusterResult): MappedComponent<CustomerCommercialProfile['behavioralCluster'], CustomerCommercialProfileClusterProvenance> {
  if (result.status === 'available') {
    return {
      value: { clusterId: result.cluster.clusterId, label: result.cluster.label, modelVersion: result.model.modelVersion },
      availability: 'AVAILABLE',
      provenance: { snapshotId: result.snapshot.snapshotId, referenceTime: result.snapshot.referenceTime, modelVersion: result.model.modelVersion },
    };
  }
  if (result.status === 'cluster_not_available' || result.status === 'customer_not_found') return { value: null, availability: 'NOT_IN_POPULATION', provenance: null };
  return unavailableCluster();
}

function mapClv(result: GetCustomerClvResult): MappedComponent<CustomerCommercialProfile['clv'], CustomerCommercialProfileClvProvenance> {
  if (result.status === 'available') {
    return {
      value: {
        expectedRevenueTaxIncl: result.clv.expectedRevenueTaxIncl,
        ...(result.clv.expectedOrders === undefined ? {} : { expectedOrders: result.clv.expectedOrders }),
        horizonMonths: result.clv.horizonMonths,
        currencyIsoCode: result.clv.currencyIsoCode,
        estimateSupportLevel: result.clv.estimateSupportLevel,
      },
      availability: 'AVAILABLE',
      provenance: { snapshotId: result.clv.snapshotId, referenceTime: result.clv.referenceTime, modelVersion: result.clv.modelVersion },
    };
  }
  if (result.status === 'customer_clv_not_found') return { value: null, availability: 'NOT_IN_POPULATION', provenance: null };
  return unavailableClv();
}

function unavailableRfm(): MappedComponent<CustomerCommercialProfile['rfm'], CustomerCommercialProfileRfmProvenance> {
  return { value: null, availability: 'UNAVAILABLE', provenance: null };
}
function unavailableCluster(): MappedComponent<CustomerCommercialProfile['behavioralCluster'], CustomerCommercialProfileClusterProvenance> {
  return { value: null, availability: 'UNAVAILABLE', provenance: null };
}
function unavailableClv(): MappedComponent<CustomerCommercialProfile['clv'], CustomerCommercialProfileClvProvenance> {
  return { value: null, availability: 'UNAVAILABLE', provenance: null };
}

function mapAffinity(result: CustomerCommercialAffinityLookupResult): MappedComponent<CustomerCommercialProfile['commercialAffinity'], CustomerCommercialProfileCommercialAffinityProvenance> {
  if (result.status === 'available') {
    return {
      value: result.affinity,
      availability: 'AVAILABLE',
      provenance: {
        snapshotId: result.affinity.snapshot.snapshotId,
        referenceTime: result.affinity.snapshot.referenceTime,
        calculationVersion: result.affinity.snapshot.calculationVersion,
      },
    };
  }
  if (result.status === 'not_in_population') return { value: null, availability: 'NOT_IN_POPULATION', provenance: null };
  return unavailableAffinity();
}

function unavailableAffinity(): MappedComponent<CustomerCommercialProfile['commercialAffinity'], CustomerCommercialProfileCommercialAffinityProvenance> {
  return { value: null, availability: 'UNAVAILABLE', provenance: null };
}

function unavailableAffinityResult(customerId: number): CustomerCommercialAffinityLookupResult {
  return { status: 'unavailable', customerId, availability: 'UNAVAILABLE', affinity: null, reason: 'affinity_unavailable', contractVersion: 'customer-commercial-affinity-runtime-v1' };
}
