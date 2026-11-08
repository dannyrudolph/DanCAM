import { describe, expect, it } from 'vitest';
import type { Curve } from './curve';
import { joinCurves } from './join';
import type { Vec2 } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const arc = (s: number, e: number, r = 1): Curve => ({ kind: 'arc', center: v(0, 0), radius: r, startDeg: s, endDeg: e });

describe('joinCurves', () => {
  it('joins collinear lines across a gap, in the first line\'s direction', () => {
    expect(joinCurves(seg(0, 0, 1, 0), seg(3, 0, 2, 0))).toEqual(seg(0, 0, 3, 0));
    expect(joinCurves(seg(1, 1, 0, 0), seg(2, 2, 3, 3))).toEqual(seg(3, 3, 0, 0));
  });

  it('joins overlapping lines into their span', () => {
    expect(joinCurves(seg(0, 0, 2, 0), seg(1, 0, 1.5, 0))).toEqual(seg(0, 0, 2, 0));
  });

  it('refuses lines that are parallel but not collinear', () => {
    expect(joinCurves(seg(0, 0, 1, 0), seg(2, 1e-6, 3, 1e-6))).toBeUndefined();
  });

  it('joins arcs on one circle counter-clockwise from the first, across a gap and 0°', () => {
    expect(joinCurves(arc(300, 330), arc(20, 60))).toEqual(arc(300, 60));
    expect(joinCurves(arc(0, 90), arc(45, 120))).toEqual(arc(0, 120));
  });

  it('makes a circle when the arcs cover it', () => {
    expect(joinCurves(arc(0, 180), arc(180, 0))).toEqual({ kind: 'circle', center: v(0, 0), radius: 1 });
    expect(joinCurves(arc(0, 200), arc(150, 10))).toEqual({ kind: 'circle', center: v(0, 0), radius: 1 });
  });

  it('refuses arcs on different circles, and a line with an arc', () => {
    expect(joinCurves(arc(0, 90), arc(100, 120, 2))).toBeUndefined();
    expect(joinCurves(seg(0, 0, 1, 0), arc(0, 90))).toBeUndefined();
  });
});
