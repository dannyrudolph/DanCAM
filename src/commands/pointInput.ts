import { angleDeg, cosSinDeg } from '../geometry/angle';
import type { Vec2 } from '../geometry/vec';

/**
 * How the input boxes read a point that follows a base point:
 * polar (length, angle), delta (dX, dY from the base) or absolute (X, Y).
 * A point with no base is always absolute.
 */
export type EntryMode = 'polar' | 'delta' | 'absolute';

export type FieldKey = 'x' | 'y' | 'dx' | 'dy' | 'length' | 'angle';

/** Locked values: lengths in drawing units, angle in degrees. */
export type Locks = Partial<Record<FieldKey, number>>;

export type Tracking = {
  readonly ortho: boolean;
  readonly polar: boolean;
  /** Polar tracking increment, degrees. */
  readonly polarIncrementDeg: number;
};

/** Polar tracking catches the cursor within this many degrees of an increment. */
export const POLAR_CATCH_DEG = 3;

export function fieldsFor(base: Vec2 | undefined, mode: EntryMode): readonly FieldKey[] {
  if (!base || mode === 'absolute') return ['x', 'y'];
  return mode === 'polar' ? ['length', 'angle'] : ['dx', 'dy'];
}

/**
 * Applies Ortho or polar tracking to the cursor relative to `base`. Ortho wins
 * when both are on. Polar tracking only acts within POLAR_CATCH_DEG of an
 * increment, and keeps the cursor's projection onto the tracked ray.
 */
export function track(base: Vec2, cursor: Vec2, t: Tracking): Vec2 {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  if (t.ortho) {
    return Math.abs(dx) >= Math.abs(dy) ? { x: cursor.x, y: base.y } : { x: base.x, y: cursor.y };
  }
  if (t.polar && (dx !== 0 || dy !== 0)) {
    const a = angleDeg({ x: dx, y: dy });
    const snapped = Math.round(a / t.polarIncrementDeg) * t.polarIncrementDeg;
    if (Math.abs(a - snapped) <= POLAR_CATCH_DEG) {
      const [c, s] = cosSinDeg(snapped);
      const along = Math.max(0, dx * c + dy * s);
      return { x: base.x + along * c, y: base.y + along * s };
    }
  }
  return cursor;
}

/**
 * The point a click or Enter places: the cursor, constrained by Ortho or polar
 * tracking, then overridden by whichever values are locked.
 */
export function resolvePoint(
  cursor: Vec2,
  base: Vec2 | undefined,
  mode: EntryMode,
  locks: Locks,
  t: Tracking,
): Vec2 {
  if (!base || mode === 'absolute') {
    return { x: locks.x ?? cursor.x, y: locks.y ?? cursor.y };
  }
  const c = track(base, cursor, t);
  if (mode === 'delta') {
    return { x: base.x + (locks.dx ?? c.x - base.x), y: base.y + (locks.dy ?? c.y - base.y) };
  }
  // polar
  const vx = c.x - base.x;
  const vy = c.y - base.y;
  if (locks.angle !== undefined) {
    const [cs, sn] = cosSinDeg(locks.angle);
    const len = locks.length ?? Math.max(0, vx * cs + vy * sn);
    return { x: base.x + len * cs, y: base.y + len * sn };
  }
  if (locks.length !== undefined) {
    const d = Math.hypot(vx, vy);
    if (d === 0) return { x: base.x + locks.length, y: base.y };
    return { x: base.x + (vx / d) * locks.length, y: base.y + (vy / d) * locks.length };
  }
  return c;
}

/** The live value each box shows for a point, before it's locked. */
export function fieldValue(key: FieldKey, p: Vec2, base: Vec2 | undefined): number {
  const b = base ?? { x: 0, y: 0 };
  switch (key) {
    case 'x':
      return p.x;
    case 'y':
      return p.y;
    case 'dx':
      return p.x - b.x;
    case 'dy':
      return p.y - b.y;
    case 'length':
      return Math.hypot(p.x - b.x, p.y - b.y);
    case 'angle':
      return angleDeg({ x: p.x - b.x, y: p.y - b.y });
  }
}
