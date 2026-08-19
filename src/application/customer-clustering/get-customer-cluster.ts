import { ClusterSchemaIncompatibleError, ClusterTimeoutError, ClusterUnavailableError } from '../customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../customer-identity/resolve-customer-identity.js';
import { CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION, type GetCustomerClusterResult } from '../../domain/customer-clustering/index.js';
import type { CurrentClusterSnapshotReader } from './ports.js';

export type GetCustomerClusterInput = {
  readonly customerId: number;
};

export type GetCustomerCluster = (input: GetCustomerClusterInput) => Promise<GetCustomerClusterResult>;

// Serving-time read path: latest published snapshot only. Never recomputes an assignment,
// never trains, never calls Python (task Section 34). customerId = ps_customer.id_customer,
// same primary identity as RFM's primary path and every other endpoint — no CRM dependency.
export function createGetCustomerCluster(deps: {
  readonly resolveCustomerIdentity: ResolveCustomerIdentity;
  readonly currentClusterSnapshotReader: CurrentClusterSnapshotReader;
}): GetCustomerCluster {
  return async function getCustomerCluster(input) {
    const customerId = input.customerId;

    let lookup;
    try {
      lookup = await deps.currentClusterSnapshotReader.getCurrentCustomerClusterLookup(customerId);
    } catch (error) {
      if (error instanceof ClusterUnavailableError || error instanceof ClusterTimeoutError || error instanceof ClusterSchemaIncompatibleError) {
        return {
          status: 'degraded',
          customerId,
          reason: 'cluster_unavailable',
          contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
        };
      }
      throw error;
    }

    if (lookup.snapshot === null) {
      return {
        status: 'degraded',
        customerId,
        reason: 'no_published_cluster_snapshot',
        contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
      };
    }

    if (lookup.record === null) {
      const identityResult = await deps.resolveCustomerIdentity(customerId);
      if (identityResult.status !== 'found') {
        return {
          status: 'customer_not_found',
          customerId,
          contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
        };
      }
      // Customer exists in PrestaShop but has no row in the published snapshot: population B'
      // requires >=2 valid orders lifetime — a one-time buyer (or zero-order customer) is
      // never assigned a cluster (task Section 37) — never nearest-centroid by default.
      return {
        status: 'cluster_not_available',
        customerId,
        reason: 'insufficient_repeat_purchase_history',
        contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
      };
    }

    const record = lookup.record;
    return {
      status: 'available',
      customerId,
      cluster: {
        clusterId: record.clusterId,
        label: record.interpretationLabel,
        description: record.interpretationDescription,
      },
      model: {
        modelVersion: record.snapshot.modelVersion,
        algorithm: record.snapshot.algorithm,
        k: record.snapshot.k,
        featureVersion: record.snapshot.featureVersion,
        preprocessingVersion: record.snapshot.preprocessingVersion,
      },
      snapshot: {
        snapshotId: record.snapshot.snapshotId,
        referenceTime: record.snapshot.referenceTime.toISOString(),
      },
      assignment: {
        distanceToCentroid: record.distanceToCentroid,
      },
      contractVersion: CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION,
    };
  };
}
