import { cosSinDeg } from './angle';
import { TOL } from './tolerance';
import { type Vec2, vecNearlyEqual } from './vec';

/** A construction line: infinite in both directions. `dir` is a unit vector. */
export type Xline = { readonly base: Vec2; readonly dir: Vec2 };

export function xlineAngle(p: Vec2, deg: number): Xline {
  const [c, s] = cosSinDeg(deg);
  return { base: p, dir: { x: c, y: s } };
}

export function xlineH(p: Vec2): Xline {
  return xlineAngle(p, 0);
}

export function xlineV(p: Vec2): Xline {
  return xlineAngle(p, 90);
}

/** Through two points, or undefined if they coincide. */
export function xline2P(a: Vec2, b: Vec2): Xline | undefined {
  if (vecNearlyEqual(a, b)) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  // Keep axis-aligned directions exact.
  const dir = dx === 0 ? { x: 0, y: Math.sign(dy) } : dy === 0 ? { x: Math.sign(dx), y: 0 } : { x: dx / len, y: dy / len };
  return { base: a, dir };
}

/**
 * A parallel copy of `x` at `dist`, on the side of `side`. Undefined when the
 * distance is not positive or `side` is on the line itself.
 */
export function offsetXline(x: Xline, dist: number, side: Vec2): Xline | undefined {
  if (dist <= TOL) return undefined;
  const c = x.dir.x * (side.y - x.base.y) - x.dir.y * (side.x - x.base.x);
  if (Math.abs(c) <= TOL) return undefined;
  const k = c > 0 ? dist : -dist; // positive cross: side is to the left of dir
  return { base: { x: x.base.x - x.dir.y * k, y: x.base.y + x.dir.x * k }, dir: x.dir };
}

export function distanceToXline(p: Vec2, x: Xline): number {
  return Math.abs(x.dir.x * (p.y - x.base.y) - x.dir.y * (p.x - x.base.x));
}
