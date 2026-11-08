import { describe, expect, it } from 'vitest';
import { clipRay } from './clip';
import { distanceToRay, ray2P } from './ray';

describe('ray', () => {
  it('runs from the first point through the second, exact when vertical', () => {
    expect(ray2P({ x: 0.1, y: 0 }, { x: 0.1, y: -3 })).toEqual({ base: { x: 0.1, y: 0 }, dir: { x: 0, y: -1 } });
    expect(ray2P({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeUndefined();
  });

  it('measures perpendicular distance beside it and distance to the base behind it', () => {
    const r = { base: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
    expect(distanceToRay({ x: 5, y: 2 }, r)).toBe(2);
    expect(distanceToRay({ x: -3, y: 4 }, r)).toBe(5);
  });

  it('clips to the box starting at its base, and misses when pointing away', () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(clipRay({ x: 5, y: 5 }, { x: 1, y: 0 }, box)).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(clipRay({ x: -5, y: 5 }, { x: 1, y: 0 }, box)).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    expect(clipRay({ x: -5, y: 5 }, { x: -1, y: 0 }, box)).toBeUndefined();
  });
});
