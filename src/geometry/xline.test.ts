import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOL } from './tolerance';
import { distanceToXline, offsetXline, xline2P, xlineAngle, xlineH, xlineV } from './xline';

const coord = fc.double({ min: -10, max: 10, noNaN: true });
const pt = fc.record({ x: coord, y: coord });

describe('xline builders', () => {
  it('makes exact horizontal and vertical directions', () => {
    expect(xlineH({ x: 1, y: 2 })).toEqual({ base: { x: 1, y: 2 }, dir: { x: 1, y: 0 } });
    expect(xlineV({ x: 1, y: 2 })).toEqual({ base: { x: 1, y: 2 }, dir: { x: 0, y: 1 } });
    expect(xlineAngle({ x: 0, y: 0 }, 180).dir).toEqual({ x: -1, y: 0 });
  });

  it('keeps an axis-aligned two-point line exact and rejects coincident points', () => {
    expect(xline2P({ x: 0.1, y: 3 }, { x: 0.1, y: -7 })?.dir).toEqual({ x: 0, y: -1 });
    expect(xline2P({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeUndefined();
  });
});

describe('offsetXline', () => {
  it('moves a horizontal line up or down toward the side point', () => {
    const x = xlineH({ x: 0, y: 0 });
    expect(offsetXline(x, 0.25, { x: 5, y: 1 })?.base).toEqual({ x: 0, y: 0.25 });
    expect(offsetXline(x, 0.25, { x: 5, y: -1 })?.base).toEqual({ x: 0, y: -0.25 });
  });

  it('rejects a zero distance or a side point on the line', () => {
    const x = xlineH({ x: 0, y: 0 });
    expect(offsetXline(x, 0, { x: 0, y: 1 })).toBeUndefined();
    expect(offsetXline(x, 1, { x: 3, y: 0 })).toBeUndefined();
  });

  it('holds the offset distance and lands on the side point\'s side', () => {
    fc.assert(
      fc.property(pt, pt, fc.double({ min: 0.001, max: 5, noNaN: true }), pt, (a, b, dist, side) => {
        const x = xline2P(a, b);
        fc.pre(x !== undefined && distanceToXline(side, x) > 0.01);
        const o = offsetXline(x!, dist, side)!;
        expect(Math.abs(distanceToXline(o.base, x!) - dist)).toBeLessThan(TOL);
        // The side point is nearer the copy than the original only if it's on that side.
        const sideOf = (p: typeof a, l: typeof o) => Math.sign(l.dir.x * (p.y - l.base.y) - l.dir.y * (p.x - l.base.x));
        expect(sideOf(o.base, x!)).toBe(sideOf(side, x!));
      }),
    );
  });
});
