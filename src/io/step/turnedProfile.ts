import { TOL } from '../../geometry/tolerance';
import type { Vec2 } from '../../geometry/vec';
import { type Vec3, add3, cross3, dot3, length3, scale3, sub3 } from '../../geometry/vec3';
import type { Units } from '../../model/drawing';
import { MM_PER_INCH } from '../../model/units';
import type { Placement, StepEdge, StepFace, StepModel } from './stepModel';

/**
 * A turned part's profile from its STEP faces (spec, "STEP import"): the
 * half-section through its axis, Z along the axis and X (here y) the
 * radius. Any point of a surface of revolution maps, by (distance along
 * the axis, distance from it), onto the curve that generates it, so each
 * face about the axis gives its exact line or arc, over the extent its
 * boundary reaches. Faces that aren't round about the axis are counted,
 * not drawn.
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

export type ProfileResult = { readonly ok: true; readonly profile: TurnedProfile } | { readonly ok: false; readonly error: string };

type Axis = { readonly point: Vec3; readonly dir: Vec3 };

/** Points sampled along a circle or ellipse edge (enough to show which way an arc goes and how far it reaches). */
const ARC_SAMPLES = 24;

/** The profile of the turned part in `model`, in `units`. */
export function turnedProfile(model: StepModel, units: Units): ProfileResult {
  const tol = Math.max(model.uncertainty ?? 0, TOL);
  const axis = findAxis(model.faces, tol);
  if (!axis) return { ok: false, error: 'There is no turned part here: no cylinders, cones or tori share an axis.' };
  const k = model.mmPerUnit / (units === 'in' ? MM_PER_INCH : 1);
  const left = { notRound: 0, freeform: 0, unreadable: model.unreadable.length };
  const curves: ProfileCurve[] = [];
  const caps: { center: Vec2; radius: number; at: Vec2 }[] = [];
  const zr = (q: Vec3): Vec2 => {
    const w = sub3(q, axis.point);
    const z = dot3(w, axis.dir);
    return { x: z, y: length3(sub3(w, scale3(axis.dir, z))) };
  };

  for (const face of model.faces) {
    const s = face.surface;
    if (s.kind === 'other') {
      left.freeform++;
      continue;
    }
    const about = s.kind === 'plane' ? parallel(s.at.axis, axis.dir, tol) : s.kind === 'sphere' ? onAxis(s.at.origin, axis, tol) : coaxial(s.at, axis, tol);
    if (!about) {
      left.notRound++;
      continue;
    }
    const pts = boundary(face).map(zr);
    const zs = pts.map((p) => p.x);
    const [zMin, zMax] = [Math.min(...zs), Math.max(...zs)];
    switch (s.kind) {
      case 'plane': {
        const z = zr(s.at.origin).x;
        const span = planeSpan(face, axis, s.at, zr);
        if (!span) left.notRound++;
        else if (span[1] - span[0] > tol) curves.push({ kind: 'line', start: { x: z, y: span[0] }, end: { x: z, y: span[1] } });
        break;
      }
      case 'cylinder':
        if (zMax - zMin > tol) curves.push({ kind: 'line', start: { x: zMin, y: s.radius }, end: { x: zMax, y: s.radius } });
        break;
      case 'cone': {
        // r(z) = radius + (z − z0) · tan(semiAngle), z measured along the cone's own axis.
        const sign = Math.sign(dot3(s.at.axis, axis.dir));
        const z0 = zr(s.at.origin).x;
        const slope = Math.tan(s.semiAngle) * sign;
        const r = (z: number): number => s.radius + (z - z0) * slope;
        if (zMax - zMin > tol) curves.push({ kind: 'line', start: { x: zMin, y: r(zMin) }, end: { x: zMax, y: r(zMax) } });
        else if (slope !== 0) {
          const apex = z0 - s.radius / slope; // the cone closes on the axis (a drill point)
          curves.push({ kind: 'line', start: { x: zMin, y: r(zMin) }, end: { x: apex, y: 0 } });
        }
        break;
      }
      case 'torus':
      case 'sphere': {
        const center = { x: zr(s.at.origin).x, y: s.kind === 'torus' ? s.major : 0 };
        const radius = s.kind === 'torus' ? s.minor : s.radius;
        const arc = covering(center, radius, pts, tol);
        if (arc) curves.push(arc);
        else if (s.kind === 'sphere' && pts[0]) caps.push({ center, radius, at: pts[0] }); // a cap whose boundary is one circle
        else left.notRound++;
        break;
      }
    }
  }
  // A ball end: the cap runs from its circle to the pole outside the rest of the part.
  for (const cap of caps) {
    const others = curves.flatMap((c) => (c.kind === 'line' ? [c.start.x, c.end.x] : [c.center.x]));
    const mid = others.length === 0 ? cap.center.x : (Math.min(...others) + Math.max(...others)) / 2;
    const toPlus = cap.center.x >= mid;
    const atDeg = (Math.atan2(cap.at.y - cap.center.y, cap.at.x - cap.center.x) * 180) / Math.PI;
    curves.push(toPlus ? { kind: 'arc', center: cap.center, radius: cap.radius, startDeg: 0, endDeg: atDeg } : { kind: 'arc', center: cap.center, radius: cap.radius, startDeg: atDeg, endDeg: 180 });
  }
  const scaled = curves.map((c) => scaleCurve(c, k));
  return { ok: true, profile: { curves: merge(scaled, tol * k), left } };
}

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

const parallel = (a: Vec3, b: Vec3, tol: number): boolean => length3(cross3(a, b)) <= tol;

function onAxis(p: Vec3, axis: Axis, tol: number): boolean {
  const w = sub3(p, axis.point);
  return length3(sub3(w, scale3(axis.dir, dot3(w, axis.dir)))) <= tol;
}

const coaxial = (at: Placement, axis: Axis, tol: number): boolean => parallel(at.axis, axis.dir, tol) && onAxis(at.origin, axis, tol);

/**
 * The axis of the part: the line most cylinders, cones and tori lie on,
 * counting flat faces square to it too, so a cross hole never wins. It
 * points along the model's positive direction.
 */
function findAxis(faces: readonly StepFace[], tol: number): Axis | undefined {
  const candidates: Axis[] = [];
  for (const f of faces) {
    const s = f.surface;
    if (s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'torus') candidates.push({ point: s.at.origin, dir: s.at.axis });
  }
  let best: Axis | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    let score = 0;
    for (const f of faces) {
      const s = f.surface;
      if (s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'torus') score += coaxial(s.at, c, tol) ? 2 : 0;
      else if (s.kind === 'sphere') score += onAxis(s.at.origin, c, tol) ? 2 : 0;
      else if (s.kind === 'plane') score += parallel(s.at.axis, c.dir, tol) ? 1 : 0;
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (!best) return undefined;
  // Point the axis the way the model does (its largest component positive), so a part drawn along +Z comes in as drawn.
  const d = best.dir;
  const big = Math.abs(d.x) >= Math.abs(d.y) && Math.abs(d.x) >= Math.abs(d.z) ? d.x : Math.abs(d.y) >= Math.abs(d.z) ? d.y : d.z;
  return big < 0 ? { point: best.point, dir: scale3(d, -1) } : best;
}

/** Points along every edge of the face: ends, and samples along circles and ellipses. */
function boundary(face: StepFace): Vec3[] {
  const out: Vec3[] = [];
  for (const loop of face.loops) {
    if (loop.vertex) out.push(loop.vertex);
    for (const e of loop.edges) out.push(...edgePoints(e));
  }
  return out;
}

function edgePoints(e: StepEdge): Vec3[] {
  const c = e.curve;
  if (c.kind !== 'circle' && c.kind !== 'ellipse') return [e.start, e.end];
  const [ra, rb] = c.kind === 'circle' ? [c.radius, c.radius] : [c.a, c.b];
  const { origin, axis, ref } = c.at;
  const v = cross3(axis, ref);
  const angle = (p: Vec3): number => {
    const w = sub3(p, origin);
    return Math.atan2(dot3(w, v) / rb, dot3(w, ref) / ra);
  };
  const a0 = angle(e.start);
  let sweep = angle(e.end) - a0;
  const closed = length3(sub3(e.start, e.end)) === 0;
  if (e.sameSense) sweep = closed ? 2 * Math.PI : ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  else sweep = closed ? -2 * Math.PI : -((((-sweep) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const pts: Vec3[] = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = a0 + (sweep * i) / ARC_SAMPLES;
    pts.push(add3(origin, add3(scale3(ref, ra * Math.cos(t)), scale3(v, rb * Math.sin(t)))));
  }
  return pts;
}

/**
 * The radius span of a flat face square to the axis, or undefined when the
 * axis passes through none of its loops (a flat's end wall, not round).
 * Inside an odd number of loops the face covers the axis (a full disk, from
 * 0); otherwise it starts at the innermost loop around the axis (a bore).
 */
function planeSpan(face: StepFace, axis: Axis, at: Placement, zr: (q: Vec3) => Vec2): [number, number] | undefined {
  const z = dot3(sub3(at.origin, axis.point), axis.dir);
  const centre = add3(axis.point, scale3(axis.dir, z));
  const u = at.ref;
  const v = cross3(at.axis, at.ref);
  const flat = (p: Vec3): Vec2 => ({ x: dot3(sub3(p, centre), u), y: dot3(sub3(p, centre), v) });
  const around: Vec3[][] = [];
  let rMax = 0;
  for (const loop of face.loops) {
    const segs = loop.edges.map((e) => edgePoints(e).map(flat));
    let crossings = 0;
    for (const poly of segs) {
      for (let i = 1; i < poly.length; i++) {
        const [p, q] = [poly[i - 1]!, poly[i]!];
        if (p.y > 0 !== q.y > 0 && p.x + ((0 - p.y) * (q.x - p.x)) / (q.y - p.y) > 0) crossings++;
      }
    }
    const pts = loop.edges.flatMap(edgePoints);
    for (const p of pts) rMax = Math.max(rMax, zr(p).y);
    if (crossings % 2 === 1) around.push(pts);
  }
  if (around.length === 0) return undefined;
  if (around.length % 2 === 1) return [0, rMax];
  const inner = Math.min(...around.map((pts) => Math.min(...pts.map((p) => zr(p).y))));
  return [inner, rMax];
}

/** The arc of the circle (center, radius) through all of `pts`: the circle less its widest gap. Undefined when they are all one point. */
function covering(center: Vec2, radius: number, pts: readonly Vec2[], tol: number): ProfileCurve | undefined {
  const angles = pts.map((p) => Math.atan2(p.y - center.y, p.x - center.x)).sort((a, b) => a - b);
  if (angles.length === 0 || (angles.at(-1)! - angles[0]!) * radius <= tol) return undefined;
  let gapAt = angles.length - 1;
  let gap = angles[0]! + 2 * Math.PI - angles.at(-1)!;
  for (let i = 1; i < angles.length; i++) {
    const g = angles[i]! - angles[i - 1]!;
    if (g > gap) {
      gap = g;
      gapAt = i - 1;
    }
  }
  const start = angles[(gapAt + 1) % angles.length]!;
  const end = angles[gapAt]!;
  const deg = (a: number): number => (a * 180) / Math.PI;
  return { kind: 'arc', center, radius, startDeg: deg(start), endDeg: deg(end) };
}

function scaleCurve(c: ProfileCurve, k: number): ProfileCurve {
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
function merge(curves: readonly ProfileCurve[], tol: number): ProfileCurve[] {
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

