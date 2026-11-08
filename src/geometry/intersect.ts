import { TOL } from './tolerance';
import { type Vec2, cross, dot, sub } from './vec';

/**
 * Intersections of infinite lines and full circles. Lines are given by a point
 * and a direction (any length); circles by center and radius. Touching within
 * TOL counts as tangent and returns one point.
 */

export function lineLine(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | undefined {
  const den = cross(d1, d2);
  const l1 = Math.hypot(d1.x, d1.y);
  const l2 = Math.hypot(d2.x, d2.y);
  // Parallel when the unit directions' cross product is below TOL per unit length.
  if (l1 === 0 || l2 === 0 || Math.abs(den) <= TOL * l1 * l2) return undefined;
  const t = cross(sub(p2, p1), d2) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

export function lineCircle(p: Vec2, d: Vec2, center: Vec2, r: number): Vec2[] {
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return [];
  const ux = d.x / len;
  const uy = d.y / len;
  const t0 = dot(sub(center, p), { x: ux, y: uy });
  const foot = { x: p.x + ux * t0, y: p.y + uy * t0 };
  const dist = Math.hypot(center.x - foot.x, center.y - foot.y);
  if (dist > r + TOL) return [];
  if (Math.abs(dist - r) <= TOL) return [foot];
  const h = Math.sqrt(r * r - dist * dist);
  return [
    { x: foot.x - ux * h, y: foot.y - uy * h },
    { x: foot.x + ux * h, y: foot.y + uy * h },
  ];
}

export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d <= TOL) return []; // concentric: none, or infinitely many
  if (d > r1 + r2 + TOL || d < Math.abs(r1 - r2) - TOL) return [];
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const ux = dx / d;
  const uy = dy / d;
  const foot = { x: c1.x + ux * a, y: c1.y + uy * a };
  if (Math.abs(d - (r1 + r2)) <= TOL || Math.abs(d - Math.abs(r1 - r2)) <= TOL) return [foot];
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  return [
    { x: foot.x + uy * h, y: foot.y - ux * h },
    { x: foot.x - uy * h, y: foot.y + ux * h },
  ];
}
