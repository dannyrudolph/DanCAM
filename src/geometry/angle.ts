import type { Vec2 } from './vec';

/** Degrees in [0, 360). */
export function normDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r === 0 ? 0 : r; // `=== 0` turns -0 into 0
}

/**
 * cos and sin of an angle in degrees, exact at multiples of 90°, so a locked
 * 90° segment has exactly the base X rather than X + 6e-17 * length.
 */
export function cosSinDeg(deg: number): [number, number] {
  const r = normDeg(deg);
  if (r === 0) return [1, 0];
  if (r === 90) return [0, 1];
  if (r === 180) return [-1, 0];
  if (r === 270) return [0, -1];
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** Angle of v in degrees, in [0, 360). Exact for axis-aligned vectors. */
export function angleDeg(v: Vec2): number {
  if (v.y === 0) return v.x < 0 ? 180 : 0;
  if (v.x === 0) return v.y > 0 ? 90 : 270;
  const a = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

/** Counter-clockwise sweep from `fromDeg` to `toDeg`, in [0, 360). */
export function ccwDeg(fromDeg: number, toDeg: number): number {
  return normDeg(toDeg - fromDeg);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
