import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerCluster } from '../../src/application/customer-clustering/get-customer-cluster.js';
import { getCustomerClusterNotConfigured } from '../../src/application/customer-clustering/cluster-not-configured.js';
import { ClusterSchemaIncompatibleError, ClusterTimeoutError, ClusterUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CurrentClusterSnapshotReader } from '../../src/application/customer-clustering/ports.js';
import type { CurrentClusterCustomerLookup } from '../../src/domain/customer-clustering/index.js';

const snapshotMeta = {
  snapshotId: '1',
  modelId: '1',
  modelVersion: 'behavioral-kmeans-k4-v1',
  algorithm: 'kmeans',
  k: 4,
  featureVersion: 'behavioral-clustering-features-v1',
  preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
  referenceTime: new Date('2026-08-19T00:00:00.000Z'),
  publishedAt: new Date('2026-08-19T00:05:00.000Z'),
  populationSize: 10147,
};

function readerReturning(lookup: CurrentClusterCustomerLookup): CurrentClusterSnapshotReader {
  return { getCurrentCustomerClusterLookup: vi.fn(async () => lookup) };
}

function readerThrowing(error: unknown): CurrentClusterSnapshotReader {
  return {
    getCurrentCustomerClusterLookup: vi.fn(async () => {
      throw error;
    }),
  };
}

function identityReturning(found: boolean): ResolveCustomerIdentity {
  return vi.fn(async () =>
    found
      ? {
          status: 'found' as const,
          identity: {
            customerId: 22066,
            externalCustomerId: 22066,
            identitySource: 'PRESTASHOP' as const,
            identityStatus: 'DIRECT_SOURCE' as const,
            sourceMetadata: { platform: 'PRESTASHOP' as const, entity: 'ps_customer' as const, primaryKey: 'id_customer' as const },
          },
        }
      : { status: 'not_found' as const },
  );
}

describe('getCustomerCluster', () => {
  it('returns available with cluster/model/snapshot/assignment for a clustered customer', async () => {
    const lookup: CurrentClusterCustomerLookup = {
      snapshot: snapshotMeta,
      record: {
        prestashopCustomerId: 22066,
        clusterId: 3,
        distanceToCentroid: 1.086622607,
        interpretationLabel: 'NEW_BURST_THEN_LAPSED_BUYERS',
        interpretationDescription: 'Newer customers whose repeat orders happened close together, then went dormant.',
        interpretationVersion: 'behavioral-cluster-interpretation-v1',
        snapshot: snapshotMeta,
      },
    };
    const getCustomerCluster = createGetCustomerCluster({
      resolveCustomerIdentity: identityReturning(true),
      currentClusterSnapshotReader: readerReturning(lookup),
    });

    const result = await getCustomerCluster({ customerId: 22066 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.cluster.clusterId).toBe(3);
      expect(result.cluster.label).toBe('NEW_BURST_THEN_LAPSED_BUYERS');
      expect(result.model.k).toBe(4);
      expect(result.snapshot.snapshotId).toBe('1');
      expect(result.assignment.distanceToCentroid).toBe(1.086622607);
    }
  });

  it('returns degraded no_published_cluster_snapshot when no snapshot has ever been published', async () => {
    const getCustomerCluster = createGetCustomerCluster({
      resolveCustomerIdentity: identityReturning(true),
      currentClusterSnapshotReader: readerReturning({ snapshot: null, record: null }),
    });
    const result = await getCustomerCluster({ customerId: 22066 });
    expect(result).toMatchObject({ status: 'degraded', reason: 'no_published_cluster_snapshot' });
  });

  it('returns cluster_not_available with insufficient_repeat_purchase_history when the customer exists but has no snapshot row (one-time buyer)', async () => {
    const getCustomerCluster = createGetCustomerCluster({
      resolveCustomerIdentity: identityReturning(true),
      currentClusterSnapshotReader: readerReturning({ snapshot: snapshotMeta, record: null }),
    });
    const result = await getCustomerCluster({ customerId: 22092 });
    expect(result).toMatchObject({ status: 'cluster_not_available', reason: 'insufficient_repeat_purchase_history' });
  });

  it('returns customer_not_found when the customer does not exist in PrestaShop at all', async () => {
    const getCustomerCluster = createGetCustomerCluster({
      resolveCustomerIdentity: identityReturning(false),
      currentClusterSnapshotReader: readerReturning({ snapshot: snapshotMeta, record: null }),
    });
    const result = await getCustomerCluster({ customerId: 999999999 });
    expect(result).toMatchObject({ status: 'customer_not_found' });
  });

  it.each([new ClusterUnavailableError('x'), new ClusterTimeoutError('x'), new ClusterSchemaIncompatibleError('x')])(
    'returns degraded cluster_unavailable for %s',
    async (error) => {
      const getCustomerCluster = createGetCustomerCluster({
        resolveCustomerIdentity: identityReturning(true),
        currentClusterSnapshotReader: readerThrowing(error),
      });
      const result = await getCustomerCluster({ customerId: 22066 });
      expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_unavailable' });
    },
  );

  it('propagates an unrecognized error rather than masking it as degraded', async () => {
    const getCustomerCluster = createGetCustomerCluster({
      resolveCustomerIdentity: identityReturning(true),
      currentClusterSnapshotReader: readerThrowing(new Error('boom')),
    });
    await expect(getCustomerCluster({ customerId: 22066 })).rejects.toThrow('boom');
  });
});

describe('getCustomerClusterNotConfigured', () => {
  it('always returns degraded cluster_not_configured, without touching any dependency', async () => {
    const result = await getCustomerClusterNotConfigured({ customerId: 22066 });
    expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_not_configured', customerId: 22066 });
  });
});
