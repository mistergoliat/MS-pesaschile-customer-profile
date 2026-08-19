import type { ClusterAssignment } from './contracts.js';

// K-Means assignment is literally nearest-centroid-by-Euclidean-distance in the transformed
// feature space — no ML library needed to reproduce it (task Section 28). Returns a distance,
// never a fabricated membership probability (K-Means doesn't produce one; task Section 22).
export function assignNearestCentroid(
  transformedVector: readonly number[],
  centroids: readonly (readonly number[])[],
): ClusterAssignment {
  if (centroids.length === 0) {
    throw new Error('Cannot assign a cluster: model has no centroids');
  }

  let bestClusterId = -1;
  let bestSquaredDistance = Number.POSITIVE_INFINITY;

  for (let clusterId = 0; clusterId < centroids.length; clusterId += 1) {
    const centroid = centroids[clusterId]!;
    if (centroid.length !== transformedVector.length) {
      throw new Error(`Centroid ${clusterId} has ${centroid.length} dimensions, expected ${transformedVector.length}`);
    }
    let squaredDistance = 0;
    for (let i = 0; i < transformedVector.length; i += 1) {
      const diff = transformedVector[i]! - centroid[i]!;
      squaredDistance += diff * diff;
    }
    if (squaredDistance < bestSquaredDistance) {
      bestSquaredDistance = squaredDistance;
      bestClusterId = clusterId;
    }
  }

  return {
    clusterId: bestClusterId,
    distanceToCentroid: Math.sqrt(bestSquaredDistance),
  };
}
