import { describe, expect, it } from 'vitest';
import { polarArray, rectangularArray } from './array';
import { transformPoint } from './transform';
import type { Vec2 } from './vec';

const v = (x: number, y: number): Vec2 => ({ x, y });

describe('rectangularArray', () => {
  it('places rows × columns minus the original, spacing signs giving the direction', () => {
    const ts = rectangularArray(2, 3, -0.5, 0.25);
    expect(ts.map((t) => transformPoint(t, v(0, 0)))).toEqual([v(0.25, 0), v(0.5, 0), v(0, -0.5), v(0.25, -0.5), v(0.5, -0.5)]);
  });

  it('is empty for one cell', () => {
    expect(rectangularArray(1, 1, 1, 1)).toEqual([]);
  });
});

describe('polarArray', () => {
  it('spaces a full circle evenly, rotating items', () => {
    const ts = polarArray(v(0, 0), 4, 360, true, v(1, 0));
    expect(ts.map((t) => transformPoint(t, v(1, 0)))).toEqual([v(0, 1), v(-1, 0), v(0, -1)]);
    expect(ts[0]).toEqual({ kind: 'rotate', center: v(0, 0), deg: 90 });
  });

  it('puts the last item at the end of a partial fill, and turns clockwise for a negative fill', () => {
    expect(polarArray(v(0, 0), 3, 180, true, v(1, 0)).map((t) => transformPoint(t, v(1, 0)))).toEqual([v(0, 1), v(-1, 0)]);
    expect(polarArray(v(0, 0), 2, -90, true, v(1, 0)).map((t) => transformPoint(t, v(1, 0)))).toEqual([v(0, -1)]);
  });

  it('moves without turning when items are not rotated', () => {
    const [t] = polarArray(v(0, 0), 2, 360, false, v(1, 0));
    expect(t).toEqual({ kind: 'translate', dx: -2, dy: 0 });
  });
});
