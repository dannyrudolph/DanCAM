import { describe, expect, it } from 'vitest';
import type { Curve } from './curve';
import { lengthenCurve } from './lengthen';
import type { Vec2 } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'segment', a: v(ax, ay), b: v(bx, by) });
const arc = (s: number, e: number): Curve => ({ kind: 'arc', center: v(0, 0), radius: 2, startDeg: s, endDeg: e });

describe('lengthenCurve', () => {
  it('moves the end nearer the pick by a delta, keeping the other end', () => {
    expect(lengthenCurve(seg(0, 0.3, 1, 0.3), v(0.9, 0.3), { kind: 'delta', value: 0.25 })).toEqual(seg(0, 0.3, 1.25, 0.3));
    expect(lengthenCurve(seg(0, 0.3, 1, 0.3), v(0.1, 0.3), { kind: 'delta', value: -0.25 })).toEqual(seg(0.25, 0.3, 1, 0.3));
  });

  it('sets a total length or a percent', () => {
    expect(lengthenCurve(seg(0, 0, 0, 2), v(0, 1.9), { kind: 'total', value: 0.5 })).toEqual(seg(0, 0, 0, 0.5));
    expect(lengthenCurve(seg(0, 0, 0, 2), v(0, 1.9), { kind: 'percent', value: 150 })).toEqual(seg(0, 0, 0, 3));
  });

  it('runs an arc end on along its circle, or pulls its start back, across 0°', () => {
    const quarterLen = Math.PI; // 90° of radius 2
    const ext = lengthenCurve(arc(0, 90), v(0, 2), { kind: 'delta', value: quarterLen }) as Extract<Curve, { kind: 'arc' }>;
    expect(ext.startDeg).toBe(0);
    expect(ext.endDeg).toBeCloseTo(180, 12);
    const back = lengthenCurve(arc(0, 90), v(2, 0), { kind: 'delta', value: quarterLen / 3 }) as Extract<Curve, { kind: 'arc' }>;
    expect(back.startDeg).toBeCloseTo(330, 12);
    expect(back.endDeg).toBe(90);
  });

  it('refuses a length of zero or less, a full turn, and curves without two ends', () => {
    expect(lengthenCurve(seg(0, 0, 1, 0), v(1, 0), { kind: 'delta', value: -1 })).toBeUndefined();
    expect(lengthenCurve(arc(0, 90), v(0, 2), { kind: 'percent', value: 400 })).toBeUndefined();
    expect(lengthenCurve({ kind: 'circle', center: v(0, 0), radius: 1 }, v(1, 0), { kind: 'delta', value: 1 })).toBeUndefined();
  });
});
