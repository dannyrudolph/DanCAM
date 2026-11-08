import { xline2P } from './xline';
import type { Vec2 } from './vec';

/** A ray: starts at `base` and runs forever along `dir`, a unit vector. */
export type Ray = { readonly base: Vec2; readonly dir: Vec2 };

/** From `a` through `b`, or undefined if they coincide. Axis-aligned directions stay exact. */
export function ray2P(a: Vec2, b: Vec2): Ray | undefined {
  return xline2P(a, b);
}

/** Distance from `p` to the ray: perpendicular beside it, to the base behind it. */
export function distanceToRay(p: Vec2, r: Ray): number {
  const dx = p.x - r.base.x;
  const dy = p.y - r.base.y;
  if (dx * r.dir.x + dy * r.dir.y <= 0) return Math.hypot(dx, dy);
  return Math.abs(r.dir.x * dy - r.dir.y * dx);
}
