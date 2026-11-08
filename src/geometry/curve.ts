import { type Arc, arcContainsDeg, arcEnd, arcStart } from './arc';
import { angleFrom, nearestOnCircle } from './circle';
import { circleCircle, lineCircle, lineLine } from './intersect';
import { TOL } from './tolerance';
import { type Vec2, distance, dot, sub } from './vec';

/**
 * A curve with its real extent, for snapping: where two objects actually
 * meet, the nearest point on one, and so on. Segments end at `a` and `b`;
 * rays start at `base` and run along `dir`; xlines run both ways; arcs run
 * counter-clockwise from `startDeg` to `endDeg`.
 */
export type Curve =
  | { readonly kind: 'segment'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'ray'; readonly base: Vec2; readonly dir: Vec2 }
  | { readonly kind: 'xline'; readonly base: Vec2; readonly dir: Vec2 }
  | ({ readonly kind: 'circle' } & { readonly center: Vec2; readonly radius: number })
  | ({ readonly kind: 'arc' } & Arc);

type Straight = Extract<Curve, { kind: 'segment' | 'ray' | 'xline' }>;
type Round = Extract<Curve, { kind: 'circle' | 'arc' }>;

function isStraight(c: Curve): c is Straight {
  return c.kind === 'segment' || c.kind === 'ray' || c.kind === 'xline';
}

/** A point and direction for the infinite line a straight curve lies on. */
function carrier(c: Straight): { p: Vec2; d: Vec2 } {
  return c.kind === 'segment' ? { p: c.a, d: sub(c.b, c.a) } : { p: c.base, d: c.dir };
}

/**
 * True when `q`, already known to lie on the curve's carrier line or circle,
 * falls within the curve's extent. An end within TOL counts as on it.
 */
function withinExtent(c: Curve, q: Vec2): boolean {
  switch (c.kind) {
    case 'xline':
    case 'circle':
      return true;
    case 'ray':
      return dot(sub(q, c.base), c.dir) >= 0 || distance(q, c.base) <= TOL;
    case 'segment': {
      const d = sub(c.b, c.a);
      const t = dot(sub(q, c.a), d);
      return (t >= 0 && t <= dot(d, d)) || distance(q, c.a) <= TOL || distance(q, c.b) <= TOL;
    }
    case 'arc':
      return arcContainsDeg(c, angleFrom(c.center, q)) || distance(q, arcStart(c)) <= TOL || distance(q, arcEnd(c)) <= TOL;
  }
}

/** Every point where `c1` and `c2` meet, within both extents. A tangent touch gives one point. */
export function intersectCurves(c1: Curve, c2: Curve): Vec2[] {
  let candidates: Vec2[];
  if (isStraight(c1) && isStraight(c2)) {
    const l1 = carrier(c1);
    const l2 = carrier(c2);
    const p = lineLine(l1.p, l1.d, l2.p, l2.d);
    candidates = p ? [p] : [];
  } else if (isStraight(c1)) {
    const l = carrier(c1);
    const r = c2 as Round;
    candidates = lineCircle(l.p, l.d, r.center, r.radius);
  } else if (isStraight(c2)) {
    return intersectCurves(c2, c1);
  } else {
    candidates = circleCircle(c1.center, c1.radius, c2.center, c2.radius);
  }
  return candidates.filter((q) => withinExtent(c1, q) && withinExtent(c2, q));
}

/** The foot of the perpendicular from `p` to the infinite line through `base` along `d`. */
function footOnLine(p: Vec2, base: Vec2, d: Vec2): Vec2 {
  const dd = dot(d, d);
  if (dd === 0) return base;
  const t = dot(sub(p, base), d) / dd;
  return { x: base.x + d.x * t, y: base.y + d.y * t };
}

/** The point on the curve closest to `p`. */
export function nearestOnCurve(c: Curve, p: Vec2): Vec2 {
  switch (c.kind) {
    case 'xline':
      return footOnLine(p, c.base, c.dir);
    case 'ray': {
      const f = footOnLine(p, c.base, c.dir);
      return withinExtent(c, f) ? f : c.base;
    }
    case 'segment': {
      const f = footOnLine(p, c.a, sub(c.b, c.a));
      if (withinExtent(c, f)) return f;
      return distance(p, c.a) <= distance(p, c.b) ? c.a : c.b;
    }
    case 'circle':
      return nearestOnCircle(c.center, c.radius, p);
    case 'arc': {
      const q = nearestOnCircle(c.center, c.radius, p);
      if (distance(p, c.center) > 0 && withinExtent(c, q)) return q;
      const s = arcStart(c);
      const e = arcEnd(c);
      return distance(p, s) <= distance(p, e) ? s : e;
    }
  }
}

/**
 * Points on the curve where a line from `from` meets it at a right angle,
 * within the curve's extent: one foot for a straight curve, the two ends of
 * the diameter through `from` for a circle or arc. None when `from` is the
 * center.
 */
export function perpendicularFeet(c: Curve, from: Vec2): Vec2[] {
  if (isStraight(c)) {
    const l = carrier(c);
    const f = footOnLine(from, l.p, l.d);
    return withinExtent(c, f) ? [f] : [];
  }
  const d = distance(from, c.center);
  if (d <= TOL) return [];
  const ux = (from.x - c.center.x) / d;
  const uy = (from.y - c.center.y) / d;
  const near = { x: c.center.x + ux * c.radius, y: c.center.y + uy * c.radius };
  const far = { x: c.center.x - ux * c.radius, y: c.center.y - uy * c.radius };
  return [near, far].filter((q) => withinExtent(c, q));
}

/**
 * Points on a circle or arc where a line from `from` touches it, within the
 * arc's extent. Two for a point outside, one for a point on the curve (itself),
 * none inside or for straight curves.
 */
export function tangentPointsFrom(c: Curve, from: Vec2): Vec2[] {
  if (isStraight(c)) return [];
  const d = distance(from, c.center);
  if (Math.abs(d - c.radius) <= TOL) return withinExtent(c, from) ? [from] : [];
  if (d < c.radius) return [];
  // The tangent points are where the circle meets the circle on center–from as a diameter.
  const ux = (from.x - c.center.x) / d;
  const uy = (from.y - c.center.y) / d;
  const a = (c.radius * c.radius) / d; // along center → from
  const h = Math.sqrt(Math.max(0, c.radius * c.radius - a * a));
  const foot = { x: c.center.x + ux * a, y: c.center.y + uy * a };
  const pts = [
    { x: foot.x - uy * h, y: foot.y + ux * h },
    { x: foot.x + uy * h, y: foot.y - ux * h },
  ];
  return pts.filter((q) => withinExtent(c, q));
}
