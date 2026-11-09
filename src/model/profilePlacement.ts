import { TOL } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';

/**
 * A turned part's profile in 2D (spec, "STEP import"): Z along the axis, y
 * the radius, and how it is placed for drawing: Z0 at either end, turned
 * end for end, or mirrored below the centerline. Reading it from a STEP
 * file is in `io/step/turnedProfile`.
 */

export type ProfileCurve =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  /** Counter-clockwise from startDeg to endDeg. */
  | { readonly kind: 'arc'; readonly center: Vec2; readonly radius: number; readonly startDeg: number; readonly endDeg: number };

export type LeftOut = {
  /** Faces of the solid that aren't round about the axis: cross holes, flats, slots, hex. */
  readonly notRound: number;
  /** Freeform faces (B-spline and the like) the import can't take exactly. */
  readonly freeform: number;
  /** Faces the file describes with broken references. */
  readonly unreadable: number;
};

export type TurnedProfile = { readonly curves: readonly ProfileCurve[]; readonly left: LeftOut };

/** Where to put Z0, which way the part points, and whether to draw both halves. */
export type ProfilePlacement = { readonly zeroAt: 'right' | 'left'; readonly flip: boolean; readonly full: boolean };

/**
 * The profile placed for drawing: turned end for end when `flip`, moved
 * along Z so its right or left end is at Z0, and mirrored below the
 * centerline when `full`.
 */
export function placeProfile(p: TurnedProfile, o: ProfilePlacement): ProfileCurve[] {
  let curves = o.flip ? p.curves.map(flipCurve) : [...p.curves];
  const [lo, hi] = zExtent(curves);
  const shift = o.zeroAt === 'right' ? -hi : -lo;
  curves = curves.map((c) => moveCurve(c, shift));
  return merge(o.full ? [...curves, ...curves.map(mirrorCurve)] : curves, TOL);
}

/** The lowest and highest Z the curves reach. */
export function zExtent(curves: readonly ProfileCurve[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    for (const z of c.kind === 'line' ? [c.start.x, c.end.x] : arcZs(c)) {
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return [lo, hi];
}

function arcZs(c: Extract<ProfileCurve, { kind: 'arc' }>): number[] {
  const zs = [c.startDeg, c.endDeg].map((d) => c.center.x + c.radius * Math.cos((d * Math.PI) / 180));
  const sweep = (((c.endDeg - c.startDeg) % 360) + 360) % 360;
  for (const q of [0, 180]) {
    const from = (((q - c.startDeg) % 360) + 360) % 360;
    if (from <= sweep) zs.push(c.center.x + (q === 0 ? c.radius : -c.radius));
  }
  return zs;
}

export function scaleCurve(c: ProfileCurve, k: number): ProfileCurve {
  const s = (p: Vec2): Vec2 => ({ x: p.x * k, y: p.y * k });
  return c.kind === 'line' ? { kind: 'line', start: s(c.start), end: s(c.end) } : { ...c, center: s(c.center), radius: c.radius * k };
}

function moveCurve(c: ProfileCurve, dz: number): ProfileCurve {
  const m = (p: Vec2): Vec2 => ({ x: p.x + dz, y: p.y });
  return c.kind === 'line' ? { kind: 'line', start: m(c.start), end: m(c.end) } : { ...c, center: m(c.center) };
}

/** End for end: Z negated; an arc keeps running counter-clockwise. */
function flipCurve(c: ProfileCurve): ProfileCurve {
  const f = (p: Vec2): Vec2 => ({ x: -p.x, y: p.y });
  return c.kind === 'line' ? { kind: 'line', start: f(c.start), end: f(c.end) } : { ...c, center: f(c.center), startDeg: 180 - c.endDeg, endDeg: 180 - c.startDeg };
}

/** Below the centerline: radius negated; an arc keeps running counter-clockwise. */
function mirrorCurve(c: ProfileCurve): ProfileCurve {
  const f = (p: Vec2): Vec2 => ({ x: p.x, y: -p.y });
  return c.kind === 'line' ? { kind: 'line', start: f(c.start), end: f(c.end) } : { ...c, center: f(c.center), startDeg: -c.endDeg, endDeg: -c.startDeg };
}

/** How far apart two angles are, in degrees, the short way round. */
function degApart(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

/**
 * Faces split in two by the exporter, and a full profile's two halves of a
 * face on the axis, give overlapping or touching lines on one line and
 * repeated arcs: joined into one line, one arc. Lines run left to right
 * (bottom to top when vertical).
 */
export function merge(curves: readonly ProfileCurve[], tol: number): ProfileCurve[] {
  const lines: { a: Vec2; b: Vec2 }[] = [];
  const arcs: Extract<ProfileCurve, { kind: 'arc' }>[] = [];
  for (const c of curves) {
    if (c.kind === 'arc') {
      const close = (a: number, b: number): boolean => degApart(a, b) * (Math.PI / 180) * c.radius <= tol;
      const same = arcs.some(
        (o) => Math.abs(o.center.x - c.center.x) <= tol && Math.abs(o.center.y - c.center.y) <= tol && Math.abs(o.radius - c.radius) <= tol && close(o.startDeg, c.startDeg) && close(o.endDeg, c.endDeg),
      );
      if (!same) arcs.push(c);
      continue;
    }
    const [a, b] = c.start.x < c.end.x || (Math.abs(c.start.x - c.end.x) <= tol && c.start.y < c.end.y) ? [c.start, c.end] : [c.end, c.start];
    lines.push({ a, b });
  }
  // Join lines on one carrier whose spans overlap or touch, until nothing joins.
  let joined = true;
  while (joined) {
    joined = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const m = join(lines[i]!, lines[j]!, tol);
        if (m) {
          lines[i] = m;
          lines.splice(j, 1);
          joined = true;
          break outer;
        }
      }
    }
  }
  return [...lines.map((l): ProfileCurve => ({ kind: 'line', start: l.a, end: l.b })), ...arcs];
}

/** One line covering both when they lie on one line and overlap or touch. */
function join(p: { a: Vec2; b: Vec2 }, q: { a: Vec2; b: Vec2 }, tol: number): { a: Vec2; b: Vec2 } | undefined {
  const d = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return undefined;
  const u = { x: d.x / len, y: d.y / len };
  const off = (r: Vec2): number => (r.x - p.a.x) * u.y - (r.y - p.a.y) * u.x;
  if (Math.abs(off(q.a)) > tol || Math.abs(off(q.b)) > tol) return undefined;
  const t = (r: Vec2): number => (r.x - p.a.x) * u.x + (r.y - p.a.y) * u.y;
  const [qa, qb] = [t(q.a), t(q.b)];
  if (Math.min(qa, qb) > len + tol || Math.max(qa, qb) < -tol) return undefined;
  const pts = [p.a, p.b, q.a, q.b].sort((x, y) => t(x) - t(y));
  return { a: pts[0]!, b: pts[3]! };
}
