import { ccwDeg } from './angle';
import { angleFrom, pointAtDeg } from './circle';
import { type Curve, nearestOnCurve } from './curve';
import { trimCurve } from './trim';
import { TOL } from './tolerance';
import { type Vec2, add, distance, scale } from './vec';

/**
 * Splits the curve in two at the point on it nearest `p`. Undefined for a
 * circle (it needs two points) or at an end, where there is nothing to split.
 */
export function breakAt(c: Curve, p: Vec2): [Curve, Curve] | undefined {
  if (c.kind === 'circle') return undefined;
  const q = nearestOnCurve(c, p);
  const r = trimCurve(c, [q], startSide(c, q));
  if (!r || r.kept.length !== 1) return undefined;
  return [r.removed, r.kept[0]!];
}

/**
 * Removes the part between the points on the curve nearest `p1` and `p2`
 * (a point past an end removes up to that end). On a circle the part
 * removed runs counter-clockwise from `p1` to `p2`. Returns what is kept:
 * one or two curves. Undefined when the points coincide.
 */
export function breakBetween(c: Curve, p1: Vec2, p2: Vec2): Curve[] | undefined {
  const q1 = nearestOnCurve(c, p1);
  const q2 = nearestOnCurve(c, p2);
  if (distance(q1, q2) <= TOL) return undefined;
  const r = trimCurve(c, [q1, q2], between(c, q1, q2));
  return r && [...r.kept];
}

/** A point on the curve between two of its points (for a circle, CCW from the first). */
function between(c: Curve, q1: Vec2, q2: Vec2): Vec2 {
  if (c.kind === 'circle' || c.kind === 'arc') {
    const a1 = angleFrom(c.center, q1);
    const a2 = angleFrom(c.center, q2);
    // On an arc, the stretch between them is the one inside the arc's sweep.
    const from = c.kind === 'arc' && ccwDeg(c.startDeg, a2) < ccwDeg(c.startDeg, a1) ? a2 : a1;
    const to = from === a1 ? a2 : a1;
    return pointAtDeg(c.center, c.radius, from + ccwDeg(from, to) / 2);
  }
  return scale(add(q1, q2), 0.5);
}

/** A point on the curve just before `q`, toward the curve's start (or anywhere for an xline). */
function startSide(c: Curve, q: Vec2): Vec2 {
  if (c.kind === 'arc') return pointAtDeg(c.center, c.radius, c.startDeg + ccwDeg(c.startDeg, angleFrom(c.center, q)) / 2);
  if (c.kind === 'segment') return scale(add(c.a, q), 0.5);
  if (c.kind === 'ray') return scale(add(c.base, q), 0.5);
  return add(q, c.kind === 'xline' ? c.dir : { x: 0, y: 0 }); // circles never get here
}

