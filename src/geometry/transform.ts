import { angleDeg, cosSinDeg, normDeg } from './angle';
import type { Arc } from './arc';
import type { Vec2 } from './vec';

/**
 * A rigid or similarity transform for Move, Copy, Rotate, Mirror and Scale.
 * Each kind maps angles directly (adding the rotation, reflecting about the
 * mirror line) rather than re-deriving them from transformed points, so a
 * move never perturbs a stored angle.
 */
export type Transform =
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'rotate'; readonly center: Vec2; readonly deg: number }
  /** Mirror about the line through `a` at `deg`. */
  | { readonly kind: 'mirror'; readonly a: Vec2; readonly deg: number }
  | { readonly kind: 'scale'; readonly center: Vec2; readonly factor: number };

export function translation(from: Vec2, to: Vec2): Transform {
  return { kind: 'translate', dx: to.x - from.x, dy: to.y - from.y };
}

export function rotation(center: Vec2, deg: number): Transform {
  return { kind: 'rotate', center, deg };
}

/** Mirror about the line through `a` and `b`; undefined when they coincide. */
export function mirrorLine(a: Vec2, b: Vec2): Transform | undefined {
  if (a.x === b.x && a.y === b.y) return undefined;
  return { kind: 'mirror', a, deg: angleDeg({ x: b.x - a.x, y: b.y - a.y }) };
}

/** Uniform scale about `center`; undefined unless the factor is positive. */
export function scaling(center: Vec2, factor: number): Transform | undefined {
  return factor > 0 && Number.isFinite(factor) ? { kind: 'scale', center, factor } : undefined;
}

/** Rotates the vector `v` by `deg`, exact at multiples of 90°. */
function rotateVec(v: Vec2, deg: number): Vec2 {
  const [c, s] = cosSinDeg(deg);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Reflects the vector `v` about a line at `deg`: a rotation by twice the angle of the flipped vector. */
function reflectVec(v: Vec2, deg: number): Vec2 {
  const [c, s] = cosSinDeg(2 * deg);
  return { x: v.x * c + v.y * s, y: v.x * s - v.y * c };
}

export function transformPoint(t: Transform, p: Vec2): Vec2 {
  switch (t.kind) {
    case 'translate':
      return { x: p.x + t.dx, y: p.y + t.dy };
    case 'rotate': {
      const r = rotateVec({ x: p.x - t.center.x, y: p.y - t.center.y }, t.deg);
      return { x: t.center.x + r.x, y: t.center.y + r.y };
    }
    case 'mirror': {
      // Horizontal and vertical mirror lines keep the untouched coordinate exact.
      const d = normDeg(t.deg) % 180;
      if (d === 0) return { x: p.x, y: 2 * t.a.y - p.y };
      if (d === 90) return { x: 2 * t.a.x - p.x, y: p.y };
      const r = reflectVec({ x: p.x - t.a.x, y: p.y - t.a.y }, t.deg);
      return { x: t.a.x + r.x, y: t.a.y + r.y };
    }
    case 'scale':
      return { x: t.center.x + (p.x - t.center.x) * t.factor, y: t.center.y + (p.y - t.center.y) * t.factor };
  }
}

/** A direction vector under the transform (positions and scale don't affect it). */
export function transformDir(t: Transform, v: Vec2): Vec2 {
  switch (t.kind) {
    case 'translate':
    case 'scale':
      return v;
    case 'rotate':
      return rotateVec(v, t.deg);
    case 'mirror': {
      const d = normDeg(t.deg) % 180;
      if (d === 0) return { x: v.x, y: -v.y };
      if (d === 90) return { x: -v.x, y: v.y };
      return reflectVec(v, t.deg);
    }
  }
}

/** A direction angle in degrees under the transform, in [0, 360). */
export function transformAngle(t: Transform, deg: number): number {
  switch (t.kind) {
    case 'translate':
    case 'scale':
      return deg;
    case 'rotate':
      return normDeg(deg + t.deg);
    case 'mirror':
      return normDeg(2 * t.deg - deg);
  }
}

export function transformLength(t: Transform, len: number): number {
  return t.kind === 'scale' ? len * t.factor : len;
}

/**
 * An arc under the transform. A mirror reverses the direction of travel, so
 * the mirrored end becomes the new start, keeping the arc counter-clockwise.
 */
export function transformArc(t: Transform, a: Arc): Arc {
  const center = transformPoint(t, a.center);
  const radius = transformLength(t, a.radius);
  const s = transformAngle(t, a.startDeg);
  const e = transformAngle(t, a.endDeg);
  return t.kind === 'mirror' ? { center, radius, startDeg: e, endDeg: s } : { center, radius, startDeg: s, endDeg: e };
}
