import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arc3P,
  arcBBox,
  arcContainsDeg,
  arcEnd,
  arcLength,
  arcMid,
  arcSCA,
  arcSCE,
  arcSER,
  arcStart,
  arcSweepDeg,
  arcTangentFrom,
  ccwTangentAt,
  distanceToArc,
} from './arc';
import { angleFrom } from './circle';
import { distanceToLine } from './distance';
import { TOL } from './tolerance';
import { cross, distance, vecNearlyEqual } from './vec';

const O = { x: 0, y: 0 };
const coord = fc.double({ min: -10, max: 10, noNaN: true });
const pt = fc.record({ x: coord, y: coord });

describe('arc basics', () => {
  const crossingZero = { center: O, radius: 2, startDeg: 315, endDeg: 45 };

  it('sweeps counter-clockwise across 0°', () => {
    expect(arcSweepDeg(crossingZero)).toBe(90);
    expect(arcContainsDeg(crossingZero, 0)).toBe(true);
    expect(arcContainsDeg(crossingZero, 350)).toBe(true);
    expect(arcContainsDeg(crossingZero, 180)).toBe(false);
    expect(arcMid(crossingZero)).toEqual({ x: 2, y: 0 });
  });

  it('includes its end angles', () => {
    expect(arcContainsDeg(crossingZero, 315)).toBe(true);
    expect(arcContainsDeg(crossingZero, 45)).toBe(true);
  });

  it('measures length along the curve', () => {
    expect(arcLength({ center: O, radius: 2, startDeg: 0, endDeg: 90 })).toBeCloseTo(Math.PI, 14);
  });

  it('has a CCW tangent at 0° pointing +Y', () => {
    expect(ccwTangentAt(0)).toEqual({ x: -0, y: 1 });
  });
});

describe('arc3P', () => {
  it('runs CCW when the middle point is reached counter-clockwise', () => {
    const a = arc3P({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 })!;
    expect(a.radius).toBeCloseTo(1, 14);
    expect(a.startDeg).toBeCloseTo(0, 12);
    expect(a.endDeg).toBeCloseTo(180, 12);
  });

  it('is stored end-to-start when the points go clockwise', () => {
    const a = arc3P({ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 })!;
    expect(a.startDeg).toBeCloseTo(0, 12);
    expect(a.endDeg).toBeCloseTo(180, 12);
  });

  it('rejects collinear points', () => {
    expect(arc3P(O, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeUndefined();
  });

  it('has its ends at the picked points and passes through the middle one', () => {
    fc.assert(
      fc.property(pt, pt, pt, (s, m, e) => {
        fc.pre(distanceToLine(m, s, e) > 0.05 && distance(s, e) > 0.05);
        const a = arc3P(s, m, e)!;
        const tol = TOL * Math.max(1, a.radius);
        const ends = [arcStart(a), arcEnd(a)];
        expect(ends.some((p) => vecNearlyEqual(p, s, tol))).toBe(true);
        expect(ends.some((p) => vecNearlyEqual(p, e, tol))).toBe(true);
        expect(arcContainsDeg(a, angleFrom(a.center, m))).toBe(true);
      }),
    );
  });
});

describe('arcSCE', () => {
  it('takes the radius from start-center and only the direction from the end', () => {
    const a = arcSCE({ x: 1, y: 0 }, O, { x: 0, y: 5 })!;
    expect(a).toEqual({ center: O, radius: 1, startDeg: 0, endDeg: 90 });
    expect(arcEnd(a)).toEqual({ x: 0, y: 1 });
  });

  it('goes the long way round when the end is clockwise of the start', () => {
    expect(arcSweepDeg(arcSCE({ x: 0, y: 1 }, O, { x: 1, y: 0 })!)).toBe(270);
  });

  it('rejects an end point on the center, or an end in the start direction', () => {
    expect(arcSCE({ x: 1, y: 0 }, O, O)).toBeUndefined();
    expect(arcSCE({ x: 1, y: 0 }, O, { x: 3, y: 0 })).toBeUndefined();
  });
});

describe('arcSCA', () => {
  it('runs CCW for a positive angle and CW for a negative one', () => {
    expect(arcSCA({ x: 1, y: 0 }, O, 90)).toEqual({ center: O, radius: 1, startDeg: 0, endDeg: 90 });
    expect(arcSCA({ x: 1, y: 0 }, O, -90)).toEqual({ center: O, radius: 1, startDeg: 270, endDeg: 0 });
  });

  it('rejects 0° and full turns', () => {
    expect(arcSCA({ x: 1, y: 0 }, O, 0)).toBeUndefined();
    expect(arcSCA({ x: 1, y: 0 }, O, 360)).toBeUndefined();
  });
});

describe('arcSER', () => {
  it('makes a half circle when the chord is the diameter, bulging toward the side point', () => {
    const up = arcSER({ x: 1, y: 0 }, { x: -1, y: 0 }, 1, { x: 0, y: 1 })!;
    expect(up).toEqual({ center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 180 });
    const down = arcSER({ x: 1, y: 0 }, { x: -1, y: 0 }, 1, { x: 0, y: -1 })!;
    expect(down.startDeg).toBe(180);
    expect(down.endDeg).toBe(0);
  });

  it('keeps the minor arc, with the center opposite the bulge', () => {
    // Chord of 2 at radius 2: center sqrt(3) below the chord when bulging up.
    const a = arcSER({ x: -1, y: 0 }, { x: 1, y: 0 }, 2, { x: 0, y: 5 })!;
    expect(a.center.x).toBeCloseTo(0, 14);
    expect(a.center.y).toBeCloseTo(-Math.sqrt(3), 14);
    expect(arcSweepDeg(a)).toBeCloseTo(60, 12);
    expect(arcMid(a).y).toBeGreaterThan(0);
  });

  it('rejects a chord longer than the diameter', () => {
    expect(arcSER({ x: 0, y: 0 }, { x: 3, y: 0 }, 1, { x: 0, y: 1 })).toBeUndefined();
  });

  it('always ends at both picked points with the given radius', () => {
    fc.assert(
      fc.property(pt, pt, pt, fc.double({ min: 1, max: 3, noNaN: true }), (s, e, side, k) => {
        fc.pre(distance(s, e) > 0.05);
        const r = (distance(s, e) / 2) * k;
        const a = arcSER(s, e, r, side)!;
        expect(Math.abs(a.radius - r)).toBe(0);
        const ends = [arcStart(a), arcEnd(a)];
        expect(ends.some((p) => vecNearlyEqual(p, s, TOL * r))).toBe(true);
        expect(ends.some((p) => vecNearlyEqual(p, e, TOL * r))).toBe(true);
        expect(arcSweepDeg(a)).toBeLessThanOrEqual(180 + TOL);
      }),
    );
  });
});

describe('arcTangentFrom', () => {
  it('turns left into a CCW quarter circle', () => {
    // Leaving (1,0) heading +Y and ending at (0,1): unit circle about the origin.
    const r = arcTangentFrom({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 1 })!;
    expect(r.reversed).toBe(false);
    expect(r.arc).toEqual({ center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 90 });
  });

  it('turns right into a clockwise arc, stored end to start', () => {
    const r = arcTangentFrom({ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 0 })!;
    expect(r.reversed).toBe(true);
    expect(r.arc).toEqual({ center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 90 });
  });

  it('rejects an end point straight ahead', () => {
    expect(arcTangentFrom(O, { x: 1, y: 0 }, { x: 5, y: 0 })).toBeUndefined();
  });

  it('is tangent to the incoming direction at the start point', () => {
    fc.assert(
      fc.property(pt, pt, pt, (s, d, e) => {
        fc.pre(Math.hypot(d.x, d.y) > 0.1 && distanceToLine(e, s, { x: s.x + d.x, y: s.y + d.y }) > 0.05);
        const { arc, reversed } = arcTangentFrom(s, d, e)!;
        const start = reversed ? arcEnd(arc) : arcStart(arc);
        expect(vecNearlyEqual(start, s, TOL * Math.max(1, arc.radius))).toBe(true);
        // Radius at the start is perpendicular to the direction.
        const radial = { x: s.x - arc.center.x, y: s.y - arc.center.y };
        const cos = (radial.x * d.x + radial.y * d.y) / (Math.hypot(radial.x, radial.y) * Math.hypot(d.x, d.y));
        expect(Math.abs(cos)).toBeLessThan(TOL);
        // And the travel direction matches: CCW turns left of d.
        expect(cross(d, { x: e.x - s.x, y: e.y - s.y }) > 0).toBe(!reversed);
      }),
    );
  });
});

describe('arcBBox', () => {
  it('reaches the top quadrant of an arc across 90°, but not the sides', () => {
    const b = arcBBox({ center: { x: 1, y: 1 }, radius: 2, startDeg: 30, endDeg: 150 });
    expect(b.minX).toBeCloseTo(1 - Math.sqrt(3), 12);
    expect(b.maxX).toBeCloseTo(1 + Math.sqrt(3), 12);
    expect(b.minY).toBeCloseTo(2, 12); // the ends, at 1 + 2·sin 30°
    expect(b.maxY).toBe(3); // the 90° quadrant, exact
  });

  it('reaches +X for an arc that crosses 0°', () => {
    const b = arcBBox({ center: O, radius: 1, startDeg: 300, endDeg: 60 });
    expect(b.maxX).toBe(1);
    expect(b.minX).toBeCloseTo(0.5, 12);
    expect(b.minY).toBeCloseTo(-Math.sqrt(3) / 2, 12);
    expect(b.maxY).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it('stops short of +X for an arc of almost a full turn that skips 0°', () => {
    const b = arcBBox({ center: O, radius: 1, startDeg: 1, endDeg: 359 });
    expect(b).toEqual({ minX: -1, minY: -1, maxX: expect.closeTo(Math.cos(Math.PI / 180), 12), maxY: 1 });
  });
});

describe('distanceToArc', () => {
  const upper = { center: O, radius: 1, startDeg: 0, endDeg: 180 };

  it('is radial inside the angular range', () => {
    expect(distanceToArc({ x: 0, y: 3 }, upper)).toBe(2);
    expect(distanceToArc({ x: 0, y: 0.25 }, upper)).toBe(0.75);
  });

  it('is the distance to the nearer end outside the range', () => {
    // Below the missing half: radially it would be 2, but the arc's nearest point is its end.
    expect(distanceToArc({ x: 0, y: -3 }, upper)).toBeCloseTo(Math.hypot(1, 3), 12);
    expect(distanceToArc({ x: 1.5, y: -0.5 }, upper)).toBeCloseTo(Math.hypot(0.5, 0.5), 12);
  });

  it('is the radius at the center', () => {
    expect(distanceToArc(O, upper)).toBe(1);
  });
});
