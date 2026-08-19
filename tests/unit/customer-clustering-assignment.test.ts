import { describe, expect, it } from 'vitest';
import { assignNearestCentroid } from '../../src/domain/customer-clustering/assignment.js';

describe('assignNearestCentroid', () => {
  const centroids = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];

  it('assigns to the nearest centroid by Euclidean distance', () => {
    const result = assignNearestCentroid([9, 1], centroids);
    expect(result.clusterId).toBe(1);
    expect(result.distanceToCentroid).toBeCloseTo(Math.sqrt(1 + 1), 10);
  });

  it('returns distance 0 for a point exactly at a centroid', () => {
    const result = assignNearestCentroid([0, 0], centroids);
    expect(result.clusterId).toBe(0);
    expect(result.distanceToCentroid).toBe(0);
  });

  it('never produces a membership probability — only clusterId and a distance (task Section 22)', () => {
    const result = assignNearestCentroid([5, 5], centroids);
    expect(Object.keys(result).sort()).toEqual(['clusterId', 'distanceToCentroid']);
  });

  it('throws when the model has no centroids', () => {
    expect(() => assignNearestCentroid([1, 2], [])).toThrow(/no centroids/);
  });

  it('throws on a dimension mismatch between the vector and a centroid', () => {
    expect(() => assignNearestCentroid([1, 2, 3], centroids)).toThrow(/dimensions/);
  });
});
