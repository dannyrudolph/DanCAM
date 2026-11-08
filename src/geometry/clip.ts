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

/**
 * Clips the infinite line through `p` with direction `d` to `box`. Returns the
 * visible segment, or undefined if the line misses the box or `d` is zero.
 */
export function clipLine(p: Vec2, d: Vec2, box: BBox): [Vec2, Vec2] | undefined {
  let t0 = -Infinity;
  let t1 = Infinity;
  const edges: [number, number][] = [
    [-d.x, p.x - box.minX],
    [d.x, box.maxX - p.x],
    [-d.y, p.y - box.minY],
    [d.y, box.maxY - p.y],
  ];
  for (const [a, q] of edges) {
    if (a === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / a;
    if (a < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (!(t0 <= t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return undefined;
  return [
    { x: p.x + t0 * d.x, y: p.y + t0 * d.y },
    { x: p.x + t1 * d.x, y: p.y + t1 * d.y },
  ];
}
