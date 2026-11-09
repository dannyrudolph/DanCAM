import { type BSpline, splinePoint, splineRange, splineSpans } from '../../geometry/bspline';
import { type Vec3, add3, cross3, dot3, length3, scale3, sub3 } from '../../geometry/vec3';
import type { StepEdge } from './stepModel';

/**
 * A curve in space, exactly as the model has it, run over a parameter
 * range: a line from `a` (t = 0) to `b` (t = 1); a circle or ellipse by its
 * angle, counter-clockwise about `axis` from `ref`; a B-spline by its own
 * parameter. Used for the edges and outlines the three views project.
 */
export type Curve3 =
  | { readonly kind: 'line'; readonly a: Vec3; readonly b: Vec3 }
  | { readonly kind: 'circle'; readonly center: Vec3; readonly axis: Vec3; readonly ref: Vec3; readonly radius: number }
  | { readonly kind: 'ellipse'; readonly center: Vec3; readonly axis: Vec3; readonly ref: Vec3; readonly a: number; readonly b: number }
  | { readonly kind: 'spline'; readonly spline: BSpline };

/** A curve over [t0, t1], t0 < t1. */
export type Piece3 = { readonly curve: Curve3; readonly t0: number; readonly t1: number };

export function point3(c: Curve3, t: number): Vec3 {
  switch (c.kind) {
    case 'line':
      return add3(c.a, scale3(sub3(c.b, c.a), t));
    case 'circle':
    case 'ellipse': {
      const [ra, rb] = c.kind === 'circle' ? [c.radius, c.radius] : [c.a, c.b];
      const v = cross3(c.axis, c.ref);
      return add3(c.center, add3(scale3(c.ref, ra * Math.cos(t)), scale3(v, rb * Math.sin(t))));
    }
    case 'spline':
      return splinePoint(c.spline, t);
  }
}

/** Points along the piece, enough to follow it (both ends included). */
export function samples3(p: Piece3, perTurn = 64): Vec3[] {
  const n = sampleCount(p, perTurn);
  return Array.from({ length: n + 1 }, (_, i) => point3(p.curve, p.t0 + ((p.t1 - p.t0) * i) / n));
}

export function sampleCount(p: Piece3, perTurn = 64): number {
  const c = p.curve;
  if (c.kind === 'line') return 1;
  if (c.kind === 'spline') {
    const [lo, hi] = splineRange(c.spline);
    return Math.max(8, Math.ceil(((perTurn / 2) * splineSpans(c.spline) * (p.t1 - p.t0)) / (hi - lo)));
  }
  return Math.max(4, Math.ceil((perTurn * (p.t1 - p.t0)) / (2 * Math.PI)));
}

const TURN = 2 * Math.PI;
const ccwFrom = (from: number, a: number): number => (((a - from) % TURN) + TURN) % TURN;

/** An edge as a piece of its curve, from its start vertex to its end; undefined for a curve type not read. */
export function edgePiece(e: StepEdge, tol: number): Piece3 | undefined {
  const c = e.curve;
  const closed = length3(sub3(e.start, e.end)) <= tol;
  switch (c.kind) {
    case 'line':
      return closed ? undefined : { curve: { kind: 'line', a: e.start, b: e.end }, t0: 0, t1: 1 };
    case 'circle':
    case 'ellipse': {
      const curve: Curve3 =
        c.kind === 'circle'
          ? { kind: 'circle', center: c.at.origin, axis: c.at.axis, ref: c.at.ref, radius: c.radius }
          : { kind: 'ellipse', center: c.at.origin, axis: c.at.axis, ref: c.at.ref, a: c.a, b: c.b };
      const [ra, rb] = c.kind === 'circle' ? [c.radius, c.radius] : [c.a, c.b];
      const v = cross3(c.at.axis, c.at.ref);
      const angle = (p: Vec3): number => {
        const w = sub3(p, c.at.origin);
        return Math.atan2(dot3(w, v) / rb, dot3(w, c.at.ref) / ra);
      };
      // The edge runs along the curve's own direction when sameSense, so its counter-clockwise run starts at whichever end that makes first.
      const [from, to] = e.sameSense ? [angle(e.start), angle(e.end)] : [angle(e.end), angle(e.start)];
      const sweep = closed ? TURN : ccwFrom(from, to);
      return sweep === 0 ? undefined : { curve, t0: from, t1: from + sweep };
    }
    case 'bspline': {
      const curve: Curve3 = { kind: 'spline', spline: c.spline };
      const [lo, hi] = splineRange(c.spline);
      if (closed) return { curve, t0: lo, t1: hi };
      const ts = nearestParam(curve, e.start, lo, hi);
      const te = nearestParam(curve, e.end, lo, hi);
      return ts === te ? undefined : { curve, t0: Math.min(ts, te), t1: Math.max(ts, te) };
    }
    default:
      return undefined;
  }
}

/** The parameter in [lo, hi] where the curve comes nearest `p`: a sampled guess, then narrowed. */
function nearestParam(c: Curve3, p: Vec3, lo: number, hi: number): number {
  const n = 256;
  const d = (t: number): number => length3(sub3(point3(c, t), p));
  let best = lo;
  for (let i = 0; i <= n; i++) {
    const t = lo + ((hi - lo) * i) / n;
    if (d(t) < d(best)) best = t;
  }
  let [a, b] = [Math.max(lo, best - (hi - lo) / n), Math.min(hi, best + (hi - lo) / n)];
  for (let i = 0; i < 80; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (d(m1) < d(m2)) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}
