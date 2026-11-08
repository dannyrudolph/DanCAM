import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distanceToLine } from './distance';
import { circleCircle, lineCircle, lineLine } from './intersect';
import { TOL } from './tolerance';
import { distance } from './vec';

const coord = fc.double({ min: -10, max: 10, noNaN: true });
const pt = fc.record({ x: coord, y: coord });
const radius = fc.double({ min: 0.01, max: 10, noNaN: true });

describe('lineLine', () => {
  it('meets the X and Y axes at the origin', () => {
    expect(lineLine({ x: -3, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 0, y: -2 })).toEqual({ x: 0, y: 0 });
  });

  it('returns undefined for parallel lines', () => {
    expect(lineLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 2, y: 2 })).toBeUndefined();
  });
});

describe('lineCircle', () => {
  it('cuts a unit circle at ±1 along the X axis', () => {
    expect(lineCircle({ x: -5, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 1)).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('returns one point for a tangent line and none for a miss', () => {
    expect(lineCircle({ x: -5, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 1)).toEqual([{ x: 0, y: 1 }]);
    expect(lineCircle({ x: -5, y: 1.001 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 1)).toEqual([]);
  });

  it('puts every intersection on both the line and the circle', () => {
    fc.assert(
      fc.property(pt, pt, pt, radius, (p, q, c, r) => {
        fc.pre(distance(p, q) > 0.01);
        for (const x of lineCircle(p, { x: q.x - p.x, y: q.y - p.y }, c, r)) {
          expect(distanceToLine(x, p, q)).toBeLessThan(TOL);
          expect(Math.abs(distance(x, c) - r)).toBeLessThan(TOL);
        }
      }),
    );
  });
});

describe('circleCircle', () => {
  it('finds the two crossings of a 3-4-5 pair', () => {
    // Circles r=3 at the origin and r=4 at (5,0) meet where the right angle is.
    const pts = circleCircle({ x: 0, y: 0 }, 3, { x: 5, y: 0 }, 4);
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(p.x).toBeCloseTo(1.8, 12);
      expect(Math.abs(p.y)).toBeCloseTo(2.4, 12);
    }
  });

  it('returns one point for touching circles, inside and outside', () => {
    expect(circleCircle({ x: 0, y: 0 }, 1, { x: 3, y: 0 }, 2)).toEqual([{ x: 1, y: 0 }]);
    expect(circleCircle({ x: 0, y: 0 }, 3, { x: 1, y: 0 }, 2)).toEqual([{ x: 3, y: 0 }]);
  });

  it('returns nothing for separate, nested or concentric circles', () => {
    expect(circleCircle({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1)).toEqual([]);
    expect(circleCircle({ x: 0, y: 0 }, 5, { x: 1, y: 0 }, 1)).toEqual([]);
    expect(circleCircle({ x: 0, y: 0 }, 1, { x: 0, y: 0 }, 1)).toEqual([]);
  });

  it('puts every intersection on both circles', () => {
    fc.assert(
      fc.property(pt, radius, pt, radius, (c1, r1, c2, r2) => {
        for (const x of circleCircle(c1, r1, c2, r2)) {
          expect(Math.abs(distance(x, c1) - r1)).toBeLessThan(TOL);
          expect(Math.abs(distance(x, c2) - r2)).toBeLessThan(TOL);
        }
      }),
    );
  });
});
