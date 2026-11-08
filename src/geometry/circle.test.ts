import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { angleFrom, circle2P, circle3P, circleBBox, distanceToCircle, nearestOnCircle, pointAtDeg } from './circle';
import { distanceToLine } from './distance';
import { TOL } from './tolerance';
import { distance } from './vec';

const coord = fc.double({ min: -10, max: 10, noNaN: true });
const pt = fc.record({ x: coord, y: coord });

describe('pointAtDeg', () => {
  it('is exact at the quadrants', () => {
    const c = { x: 0.5, y: 0.25 };
    expect(pointAtDeg(c, 0.125, 0)).toEqual({ x: 0.625, y: 0.25 });
    expect(pointAtDeg(c, 0.125, 90)).toEqual({ x: 0.5, y: 0.375 });
    expect(pointAtDeg(c, 0.125, 180)).toEqual({ x: 0.375, y: 0.25 });
    expect(pointAtDeg(c, 0.125, 270)).toEqual({ x: 0.5, y: 0.125 });
  });
});

describe('circle2P', () => {
  it('takes the two points as a diameter', () => {
    expect(circle2P({ x: 0, y: 0 }, { x: 0.25, y: 0 })).toEqual({ center: { x: 0.125, y: 0 }, radius: 0.125 });
  });

  it('rejects coincident points', () => {
    expect(circle2P({ x: 1, y: 1 }, { x: 1, y: 1 + TOL / 2 })).toBeUndefined();
  });
});

describe('circle3P', () => {
  it('finds the circumcircle of a right triangle at the hypotenuse midpoint', () => {
    const c = circle3P({ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 });
    expect(c?.center.x).toBeCloseTo(1.5, 14);
    expect(c?.center.y).toBeCloseTo(2, 14);
    expect(c?.radius).toBeCloseTo(2.5, 14);
  });

  it('rejects collinear and repeated points', () => {
    expect(circle3P({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeUndefined();
    expect(circle3P({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeUndefined();
  });

  it('passes through all three points', () => {
    fc.assert(
      fc.property(pt, pt, pt, (a, b, c) => {
        fc.pre(distanceToLine(c, a, b) > 0.01 && distance(a, b) > 0.01);
        const circ = circle3P(a, b, c);
        expect(circ).toBeDefined();
        for (const p of [a, b, c]) {
          // Relative to the radius: near-collinear points give huge circles.
          expect(Math.abs(distance(p, circ!.center) - circ!.radius)).toBeLessThan(TOL * Math.max(1, circ!.radius));
        }
      }),
    );
  });
});

describe('nearestOnCircle and angleFrom', () => {
  it('projects radially onto the circle', () => {
    expect(nearestOnCircle({ x: 1, y: 1 }, 2, { x: 1, y: 5 })).toEqual({ x: 1, y: 3 });
    expect(angleFrom({ x: 1, y: 1 }, { x: 1, y: 5 })).toBe(90);
  });
});

describe('circleBBox and distanceToCircle', () => {
  const c = { center: { x: 1, y: -2 }, radius: 0.5 };

  it('boxes the circle at center ± radius', () => {
    expect(circleBBox(c)).toEqual({ minX: 0.5, minY: -2.5, maxX: 1.5, maxY: -1.5 });
  });

  it('measures to the curve from outside and inside, not to the disc', () => {
    expect(distanceToCircle({ x: 1, y: 1 }, c)).toBe(2.5);
    expect(distanceToCircle({ x: 1, y: -2 }, c)).toBe(0.5);
    expect(distanceToCircle({ x: 1.5, y: -2 }, c)).toBe(0);
  });
});
