import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arcLength } from './arc';
import { type Curve, intersectCurves } from './curve';
import { TOL } from './tolerance';
import { trimCurve } from './trim';
import { type Vec2, cross, distance, sub } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const xline = (x: number, y: number, dx: number, dy: number): Curve => ({ kind: 'xline', base: v(x, y), dir: v(dx, dy) });
const circle = (x: number, y: number, r: number): Curve => ({ kind: 'circle', center: v(x, y), radius: r });
const arc = (r: number, startDeg: number, endDeg: number): Curve => ({ kind: 'arc', center: v(0, 0), radius: r, startDeg, endDeg });

describe('trimCurve on straight curves', () => {
  it('removes the middle of a segment between two cuts and keeps both ends exactly', () => {
    const r = trimCurve(seg(0, 0, 10, 0), [v(7, 0), v(3, 0)], v(5, 0.1));
    expect(r?.removed).toEqual(seg(3, 0, 7, 0));
    expect(r?.kept).toEqual([seg(0, 0, 3, 0), seg(7, 0, 10, 0)]);
  });

  it('removes an end piece, keeping the rest as one segment that still passes the other cut', () => {
    const r = trimCurve(seg(0, 0, 10, 0), [v(3, 0), v(7, 0)], v(9, 0));
    expect(r?.kept).toEqual([seg(0, 0, 7, 0)]);
    expect(r?.removed).toEqual(seg(7, 0, 10, 0));
  });

  it('ignores a cut within TOL of an end, so no zero-length piece is left', () => {
    expect(trimCurve(seg(0, 0, 10, 0), [v(10 - TOL / 2, 0)], v(9, 0))).toBeUndefined();
    expect(trimCurve(seg(0, 0, 10, 0), [v(0, 0), v(10, 0)], v(5, 0))).toBeUndefined();
  });

  it('merges cuts closer than TOL into one', () => {
    const r = trimCurve(seg(0, 0, 10, 0), [v(5, 0), v(5 + TOL / 2, 0)], v(8, 0));
    expect(r?.kept).toEqual([seg(0, 0, 5, 0)]);
  });

  it('turns an xline cut on one side into a ray pointing away from the removed side', () => {
    const r = trimCurve(xline(0, 0, 1, 0), [v(2, 0)], v(5, 0));
    expect(r?.kept).toEqual([{ kind: 'ray', base: v(2, 0), dir: v(-1, -0) }]);
    expect(r?.removed).toEqual({ kind: 'ray', base: v(2, 0), dir: v(1, 0) });
  });

  it('turns an xline cut between two edges into two rays', () => {
    const r = trimCurve(xline(0, 0, 1, 0), [v(-1, 0), v(2, 0)], v(0.5, 0));
    expect(r?.kept).toEqual([
      { kind: 'ray', base: v(-1, 0), dir: v(-1, -0) },
      { kind: 'ray', base: v(2, 0), dir: v(1, 0) },
    ]);
  });

  it('trims an xline down to an exact line in two picks', () => {
    const cuts = [v(1, 0), v(4, 0)];
    const first = trimCurve(xline(0, 0, 1, 0), cuts, v(6, 0))!.kept[0]!;
    expect(first.kind).toBe('ray');
    const second = trimCurve(first, cuts, v(-2, 0))!.kept;
    expect(second).toEqual([seg(4, 0, 1, 0)]);
  });

  it('keeps a line from the base of a ray cut ahead of it, or a ray past the cut', () => {
    const ray: Curve = { kind: 'ray', base: v(0, 0), dir: v(0, 1) };
    expect(trimCurve(ray, [v(0, 3)], v(0, 9))?.kept).toEqual([seg(0, 0, 0, 3)]);
    expect(trimCurve(ray, [v(0, 3)], v(0, 1))?.kept).toEqual([{ kind: 'ray', base: v(0, 3), dir: v(0, 1) }]);
  });

  it('cuts a line at the point where a circle touches it', () => {
    const line = seg(-2, 1, 2, 1);
    const touch = intersectCurves(line, circle(0, 0, 1));
    expect(touch).toEqual([v(0, 1)]);
    expect(trimCurve(line, touch, v(1, 1))?.kept).toEqual([seg(-2, 1, 0, 1)]);
  });

  it('returns undefined when there are no cuts', () => {
    expect(trimCurve(seg(0, 0, 1, 0), [], v(0.5, 0))).toBeUndefined();
  });
});

describe('trimCurve on circles and arcs', () => {
  it('turns a circle into the arc on the far side of the two cuts', () => {
    const r = trimCurve(circle(0, 0, 1), [v(0, 1), v(0, -1)], v(1, 0));
    expect(r?.kept).toEqual([{ kind: 'arc', center: v(0, 0), radius: 1, startDeg: 90, endDeg: 270 }]);
    expect(r?.removed).toEqual({ kind: 'arc', center: v(0, 0), radius: 1, startDeg: 270, endDeg: 90 });
  });

  it('needs two cuts to trim a circle', () => {
    expect(trimCurve(circle(0, 0, 1), [v(1, 0)], v(-1, 0))).toBeUndefined();
  });

  it('removes the piece of a circle that wraps past 0°', () => {
    const cuts = intersectCurves(circle(0, 0, 1), xline(0.5, 0, 0, 1));
    const r = trimCurve(circle(0, 0, 1), cuts, v(2, 0));
    const kept = r!.kept[0] as Extract<Curve, { kind: 'arc' }>;
    expect(kept.startDeg).toBeCloseTo(60, 12);
    expect(kept.endDeg).toBeCloseTo(300, 12);
  });

  it('trims an arc that crosses 0° at its 0° point', () => {
    const r = trimCurve(arc(1, 300, 60), [v(1, 0)], v(0.9, 0.4));
    expect(r?.kept).toEqual([arc(1, 300, 0)]);
    expect(r?.removed).toEqual(arc(1, 0, 60));
  });

  it('removes the middle of an arc, keeping its original end angles', () => {
    const r = trimCurve(arc(2, 0, 180), [v(0, 2), v(-2, 0)], v(1.5, 1.4));
    expect(r?.kept).toEqual([arc(2, 90, 180)]);
    expect(trimCurve(arc(2, 0, 180), [v(Math.SQRT2, Math.SQRT2), v(-Math.SQRT2, Math.SQRT2)], v(0, 2.5))?.kept).toEqual([
      arc(2, 0, 45),
      arc(2, 135, 180),
    ]);
  });
});

function curveLength(c: Curve): number {
  if (c.kind === 'segment') return distance(c.a, c.b);
  if (c.kind === 'arc') return arcLength(c);
  throw new Error(`unbounded ${c.kind}`);
}

describe('trimCurve properties', () => {
  const unit = fc.double({ min: 0, max: 1, noNaN: true });
  const coord = fc.double({ min: -50, max: 50, noNaN: true });

  it('never lengthens a segment, and every kept piece stays on its line', () => {
    fc.assert(
      fc.property(coord, coord, coord, coord, fc.array(unit, { minLength: 1, maxLength: 4 }), unit, (ax, ay, bx, by, ts, tp) => {
        fc.pre(Math.hypot(bx - ax, by - ay) > 0.01);
        const s = seg(ax, ay, bx, by) as Extract<Curve, { kind: 'segment' }>;
        const at = (t: number): Vec2 => v(ax + (bx - ax) * t, ay + (by - ay) * t);
        const r = trimCurve(s, ts.map(at), at(tp));
        if (!r) return;
        const kept = r.kept.reduce((sum, k) => sum + curveLength(k), 0);
        expect(kept + curveLength(r.removed)).toBeCloseTo(curveLength(s), 9);
        expect(kept).toBeLessThan(curveLength(s));
        for (const k of r.kept) {
          const kk = k as Extract<Curve, { kind: 'segment' }>;
          for (const p of [kk.a, kk.b]) expect(Math.abs(cross(sub(p, s.a), sub(s.b, s.a))) / curveLength(s)).toBeLessThan(1e-9);
        }
      }),
    );
  });

  it('never lengthens an arc, and kept arcs stay on its circle', () => {
    const deg = fc.double({ min: 0, max: 359.9, noNaN: true });
    fc.assert(
      fc.property(deg, deg, fc.array(unit, { minLength: 1, maxLength: 4 }), unit, (s0, e0, ts, tp) => {
        const a = arc(3, s0, e0) as Extract<Curve, { kind: 'arc' }>;
        const sweep = curveLength(a) / 3;
        const at = (t: number): Vec2 => {
          const rad = (s0 * Math.PI) / 180 + sweep * t;
          return v(3 * Math.cos(rad), 3 * Math.sin(rad));
        };
        const r = trimCurve(a, ts.map(at), at(tp));
        if (!r) return;
        for (const k of r.kept) {
          expect(k.kind).toBe('arc');
          expect(k).toMatchObject({ center: v(0, 0), radius: 3 });
        }
        expect(r.kept.reduce((sum, k) => sum + curveLength(k), 0)).toBeLessThan(curveLength(a) + 1e-9);
      }),
    );
  });
});
