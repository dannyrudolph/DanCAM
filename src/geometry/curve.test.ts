import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Curve, intersectCurves, nearestOnCurve, perpendicularFeet, tangentPointsFrom } from './curve';
import { TOL } from './tolerance';
import { distance, dot, sub } from './vec';

const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const circle = (x: number, y: number, r: number): Curve => ({ kind: 'circle', center: { x, y }, radius: r });
const arc = (x: number, y: number, r: number, startDeg: number, endDeg: number): Curve => ({
  kind: 'arc',
  center: { x, y },
  radius: r,
  startDeg,
  endDeg,
});

describe('intersectCurves', () => {
  it('finds where two segments cross, and nothing when they only would if extended', () => {
    expect(intersectCurves(seg(0, 0, 2, 2), seg(0, 2, 2, 0))).toEqual([{ x: 1, y: 1 }]);
    expect(intersectCurves(seg(0, 0, 1, 0), seg(2, -1, 2, 1))).toEqual([]);
  });

  it('counts a segment ending exactly on another as meeting it', () => {
    expect(intersectCurves(seg(0, 0, 2, 0), seg(1, 0, 1, 3))).toEqual([{ x: 1, y: 0 }]);
  });

  it('cuts a ray at its base: only the forward side meets', () => {
    const ray: Curve = { kind: 'ray', base: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
    expect(intersectCurves(ray, seg(1, -1, 1, 1))).toEqual([{ x: 1, y: 0 }]);
    expect(intersectCurves(ray, seg(-1, -1, -1, 1))).toEqual([]);
    expect(intersectCurves(ray, circle(0, 0, 1))).toEqual([{ x: 1, y: 0 }]);
  });

  it('keeps only the line-arc crossings that lie on the arc', () => {
    // Upper half of the unit circle; the x axis meets it only at its two ends.
    const upper = arc(0, 0, 1, 0, 180);
    const pts = intersectCurves({ kind: 'xline', base: { x: 0, y: 0.5 }, dir: { x: 1, y: 0 } }, upper);
    expect(pts).toHaveLength(2);
    expect(intersectCurves({ kind: 'xline', base: { x: 0, y: -0.5 }, dir: { x: 1, y: 0 } }, upper)).toEqual([]);
  });

  it('handles an arc crossing 0°', () => {
    const a = arc(0, 0, 1, 300, 60); // right side, through 0°
    expect(intersectCurves(seg(0, 0, 3, 0), a)).toEqual([{ x: 1, y: 0 }]);
    expect(intersectCurves(seg(0, 0, -3, 0), a)).toEqual([]);
  });

  it('gives one exact point for a line tangent to an arc', () => {
    const pts = intersectCurves(seg(-2, 1, 2, 1), arc(0, 0, 1, 0, 180));
    expect(pts).toEqual([{ x: 0, y: 1 }]);
  });

  it('finds arc-arc crossings only within both arcs', () => {
    // Unit circles at (0,0) and (1,0) cross at (0.5, ±√3/2).
    const upperLeft = arc(0, 0, 1, 0, 180);
    const upperRight = arc(1, 0, 1, 0, 180);
    const pts = intersectCurves(upperLeft, upperRight);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.x).toBeCloseTo(0.5, 15);
    expect(pts[0]!.y).toBeCloseTo(Math.sqrt(3) / 2, 15);
  });

  it('gives one point for two arcs touching end to end on tangent circles', () => {
    expect(intersectCurves(arc(0, 0, 1, 270, 90), arc(2, 0, 1, 90, 270))).toEqual([{ x: 1, y: 0 }]);
  });

  it('puts every crossing on both curves, for any segment and circle', () => {
    const c = fc.double({ min: -5, max: 5, noNaN: true });
    fc.assert(
      fc.property(c, c, c, c, c, c, fc.double({ min: 0.1, max: 5, noNaN: true }), (ax, ay, bx, by, cx, cy, r) => {
        fc.pre(Math.hypot(bx - ax, by - ay) > 0.01);
        const s = seg(ax, ay, bx, by);
        for (const q of intersectCurves(s, circle(cx, cy, r))) {
          expect(Math.abs(distance(q, { x: cx, y: cy }) - r)).toBeLessThan(1e-9);
          expect(distance(nearestOnCurve(s, q), q)).toBeLessThan(1e-9);
        }
      }),
    );
  });
});

describe('nearestOnCurve', () => {
  it('projects onto a segment, or returns the nearer end past it', () => {
    expect(nearestOnCurve(seg(0, 0, 2, 0), { x: 1, y: 3 })).toEqual({ x: 1, y: 0 });
    expect(nearestOnCurve(seg(0, 0, 2, 0), { x: 5, y: 1 })).toEqual({ x: 2, y: 0 });
  });

  it('returns the base for a point behind a ray', () => {
    expect(nearestOnCurve({ kind: 'ray', base: { x: 1, y: 1 }, dir: { x: 0, y: 1 } }, { x: 0, y: -4 })).toEqual({ x: 1, y: 1 });
  });

  it('projects onto an arc, or returns the nearer end outside its sweep', () => {
    const upper = arc(0, 0, 2, 0, 180);
    expect(nearestOnCurve(upper, { x: 0, y: 5 })).toEqual({ x: 0, y: 2 });
    const end = nearestOnCurve(upper, { x: 1, y: -3 });
    expect(end.x).toBe(2);
    expect(end.y).toBe(0);
  });
});

describe('perpendicularFeet', () => {
  it('drops a perpendicular onto a segment, but not past its end', () => {
    expect(perpendicularFeet(seg(0, 0, 4, 0), { x: 1, y: 2 })).toEqual([{ x: 1, y: 0 }]);
    expect(perpendicularFeet(seg(0, 0, 4, 0), { x: 6, y: 2 })).toEqual([]);
  });

  it('gives both ends of the diameter through the point for a circle, and only those on an arc', () => {
    expect(perpendicularFeet(circle(0, 0, 1), { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]);
    expect(perpendicularFeet(arc(0, 0, 1, 90, 270), { x: 3, y: 0 })).toEqual([{ x: -1, y: 0 }]);
    expect(perpendicularFeet(circle(0, 0, 1), { x: 0, y: 0 })).toEqual([]);
  });
});

describe('tangentPointsFrom', () => {
  it('finds the two exact tangent points from a point on the x axis', () => {
    // From (2,0) to the unit circle: the tangent points are at 60° and 300°.
    const pts = tangentPointsFrom(circle(0, 0, 1), { x: 2, y: 0 });
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      expect(p.x).toBeCloseTo(0.5, 15);
      expect(Math.abs(p.y)).toBeCloseTo(Math.sqrt(3) / 2, 15);
    }
  });

  it('keeps only the tangent points on an arc, and none from inside', () => {
    const pts = tangentPointsFrom(arc(0, 0, 1, 0, 180), { x: 2, y: 0 });
    expect(pts).toHaveLength(1);
    expect(pts[0]!.y).toBeGreaterThan(0);
    expect(tangentPointsFrom(circle(0, 0, 1), { x: 0.5, y: 0 })).toEqual([]);
    expect(tangentPointsFrom(seg(0, 0, 1, 0), { x: 0.5, y: 3 })).toEqual([]);
  });

  it('makes the radius perpendicular to the tangent line, for any outside point', () => {
    const c = fc.double({ min: -5, max: 5, noNaN: true });
    fc.assert(
      fc.property(c, c, fc.double({ min: 0.1, max: 3, noNaN: true }), c, c, (cx, cy, r, px, py) => {
        const center = { x: cx, y: cy };
        const from = { x: px, y: py };
        fc.pre(distance(center, from) > r + 0.01);
        const pts = tangentPointsFrom(circle(cx, cy, r), from);
        expect(pts).toHaveLength(2);
        for (const t of pts) {
          expect(Math.abs(distance(t, center) - r)).toBeLessThan(1e-9);
          const radial = sub(t, center);
          const tangent = sub(from, t);
          expect(Math.abs(dot(radial, tangent)) / (r * distance(from, t))).toBeLessThan(TOL);
        }
      }),
    );
  });
});
