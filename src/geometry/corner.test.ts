import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Corner, chamferLines, filletCurves } from './corner';
import { type Curve, nearestOnCurve } from './curve';
import { type Vec2, distance } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const xline = (x: number, y: number, dx: number, dy: number): Curve => ({ kind: 'xline', base: v(x, y), dir: v(dx, dy) });
const arc = (cx: number, cy: number, r: number, s: number, e: number): Curve => ({ kind: 'arc', center: v(cx, cy), radius: r, startDeg: s, endDeg: e });
const circle = (cx: number, cy: number, r: number): Curve => ({ kind: 'circle', center: v(cx, cy), radius: r });

type ArcCurve = Extract<Curve, { kind: 'arc' }>;
const jointArc = (c: Corner | undefined): ArcCurve => c!.joint as ArcCurve;

describe('filletCurves between lines', () => {
  it('rounds a square corner exactly and cuts both lines back to the arc', () => {
    const r = filletCurves(seg(0, 0, 5, 0), v(3, 0), seg(0, 0, 0, 5), v(0, 3), 1);
    expect(r).toEqual({ first: seg(1, 0, 5, 0), second: seg(0, 1, 0, 5), joint: arc(1, 1, 1, 180, 270) });
  });

  it('runs lines that stop short of the corner on to the arc', () => {
    const r = filletCurves(seg(2, 0, 5, 0), v(3, 0), seg(0, 5, 0, 2), v(0, 3), 1);
    expect(r?.first).toEqual(seg(1, 0, 5, 0));
    expect(r?.second).toEqual(seg(0, 5, 0, 1));
  });

  it('fillets the corner the picks enclose where two xlines cross, leaving rays', () => {
    const r = filletCurves(xline(0, 0, 1, 0), v(-3, 0), xline(0, 0, 0, 1), v(0, 3), 0.5);
    expect(jointArc(r).center).toEqual(v(-0.5, 0.5));
    expect(r?.first).toEqual({ kind: 'ray', base: v(-0.5, 0), dir: v(-1, -0) });
    expect(r?.second).toEqual({ kind: 'ray', base: v(0, 0.5), dir: v(0, 1) });
  });

  it('finds the right corner of a narrow wedge even with picks close to the point', () => {
    const r = filletCurves(seg(0, 0, 10, 0), v(0.5, 0), seg(0, 0, 10, 1), v(0.5, 0.05), 0.1);
    const c = jointArc(r).center;
    expect(c.y).toBeCloseTo(0.1, 12); // above the first line...
    expect(c.y).toBeLessThan(c.x / 10); // ...and below the second
    expect(c.x).toBeGreaterThan(0);
  });

  it('refuses a radius too large for the lines', () => {
    expect(filletCurves(seg(0, 0, 1, 0), v(0.5, 0), seg(0, 0, 0, 1), v(0, 0.5), 2)).toBeUndefined();
  });

  it('makes a sharp corner at radius 0, keeping the picked sides', () => {
    expect(filletCurves(seg(2, 0, 5, 0), v(3, 0), seg(0, 2, 0, 5), v(0, 3), 0)).toEqual({ first: seg(0, 0, 5, 0), second: seg(0, 0, 0, 5), joint: undefined });
    const crossing = filletCurves(seg(-5, 0, 5, 0), v(3, 0), seg(0, -5, 0, 5), v(0, -3), 0);
    expect(crossing?.first).toEqual(seg(0, 0, 5, 0));
    expect(crossing?.second).toEqual(seg(0, -5, 0, 0));
  });

  it('joins parallel lines with a half-circle at the picked end, whatever the radius', () => {
    const r = filletCurves(seg(0, 0, 5, 0), v(1, 0), seg(1, 2, 5, 2), v(2, 2), 0.25);
    expect(r).toEqual({ first: seg(0, 0, 5, 0), second: seg(0, 2, 5, 2), joint: arc(0, 1, 1, 90, 270) });
  });
});

describe('filletCurves with arcs and circles', () => {
  it('fillets a line to a circle, leaving the circle whole', () => {
    const r = filletCurves(seg(-5, 0, 5, 0), v(0, 0), circle(3, 1.5, 1), v(2, 1.5), 0.5);
    const j = jointArc(r);
    expect(j.radius).toBe(0.5);
    expect(j.center.x).toBeCloseTo(3 - Math.sqrt(1.25), 12);
    expect(j.center.y).toBeCloseTo(0.5, 12);
    expect(r?.second).toBeUndefined();
    expect(r?.first).toEqual(seg(-5, 0, j.center.x, 0));
  });

  it('cuts an arc back to the tangent point, keeping the part that was picked', () => {
    const r = filletCurves(seg(-5, 0, 5, 0), v(0, 0), arc(3, 1.5, 1, 90, 270), v(2, 1.5), 0.5);
    const kept = r?.second as ArcCurve;
    const t2 = { x: 3 + Math.cos((kept.endDeg * Math.PI) / 180), y: 1.5 + Math.sin((kept.endDeg * Math.PI) / 180) };
    expect(kept.startDeg).toBe(90);
    expect(distance(t2, jointArc(r).center)).toBeCloseTo(0.5, 12);
    expect(kept.endDeg).toBeGreaterThan(180);
    expect(kept.endDeg).toBeLessThan(270);
  });

  it('fillets the outside of two circles on the side of the picks', () => {
    const r = filletCurves(circle(0, 0, 1), v(0.5, 0.8), circle(4, 0, 1), v(3.5, 0.8), 1.5);
    expect(jointArc(r).center).toEqual(v(2, 1.5));
    const below = filletCurves(circle(0, 0, 1), v(0.5, -0.8), circle(4, 0, 1), v(3.5, -0.8), 1.5);
    expect(jointArc(below).center).toEqual(v(2, -1.5));
  });
});

describe('filletCurves properties', () => {
  it('puts the arc tangent to both lines, with its ends on the trimmed lines', () => {
    const deg = fc.double({ min: 10, max: 170, noNaN: true });
    const rad = fc.double({ min: 0.01, max: 1, noNaN: true });
    fc.assert(
      fc.property(deg, deg, rad, (a1, spread, r) => {
        const a2 = a1 + spread;
        const u1 = v(Math.cos((a1 * Math.PI) / 180), Math.sin((a1 * Math.PI) / 180));
        const u2 = v(Math.cos((a2 * Math.PI) / 180), Math.sin((a2 * Math.PI) / 180));
        const l1 = seg(0, 0, 50 * u1.x, 50 * u1.y);
        const l2 = seg(0, 0, 50 * u2.x, 50 * u2.y);
        const res = filletCurves(l1, v(10 * u1.x, 10 * u1.y), l2, v(10 * u2.x, 10 * u2.y), r)!;
        const j = jointArc(res);
        const s = (j.startDeg * Math.PI) / 180;
        const e = (j.endDeg * Math.PI) / 180;
        const ends = [v(j.center.x + r * Math.cos(s), j.center.y + r * Math.sin(s)), v(j.center.x + r * Math.cos(e), j.center.y + r * Math.sin(e))];
        for (const p of ends) {
          const onFirst = distance(nearestOnCurve(res.first!, p), p);
          const onSecond = distance(nearestOnCurve(res.second!, p), p);
          expect(Math.min(onFirst, onSecond)).toBeLessThan(1e-9);
        }
        expect(distance(nearestOnCurve(l1, j.center), j.center)).toBeCloseTo(r, 9);
        expect(distance(nearestOnCurve(l2, j.center), j.center)).toBeCloseTo(r, 9);
      }),
    );
  });
});

describe('chamferLines', () => {
  it('cuts each line back by its distance and joins the cuts', () => {
    expect(chamferLines(seg(0, 0, 5, 0), v(3, 0), seg(0, 0, 0, 5), v(0, 3), { kind: 'distances', d1: 0.5, d2: 0.25 })).toEqual({
      first: seg(0.5, 0, 5, 0),
      second: seg(0, 0.25, 0, 5),
      joint: seg(0.5, 0, 0, 0.25),
    });
  });

  it('makes a .010 x 45° edge break', () => {
    const r = chamferLines(seg(0, 0, 1, 0), v(0.5, 0), seg(0, 0, 0, 1), v(0, 0.5), { kind: 'angle', d1: 0.01, deg: 45 });
    const j = r?.joint as Extract<Curve, { kind: 'segment' }>;
    expect(j.a).toEqual(v(0.01, 0));
    expect(j.b.x).toBeCloseTo(0, 15);
    expect(j.b.y).toBeCloseTo(0.01, 15);
  });

  it('sizes the second leg by the corner angle for distance-angle', () => {
    // 120° corner, 1 along the first line at 30° from it: an isosceles triangle, so the second leg is 1 too.
    const u2 = v(Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3));
    const r = chamferLines(seg(0, 0, 5, 0), v(3, 0), seg(0, 0, 5 * u2.x, 5 * u2.y), v(3 * u2.x, 3 * u2.y), { kind: 'angle', d1: 1, deg: 30 });
    const j = r?.joint as Extract<Curve, { kind: 'segment' }>;
    expect(distance(j.b, v(0, 0))).toBeCloseTo(1, 12);
  });

  it('turns crossing xlines into rays', () => {
    const r = chamferLines(xline(0, 0, 1, 0), v(2, 0), xline(0, 0, 0, 1), v(0, -2), { kind: 'distances', d1: 0.1, d2: 0.1 });
    expect(r?.first).toEqual({ kind: 'ray', base: v(0.1, 0), dir: v(1, 0) });
    expect(r?.second).toEqual({ kind: 'ray', base: v(0, -0.1), dir: v(-0, -1) });
  });

  it('makes a sharp corner for zero distances, and refuses parallel lines, arcs and lines too short', () => {
    expect(chamferLines(seg(2, 0, 5, 0), v(3, 0), seg(0, 2, 0, 5), v(0, 3), { kind: 'distances', d1: 0, d2: 0 })?.joint).toBeUndefined();
    expect(chamferLines(seg(0, 0, 5, 0), v(1, 0), seg(0, 1, 5, 1), v(1, 1), { kind: 'distances', d1: 0.1, d2: 0.1 })).toBeUndefined();
    expect(chamferLines(seg(0, 0, 5, 0), v(1, 0), arc(0, 0, 1, 0, 90), v(0, 1), { kind: 'distances', d1: 0.1, d2: 0.1 })).toBeUndefined();
    expect(chamferLines(seg(0, 0, 1, 0), v(0.5, 0), seg(0, 0, 0, 1), v(0, 0.5), { kind: 'distances', d1: 2, d2: 0.1 })).toBeUndefined();
  });
});
