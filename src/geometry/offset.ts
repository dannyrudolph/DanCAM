import type { Curve } from './curve';
import { TOL } from './tolerance';
import { type Vec2, cross, distance, length, scale, sub } from './vec';

/**
 * The curve moved `dist` toward `side`: lines, rays and xlines sideways
 * (same length and direction), circles and arcs concentrically (same
 * angles). Undefined when `side` is on the curve, or an arc or circle would
 * shrink to radius TOL or less.
 */
export function offsetCurve(c: Curve, dist: number, side: Vec2): Curve | undefined {
  switch (c.kind) {
    case 'segment':
    case 'ray':
    case 'xline': {
      const p = c.kind === 'segment' ? c.a : c.base;
      const d = c.kind === 'segment' ? sub(c.b, c.a) : c.dir;
      const s = cross(d, sub(side, p));
      if (Math.abs(s) / length(d) <= TOL) return undefined;
      const u = scale(d, 1 / length(d));
      const n = scale({ x: -u.y, y: u.x }, Math.sign(s) * dist);
      // Axis-aligned normals are exact, so a horizontal line moves by exactly `dist`.
      const shift = (q: Vec2): Vec2 => ({ x: n.x === 0 ? q.x : q.x + n.x, y: n.y === 0 ? q.y : q.y + n.y });
      return c.kind === 'segment' ? { kind: 'segment', a: shift(c.a), b: shift(c.b) } : { ...c, base: shift(c.base) };
    }
    case 'circle':
    case 'arc': {
      const d = distance(side, c.center);
      if (Math.abs(d - c.radius) <= TOL) return undefined;
      const radius = d > c.radius ? c.radius + dist : c.radius - dist;
      return radius > TOL ? { ...c, radius } : undefined;
    }
  }
}

/** The offset that passes through `p`: its distance is `p`'s distance from the curve's line or circle. */
export function offsetThrough(c: Curve, p: Vec2): Curve | undefined {
  if (c.kind === 'circle' || c.kind === 'arc') return offsetCurve(c, Math.abs(distance(p, c.center) - c.radius), p);
  const base = c.kind === 'segment' ? c.a : c.base;
  const d = c.kind === 'segment' ? sub(c.b, c.a) : c.dir;
  return offsetCurve(c, Math.abs(cross(d, sub(p, base))) / length(d), p);
}

