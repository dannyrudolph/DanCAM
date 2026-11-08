import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arcEnd, arcStart } from './arc';
import { mirrorLine, rotation, scaling, transformAngle, transformArc, transformDir, transformPoint, translation } from './transform';
import type { Vec2 } from './vec';

const coord = fc.double({ min: -100, max: 100, noNaN: true });
const pt = fc.record({ x: coord, y: coord });
const deg = fc.double({ min: -720, max: 720, noNaN: true });

const close = (a: Vec2, b: Vec2, tol = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

describe('transforms', () => {
  it('rotates 90° about a point exactly', () => {
    const t = rotation({ x: 1, y: 1 }, 90);
    expect(transformPoint(t, { x: 3, y: 1 })).toEqual({ x: 1, y: 3 });
    // No sin(180°) ≈ 1e-16 cross-term: a point level with the center stays exactly level.
    const p = transformPoint(rotation({ x: 0.1, y: 0.2 }, 180), { x: 0.3, y: 0.2 });
    expect(p.y).toBe(0.2);
    expect(p.x).toBeCloseTo(-0.1, 15);
  });

  it('mirrors about horizontal and vertical lines without touching the other coordinate', () => {
    const h = mirrorLine({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })!;
    expect(transformPoint(h, { x: 0.123456789, y: 0.2 })).toEqual({ x: 0.123456789, y: 0.8 });
    const v = mirrorLine({ x: 1, y: 0 }, { x: 1, y: -3 })!;
    expect(transformPoint(v, { x: 0.25, y: 7.1 })).toEqual({ x: 1.75, y: 7.1 });
  });

  it('mirrors about a 45° line by swapping coordinates', () => {
    const t = mirrorLine({ x: 0, y: 0 }, { x: 1, y: 1 })!;
    close(transformPoint(t, { x: 2, y: 5 }), { x: 5, y: 2 }, 1e-14);
  });

  it('moves without changing an angle at all', () => {
    const t = translation({ x: 0, y: 0 }, { x: 0.1, y: 0.2 });
    expect(transformAngle(t, 37.123456789)).toBe(37.123456789);
    expect(transformDir(t, { x: 0.6, y: 0.8 })).toEqual({ x: 0.6, y: 0.8 });
  });

  it('scales lengths and positions about the base point', () => {
    const t = scaling({ x: 1, y: 1 }, 2)!;
    expect(transformPoint(t, { x: 2, y: 3 })).toEqual({ x: 3, y: 5 });
    const a = transformArc(t, { center: { x: 1, y: 2 }, radius: 0.5, startDeg: 10, endDeg: 80 });
    expect(a).toEqual({ center: { x: 1, y: 3 }, radius: 1, startDeg: 10, endDeg: 80 });
    expect(scaling({ x: 0, y: 0 }, 0)).toBeUndefined();
    expect(scaling({ x: 0, y: 0 }, -1)).toBeUndefined();
  });

  it('rotates an arc by adding to both angles', () => {
    const a = transformArc(rotation({ x: 0, y: 0 }, 90), { center: { x: 1, y: 0 }, radius: 1, startDeg: 300, endDeg: 30 });
    expect(a).toEqual({ center: { x: 0, y: 1 }, radius: 1, startDeg: 30, endDeg: 120 });
  });

  it('mirrors an arc so it still runs counter-clockwise over the mirrored points', () => {
    const src = { center: { x: 1, y: 1 }, radius: 1, startDeg: 0, endDeg: 90 }; // (2,1) → (1,2)
    const t = mirrorLine({ x: 0, y: 0 }, { x: 0, y: 1 })!; // the Y axis
    const m = transformArc(t, src);
    expect(m).toEqual({ center: { x: -1, y: 1 }, radius: 1, startDeg: 90, endDeg: 180 });
    close(arcStart(m), transformPoint(t, arcEnd(src)));
    close(arcEnd(m), transformPoint(t, arcStart(src)));
  });

  it('returns to the start after rotating there and back, or mirroring twice', () => {
    fc.assert(
      fc.property(pt, pt, deg, (p, c, d) => {
        const there = transformPoint(rotation(c, d), p);
        close(transformPoint(rotation(c, -d), there), p);
      }),
    );
    fc.assert(
      fc.property(pt, pt, pt, (p, a, b) => {
        fc.pre(Math.hypot(b.x - a.x, b.y - a.y) > 0.01);
        const t = mirrorLine(a, b)!;
        close(transformPoint(t, transformPoint(t, p)), p);
      }),
    );
  });

  it('keeps arc ends on the transformed ends of the source, for any rotation or mirror', () => {
    const arcArb = fc.record({
      center: pt,
      radius: fc.double({ min: 0.01, max: 10, noNaN: true }),
      startDeg: fc.double({ min: 0, max: 359.9, noNaN: true }),
      endDeg: fc.double({ min: 0, max: 359.9, noNaN: true }),
    });
    fc.assert(
      fc.property(arcArb, pt, pt, deg, (a, p, q, d) => {
        fc.pre(Math.hypot(q.x - p.x, q.y - p.y) > 0.01);
        const r = rotation(p, d);
        close(arcStart(transformArc(r, a)), transformPoint(r, arcStart(a)), 1e-8);
        const m = mirrorLine(p, q)!;
        close(arcStart(transformArc(m, a)), transformPoint(m, arcEnd(a)), 1e-8);
      }),
    );
  });
});
