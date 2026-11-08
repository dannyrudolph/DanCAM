import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Circle } from './circle';
import { distanceToLine } from './distance';
import { type TangentTarget, nearestToPicks, tangentPoint, tangentTangentRadius, tangentTangentTangent } from './tangentCircles';
import { TOL } from './tolerance';
import { distance } from './vec';

const xAxis: TangentTarget = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } };
const yAxis: TangentTarget = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 1 } };
const unit: TangentTarget = { kind: 'circle', center: { x: 0, y: 0 }, radius: 1 };

/** How far `c` is from touching `t`: zero when tangent. */
function tangencyError(t: TangentTarget, c: Circle): number {
  if (t.kind === 'line') return Math.abs(distanceToLine(c.center, t.a, t.b) - c.radius);
  const d = distance(c.center, t.center);
  return Math.min(Math.abs(d - (c.radius + t.radius)), Math.abs(d - Math.abs(c.radius - t.radius)));
}

function sortByCenter(cs: Circle[]): Circle[] {
  return [...cs].sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y);
}

describe('tangentTangentRadius', () => {
  it('puts a corner radius in each quadrant of two crossing lines', () => {
    const sols = sortByCenter(tangentTangentRadius(xAxis, yAxis, 0.25));
    expect(sols.map((s) => s.center)).toEqual([
      { x: -0.25, y: -0.25 },
      { x: -0.25, y: 0.25 },
      { x: 0.25, y: -0.25 },
      { x: 0.25, y: 0.25 },
    ]);
  });

  it('fits a radius between a line and a circle on both sides of the gap', () => {
    // Line y = 1.5, unit circle, r = 0.5: centers on y = 1 at distance 1.5 from the origin.
    const top: TangentTarget = { kind: 'line', a: { x: 0, y: 1.5 }, b: { x: 1, y: 1.5 } };
    const sols = sortByCenter(tangentTangentRadius(top, unit, 0.5));
    expect(sols).toHaveLength(2);
    expect(sols[0]!.center.x).toBeCloseTo(-Math.sqrt(1.25), 14);
    expect(sols[1]!.center.x).toBeCloseTo(Math.sqrt(1.25), 14);
    for (const s of sols) expect(s.center.y).toBeCloseTo(1, 14);
  });

  it('gives one solution when the radius just bridges the gap', () => {
    const top: TangentTarget = { kind: 'line', a: { x: 0, y: 2 }, b: { x: 1, y: 2 } };
    expect(tangentTangentRadius(top, unit, 0.5)).toEqual([{ center: { x: 0, y: 1.5 }, radius: 0.5 }]);
  });

  it('returns nothing for parallel lines too far apart for the radius', () => {
    const y1: TangentTarget = { kind: 'line', a: { x: 0, y: 1 }, b: { x: 1, y: 1 } };
    expect(tangentTangentRadius(xAxis, y1, 0.25)).toEqual([]);
  });

  it('places the circle nearest the hint between parallel lines exactly 2r apart', () => {
    const y1: TangentTarget = { kind: 'line', a: { x: 0, y: 1 }, b: { x: 1, y: 1 } };
    expect(tangentTangentRadius(xAxis, y1, 0.5, { x: 3, y: 0.9 })).toEqual([{ center: { x: 3, y: 0.5 }, radius: 0.5 }]);
    expect(tangentTangentRadius(xAxis, y1, 0.5)).toEqual([]);
  });

  it('accepts the targets in either order', () => {
    const a = sortByCenter(tangentTangentRadius(xAxis, unit, 0.5));
    const b = sortByCenter(tangentTangentRadius(unit, xAxis, 0.5));
    expect(b).toEqual(a);
  });
});

describe('tangentTangentTangent', () => {
  it('finds the incircle and three excircles of a 3-4-5 triangle', () => {
    const a: TangentTarget = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };
    const b: TangentTarget = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 3 } };
    const c: TangentTarget = { kind: 'line', a: { x: 4, y: 0 }, b: { x: 0, y: 3 } };
    const radii = tangentTangentTangent(a, b, c)
      .map((s) => s.radius)
      .sort((x, y) => x - y);
    // Inradius (a+b-c)/2 = 1; exradii area/(s-a) for s = 6: 2, 3, 6.
    expect(radii).toHaveLength(4);
    [1, 2, 3, 6].forEach((r, i) => expect(radii[i]).toBeCloseTo(r, 12));
  });

  it('fits a circle between two parallel lines and a circle', () => {
    // Lines y = ±1 and the unit circle: r = 1 circles centered at x = ±2 touch all three.
    // The unit circle itself also "touches" all three, and must not be offered.
    const lo: TangentTarget = { kind: 'line', a: { x: 0, y: -1 }, b: { x: 1, y: -1 } };
    const hi: TangentTarget = { kind: 'line', a: { x: 0, y: 1 }, b: { x: 1, y: 1 } };
    const sols = sortByCenter(tangentTangentTangent(lo, hi, unit));
    expect(sols).toHaveLength(2);
    expect(sols[0]!.center.x).toBeCloseTo(-2, 12);
    expect(sols[1]!.center.x).toBeCloseTo(2, 12);
    for (const s of sols) expect(s.radius).toBeCloseTo(1, 12);
  });

  it('finds circles touching three equal circles, including the one around them all', () => {
    const at = (x: number, y: number): TangentTarget => ({ kind: 'circle', center: { x, y }, radius: 1 });
    const h = Math.sqrt(3);
    const sols = tangentTangentTangent(at(-1, 0), at(1, 0), at(0, h));
    const centroidR = 2 / Math.sqrt(3); // centroid to each center
    const radii = sols.map((s) => s.radius);
    expect(radii.some((r) => Math.abs(r - (centroidR - 1)) < TOL)).toBe(true); // inner Soddy circle
    expect(radii.some((r) => Math.abs(r - (centroidR + 1)) < TOL)).toBe(true); // enclosing circle
  });

  // Cases fast-check found; each failed a TOL tangency check before the bisector walk and refinement.
  it('stays tangent within TOL for nearly parallel lines meeting far away', () => {
    const t: TangentTarget[] = [
      { kind: 'line', a: { x: 0, y: -4.999965192060107 }, b: { x: -4.999975778572281, y: 0 } },
      { kind: 'circle', center: { x: 0, y: 0 }, radius: 0.05 },
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 4.999999999999989, y: -4.99999306247259 } },
    ];
    const sols = tangentTangentTangent(t[0]!, t[1]!, t[2]!).filter((s) => s.radius < 10);
    expect(sols).toHaveLength(2);
    for (const s of sols) for (const x of t) expect(tangencyError(x, s)).toBeLessThan(TOL);
  });

  it('stays tangent within TOL for two nearly identical circles', () => {
    const t: TangentTarget[] = [
      { kind: 'circle', center: { x: 0, y: 0 }, radius: 0.05109199642849113 },
      { kind: 'circle', center: { x: 0, y: 0 }, radius: 0.05 },
      { kind: 'circle', center: { x: 0, y: -0.0000011571700791524188 }, radius: 0.05 },
    ];
    const sols = tangentTangentTangent(t[0]!, t[1]!, t[2]!);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) for (const x of t) expect(tangencyError(x, s)).toBeLessThan(TOL);
  });

  it('returns nothing for three parallel lines', () => {
    const y = (k: number): TangentTarget => ({ kind: 'line', a: { x: 0, y: k }, b: { x: 1, y: k } });
    expect(tangentTangentTangent(y(0), y(1), y(2))).toEqual([]);
  });
});

const coord = fc.double({ min: -5, max: 5, noNaN: true });
const pt = fc.record({ x: coord, y: coord });
const target: fc.Arbitrary<TangentTarget> = fc.oneof(
  fc
    .tuple(pt, pt)
    .filter(([a, b]) => distance(a, b) > 0.1)
    .map(([a, b]) => ({ kind: 'line' as const, a, b })),
  fc.tuple(pt, fc.double({ min: 0.05, max: 3, noNaN: true })).map(([center, radius]) => ({ kind: 'circle' as const, center, radius })),
);

describe('tangent circle properties', () => {
  // Relative to the solution's size, as in any well-scaled geometry test.
  const tolFor = (c: Circle) => TOL * Math.max(1, c.radius, Math.hypot(c.center.x, c.center.y));

  it('TTR solutions have the radius asked for and touch both targets', () => {
    fc.assert(
      fc.property(target, target, fc.double({ min: 0.01, max: 3, noNaN: true }), (t1, t2, r) => {
        for (const s of tangentTangentRadius(t1, t2, r)) {
          expect(s.radius).toBe(r);
          expect(tangencyError(t1, s)).toBeLessThan(tolFor(s));
          expect(tangencyError(t2, s)).toBeLessThan(tolFor(s));
        }
      }),
    );
  });

  it('TTT solutions touch all three targets', () => {
    // Circles that coincide to within a few TOL have no meaningful answer at that scale.
    const nearlySame = (a: TangentTarget, b: TangentTarget) =>
      a.kind === 'circle' && b.kind === 'circle' && distance(a.center, b.center) + Math.abs(a.radius - b.radius) < 1000 * TOL;
    fc.assert(
      fc.property(target, target, target, (t1, t2, t3) => {
        fc.pre(!nearlySame(t1, t2) && !nearlySame(t1, t3) && !nearlySame(t2, t3));
        for (const s of tangentTangentTangent(t1, t2, t3)) {
          for (const t of [t1, t2, t3]) expect(tangencyError(t, s)).toBeLessThan(tolFor(s));
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('choosing a solution from the picks', () => {
  it('picks the corner radius in the quadrant that was clicked', () => {
    const sols = tangentTangentRadius(xAxis, yAxis, 0.25);
    const chosen = nearestToPicks(sols, [xAxis, yAxis], [
      { x: 1, y: 0 },
      { x: 0, y: -1 },
    ]);
    expect(chosen?.center).toEqual({ x: 0.25, y: -0.25 });
  });

  it('reports the contact point on a circle for outside and enclosing tangency', () => {
    expect(tangentPoint(unit, { center: { x: 3, y: 0 }, radius: 2 })).toEqual({ x: 1, y: 0 });
    expect(tangentPoint(unit, { center: { x: 1, y: 0 }, radius: 2 })).toEqual({ x: -1, y: 0 });
    expect(tangentPoint(xAxis, { center: { x: 2, y: 0.5 }, radius: 0.5 })).toEqual({ x: 2, y: 0 });
  });
});
