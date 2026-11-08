import type { BBox } from './bbox';
import type { Vec2 } from './vec';

/**
 * Clips segment a→b to `box` (Liang–Barsky). Returns the visible part, or
 * undefined if none of it is inside. Endpoints already inside are returned
 * unchanged.
 */
export function clipSegment(a: Vec2, b: Vec2, box: BBox): [Vec2, Vec2] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return undefined;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return undefined;
      if (t < t1) t1 = t;
    }
  }
  const start = t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy };
  const end = t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy };
  return [start, end];
}
