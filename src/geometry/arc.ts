import { ccwDeg, cosSinDeg, degToRad, normDeg } from './angle';
import { type Circle, angleFrom, circle3P, pointAtDeg } from './circle';
import { TOL } from './tolerance';
import { type Vec2, distance, vecNearlyEqual } from './vec';

/**
 * An arc runs counter-clockwise from `startDeg` to `endDeg`. Angles are degrees
 * in [0, 360), counter-clockwise from +X, as in DXF.
 */
export type Arc = Circle & { readonly startDeg: number; readonly endDeg: number };

/** Counter-clockwise sweep in degrees, in (0, 360]. Equal start and end mean a full turn. */
export function arcSweepDeg(a: Arc): number {
  return ccwDeg(a.startDeg, a.endDeg) || 360;
}

export function arcStart(a: Arc): Vec2 {
  return pointAtDeg(a.center, a.radius, a.startDeg);
}

export function arcEnd(a: Arc): Vec2 {
  return pointAtDeg(a.center, a.radius, a.endDeg);
}

export function arcMid(a: Arc): Vec2 {
  return pointAtDeg(a.center, a.radius, a.startDeg + arcSweepDeg(a) / 2);
}

export function arcLength(a: Arc): number {
  return a.radius * degToRad(arcSweepDeg(a));
}

/** True when the direction `deg` from the center falls on the arc (ends included). */
export function arcContainsDeg(a: Arc, deg: number): boolean {
  return ccwDeg(a.startDeg, deg) <= arcSweepDeg(a);
}

/** Unit tangent at `deg`, pointing counter-clockwise (the arc's own direction). */
export function ccwTangentAt(deg: number): Vec2 {
  const [c, s] = cosSinDeg(deg);
  return { x: -s, y: c };
}

function make(center: Vec2, radius: number, startDeg: number, endDeg: number): Arc | undefined {
  const s = normDeg(startDeg);
  const e = normDeg(endDeg);
  if (radius <= TOL) return undefined;
  if (vecNearlyEqual(pointAtDeg(center, radius, s), pointAtDeg(center, radius, e))) return undefined;
  return { center, radius, startDeg: s, endDeg: e };
}

/** Arc from `s` through `m` to `e`. Undefined when the points are collinear or coincide. */
export function arc3P(s: Vec2, m: Vec2, e: Vec2): Arc | undefined {
  const c = circle3P(s, m, e);
  if (!c) return undefined;
  const as = angleFrom(c.center, s);
  const am = angleFrom(c.center, m);
  const ae = angleFrom(c.center, e);
  // Travelling CCW from s, we must meet m before e; otherwise the arc runs CW, so store it e → s.
  return ccwDeg(as, am) < ccwDeg(as, ae) ? make(c.center, c.radius, as, ae) : make(c.center, c.radius, ae, as);
}

/**
 * Start-Center-End, counter-clockwise. The radius comes from start and center;
 * `e` only sets the end angle, as in AutoCAD.
 */
export function arcSCE(s: Vec2, c: Vec2, e: Vec2): Arc | undefined {
  if (vecNearlyEqual(e, c)) return undefined;
  return make(c, distance(s, c), angleFrom(c, s), angleFrom(c, e));
}

/**
 * Start-Center-included Angle. Positive angles run counter-clockwise from the
 * start, negative ones clockwise. |angle| must be below 360.
 */
export function arcSCA(s: Vec2, c: Vec2, includedDeg: number): Arc | undefined {
  if (Math.abs(includedDeg) >= 360) return undefined;
  const as = angleFrom(c, s);
  const r = distance(s, c);
  return includedDeg > 0 ? make(c, r, as, as + includedDeg) : make(c, r, as + includedDeg, as);
}

/**
 * Start-End-Radius: the minor arc (at most 180°) between `s` and `e`, bulging
 * toward `side`. Undefined when the chord is longer than the diameter.
 */
export function arcSER(s: Vec2, e: Vec2, radius: number, side: Vec2): Arc | undefined {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= TOL || radius <= TOL || chord > 2 * radius + TOL) return undefined;
  const half = chord / 2;
  const h = Math.sqrt(Math.max(0, radius * radius - half * half));
  const nx = -dy / chord; // left normal of s → e
  const ny = dx / chord;
  const leftBulge = dx * (side.y - s.y) - dy * (side.x - s.x) >= 0;
  const k = leftBulge ? -h : h; // center sits opposite the bulge
  const c = { x: s.x + dx / 2 + nx * k, y: s.y + dy / 2 + ny * k };
  const as = angleFrom(c, s);
  const ae = angleFrom(c, e);
  // A left bulge means turning clockwise from s to e, so the CCW arc runs e → s.
  return leftBulge ? make(c, radius, ae, as) : make(c, radius, as, ae);
}

/**
 * The arc that leaves `s` heading along `dir` and ends at `e`. Undefined when
 * `e` lies on the tangent line (the "arc" would be straight). `reversed` is
 * true when the arc is travelled clockwise, so the stored CCW arc runs e → s.
 */
export function arcTangentFrom(s: Vec2, dir: Vec2, e: Vec2): { arc: Arc; reversed: boolean } | undefined {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0) return undefined;
  const nx = -dir.y / len;
  const ny = dir.x / len;
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const nd = nx * dx + ny * dy;
  if (Math.abs(nd) <= TOL) return undefined;
  const t = (dx * dx + dy * dy) / (2 * nd);
  const c = { x: s.x + nx * t, y: s.y + ny * t };
  const r = Math.abs(t);
  const as = angleFrom(c, s);
  const ae = angleFrom(c, e);
  const arc = t > 0 ? make(c, r, as, ae) : make(c, r, ae, as);
  return arc && { arc, reversed: t < 0 };
}
