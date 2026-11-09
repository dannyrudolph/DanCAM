import { type Arc, arcEnd, arcStart, arcSweepDeg } from './arc';
import { ccwDeg } from './angle';
import { angleFrom } from './circle';
import { type Curve, nearestOnCurve } from './curve';
import { TOL } from './tolerance';
import { type Vec2, distance, dot, scale, sub } from './vec';

/**
 * Trimming one curve: what is removed (the piece under the pick, between the
 * nearest cuts on either side) and what is kept (zero, one or two curves).
 * New ends are the cut points themselves, never rebuilt from a parameter, so
 * a trimmed end sits exactly where the intersection was computed (CAD-5).
 */
export type TrimResult = { readonly removed: Curve; readonly kept: readonly Curve[] };

/** A cut at its position along the curve (straight: along the carrier; round: CCW degrees from the start). */
type Cut = { readonly t: number; readonly p: Vec2 };

function straightCarrier(c: Extract<Curve, { kind: 'segment' | 'ray' | 'xline' }>): { p: Vec2; d: Vec2 } {
  return c.kind === 'segment' ? { p: c.a, d: sub(c.b, c.a) } : { p: c.base, d: c.dir };
}

/** Ends of a bounded curve, where a cut splits nothing. */
function curveEnds(c: Curve): Vec2[] {
  switch (c.kind) {
    case 'segment':
      return [c.a, c.b];
    case 'ray':
      return [c.base];
    case 'arc':
      return [arcStart(c), arcEnd(c)];
    default:
      return [];
  }
}

/**
 * Cuts sorted along the curve, with any within TOL of an end or of another
 * cut dropped, so no piece is shorter than TOL.
 */
function sortedCuts(c: Curve, points: readonly Vec2[], position: (p: Vec2) => number): Cut[] {
  const ends = curveEnds(c);
  const cuts = points
    .filter((p) => ends.every((e) => distance(p, e) > TOL))
    .map((p) => ({ t: position(p), p }))
    .sort((a, b) => a.t - b.t);
  const out: Cut[] = [];
  for (const cut of cuts) if (out.every((o) => distance(o.p, cut.p) > TOL)) out.push(cut);
  return out;
}

function arcFrom(c: { center: Vec2; radius: number }, from: Vec2, to: Vec2): Curve {
  return { kind: 'arc', center: c.center, radius: c.radius, startDeg: angleFrom(c.center, from), endDeg: angleFrom(c.center, to) };
}

/**
 * Removes the piece of `c` that `pick` is on, bounded by the nearest of
 * `cuts` (points on `c`, usually its intersections with the cutting edges).
 * A circle needs two cuts and becomes an arc; an xline cut on one side
 * becomes a ray, on both sides a line; a ray cut ahead of its base keeps a
 * line. Undefined when no cut bounds the picked piece (nothing to trim).
 */
export function trimCurve(c: Curve, cuts: readonly Vec2[], pick: Vec2): TrimResult | undefined {
  const on = nearestOnCurve(c, pick);
  switch (c.kind) {
    case 'segment':
    case 'ray':
    case 'xline': {
      const { p: base, d } = straightCarrier(c);
      const at = (q: Vec2): number => dot(sub(q, base), d);
      const sorted = sortedCuts(c, cuts, at);
      const t = at(on);
      const lo = [...sorted].reverse().find((k) => k.t < t);
      const hi = sorted.find((k) => k.t >= t);
      if (!lo && !hi) return undefined;
      // Each side of the removed piece, from the curve's own start or end.
      const before: Curve | undefined = lo && (c.kind === 'xline' ? { kind: 'ray', base: lo.p, dir: scale(d, -1) } : { kind: 'segment', a: c.kind === 'segment' ? c.a : c.base, b: lo.p });
      const after: Curve | undefined = hi && (c.kind === 'segment' ? { kind: 'segment', a: hi.p, b: c.b } : { kind: 'ray', base: hi.p, dir: d });
      let removed: Curve;
      if (lo && hi) removed = { kind: 'segment', a: lo.p, b: hi.p };
      else if (lo) removed = c.kind === 'segment' ? { kind: 'segment', a: lo.p, b: c.b } : { kind: 'ray', base: lo.p, dir: d };
      else removed = c.kind === 'segment' ? { kind: 'segment', a: c.a, b: hi!.p } : c.kind === 'ray' ? { kind: 'segment', a: c.base, b: hi!.p } : { kind: 'ray', base: hi!.p, dir: scale(d, -1) };
      const kept: Curve[] = [];
      if (before) kept.push(before);
      if (after) kept.push(after);
      return { removed, kept };
    }
    case 'arc': {
      const at = (q: Vec2): number => ccwDeg(c.startDeg, angleFrom(c.center, q));
      const sorted = sortedCuts(c, cuts, at);
      const t = at(on) > arcSweepDeg(c) ? 0 : at(on);
      const lo = [...sorted].reverse().find((k) => k.t < t);
      const hi = sorted.find((k) => k.t >= t);
      if (!lo && !hi) return undefined;
      const loDeg = lo ? angleFrom(c.center, lo.p) : c.startDeg;
      const hiDeg = hi ? angleFrom(c.center, hi.p) : c.endDeg;
      const kept: Curve[] = [];
      if (lo) kept.push(withAngles(c, c.startDeg, loDeg));
      if (hi) kept.push(withAngles(c, hiDeg, c.endDeg));
      return { removed: withAngles(c, loDeg, hiDeg), kept };
    }
    case 'circle': {
      const at = (q: Vec2): number => angleFrom(c.center, q);
      const sorted = sortedCuts(c, cuts, at);
      if (sorted.length < 2) return undefined;
      const t = at(on);
      // The removed piece runs CCW from the last cut at or before the pick to the next one, wrapping past 0°.
      const i = Math.max(0, sorted.findIndex((k) => k.t >= t));
      const hi = sorted[i]!;
      const lo = sorted[(i - 1 + sorted.length) % sorted.length]!;
      return { removed: arcFrom(c, lo.p, hi.p), kept: [arcFrom(c, hi.p, lo.p)] };
    }
  }
}

function withAngles(a: Arc, startDeg: number, endDeg: number): Curve {
  return { kind: 'arc', center: a.center, radius: a.radius, startDeg, endDeg };
}
