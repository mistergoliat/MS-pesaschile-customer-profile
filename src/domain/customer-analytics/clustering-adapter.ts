import type { RawClusterFeatureVector } from '../customer-clustering/contracts.js';
import { featureOrder as clusterFeatureOrder } from '../customer-clustering/model-version.js';
import type { CustomerFeatureRow } from './contracts.js';

// Future-integration proof, not a wiring change (task Section 40/46): demonstrates that
// clustering's exact 12-field Feature Set A is fully representable from a materialized
// CustomerFeatureRow, without re-querying PrestaShop. Clustering itself is NOT changed to
// consume this — it still calls mysql-cluster-population-reader.ts directly (task Section 6:
// no premature refactor). This is what a future clustering-migration task would call instead.
//
// Returns null for a customer whose row falls below clustering's own population policy
// (>=2 valid orders — purchaseFrequencyDays is undefined by construction below that, task
// Section 13), exactly mirroring the throw mysql-cluster-population-reader.ts's
// buildFeatureVector already performs for the same case, but as a representable "not
// eligible" result rather than an exception, since the Data Layer's own population is
// intentionally broader than clustering's.
export function toClusteringFeatureVector(row: CustomerFeatureRow): RawClusterFeatureVector | null {
  if (row.purchaseFrequencyDays === null) {
    return null;
  }
  const vector: RawClusterFeatureVector = {
    distinctProducts: row.distinctProducts,
    effectiveDiversity: Number(row.effectiveDiversity),
    averageUnitsPerOrder: Number(row.averageUnitsPerOrder),
    purchaseFrequencyDays: Number(row.purchaseFrequencyDays),
    orders365d: row.orders365d,
    customerTenureDays: row.customerTenureDays,
    repeatProductRate: Number(row.repeatProductRate),
    top1Share: Number(row.top1Share),
    top3Share: Number(row.top3Share),
    cancelledOrderRatio: Number(row.cancelledOrderRatio),
    discountShare: Number(row.discountShare),
    shippingShare: Number(row.shippingShare),
  };
  assertCoversClusterFeatureOrder(vector);
  return vector;
}

function assertCoversClusterFeatureOrder(vector: RawClusterFeatureVector): void {
  for (const feature of clusterFeatureOrder) {
    if (!(feature in vector) || !Number.isFinite(vector[feature])) {
      throw new Error(`Clustering feature vector adapter is missing a finite value for ${feature}`);
    }
  }
}
