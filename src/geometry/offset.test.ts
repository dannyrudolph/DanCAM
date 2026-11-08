import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Curve, nearestOnCurve } from './curve';
import { offsetCurve, offsetThrough } from './offset';
import { type Vec2, distance } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });

describe('offsetCurve', () => {
  it('moves a line sideways toward the side point, exactly for a horizontal line', () => {
    expect(offsetCurve(seg(0, 0.3, 5, 0.3), 0.1, v(2, 1))).toEqual(seg(0, 0.3 + 0.1, 5, 0.3 + 0.1));
    expect(offsetCurve(seg(0, 0.3, 5, 0.3), 0.1, v(2, -1))).toEqual(seg(0, 0.3 - 0.1, 5, 0.3 - 0.1));
    expect(offsetCurve({ kind: 'xline', base: v(1, 0), dir: v(0, 1) }, 0.25, v(0, 7))).toEqual({ kind: 'xline', base: v(0.75, 0), dir: v(0, 1) });
  });

  it('grows or shrinks an arc concentrically, keeping its angles', () => {
    const a: Curve = { kind: 'arc', center: v(0, 0), radius: 1, startDeg: 10, endDeg: 100 };
    expect(offsetCurve(a, 0.25, v(3, 3))).toEqual({ ...a, radius: 1.25 });
    expect(offsetCurve(a, 0.25, v(0.1, 0.1))).toEqual({ ...a, radius: 0.75 });
  });

  it('refuses a side point on the curve, and an inward offset that would reach the center', () => {
    expect(offsetCurve(seg(0, 0, 5, 0), 0.1, v(9, 0))).toBeUndefined();
    expect(offsetCurve({ kind: 'circle', center: v(0, 0), radius: 1 }, 1, v(0.5, 0))).toBeUndefined();
  });
});

describe('offsetThrough', () => {
  it('passes through the point', () => {
    expect(offsetThrough(seg(0, 0, 5, 0), v(2, -0.4))).toEqual(seg(0, -0.4, 5, -0.4));
    expect(offsetThrough({ kind: 'circle', center: v(0, 0), radius: 1 }, v(0, 3))).toEqual({ kind: 'circle', center: v(0, 0), radius: 3 });
  });
});

describe('offsetCurve properties', () => {
  const coord = fc.double({ min: -50, max: 50, noNaN: true });
  it('keeps the offset distance between a line and its offset', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, coord, fc.double({ min: 0.001, max: 10, noNaN: true }), (ax, ay, bx, by, sx, sy, d) => {
        fc.pre(Math.hypot(bx - ax, by - ay) > 0.01);
        const line = seg(ax, ay, bx, by);
        const o = offsetCurve(line, d, v(sx, sy)) as Extract<Curve, { kind: 'segment' }> | undefined;
        if (!o) return;
        for (const p of [o.a, o.b]) expect(distance(nearestOnCurve({ kind: 'xline', base: v(ax, ay), dir: v(bx - ax, by - ay) }, p), p)).toBeCloseTo(d, 9);
      }),
    );
  });
});
