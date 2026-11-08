import { angleDeg, cosSinDeg } from './angle';
import { distanceToLine } from './distance';
import { TOL } from './tolerance';
import { type Vec2, distance, vecNearlyEqual } from './vec';

export type Circle = { readonly center: Vec2; readonly radius: number };

/** The point on a circle at `deg` (counter-clockwise from +X). Exact at quadrants. */
export function pointAtDeg(center: Vec2, radius: number, deg: number): Vec2 {
  const [c, s] = cosSinDeg(deg);
  return { x: center.x + radius * c, y: center.y + radius * s };
}

/** Angle of `p` seen from `center`, degrees in [0, 360). */
export function angleFrom(center: Vec2, p: Vec2): number {
  return angleDeg({ x: p.x - center.x, y: p.y - center.y });
}

/** Circle with `a`-`b` as a diameter, or undefined if they coincide. */
export function circle2P(a: Vec2, b: Vec2): Circle | undefined {
  if (vecNearlyEqual(a, b)) return undefined;
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, radius: distance(a, b) / 2 };
}

/** Circle through three points, or undefined if any two coincide or all three are collinear. */
export function circle3P(a: Vec2, b: Vec2, c: Vec2): Circle | undefined {
  if (vecNearlyEqual(a, b) || vecNearlyEqual(b, c) || vecNearlyEqual(a, c)) return undefined;
  if (distanceToLine(c, a, b) <= TOL) return undefined;
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { center: { x: a.x + ux, y: a.y + uy }, radius: Math.hypot(ux, uy) };
}

/** The point on the circle nearest `p`. A point at the center maps to angle 0. */
export function nearestOnCircle(center: Vec2, radius: number, p: Vec2): Vec2 {
  const d = distance(center, p);
  if (d === 0) return { x: center.x + radius, y: center.y };
  return { x: center.x + ((p.x - center.x) / d) * radius, y: center.y + ((p.y - center.y) / d) * radius };
}
