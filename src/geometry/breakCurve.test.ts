import { describe, expect, it } from 'vitest';
import { breakAt, breakBetween } from './breakCurve';
import type { Curve } from './curve';
import type { Vec2 } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const arc = (s: number, e: number): Curve => ({ kind: 'arc', center: v(0, 0), radius: 1, startDeg: s, endDeg: e });

describe('breakAt', () => {
  it('splits a line in two at the point on it nearest the pick', () => {
    expect(breakAt(seg(0, 0, 4, 0), v(1, 0.3))).toEqual([seg(0, 0, 1, 0), seg(1, 0, 4, 0)]);
  });

  it('splits an arc and an xline', () => {
    expect(breakAt(arc(0, 180), v(0, 2))).toEqual([arc(0, 90), arc(90, 180)]);
    const [a, b] = breakAt({ kind: 'xline', base: v(0, 0), dir: v(1, 0) }, v(2, 0))!;
    expect(a).toEqual({ kind: 'ray', base: v(2, 0), dir: v(1, 0) });
    expect(b).toEqual({ kind: 'ray', base: v(2, 0), dir: v(-1, -0) });
  });

  it('refuses a circle and a point at an end', () => {
    expect(breakAt({ kind: 'circle', center: v(0, 0), radius: 1 }, v(1, 0))).toBeUndefined();
    expect(breakAt(seg(0, 0, 4, 0), v(5, 0))).toBeUndefined();
  });
});

describe('breakBetween', () => {
  it('removes the part of a line between two points, in either order', () => {
    expect(breakBetween(seg(0, 0, 4, 0), v(3, 0), v(1, 0))).toEqual([seg(0, 0, 1, 0), seg(3, 0, 4, 0)]);
  });

  it('removes up to the end when a point is past it', () => {
    expect(breakBetween(seg(0, 0, 4, 0), v(3, 0), v(9, 0))).toEqual([seg(0, 0, 3, 0)]);
  });

  it('removes counter-clockwise from the first point to the second on a circle', () => {
    expect(breakBetween({ kind: 'circle', center: v(0, 0), radius: 1 }, v(0, 1), v(-1, 0))).toEqual([arc(180, 90)]);
    expect(breakBetween({ kind: 'circle', center: v(0, 0), radius: 1 }, v(-1, 0), v(0, 1))).toEqual([arc(90, 180)]);
  });

  it('removes the stretch inside an arc that crosses 0°', () => {
    expect(breakBetween(arc(270, 90), v(0, 1.5), v(1, 0))).toEqual([arc(270, 0)]);
  });

  it('refuses two points that coincide', () => {
    expect(breakBetween(seg(0, 0, 4, 0), v(2, 0), v(2, 0.1))).toBeUndefined();
  });
});
