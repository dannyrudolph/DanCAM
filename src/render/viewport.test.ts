import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EMPTY_BBOX } from '../geometry/bbox';
import { TOL } from '../geometry/tolerance';
import {
  EXTENTS_MARGIN,
  MAX_SCALE,
  MIN_SCALE,
  type Viewport,
  pan,
  screenToWorld,
  visibleBBox,
  worldToScreen,
  zoomAt,
  zoomExtents,
} from './viewport';

const base: Viewport = { center: { x: 0, y: 0 }, scale: 100, widthPx: 1000, heightPx: 600 };

describe('viewport transform', () => {
  it('puts the center at the middle of the canvas, with world Y up', () => {
    const v = { ...base, center: { x: 1, y: 2 } };
    expect(worldToScreen(v, { x: 1, y: 2 })).toEqual({ x: 500, y: 300 });
    expect(worldToScreen(v, { x: 2, y: 2 })).toEqual({ x: 600, y: 300 });
    expect(worldToScreen(v, { x: 1, y: 3 })).toEqual({ x: 500, y: 200 });
  });

  it('covers a visible box of canvas size divided by scale', () => {
    expect(visibleBBox(base)).toEqual({ minX: -5, minY: -3, maxX: 5, maxY: 3 });
  });

  it('property: screen→world inverts world→screen within TOL across the whole zoom range', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: MIN_SCALE, max: MAX_SCALE, noNaN: true }),
        (px, py, cx, cy, scale) => {
          const v = { ...base, center: { x: cx, y: cy }, scale };
          const back = screenToWorld(v, worldToScreen(v, { x: px, y: py }));
          expect(Math.abs(back.x - px)).toBeLessThanOrEqual(TOL);
          expect(Math.abs(back.y - py)).toBeLessThanOrEqual(TOL);
        },
      ),
    );
  });

  it('keeps a 0.0005" feature 2" from the origin exact at deep zoom', () => {
    // 0.001" across 1000px: 1e6 px per inch, looking at the step at (1, 0.2505).
    const v = { ...base, center: { x: 1, y: 0.25 }, scale: 1e6 };
    const lower = worldToScreen(v, { x: 1, y: 0.25 });
    const upper = worldToScreen(v, { x: 1, y: 0.2505 });
    expect(lower).toEqual({ x: 500, y: 300 });
    expect(lower.y - upper.y).toBeCloseTo(500, 6);
    // A point 2" away still lands where expected, far off screen, without overflow.
    expect(worldToScreen(v, { x: 3, y: 0.25 }).x).toBeCloseTo(500 + 2e6, 3);
  });
});

describe('zoomAt', () => {
  it('property: the world point under the cursor stays under the cursor', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        fc.double({ min: 1, max: 1e8, noNaN: true }),
        (sx, sy, factor, scale) => {
          const v = { ...base, center: { x: 1.5, y: 0.25 }, scale };
          const before = screenToWorld(v, { x: sx, y: sy });
          const after = screenToWorld(zoomAt(v, { x: sx, y: sy }, factor), { x: sx, y: sy });
          expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(TOL);
          expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(TOL);
        },
      ),
    );
  });

  it('multiplies the scale by the factor', () => {
    expect(zoomAt(base, { x: 100, y: 100 }, 2).scale).toBe(200);
    expect(zoomAt(base, { x: 100, y: 100 }, 0.5).scale).toBe(50);
  });

  it('clamps at the zoom limits instead of running away', () => {
    const deep = { ...base, scale: MAX_SCALE / 2 };
    expect(zoomAt(deep, { x: 500, y: 300 }, 10).scale).toBe(MAX_SCALE);
    const far = { ...base, scale: MIN_SCALE * 2 };
    expect(zoomAt(far, { x: 500, y: 300 }, 0.1).scale).toBe(MIN_SCALE);
  });

  it('zooming in then out by the same factor returns to the same view', () => {
    const v = { ...base, center: { x: 0.75, y: -0.1 }, scale: 3000 };
    const round = zoomAt(zoomAt(v, { x: 123, y: 456 }, 1.37), { x: 123, y: 456 }, 1 / 1.37);
    expect(round.scale).toBeCloseTo(3000, 9);
    expect(Math.abs(round.center.x - 0.75)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(round.center.y + 0.1)).toBeLessThanOrEqual(TOL);
  });
});

describe('pan', () => {
  it('drags the drawing with the mouse: right moves the view left, down moves it up', () => {
    const v = pan(base, 50, 20);
    expect(v.center).toEqual({ x: -0.5, y: 0.2 });
    expect(v.scale).toBe(100);
    // The point that was at screen (500,300) is now at (550,320).
    expect(worldToScreen(v, { x: 0, y: 0 })).toEqual({ x: 550, y: 320 });
  });
});

describe('zoomExtents', () => {
  it('fits a wide box to the width, less the margin, and centers it', () => {
    // 2 x 0.25 box on a 1000 x 600 canvas: width limits, 900px / 2 = 450 px per unit.
    const v = zoomExtents(base, { minX: 0, minY: 0, maxX: 2, maxY: 0.25 });
    expect(v.scale).toBeCloseTo((1000 * (1 - 2 * EXTENTS_MARGIN)) / 2, 9);
    expect(v.center).toEqual({ x: 1, y: 0.125 });
    expect(worldToScreen(v, { x: 0, y: 0.125 }).x).toBeCloseTo(50, 9);
    expect(worldToScreen(v, { x: 2, y: 0.125 }).x).toBeCloseTo(950, 9);
  });

  it('fits a tall box to the height', () => {
    const v = zoomExtents(base, { minX: 0, minY: 0, maxX: 1, maxY: 6 });
    expect(v.scale).toBeCloseTo((600 * 0.9) / 6, 9);
  });

  it('fits a horizontal-only box (zero height) by its width', () => {
    const v = zoomExtents(base, { minX: -1, minY: 0, maxX: 3, maxY: 0 });
    expect(v.scale).toBeCloseTo(900 / 4, 9);
    expect(v.center).toEqual({ x: 1, y: 0 });
  });

  it('centers on a single point without changing scale', () => {
    const v = zoomExtents(base, { minX: 2, minY: 3, maxX: 2, maxY: 3 });
    expect(v.center).toEqual({ x: 2, y: 3 });
    expect(v.scale).toBe(100);
  });

  it('leaves the view unchanged for an empty drawing', () => {
    expect(zoomExtents(base, EMPTY_BBOX)).toEqual(base);
  });
});
