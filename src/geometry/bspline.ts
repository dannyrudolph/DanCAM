import { type Vec3, add3, scale3 } from './vec3';

/**
 * A B-spline curve in 3D (STEP's B_SPLINE_CURVE_WITH_KNOTS, rational when
 * it has weights): `knots` is the full knot vector, each knot repeated by
 * its multiplicity, so it holds points + degree + 1 values.
 */
export type BSpline = {
  readonly degree: number;
  readonly points: readonly Vec3[];
  readonly knots: readonly number[];
  readonly weights?: readonly number[];
};

/** The full knot vector from STEP's distinct knots and their multiplicities. */
export function expandKnots(knots: readonly number[], multiplicities: readonly number[]): number[] {
  return knots.flatMap((k, i) => Array<number>(multiplicities[i] ?? 0).fill(k));
}

/** The parameter range the curve is defined over. */
export function splineRange(s: BSpline): [number, number] {
  return [s.knots[s.degree]!, s.knots[s.points.length]!];
}

/** The point at parameter `t` (clamped to the range), by de Boor's algorithm. */
export function splinePoint(s: BSpline, t: number): Vec3 {
  const p = s.degree;
  const n = s.points.length;
  const [lo, hi] = splineRange(s);
  const u = Math.min(Math.max(t, lo), hi);
  // The knot span holding u: knots[k] <= u < knots[k + 1], the last span closed.
  let k = p;
  while (k < n - 1 && s.knots[k + 1]! <= u) k++;
  const w = (i: number): number => s.weights?.[i] ?? 1;
  // Homogeneous control points (x·w, y·w, z·w, w).
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = k - p + j;
    return { q: scale3(s.points[i]!, w(i)), w: w(i) };
  });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const span = s.knots[i + p - r + 1]! - s.knots[i]!;
      const a = span === 0 ? 0 : (u - s.knots[i]!) / span;
      d[j] = { q: add3(scale3(d[j - 1]!.q, 1 - a), scale3(d[j]!.q, a)), w: (1 - a) * d[j - 1]!.w + a * d[j]!.w };
    }
  }
  return scale3(d[p]!.q, 1 / d[p]!.w);
}

/** How many distinct spans the curve has (for choosing how finely to sample it). */
export function splineSpans(s: BSpline): number {
  let n = 0;
  for (let i = s.degree; i < s.points.length; i++) if (s.knots[i + 1]! > s.knots[i]!) n++;
  return Math.max(n, 1);
}
