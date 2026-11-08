import { describe, expect, it } from 'vitest';
import { EMPTY_BBOX, center, extend, fromPoints, height, isEmpty, union, width } from './bbox';

describe('bounding boxes', () => {
  it('from 0 points is empty with zero size', () => {
    const b = fromPoints([]);
    expect(isEmpty(b)).toBe(true);
    expect(width(b)).toBe(0);
    expect(height(b)).toBe(0);
  });

  it('from 1 point is that point, not empty, with zero size', () => {
    const b = fromPoints([{ x: 2, y: -1 }]);
    expect(b).toEqual({ minX: 2, minY: -1, maxX: 2, maxY: -1 });
    expect(isEmpty(b)).toBe(false);
  });

  it('from 2 points spans both regardless of order', () => {
    expect(fromPoints([{ x: 3, y: 1 }, { x: -1, y: 4 }])).toEqual({ minX: -1, minY: 1, maxX: 3, maxY: 4 });
  });

  it('from N points has the outermost coordinates on each side', () => {
    const b = fromPoints([
      { x: 0, y: 0 },
      { x: 2, y: 0.125 },
      { x: 0.5, y: 0.25 },
      { x: -0.1, y: 0 },
    ]);
    expect(b).toEqual({ minX: -0.1, minY: 0, maxX: 2, maxY: 0.25 });
    expect(width(b)).toBeCloseTo(2.1, 15);
    expect(height(b)).toBe(0.25);
    expect(center(b)).toEqual({ x: 0.95, y: 0.125 });
  });

  it('union with the empty box returns the other box unchanged', () => {
    const b = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
    expect(union(EMPTY_BBOX, b)).toEqual(b);
    expect(union(b, EMPTY_BBOX)).toEqual(b);
  });

  it('union of two boxes covers both', () => {
    expect(union({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { minX: 2, minY: -1, maxX: 3, maxY: 0.5 })).toEqual({
      minX: 0,
      minY: -1,
      maxX: 3,
      maxY: 1,
    });
  });

  it('extend leaves the box alone for a point already inside', () => {
    const b = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    expect(extend(b, { x: 1, y: 1 })).toEqual(b);
  });
});
