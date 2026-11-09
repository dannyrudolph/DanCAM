import { TOL } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';

/**
 * A turned part's profile in 2D (spec, "STEP import"): Z along the axis, y
 * the radius, and how it is placed for drawing: Z0 at either end, turned
 * end for end, or mirrored below the centerline. Reading it from a STEP
 * file is in `io/step/turnedProfile`.
 */

/**
 * How a curve shows in a side view: `hidden` inside the part (a bore),
 * `tangent` where two faces meet smoothly; absent, a visible edge.
 */
export type ProfileStyle = 'hidden' | 'tangent';

export type ProfileCurve =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2; readonly style?: ProfileStyle }
  /** Counter-clockwise from startDeg to endDeg. */
  | { readonly kind: 'arc'; readonly center: Vec2; readonly radius: number; readonly startDeg: number; readonly endDeg: number; readonly style?: ProfileStyle };

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
  return c.kind === 'line' ? { ...c, start: s(c.start), end: s(c.end) } : { ...c, center: s(c.center), radius: c.radius * k };
}

function moveCurve(c: ProfileCurve, dz: number): ProfileCurve {
  const m = (p: Vec2): Vec2 => ({ x: p.x + dz, y: p.y });
  return c.kind === 'line' ? { ...c, start: m(c.start), end: m(c.end) } : { ...c, center: m(c.center) };
}

/** End for end: Z negated; an arc keeps running counter-clockwise. */
function flipCurve(c: ProfileCurve): ProfileCurve {
  const f = (p: Vec2): Vec2 => ({ x: -p.x, y: p.y });
  return c.kind === 'line' ? { ...c, start: f(c.start), end: f(c.end) } : { ...c, center: f(c.center), startDeg: 180 - c.endDeg, endDeg: 180 - c.startDeg };
}

/** Below the centerline: radius negated; an arc keeps running counter-clockwise. */
function mirrorCurve(c: ProfileCurve): ProfileCurve {
  const f = (p: Vec2): Vec2 => ({ x: p.x, y: -p.y });
  return c.kind === 'line' ? { ...c, start: f(c.start), end: f(c.end) } : { ...c, center: f(c.center), startDeg: -c.endDeg, endDeg: -c.startDeg };
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
  const lines: Joinable[] = [];
  const arcs: Extract<ProfileCurve, { kind: 'arc' }>[] = [];
  for (const c of curves) {
    if (c.kind === 'arc') {
      const close = (a: number, b: number): boolean => degApart(a, b) * (Math.PI / 180) * c.radius <= tol;
      const same = arcs.some(
        (o) => Math.abs(o.center.x - c.center.x) <= tol && Math.abs(o.center.y - c.center.y) <= tol && Math.abs(o.radius - c.radius) <= tol && o.style === c.style && close(o.startDeg, c.startDeg) && close(o.endDeg, c.endDeg),
      );
      if (!same) arcs.push(c);
      continue;
    }
    const [a, b] = c.start.x < c.end.x || (Math.abs(c.start.x - c.end.x) <= tol && c.start.y < c.end.y) ? [c.start, c.end] : [c.end, c.start];
    lines.push(c.style ? { a, b, style: c.style } : { a, b });
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
  return [...lines.map((l): ProfileCurve => (l.style ? { kind: 'line', start: l.a, end: l.b, style: l.style } : { kind: 'line', start: l.a, end: l.b })), ...arcs];
}

type Joinable = { readonly a: Vec2; readonly b: Vec2; readonly style?: ProfileStyle };

/** One line covering both when they lie on one line, overlap or touch, and are the same kind of edge. */
function join(p: Joinable, q: Joinable, tol: number): Joinable | undefined {
  if (p.style !== q.style) return undefined;
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
  return { ...p, a: pts[0]!, b: pts[3]! };
}

/**
 * The profile as a side view shows it (spec, "STEP import"): what lies
 * inside the part, below its outside at that Z (a bore, its drill point, an
 * inner shoulder or radius), hidden; and at each Z with a circular edge, a
 * line from the centerline across the part. It is visible when the edge is
 * on the outside, in the tangent style where two faces meet smoothly there
 * (a radius running into a diameter; where one of them is a flat face, the
 * face is the edge), and hidden when every edge at that Z is inside. The
 * ends of the profile's curves are its edges.
 */
export function sideView(curves: readonly ProfileCurve[], tol: number): ProfileCurve[] {
  const inside = (p: Vec2): boolean => p.y < radiusAt(curves, p.x, tol) - tol;
  const out: ProfileCurve[] = curves.map((c) => (inside(showing(c, tol)) ? { ...c, style: 'hidden' } : c));
  const ends = curves.flatMap(curveEnds);
  const outer: Vec2[] = [];
  for (const e of ends) {
    if (e.at.y <= tol) continue;
    const i = outer.findIndex((p) => Math.abs(p.x - e.at.x) <= tol);
    if (i < 0) outer.push(e.at);
    else if (e.at.y > outer[i]!.y) outer[i] = e.at;
  }
  for (const p of outer) {
    const line = { kind: 'line', start: { x: p.x, y: 0 }, end: p } as const;
    if (inside(p)) {
      out.push({ ...line, style: 'hidden' });
      continue;
    }
    const meeting = ends.filter((e) => Math.abs(e.at.x - p.x) <= tol && Math.abs(e.at.y - p.y) <= tol).map((e) => e.away);
    const [u, w] = meeting;
    const smooth = meeting.length === 2 && u !== undefined && w !== undefined && Math.abs(u.x * w.y - u.y * w.x) <= tol && u.x * w.x + u.y * w.y < 0 && Math.abs(u.x) > tol;
    out.push(smooth ? { ...line, style: 'tangent' } : line);
  }
  return out;
}

/** The point that says whether a curve is inside the part: a flat face's outer end, any other curve's middle. */
function showing(c: ProfileCurve, tol: number): Vec2 {
  if (c.kind === 'line') {
    if (Math.abs(c.end.x - c.start.x) <= tol) return c.start.y > c.end.y ? c.start : c.end;
    return { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 };
  }
  const sweep = (((c.endDeg - c.startDeg) % 360) + 360) % 360;
  const mid = ((c.startDeg + sweep / 2) * Math.PI) / 180;
  return { x: c.center.x + c.radius * Math.cos(mid), y: c.center.y + c.radius * Math.sin(mid) };
}

/** Each end of a curve, with the unit direction the curve leaves it in. */
function curveEnds(c: ProfileCurve): { at: Vec2; away: Vec2 }[] {
  if (c.kind === 'line') {
    const len = Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y);
    if (len === 0) return [];
    const d = { x: (c.end.x - c.start.x) / len, y: (c.end.y - c.start.y) / len };
    return [
      { at: c.start, away: d },
      { at: c.end, away: { x: -d.x, y: -d.y } },
    ];
  }
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const at = (deg: number): Vec2 => ({ x: c.center.x + c.radius * Math.cos(rad(deg)), y: c.center.y + c.radius * Math.sin(rad(deg)) });
  const ccw = (deg: number): Vec2 => ({ x: -Math.sin(rad(deg)), y: Math.cos(rad(deg)) });
  const back = ccw(c.endDeg);
  return [
    { at: at(c.startDeg), away: ccw(c.startDeg) },
    { at: at(c.endDeg), away: { x: -back.x, y: -back.y } },
  ];
}

/** The largest radius the profile reaches at `z`. */
function radiusAt(curves: readonly ProfileCurve[], z: number, tol: number): number {
  let r = 0;
  for (const c of curves) {
    if (c.kind === 'line') {
      const [a, b] = c.start.x <= c.end.x ? [c.start, c.end] : [c.end, c.start];
      if (z < a.x - tol || z > b.x + tol) continue;
      const along = b.x - a.x <= tol ? Math.max(a.y, b.y) : a.y + ((Math.min(Math.max(z, a.x), b.x) - a.x) * (b.y - a.y)) / (b.x - a.x);
      r = Math.max(r, along);
      continue;
    }
    const dz = z - c.center.x;
    if (Math.abs(dz) > c.radius + tol) continue;
    const dy = Math.sqrt(Math.max(0, c.radius * c.radius - dz * dz));
    const slack = (tol / c.radius) * (180 / Math.PI);
    const sweep = (((c.endDeg - c.startDeg) % 360) + 360) % 360;
    for (const y of [c.center.y + dy, c.center.y - dy]) {
      const from = ((((Math.atan2(y - c.center.y, dz) * 180) / Math.PI - c.startDeg) % 360) + 360) % 360;
      if (from <= sweep + slack || from >= 360 - slack) r = Math.max(r, y);
    }
  }
  return r;
}
