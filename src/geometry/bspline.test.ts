import { describe, expect, it } from 'vitest';
import { expandKnots, splinePoint, splineRange, splineSpans } from './bspline';

describe('B-spline', () => {
  it('a degree-1 spline is the polyline through its points', () => {
    const s = { degree: 1, points: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 4, z: 0 }], knots: expandKnots([0, 1, 2], [2, 1, 2]) };
    expect(splineRange(s)).toEqual([0, 2]);
    expect(splinePoint(s, 0.5)).toEqual({ x: 1, y: 0, z: 0 });
    expect(splinePoint(s, 1.25)).toEqual({ x: 2, y: 1, z: 0 });
    expect(splinePoint(s, 2)).toEqual({ x: 2, y: 4, z: 0 });
    expect(splineSpans(s)).toBe(2);
  });

  it('a cubic Bézier: ends at its end points, the middle at (P0 + 3P1 + 3P2 + P3) / 8', () => {
    const s = { degree: 3, points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }, { x: 3, y: 2, z: 1 }, { x: 4, y: 0, z: 0 }], knots: expandKnots([0, 1], [4, 4]) };
    expect(splinePoint(s, 0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(splinePoint(s, 1)).toEqual({ x: 4, y: 0, z: 0 });
    const m = splinePoint(s, 0.5);
    expect([m.x, m.y, m.z]).toEqual([2, 1.5, 0.375]);
  });

  it('rational: the quarter circle as a quadratic with weight √2/2 lies on the circle exactly', () => {
    const s = { degree: 2, points: [{ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }], knots: expandKnots([0, 1], [3, 3]), weights: [1, Math.SQRT1_2, 1] };
    for (const t of [0.1, 0.37, 0.5, 0.9]) {
      const p = splinePoint(s, t);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 14);
    }
  });
});
