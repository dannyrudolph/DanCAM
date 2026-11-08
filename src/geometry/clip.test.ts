import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clipSegment } from './clip';
import { TOL } from './tolerance';

const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

describe('clipSegment', () => {
  it('returns a segment fully inside unchanged', () => {
    const a = { x: 10, y: 10 };
    const b = { x: 90, y: 40 };
    const r = clipSegment(a, b, box);
    expect(r?.[0]).toBe(a);
    expect(r?.[1]).toBe(b);
  });

  it('returns undefined for a segment entirely outside', () => {
    expect(clipSegment({ x: -10, y: 60 }, { x: 200, y: 60 }, box)).toBeUndefined();
    expect(clipSegment({ x: -10, y: -10 }, { x: -1, y: 100 }, box)).toBeUndefined();
  });

  it('cuts a horizontal line crossing the box at the box edges', () => {
    expect(clipSegment({ x: -1e9, y: 25 }, { x: 1e9, y: 25 }, box)).toEqual([
      { x: 0, y: 25 },
      { x: 100, y: 25 },
    ]);
  });

  it('cuts a diagonal at the right points', () => {
    // y = x, entering at (0,0) and leaving through the top at (50,50)
    const r = clipSegment({ x: -50, y: -50 }, { x: 150, y: 150 }, box);
    expect(r?.[0].x).toBeCloseTo(0, 12);
    expect(r?.[0].y).toBeCloseTo(0, 12);
    expect(r?.[1].x).toBeCloseTo(50, 12);
    expect(r?.[1].y).toBeCloseTo(50, 12);
  });

  it('keeps a zero-length segment inside and drops one outside', () => {
    expect(clipSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, box)).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    expect(clipSegment({ x: -5, y: 5 }, { x: -5, y: 5 }, box)).toBeUndefined();
  });

  it('property: clipped endpoints lie in the box and on the original line', () => {
    const coord = fc.double({ min: -1e9, max: 1e9, noNaN: true });
    fc.assert(
      fc.property(coord, coord, coord, coord, (ax, ay, bx, by) => {
        const a = { x: ax, y: ay };
        const b = { x: bx, y: by };
        const r = clipSegment(a, b, box);
        if (!r) return;
        const len = Math.hypot(bx - ax, by - ay);
        for (const p of r) {
          // Inside the box, allowing rounding proportional to the input size.
          const slack = TOL + 1e-15 * Math.max(Math.abs(ax), Math.abs(bx), Math.abs(ay), Math.abs(by));
          expect(p.x).toBeGreaterThanOrEqual(box.minX - slack);
          expect(p.x).toBeLessThanOrEqual(box.maxX + slack);
          expect(p.y).toBeGreaterThanOrEqual(box.minY - slack);
          expect(p.y).toBeLessThanOrEqual(box.maxY + slack);
          // On the line through a and b: perpendicular distance relative to its length.
          if (len > 0) {
            const off = Math.abs((bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax)) / len;
            expect(off).toBeLessThan(1e-6);
          }
        }
      }),
    );
  });
});
