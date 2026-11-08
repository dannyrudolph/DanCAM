import { type Arc, arcEnd, arcStart } from './arc';
import { ccwDeg, cosSinDeg } from './angle';
import { angleFrom } from './circle';
import type { Curve } from './curve';
import { circleCircle, lineCircle, lineLine } from './intersect';
import { TOL } from './tolerance';
import { type Vec2, add, cross, distance, dot, length, scale, sub } from './vec';

/**
 * Fillet and chamfer: a corner made between two curves, each cut back (or
 * run on) to where the corner meets it, keeping the side that was picked.
 * `first` / `second` are the reshaped curves; undefined for a circle, which
 * is never trimmed.
 */
export type Corner = {
  readonly first: Curve | undefined;
  readonly second: Curve | undefined;
  /** The fillet arc or chamfer line; none for a sharp corner (radius or distances 0). */
  readonly joint: Curve | undefined;
};

type Straight = Extract<Curve, { kind: 'segment' | 'ray' | 'xline' }>;
type Round = Extract<Curve, { kind: 'circle' | 'arc' }>;

const isStraight = (c: Curve): c is Straight => c.kind === 'segment' || c.kind === 'ray' || c.kind === 'xline';

/** A point on the curve's infinite line and its unit direction. */
function carrier(c: Straight): { p: Vec2; u: Vec2 } {
  const d = c.kind === 'segment' ? sub(c.b, c.a) : c.dir;
  return { p: c.kind === 'segment' ? c.a : c.base, u: scale(d, 1 / length(d)) };
}

function foot(q: Vec2, p: Vec2, u: Vec2): Vec2 {
  return add(p, scale(u, dot(sub(q, p), u)));
}

/**
 * The straight curve cut at `t` (a point on its line), keeping the part on
 * the `keep` side of `t`. An xline becomes a ray; a ray running away from
 * the kept side becomes a line. Undefined when nothing longer than TOL is
 * left on that side.
 */
function cutStraight(c: Straight, t: Vec2, keep: Vec2): Curve | undefined {
  switch (c.kind) {
    case 'xline':
      return { kind: 'ray', base: t, dir: dot(c.dir, keep) > 0 ? c.dir : scale(c.dir, -1) };
    case 'ray':
      if (dot(c.dir, keep) > 0) return { kind: 'ray', base: t, dir: c.dir };
      return dot(sub(c.base, t), keep) > TOL ? { kind: 'segment', a: c.base, b: t } : undefined;
    case 'segment': {
      const ka = dot(sub(c.a, t), keep);
      const kb = dot(sub(c.b, t), keep);
      if (Math.max(ka, kb) <= TOL) return undefined;
      return ka >= kb ? { kind: 'segment', a: c.a, b: t } : { kind: 'segment', a: t, b: c.b };
    }
  }
}

/**
 * The arc with one end moved to `t` (on its circle), keeping the picked
 * part: of the two arcs that keep one original end, the one containing the
 * pick, and of those the shorter (so an end is run on the short way round).
 */
function cutArc(a: Arc, t: Vec2, pick: Vec2): Curve {
  const deg = angleFrom(a.center, t);
  const arc = (startDeg: number, endDeg: number): Curve => ({ kind: 'arc', center: a.center, radius: a.radius, startDeg, endDeg });
  if (distance(t, arcStart(a)) <= TOL || distance(t, arcEnd(a)) <= TOL) return arc(a.startDeg, a.endDeg);
  const pickDeg = angleFrom(a.center, pick);
  const options = [
    { s: a.startDeg, e: deg },
    { s: deg, e: a.endDeg },
  ].map((o) => ({ ...o, sweep: ccwDeg(o.s, o.e), holds: ccwDeg(o.s, pickDeg) <= ccwDeg(o.s, o.e) }));
  const pool = options.some((o) => o.holds) ? options.filter((o) => o.holds) : options;
  const best = pool.reduce((x, y) => (y.sweep < x.sweep ? y : x));
  return arc(best.s, best.e);
}

/** Cuts `c` at `t`: a straight curve keeps its part along `keep`, an arc the part with `pick`. */
function cutAt(c: Curve, t: Vec2, pick: Vec2, keep: Vec2): Curve | undefined {
  if (isStraight(c)) return cutStraight(c, t, keep);
  if (c.kind === 'arc') return cutArc(c, t, pick);
  return undefined; // circles stay whole
}

/** Which side of the curve `q` is on: left/right of a line, outside/inside a circle; 0 on it. */
function side(c: Curve, q: Vec2): number {
  if (isStraight(c)) {
    const { p, u } = carrier(c);
    const s = cross(u, sub(q, p));
    return Math.abs(s) <= TOL ? 0 : Math.sign(s);
  }
  const s = distance(q, c.center) - c.radius;
  return Math.abs(s) <= TOL ? 0 : Math.sign(s);
}

/** Curves at distance `r` from `c` (both sides), as lines or full circles. */
function offsets(c: Curve, r: number): ({ kind: 'line'; p: Vec2; u: Vec2 } | { kind: 'circle'; center: Vec2; radius: number })[] {
  if (isStraight(c)) {
    const { p, u } = carrier(c);
    const n = { x: -u.y, y: u.x };
    return [
      { kind: 'line', p: add(p, scale(n, r)), u },
      { kind: 'line', p: sub(p, scale(n, r)), u },
    ];
  }
  const rc = c as Round;
  const out: { kind: 'circle'; center: Vec2; radius: number }[] = [{ kind: 'circle', center: rc.center, radius: rc.radius + r }];
  if (Math.abs(rc.radius - r) > TOL) out.push({ kind: 'circle', center: rc.center, radius: Math.abs(rc.radius - r) });
  return out;
}

type Offset = ReturnType<typeof offsets>[number];

function meet(a: Offset, b: Offset): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const p = lineLine(a.p, a.u, b.p, b.u);
    return p ? [p] : [];
  }
  if (a.kind === 'line' && b.kind === 'circle') return lineCircle(a.p, a.u, b.center, b.radius);
  if (a.kind === 'circle' && b.kind === 'line') return lineCircle(b.p, b.u, a.center, a.radius);
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a.center, a.radius, b.center, b.radius);
  return [];
}

/** Where a circle of radius `r` centred at `center` touches `c`. */
function touchPoint(c: Curve, center: Vec2, r: number): Vec2 {
  if (isStraight(c)) {
    const { p, u } = carrier(c);
    return foot(center, p, u);
  }
  const rc = c as Round;
  const d = distance(center, rc.center);
  const u = scale(sub(center, rc.center), 1 / d);
  const near = add(rc.center, scale(u, rc.radius));
  const far = sub(rc.center, scale(u, rc.radius));
  return Math.abs(distance(near, center) - r) <= Math.abs(distance(far, center) - r) ? near : far;
}

/** Infinite lines and full circles through the curves: every point where they meet. */
function carrierMeets(c1: Curve, c2: Curve): Vec2[] {
  return offsets(c1, 0).slice(0, 1).flatMap((a) => offsets(c2, 0).slice(0, 1).flatMap((b) => meet(a, b)));
}

/** The direction along a straight curve from `t` toward `q`, as a vector to `dot` with. */
function towards(c: Curve, t: Vec2, q: Vec2): Vec2 {
  return isStraight(c) ? scale(carrier(c).u, Math.sign(dot(sub(q, t), carrier(c).u))) : { x: 0, y: 0 };
}

/** A sharp corner: both curves cut or run on to where they meet, nearest the picks. */
function sharpCorner(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2): Corner | undefined {
  const pts = carrierMeets(c1, c2);
  if (pts.length === 0) return undefined;
  const x = pts.reduce((a, b) => (distance(b, p1) + distance(b, p2) < distance(a, p1) + distance(a, p2) ? b : a));
  const first = cutAt(c1, x, p1, towards(c1, x, p1));
  const second = cutAt(c2, x, p2, towards(c2, x, p2));
  if ((isStraight(c1) && !first) || (isStraight(c2) && !second)) return undefined;
  return { first, second, joint: undefined };
}

/**
 * Two parallel lines: a half-circle across the gap at the end of the first
 * line nearest its pick (the base of a ray, or the pick itself on an
 * xline); the second line is cut or run on to meet it. The radius is half
 * the gap, whatever radius is set, as in AutoCAD.
 */
function parallelFillet(c1: Straight, p1: Vec2, c2: Straight, p2: Vec2): Corner | undefined {
  const { p, u } = carrier(c2);
  let e1: Vec2;
  if (c1.kind === 'segment') e1 = distance(p1, c1.a) <= distance(p1, c1.b) ? c1.a : c1.b;
  else if (c1.kind === 'ray') e1 = c1.base;
  else e1 = foot(p1, carrier(c1).p, carrier(c1).u);
  const t2 = foot(e1, p, u);
  const gap = distance(e1, t2);
  if (gap <= TOL) return undefined;
  // Keep the side of each line that runs back from the end toward the first pick's line body.
  const back = c1.kind === 'segment' ? sub(distance(p1, c1.a) <= distance(p1, c1.b) ? c1.b : c1.a, e1) : c1.kind === 'ray' ? c1.dir : sub(foot(p2, carrier(c1).p, carrier(c1).u), e1);
  const keep = length(back) > TOL ? back : u;
  const center = scale(add(e1, t2), 0.5);
  const a1 = angleFrom(center, e1);
  const a2 = angleFrom(center, t2);
  // The half-circle bulges away from the kept side.
  const [cos, sin] = cosSinDeg(a1 + 90);
  const ccwFromE1 = cos * keep.x + sin * keep.y < 0;
  const joint: Curve = { kind: 'arc', center, radius: gap / 2, startDeg: ccwFromE1 ? a1 : a2, endDeg: ccwFromE1 ? a2 : a1 };
  const first = c1.kind === 'segment' ? c1 : cutStraight(c1, e1, keep);
  const second = cutStraight(c2, t2, keep);
  if (!first || !second) return undefined;
  return { first, second, joint };
}

/**
 * Fillet of radius `r` between `c1` (picked at `p1`) and `c2` (picked at
 * `p2`). The arc's center lies on the side of each curve where the other
 * pick is (the corner the picks enclose); of the arcs that fit, the one whose
 * tangent points lie nearest the picks. Radius 0 makes a sharp corner.
 * Undefined when no arc fits or a picked line would be left with nothing.
 */
export function filletCurves(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2, r: number): Corner | undefined {
  if (r <= TOL) return sharpCorner(c1, p1, c2, p2);
  if (isStraight(c1) && isStraight(c2) && Math.abs(cross(carrier(c1).u, carrier(c2).u)) <= TOL) return parallelFillet(c1, p1, c2, p2);
  const want1 = side(c1, p2);
  const want2 = side(c2, p1);
  let best: { center: Vec2; t1: Vec2; t2: Vec2; cost: number } | undefined;
  for (const o1 of offsets(c1, r)) {
    for (const o2 of offsets(c2, r)) {
      for (const center of meet(o1, o2)) {
        if ((want1 !== 0 && side(c1, center) !== want1) || (want2 !== 0 && side(c2, center) !== want2)) continue;
        const t1 = touchPoint(c1, center, r);
        const t2 = touchPoint(c2, center, r);
        const cost = distance(t1, p1) + distance(t2, p2);
        if (!best || cost < best.cost) best = { center, t1, t2, cost };
      }
    }
  }
  if (!best) return undefined;
  const { center, t1, t2 } = best;
  // A straight curve keeps the part running away from the arc.
  const first = cutAt(c1, t1, p1, scale(towards(c1, t1, t2), -1));
  const second = cutAt(c2, t2, p2, scale(towards(c2, t2, t1), -1));
  if ((isStraight(c1) && !first) || (isStraight(c2) && !second)) return undefined;
  const a1 = angleFrom(center, t1);
  const a2 = angleFrom(center, t2);
  const minor = ccwDeg(a1, a2) <= 180;
  const joint: Curve = { kind: 'arc', center, radius: r, startDeg: minor ? a1 : a2, endDeg: minor ? a2 : a1 };
  return { first, second, joint };
}

/** Chamfer sizes: two distances from the corner, or a distance on the first line and an angle from it. */
export type ChamferSpec = { readonly kind: 'distances'; readonly d1: number; readonly d2: number } | { readonly kind: 'angle'; readonly d1: number; readonly deg: number };

/**
 * Chamfer between two straight curves, picked at `p1` and `p2`: each is cut
 * back from where they meet by its distance on the picked side, and a line
 * joins the cuts. Distance-angle measures the angle from the first line.
 * Both distances 0 make a sharp corner. Undefined for parallel lines, or
 * when a line is too short for its distance.
 */
export function chamferLines(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2, spec: ChamferSpec): Corner | undefined {
  if (!isStraight(c1) || !isStraight(c2)) return undefined;
  const l1 = carrier(c1);
  const l2 = carrier(c2);
  const x = lineLine(l1.p, l1.u, l2.p, l2.u);
  if (!x) return undefined;
  const s1 = towards(c1, x, p1);
  const s2 = towards(c2, x, p2);
  if (length(s1) === 0 || length(s2) === 0) return undefined; // picked at the corner itself
  if (spec.d1 <= TOL && (spec.kind === 'angle' || spec.d2 <= TOL)) return sharpCorner(c1, p1, c2, p2);
  const t1 = add(x, scale(s1, spec.d1));
  let t2: Vec2 | undefined;
  if (spec.kind === 'distances') t2 = add(x, scale(s2, spec.d2));
  else {
    // From t1, head back toward the corner turned by the angle toward the second line.
    const turn = -Math.sign(cross(s1, s2)) * spec.deg;
    const [c, s] = cosSinDeg(turn);
    const back = scale(s1, -1);
    const dir = { x: back.x * c - back.y * s, y: back.x * s + back.y * c };
    t2 = lineLine(t1, dir, l2.p, l2.u);
    if (!t2 || dot(sub(t2, x), s2) <= TOL) return undefined;
  }
  const first = cutStraight(c1, t1, s1);
  const second = cutStraight(c2, t2, s2);
  if (!first || !second) return undefined;
  return { first, second, joint: { kind: 'segment', a: t1, b: t2 } };
}
