import { TOL } from '../../geometry/tolerance';
import type { Vec2 } from '../../geometry/vec';
import { type Vec3, add3, cross3, dot3, length3, scale3, sub3, unit3 } from '../../geometry/vec3';
import type { Units } from '../../model/drawing';
import { type ProfileCurve, type ProfileStyle, merge } from '../../model/profilePlacement';
import { MM_PER_INCH } from '../../model/units';
import { type Curve3, type Piece3, edgePiece, point3, samples3 } from './curve3';
import { type SolidFace, insideFace, normalAt, rayHits, rayMeetsBox, solidFaces } from './faceSolid';
import type { StepEdge, StepFace, StepModel, StepSurface } from './stepModel';
import { findAxis } from './turnedProfile';

/**
 * A turned part's three views (spec, "STEP import"), third-angle: the
 * front view with the part's axis along X; the top view, seen from above;
 * the end view, seen from the right end. Every edge of the solid and the
 * outline of every curved face is projected exactly where it can be (a line
 * as a line; a circle face-on as a circle or arc, edge-on as a line) and
 * fitted with arcs and lines where it can't (ellipses, splines, circles at a
 * slant), marked `fitted`. Each is split where material lies between it and
 * the viewer: those pieces are hidden. Seams and the edges between a face
 * split in two aren't edges; where two faces meet smoothly the edge is a
 * tangent edge. Coordinates are each view's own, the part's axis through
 * (0, 0) of the front and top views, its centre at (0, 0) of the end view.
 */
export type ThreeViews = {
  readonly front: readonly ProfileCurve[];
  readonly top: readonly ProfileCurve[];
  readonly end: readonly ProfileCurve[];
  /** Faces the views can't take: drawn by their edges, but they hide nothing. */
  readonly freeform: number;
  readonly unreadable: number;
};

/** Turned end for end, and turned about the axis in quarter turns (0–3), before the views are taken. */
export type ViewOrientation = { readonly flip: boolean; readonly turn: number };

export type ViewsResult = { readonly ok: true; readonly views: ThreeViews } | { readonly ok: false; readonly error: string };

type View = { readonly ex: Vec3; readonly ey: Vec3; /** toward the viewer */ readonly e: Vec3 };
type Style = 'visible' | ProfileStyle;
/** A curve to draw: a piece of an edge or an outline, and how it shows before hidden lines are found. */
type Draw = { readonly piece: Piece3; readonly style: 'visible' | 'tangent'; /** the surfaces it lies on (an edge's two faces') */ readonly on: readonly StepSurface[] };

/**
 * Unit vectors closer than this are parallel. Normals here are worked out
 * at points the file gives to its own accuracy, so it is looser than TOL
 * (whose square root it is): one shared base, not a new magic number.
 */
const PARALLEL = Math.sqrt(TOL);

export function threeViews(model: StepModel, units: Units, o: ViewOrientation): ViewsResult {
  const tol = Math.max(model.uncertainty ?? 0, TOL);
  const axis = findAxis(model.faces, tol);
  if (!axis) return { ok: false, error: 'There is no turned part here: no cylinders, cones or tori share an axis.' };
  const k = model.mmPerUnit / (units === 'in' ? MM_PER_INCH : 1);
  const solids = solidFaces(model.faces, tol);
  const size = diagonal(solids);
  const ctx: Ctx = { solids, tol, size, clearance: PARALLEL * size, step: size / 300, origin: axis.point, k, fitTol: size * k * 1e-5 };

  const views = orient(axis.dir, o);
  const draws = edges(model.faces, tol);
  const take = (v: View): ProfileCurve[] => {
    const out: ProfileCurve[] = [];
    const all: Draw[] = [...draws, ...solids.flatMap((f) => outlines(f, v.e, ctx).map((piece): Draw => ({ piece, style: 'visible', on: [f.surface] })))];
    for (const d of all) for (const part of seen(d, v, ctx)) out.push(...project(part.piece, part.style, v, ctx, d.on));
    return tidy(out, ctx);
  };
  return {
    ok: true,
    views: { front: take(views.front), top: take(views.top), end: take(views.end), freeform: model.faces.length - solids.length, unreadable: model.unreadable.length },
  };
}

type Ctx = {
  readonly solids: readonly SolidFace[];
  readonly tol: number;
  readonly size: number;
  /** A ray's hits nearer its start than this are the surface it starts on. */
  readonly clearance: number;
  /** How far apart visibility is sampled along a curve. */
  readonly step: number;
  readonly origin: Vec3;
  /** File units to drawing units. */
  readonly k: number;
  /** How far a fitted curve may stray, in drawing units. */
  readonly fitTol: number;
};

function diagonal(solids: readonly SolidFace[]): number {
  const lo = (k: 'x' | 'y' | 'z'): number => Math.min(...solids.map((f) => f.box[0][k]));
  const hi = (k: 'x' | 'y' | 'z'): number => Math.max(...solids.map((f) => f.box[1][k]));
  return Math.hypot(hi('x') - lo('x'), hi('y') - lo('y'), hi('z') - lo('z')) || 1;
}

/**
 * The three view directions. Up in the front view is the model's Y (else Z,
 * else X), whichever lies most square to the axis, turned about the axis by
 * the quarter turns asked for.
 */
function orient(dir: Vec3, o: ViewOrientation): { front: View; top: View; end: View } {
  const globals: Vec3[] = [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
  ];
  let g = globals[0]!;
  for (const c of globals) if (Math.abs(dot3(c, dir)) < Math.abs(dot3(g, dir)) - PARALLEL) g = c;
  const u0 = unit3(sub3(g, scale3(dir, dot3(g, dir))))!;
  // Quarter turns about the axis, exactly: u, axis × u, −u, −(axis × u).
  const side = cross3(dir, u0);
  const u = [u0, side, scale3(u0, -1), scale3(side, -1)][((o.turn % 4) + 4) % 4]!;
  const a = o.flip ? scale3(dir, -1) : dir;
  const w = cross3(a, u);
  return {
    front: { ex: a, ey: u, e: w },
    top: { ex: a, ey: scale3(w, -1), e: u },
    end: { ex: scale3(w, -1), ey: u, e: a },
  };
}

/** Every real edge once: not seams, not the line between a face split in two; tangent where its faces meet smoothly. */
function edges(faces: readonly StepFace[], tol: number): Draw[] {
  const uses = new Map<number, { edge: StepEdge; faces: StepFace[] }>();
  for (const f of faces) {
    for (const l of f.loops) {
      for (const e of l.edges) {
        const u = uses.get(e.id);
        if (u) u.faces.push(f);
        else uses.set(e.id, { edge: e, faces: [f] });
      }
    }
  }
  const out: Draw[] = [];
  for (const { edge, faces: [f1, f2] } of uses.values()) {
    const piece = edgePiece(edge, tol);
    if (!piece || !f1) continue;
    if (f2 && (f2.id === f1.id || sameSurface(f1.surface, f2.surface, tol))) continue;
    let style: Draw['style'] = 'visible';
    if (f2 && f1.surface.kind !== 'other' && f2.surface.kind !== 'other') {
      const mid = point3(piece.curve, (piece.t0 + piece.t1) / 2);
      if (length3(cross3(normalAt(f1.surface, mid), normalAt(f2.surface, mid))) <= PARALLEL) style = 'tangent';
    }
    out.push({ piece, style, on: f2 ? [f1.surface, f2.surface] : [f1.surface] });
  }
  return out;
}

/** Two surfaces that are one: the halves of a face split by the exporter. */
function sameSurface(s: StepSurface, t: StepSurface, tol: number): boolean {
  if (s.kind === 'other' || s.kind !== t.kind) return false;
  const par = (a: Vec3, b: Vec3): boolean => length3(cross3(a, b)) <= PARALLEL;
  const near = (a: Vec3, b: Vec3): boolean => length3(sub3(a, b)) <= tol;
  const onAxis = (p: Vec3): boolean => length3(cross3(sub3(p, s.at.origin), s.at.axis)) <= tol;
  const eq = (a: number, b: number): boolean => Math.abs(a - b) <= tol;
  switch (s.kind) {
    case 'plane':
      return par(s.at.axis, t.at.axis) && Math.abs(dot3(sub3(t.at.origin, s.at.origin), s.at.axis)) <= tol;
    case 'cylinder':
      return t.kind === 'cylinder' && eq(s.radius, t.radius) && par(s.at.axis, t.at.axis) && onAxis(t.at.origin);
    case 'sphere':
      return t.kind === 'sphere' && eq(s.radius, t.radius) && near(s.at.origin, t.at.origin);
    case 'torus':
      return t.kind === 'torus' && eq(s.major, t.major) && eq(s.minor, t.minor) && par(s.at.axis, t.at.axis) && near(s.at.origin, t.at.origin);
    case 'cone': {
      if (t.kind !== 'cone' || !eq(s.semiAngle, t.semiAngle) || !par(s.at.axis, t.at.axis)) return false;
      const apex = (c: typeof s): Vec3 => sub3(c.at.origin, scale3(c.at.axis, c.radius / Math.tan(c.semiAngle)));
      return near(apex(s), apex(t as typeof s));
    }
  }
}

/**
 * The outline of a curved face seen along `e` (toward the viewer): where
 * its surface turns away from the viewer, over the part of it that is the
 * face. A cylinder or cone gives two lines, a sphere a circle, a torus
 * seen square to or along its axis its circles.
 */
function outlines(f: SolidFace, e: Vec3, ctx: Ctx): Piece3[] {
  const s = f.surface;
  const at = s.at;
  const y = cross3(at.axis, at.ref);
  const full = (curve: Curve3): Piece3 => ({ curve, t0: 0, t1: 2 * Math.PI });
  const [vMin, vMax] = f.vSpan;
  let curves: Piece3[] = [];
  switch (s.kind) {
    case 'plane':
      return [];
    case 'cylinder': {
      const n = unit3(cross3(at.axis, e));
      if (!n || length3(cross3(at.axis, e)) <= PARALLEL) return [];
      curves = [1, -1].map((sg) => {
        const base = add3(at.origin, scale3(n, sg * s.radius));
        return { curve: { kind: 'line', a: add3(base, scale3(at.axis, vMin)), b: add3(base, scale3(at.axis, vMax)) }, t0: 0, t1: 1 };
      });
      break;
    }
    case 'cone': {
      const T = Math.tan(s.semiAngle);
      const [ex, ey, ek] = [dot3(e, at.ref), dot3(e, y), dot3(e, at.axis)];
      const rho = Math.hypot(ex, ey);
      if (rho === 0 || Math.abs(T * ek) > rho) return [];
      const phi0 = Math.atan2(ey, ex);
      const off = Math.acos((T * ek) / rho);
      const apexV = -s.radius / T;
      const [v0, v1] = [Math.max(vMin, apexV), vMax];
      curves = [phi0 + off, phi0 - off].map((th) => {
        const dirR = add3(scale3(at.ref, Math.cos(th)), scale3(y, Math.sin(th)));
        const P = (v: number): Vec3 => add3(add3(at.origin, scale3(dirR, s.radius + v * T)), scale3(at.axis, v));
        return { curve: { kind: 'line', a: P(v0), b: P(v1) }, t0: 0, t1: 1 };
      });
      break;
    }
    case 'sphere': {
      const ref = unit3(cross3(e, Math.abs(e.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 }))!;
      curves = [full({ kind: 'circle', center: at.origin, axis: e, ref, radius: s.radius })];
      break;
    }
    case 'torus': {
      const along = Math.abs(dot3(at.axis, e));
      if (1 - along <= PARALLEL) {
        curves = [s.major + s.minor, s.major - s.minor].filter((r) => r > ctx.tol).map((r) => full({ kind: 'circle', center: at.origin, axis: at.axis, ref: at.ref, radius: r }));
      } else if (along <= PARALLEL) {
        const d = unit3(cross3(at.axis, e))!;
        curves = [
          ...[1, -1].map((sg) => full({ kind: 'circle', center: add3(at.origin, scale3(d, sg * s.major)), axis: cross3(d, at.axis), ref: scale3(d, sg), radius: s.minor })),
          // The rims (where the tube faces along the axis), seen edge-on; a rim the face's boundary runs along is that edge
          // (a fillet meeting a flat face), already drawn, and clipping it to the face would only be rounding either way.
          ...[1, -1]
            .filter((sg) => !f.segs.some((g) => onRim(g.p.v, sg) && onRim(g.q.v, sg)))
            .map((sg) => full({ kind: 'circle', center: add3(at.origin, scale3(at.axis, sg * s.minor)), axis: at.axis, ref: at.ref, radius: s.major })),
        ];
      }
      break;
    }
  }
  return curves.flatMap((p) => clip(p, (q) => insideFace(f, q, 0), ctx));
}

/** Whether a torus parameter v is its rim on the `sg` side (v = ±π/2, a whole number of turns either way). */
function onRim(v: number, sg: number): boolean {
  const off = v - (sg * Math.PI) / 2;
  return Math.abs(off - 2 * Math.PI * Math.round(off / (2 * Math.PI))) <= PARALLEL;
}

/** The parts of the piece where `keep` holds: sampled, then each change narrowed down. */
function clip(p: Piece3, keep: (q: Vec3) => boolean, ctx: Ctx): Piece3[] {
  const n = samplesFor(p, ctx);
  const ts = Array.from({ length: n + 1 }, (_, i) => p.t0 + ((p.t1 - p.t0) * i) / n);
  const ok = ts.map((t) => keep(point3(p.curve, t)));
  const out: Piece3[] = [];
  let start: number | undefined = ok[0] ? p.t0 : undefined;
  for (let i = 1; i <= n; i++) {
    if (ok[i] === ok[i - 1]) continue;
    const t = snapToEnd(p, narrow(p.curve, ts[i - 1]!, ts[i]!, ok[i - 1]!, keep), ctx);
    if (ok[i]) start = t;
    else if (start !== undefined) {
      out.push({ curve: p.curve, t0: start, t1: t });
      start = undefined;
    }
  }
  if (start !== undefined) out.push({ curve: p.curve, t0: start, t1: p.t1 });
  return out.filter((q) => length3(sub3(point3(q.curve, q.t1), point3(q.curve, q.t0))) > ctx.tol || q.t1 - q.t0 > 1e-6);
}

/**
 * A change found within the clearance of the piece's end is at the end: where
 * the piece runs tangent into a face (a fillet meeting a shoulder), the test
 * either side of the end differs only to the square of the distance, so the
 * change lands short by about the square root of rounding.
 */
function snapToEnd(p: Piece3, t: number, ctx: Ctx): number {
  const q = point3(p.curve, t);
  // The end nearer along the piece: a full circle's two ends are one point, and the far one would turn the piece inside out.
  const end = t - p.t0 <= p.t1 - t ? p.t0 : p.t1;
  if (length3(sub3(q, point3(p.curve, end))) <= ctx.clearance) return end;
  return t;
}

/** Where `keep` changes between a (where it is `atA`) and b. */
function narrow(c: Curve3, a: number, b: number, atA: boolean, keep: (q: Vec3) => boolean): number {
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (keep(point3(c, m)) === atA) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

function samplesFor(p: Piece3, ctx: Ctx): number {
  const pts = samples3(p, 64);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += length3(sub3(pts[i]!, pts[i - 1]!));
  return Math.min(2000, Math.max(8, Math.ceil(len / ctx.step)));
}

/** The piece split into what the viewer sees and what material hides. */
function seen(d: Draw, v: View, ctx: Ctx): { piece: Piece3; style: Style }[] {
  const hidden = (q: Vec3): boolean => blocked(q, v.e, ctx);
  const shown = clip(d.piece, (q) => !hidden(q), ctx).map((piece) => ({ piece, style: d.style as Style }));
  const behind = clip(d.piece, hidden, ctx).map((piece) => ({ piece, style: 'hidden' as Style }));
  return [...shown, ...behind];
}

/** Whether material lies between `q` and the viewer: a face the ray toward the viewer passes through. */
function blocked(q: Vec3, e: Vec3, ctx: Ctx): boolean {
  for (const f of ctx.solids) {
    if (!rayMeetsBox(f.box, q, e, ctx.tol)) continue;
    for (const t of rayHits(f.surface, q, e)) {
      // Strictly inside: a ray grazing a face's edge passes it.
      if (t > ctx.clearance && insideFace(f, add3(q, scale3(e, t)), 0)) return true;
    }
  }
  return false;
}

/**
 * The piece in the view's coordinates: exact for lines, for circles face-on
 * or edge-on, and for any curve on a cylinder seen end-on (it lies on that
 * cylinder's circle); fitted otherwise.
 */
function project(p: Piece3, style: Style, v: View, ctx: Ctx, on: readonly StepSurface[]): ProfileCurve[] {
  const marks = style === 'visible' ? {} : { style };
  const to2 = (q: Vec3): Vec2 => {
    const w = sub3(q, ctx.origin);
    return { x: dot3(w, v.ex) * ctx.k, y: dot3(w, v.ey) * ctx.k };
  };
  const dir2 = (d: Vec3): Vec2 => ({ x: dot3(d, v.ex), y: dot3(d, v.ey) });
  const c = p.curve;
  if (c.kind === 'line') {
    const [a, b] = [to2(point3(c, p.t0)), to2(point3(c, p.t1))];
    return Math.hypot(b.x - a.x, b.y - a.y) <= ctx.tol * ctx.k ? [] : [{ kind: 'line', start: a, end: b, ...marks }];
  }
  if (c.kind === 'circle' || c.kind === 'ellipse') {
    const facing = dot3(c.axis, v.e);
    const [ra, rb] = c.kind === 'circle' ? [c.radius, c.radius] : [c.a, c.b];
    const r2 = dir2(c.ref);
    const s2 = dir2(cross3(c.axis, c.ref));
    if (c.kind === 'circle' && 1 - Math.abs(facing) <= PARALLEL) {
      const center = to2(c.center);
      const radius = c.radius * ctx.k;
      if (p.t1 - p.t0 >= 2 * Math.PI - PARALLEL) return [{ kind: 'circle', center, radius, ...marks }];
      const a0 = Math.atan2(r2.y, r2.x);
      const deg = (a: number): number => (a * 180) / Math.PI;
      const [s, e] = facing > 0 ? [a0 + p.t0, a0 + p.t1] : [a0 - p.t1, a0 - p.t0];
      return [{ kind: 'arc', center, radius, startDeg: deg(s), endDeg: deg(e), ...marks }];
    }
    if (Math.abs(facing) <= PARALLEL) {
      // Edge-on: a line, from the nearest to the farthest the curve reaches along it.
      const L = Math.hypot(r2.x, r2.y) >= Math.hypot(s2.x, s2.y) ? r2 : s2;
      const len = Math.hypot(L.x, L.y);
      const u = { x: L.x / len, y: L.y / len };
      const A = ra * (r2.x * u.x + r2.y * u.y);
      const B = rb * (s2.x * u.x + s2.y * u.y);
      const f = (t: number): number => A * Math.cos(t) + B * Math.sin(t);
      const peak = Math.atan2(B, A);
      const ts = [p.t0, p.t1];
      for (let m = -4; m <= 4; m++) {
        const t = peak + m * Math.PI;
        if (t > p.t0 && t < p.t1) ts.push(t);
      }
      const vals = ts.map(f);
      const c2 = to2(c.center);
      const at = (x: number): Vec2 => ({ x: c2.x + u.x * x * ctx.k, y: c2.y + u.y * x * ctx.k });
      const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      return (hi - lo) * ctx.k <= ctx.tol * ctx.k ? [] : [{ kind: 'line', start: at(lo), end: at(hi), ...marks }];
    }
  }
  const pts = samples3(p, 256).map(to2);
  const tube = on.find((s): s is Extract<StepSurface, { kind: 'cylinder' }> => s.kind === 'cylinder' && 1 - Math.abs(dot3(s.at.axis, v.e)) <= PARALLEL);
  if (tube) {
    const center = to2(tube.at.origin);
    const radius = tube.radius * ctx.k;
    const arc = arcCovering(center, radius, pts, ctx.tol * ctx.k);
    return arc ? [{ ...arc, ...marks }] : [];
  }
  return fit(pts, ctx.fitTol).map((f) => ({ ...f, ...marks, fitted: true }));
}

/** The arc of the circle (center, radius) the points run along: the circle less the widest gap between them; the whole circle when they go all round. */
function arcCovering(center: Vec2, radius: number, pts: readonly Vec2[], tol: number): ProfileCurve | undefined {
  const angles = pts.map((q) => Math.atan2(q.y - center.y, q.x - center.x)).sort((a, b) => a - b);
  if (angles.length < 2 || (angles.at(-1)! - angles[0]!) * radius <= tol) return undefined;
  let gapAt = angles.length - 1;
  let gap = angles[0]! + 2 * Math.PI - angles.at(-1)!;
  for (let i = 1; i < angles.length; i++) {
    const g = angles[i]! - angles[i - 1]!;
    if (g > gap) [gap, gapAt] = [g, i - 1];
  }
  // Gaps no wider than the sampling leaves: the points go all the way round.
  const step = (2 * Math.PI) / Math.max(angles.length - 1, 1);
  if (gap <= 2 * step && gap * radius <= Math.max(tol, radius * step * 2)) {
    const first = pts[0]!;
    const last = pts.at(-1)!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tol) return { kind: 'circle', center, radius };
  }
  const deg = (a: number): number => (a * 180) / Math.PI;
  return { kind: 'arc', center, radius, startDeg: deg(angles[(gapAt + 1) % angles.length]!), endDeg: deg(angles[gapAt]!) };
}

/** Lines and arcs through the points, none straying more than `fitTol` from them. */
export function fit(pts: readonly Vec2[], fitTol: number): ProfileCurve[] {
  const out: ProfileCurve[] = [];
  const go = (i: number, j: number): void => {
    const a = pts[i]!;
    const b = pts[j]!;
    const chord = (q: Vec2): number => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      return len === 0 ? Math.hypot(q.x - a.x, q.y - a.y) : Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / len;
    };
    let straight = true;
    for (let k = i + 1; k < j; k++) if (chord(pts[k]!) > fitTol) straight = false;
    if (straight) {
      if (Math.hypot(b.x - a.x, b.y - a.y) > 0) out.push({ kind: 'line', start: a, end: b });
      return;
    }
    const m = Math.floor((i + j) / 2);
    const arc = arcThrough(a, pts[m]!, b);
    if (arc && j - i >= 2) {
      let good = true;
      for (let k = i + 1; k < j && good; k++) {
        const q = pts[k]!;
        if (Math.abs(Math.hypot(q.x - arc.center.x, q.y - arc.center.y) - arc.radius) > fitTol) good = false;
        // Each point must lie within the arc's sweep, in order.
        const rel = (((Math.atan2(q.y - arc.center.y, q.x - arc.center.x) * 180) / Math.PI - arc.from) * arc.dir + 720) % 360;
        if (rel > arc.sweep + 1e-9) good = false;
      }
      if (good) {
        out.push(arc.dir > 0 ? { kind: 'arc', center: arc.center, radius: arc.radius, startDeg: arc.from, endDeg: arc.from + arc.sweep } : { kind: 'arc', center: arc.center, radius: arc.radius, startDeg: arc.from - arc.sweep, endDeg: arc.from });
        return;
      }
    }
    if (j - i < 2) {
      out.push({ kind: 'line', start: a, end: b });
      return;
    }
    go(i, m);
    go(m, j);
  };
  if (pts.length >= 2) go(0, pts.length - 1);
  return out;
}

/** The arc from a through m to b: its centre, radius, start angle (degrees), which way it runs (+1 CCW) and how far. */
function arcThrough(a: Vec2, m: Vec2, b: Vec2): { center: Vec2; radius: number; from: number; dir: number; sweep: number } | undefined {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (d === 0) return undefined;
  const sq = (p: Vec2): number => p.x * p.x + p.y * p.y;
  const center = {
    x: (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d,
    y: (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d,
  };
  const radius = Math.hypot(a.x - center.x, a.y - center.y);
  const ang = (p: Vec2): number => (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  const dir = (m.x - a.x) * (b.y - m.y) - (m.y - a.y) * (b.x - m.x) > 0 ? 1 : -1;
  const sweep = ((((ang(b) - ang(a)) * dir) % 360) + 360) % 360;
  return { center, radius, from: ang(a), dir, sweep };
}

const RANK: Record<Style, number> = { visible: 0, tangent: 1, hidden: 2 };
const styleOf = (c: ProfileCurve): Style => c.style ?? 'visible';

/** Hidden and tangent pieces under a stronger line dropped, then lines and arcs on one carrier joined. */
function tidy(curves: readonly ProfileCurve[], ctx: Ctx): ProfileCurve[] {
  const cover = ctx.fitTol * 4;
  const out: ProfileCurve[] = [];
  for (const c of curves) {
    const stronger = curves.filter((o) => RANK[styleOf(o)] < RANK[styleOf(c)]);
    out.push(...uncovered(c, stronger, cover));
  }
  return merge(out, ctx.tol * ctx.k);
}

/** What of `c` no curve of `over` lies on. */
function uncovered(c: ProfileCurve, over: readonly ProfileCurve[], tol: number): ProfileCurve[] {
  if (over.length === 0) return [c];
  if (c.kind === 'line') {
    const dx = c.end.x - c.start.x;
    const dy = c.end.y - c.start.y;
    const len = Math.hypot(dx, dy);
    const u = { x: dx / len, y: dy / len };
    const t = (p: Vec2): number => (p.x - c.start.x) * u.x + (p.y - c.start.y) * u.y;
    const off = (p: Vec2): number => Math.abs((p.x - c.start.x) * u.y - (p.y - c.start.y) * u.x);
    const spans = over.filter((o): o is Extract<ProfileCurve, { kind: 'line' }> => o.kind === 'line' && off(o.start) <= tol && off(o.end) <= tol).map((o) => [Math.min(t(o.start), t(o.end)), Math.max(t(o.start), t(o.end))] as [number, number]);
    return gaps(0, len, spans, tol).map(([a, b]) => ({ ...c, start: { x: c.start.x + u.x * a, y: c.start.y + u.y * a }, end: { x: c.start.x + u.x * b, y: c.start.y + u.y * b } }));
  }
  const same = over.filter((o): o is Exclude<ProfileCurve, { kind: 'line' }> => o.kind !== 'line' && Math.hypot(o.center.x - c.center.x, o.center.y - c.center.y) <= tol && Math.abs(o.radius - c.radius) <= tol);
  if (same.length === 0) return [c];
  const start = c.kind === 'circle' ? 0 : c.startDeg;
  const sweep = c.kind === 'circle' ? 360 : ((((c.endDeg - c.startDeg) % 360) + 360) % 360);
  const rel = (a: number): number => (((a - start) % 360) + 360) % 360;
  const spans: [number, number][] = [];
  for (const o of same) {
    if (o.kind === 'circle') return [];
    const s = rel(o.startDeg);
    const w = (((o.endDeg - o.startDeg) % 360) + 360) % 360;
    spans.push([s, s + w]);
    if (s + w > 360) spans.push([0, s + w - 360]);
  }
  const degTol = ((tol / c.radius) * 180) / Math.PI;
  return gaps(0, sweep, spans, degTol).map(([a, b]): ProfileCurve => ({ kind: 'arc', center: c.center, radius: c.radius, startDeg: start + a, endDeg: start + b, ...(c.style ? { style: c.style } : {}), ...(c.fitted ? { fitted: true as const } : {}) }));
}

/** The parts of [lo, hi] no span covers, each longer than tol. */
function gaps(lo: number, hi: number, spans: readonly [number, number][], tol: number): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of sorted) {
    if (a > at + tol) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
    if (at >= hi) break;
  }
  if (hi > at + tol) out.push([at, hi]);
  return out.filter(([a, b]) => b - a > tol);
}
