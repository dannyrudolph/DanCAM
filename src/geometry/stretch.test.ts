import { describe, expect, it } from 'vitest';
import { arcMid } from './arc';
import type { BBox } from './bbox';
import type { Curve } from './curve';
import { stretchCurve } from './stretch';
import { type Vec2, distance } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const box = (minX: number, minY: number, maxX: number, maxY: number): BBox => ({ minX, minY, maxX, maxY });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });

describe('stretchCurve', () => {
  it('moves only the line ends inside the window', () => {
    expect(stretchCurve(seg(0, 0, 2, 0), box(1.5, -1, 3, 1), v(0.5, 0))).toEqual(seg(0, 0, 2.5, 0));
    expect(stretchCurve(seg(0, 0, 2, 0), box(-1, -1, 3, 1), v(0, 1))).toEqual(seg(0, 1, 2, 1));
  });

  it('counts an end on the window edge as inside', () => {
    expect(stretchCurve(seg(0, 0, 2, 0), box(2, 0, 3, 1), v(1, 0))).toEqual(seg(0, 0, 3, 0));
  });

  it('leaves an object with nothing inside, even if it crosses the window', () => {
    expect(stretchCurve(seg(0, 0, 4, 0), box(1, -1, 2, 1), v(1, 0))).toBeUndefined();
  });

  it('moves circles by their center and rays and xlines by their base', () => {
    expect(stretchCurve({ kind: 'circle', center: v(0, 0), radius: 1 }, box(-0.1, -0.1, 0.1, 0.1), v(1, 1))).toEqual({ kind: 'circle', center: v(1, 1), radius: 1 });
    expect(stretchCurve({ kind: 'ray', base: v(0, 0), dir: v(1, 0) }, box(-1, -1, 1, 1), v(0, 2))).toEqual({ kind: 'ray', base: v(0, 2), dir: v(1, 0) });
  });

  it('moves an arc whole when both ends are inside', () => {
    const a: Curve = { kind: 'arc', center: v(0, 0), radius: 1, startDeg: 0, endDeg: 180 };
    expect(stretchCurve(a, box(-2, -0.5, 2, 0.5), v(0, 1))).toEqual({ ...a, center: v(0, 1) });
  });

  it('keeps the bulge height when one arc end moves', () => {
    // Upper half circle, chord (1,0)-(-1,0), sagitta 1. Stretch the start end to (3,0).
    const a: Curve = { kind: 'arc', center: v(0, 0), radius: 1, startDeg: 0, endDeg: 180 };
    const r = stretchCurve(a, box(0.5, -0.5, 1.5, 0.5), v(2, 0)) as Extract<Curve, { kind: 'arc' }>;
    const mid = arcMid(r);
    expect(mid.x).toBeCloseTo(1, 12);
    expect(mid.y).toBeCloseTo(1, 12);
    expect(distance(v(3, 0), r.center)).toBeCloseTo(r.radius, 12);
    expect(distance(v(-1, 0), r.center)).toBeCloseTo(r.radius, 12);
  });
});
