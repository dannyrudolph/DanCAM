import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Curve } from './curve';
import { extendCurve } from './extend';
import { TOL } from './tolerance';
import { type Vec2, cross, distance, sub } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const vline = (x: number): Curve => ({ kind: 'xline', base: v(x, 0), dir: v(0, 1) });
const hline = (y: number): Curve => ({ kind: 'xline', base: v(0, y), dir: v(1, 0) });
const arc = (r: number, startDeg: number, endDeg: number): Curve => ({ kind: 'arc', center: v(0, 0), radius: r, startDeg, endDeg });

describe('extendCurve', () => {
  it('extends the segment end nearer the pick to the first boundary ahead of it', () => {
    const s = seg(0, 0, 2, 0);
    const bounds = [vline(5), vline(3), vline(-4)];
    expect(extendCurve(s, bounds, v(1.9, 0))).toEqual(seg(0, 0, 3, 0));
    expect(extendCurve(s, bounds, v(0.1, 0))).toEqual(seg(-4, 0, 2, 0));
  });

  it('goes on to the next boundary when the end already lies on one (within TOL)', () => {
    expect(extendCurve(seg(0, 0, 3 - TOL / 2, 0), [vline(3), vline(5)], v(2.9, 0))).toEqual(seg(0, 0, 5, 0));
  });

  it('returns undefined when no boundary lies ahead', () => {
    expect(extendCurve(seg(0, 0, 2, 0), [vline(-1)], v(1.9, 0))).toBeUndefined();
    expect(extendCurve(seg(0, 0, 2, 0), [hline(1)], v(1.9, 0))).toBeUndefined();
  });

  it('extends a ray back from its base', () => {
    const ray: Curve = { kind: 'ray', base: v(0, 0), dir: v(1, 0) };
    expect(extendCurve(ray, [vline(-2), vline(2)], v(5, 0))).toEqual({ kind: 'ray', base: v(-2, 0), dir: v(1, 0) });
  });

  it('does not extend xlines or circles', () => {
    expect(extendCurve(hline(0), [vline(1)], v(0, 0))).toBeUndefined();
    expect(extendCurve({ kind: 'circle', center: v(0, 0), radius: 1 }, [vline(0)], v(1, 0))).toBeUndefined();
  });

  it('runs an arc end on along its circle, across 0°', () => {
    // Arc from 90° to 300°; extending its end CCW meets the x axis at 0°, not at 180°.
    expect(extendCurve(arc(2, 90, 300), [hline(0)], v(1, -1.7))).toEqual(arc(2, 90, 0));
  });

  it('extends an arc start clockwise to the nearest boundary behind it', () => {
    expect(extendCurve(arc(2, 90, 180), [vline(Math.SQRT2), vline(-1)], v(0.2, 2))).toEqual(arc(2, 45, 180));
  });

  it('skips boundary hits that fall on the arc itself or at its other end', () => {
    // The x axis meets the circle at 0° (the start) and 180° (on the arc), so nothing lies ahead of the end.
    expect(extendCurve(arc(1, 0, 270), [hline(0)], v(0, -1))).toBeUndefined();
  });
});

describe('extendCurve properties', () => {
  const coord = fc.double({ min: -50, max: 50, noNaN: true });

  it('keeps a segment on its line, keeps the far end, and only gets longer', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, coord, (ax, ay, bx, by, wx) => {
        fc.pre(Math.hypot(bx - ax, by - ay) > 0.01);
        const s = seg(ax, ay, bx, by) as Extract<Curve, { kind: 'segment' }>;
        const r = extendCurve(s, [vline(wx)], s.b) as Extract<Curve, { kind: 'segment' }> | undefined;
        if (!r) return;
        expect(r.a).toEqual(s.a);
        expect(r.b.x).toBe(wx);
        expect(Math.abs(cross(sub(r.b, s.a), sub(s.b, s.a))) / distance(s.a, s.b)).toBeLessThan(1e-9 * Math.max(1, distance(r.a, r.b)));
        expect(distance(r.a, r.b)).toBeGreaterThan(distance(s.a, s.b));
      }),
    );
  });
});
