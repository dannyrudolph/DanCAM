import { type Vec3, add3, cross3, dot3, length3, scale3, sub3 } from '../../geometry/vec3';
import { edgePiece, samples3 } from './curve3';
import type { Placement, StepFace, StepSurface } from './stepModel';

/**
 * A face of the solid as the three views ask about it: where a ray from a
 * point meets its surface, and whether a point of the surface lies inside
 * the face. The test works in the surface's own coordinates (u around,
 * v along, for a surface of revolution), with the face's boundary loops
 * carried over: the first boundary a path from the point crosses, and
 * which way that boundary runs, says which side the face is on (STEP
 * loops keep the face on their left, seen from the face's normal).
 */

type Surface = Exclude<StepSurface, { kind: 'other' }>;
type UV = { readonly u: number; readonly v: number };
/** A boundary piece in (u, v), run the way its loop runs. */
type Seg = { readonly p: UV; readonly q: UV; /** p and q as uvOf gives them, before unwrapping: equal points, equal values */ readonly pr: UV; readonly qr: UV };

export type SolidFace = {
  readonly face: StepFace;
  readonly surface: Surface;
  /** The box the face lies in: [min, max]. */
  readonly box: readonly [Vec3, Vec3];
  readonly segs: readonly Seg[];
  /** The face lies to the left of its loops in (u, v), which is right-handed about the surface's normal. */
  readonly left: boolean;
  /** The lowest and highest v its boundary reaches, seams and vertices (a cone's apex) included. */
  readonly vSpan: readonly [number, number];
};

const TURN = 2 * Math.PI;
const wrap = (a: number): number => ((a % TURN) + TURN) % TURN;

/** The local frame of a placement: x along ref, y = axis × ref, z along the axis. */
function local(at: Placement, p: Vec3): Vec3 {
  const w = sub3(p, at.origin);
  return { x: dot3(w, at.ref), y: dot3(w, cross3(at.axis, at.ref)), z: dot3(w, at.axis) };
}

/** True when u wraps round (an angle), and when v does (a torus's tube angle). */
const periodic = (s: Surface): [boolean, boolean] => [s.kind !== 'plane', s.kind === 'torus'];

/** (u, v) of a point on the surface; u is undefined on the axis of a surface of revolution. */
export function uvOf(s: Surface, p: Vec3): { u: number | undefined; v: number } {
  const q = local(s.at, p);
  if (s.kind === 'plane') return { u: q.x, v: q.y };
  const rho = Math.hypot(q.x, q.y);
  const u = rho === 0 ? undefined : Math.atan2(q.y, q.x);
  switch (s.kind) {
    case 'cylinder':
    case 'cone':
      return { u, v: q.z };
    case 'sphere':
      return { u, v: Math.atan2(q.z, rho) };
    case 'torus':
      return { u, v: Math.atan2(q.z, rho - s.major) };
  }
}

/** The surface's normal at a point of it (outward from its axis or centre, along a plane's axis), as a unit vector. */
export function normalAt(s: Surface, p: Vec3): Vec3 {
  const at = s.at;
  const q = local(at, p);
  const y = cross3(at.axis, at.ref);
  const radial = (): Vec3 => {
    const rho = Math.hypot(q.x, q.y) || 1;
    return add3(scale3(at.ref, q.x / rho), scale3(y, q.y / rho));
  };
  switch (s.kind) {
    case 'plane':
      return at.axis;
    case 'cylinder':
      return radial();
    case 'cone': {
      const n = sub3(radial(), scale3(at.axis, Math.tan(s.semiAngle)));
      return scale3(n, 1 / length3(n));
    }
    case 'sphere': {
      const w = sub3(p, at.origin);
      return scale3(w, 1 / (length3(w) || 1));
    }
    case 'torus': {
      const c = add3(at.origin, scale3(radial(), s.major)); // the tube's centre circle
      const w = sub3(p, c);
      return scale3(w, 1 / (length3(w) || 1));
    }
  }
}

/** The face prepared for the views; undefined for a surface the views can't take (freeform). */
/**
 * Every face prepared, with the side its loops keep it on. By the standard
 * the face lies left of its loops seen from its own normal (the surface's,
 * or reversed when not sameSense), and so a closed solid runs each edge
 * once each way. Some exporters write a face's loops backwards (OpenCascade
 * does for a reversed torus), so a face whose shared edges mostly run the
 * same way as its neighbours' is taken the other way round.
 */
export function solidFaces(faces: readonly StepFace[], tol: number): SolidFace[] {
  const runs = new Map<number, { face: number; forward: boolean }[]>();
  for (const f of faces) for (const l of f.loops) for (const e of l.edges) runs.set(e.id, [...(runs.get(e.id) ?? []), { face: f.id, forward: e.forward }]);
  const out: SolidFace[] = [];
  for (const f of faces) {
    let [agree, disagree] = [0, 0];
    for (const l of f.loops) {
      for (const e of l.edges) {
        for (const o of runs.get(e.id) ?? []) {
          if (o.face === f.id) continue;
          if (o.forward !== e.forward) agree++;
          else disagree++;
        }
      }
    }
    const sf = solidFace(f, tol, disagree > agree);
    if (sf) out.push(sf);
  }
  return out;
}

export function solidFace(face: StepFace, tol: number, backwards = false): SolidFace | undefined {
  if (face.surface.kind === 'other') return undefined;
  const s = face.surface;
  const [pu, pv] = periodic(s);
  const segs: Seg[] = [];
  const pts: Vec3[] = [];
  // A seam (an edge the face runs both ways, where a periodic surface meets itself) bounds nothing.
  const count = new Map<number, number>();
  for (const l of face.loops) for (const e of l.edges) count.set(e.id, (count.get(e.id) ?? 0) + 1);
  const span: number[] = [];
  for (const loop of face.loops) {
    if (loop.vertex) span.push(uvOf(s, loop.vertex).v);
    for (const e of loop.edges) {
      if (count.get(e.id)! > 1) {
        span.push(uvOf(s, e.start).v, uvOf(s, e.end).v);
        continue;
      }
      const piece = edgePiece(e, tol);
      let ps = piece ? samples3(piece, 128) : [e.start, e.end];
      // Samples run along the curve (a circle's counter-clockwise from the end it starts at); the loop may run the other way.
      const kind = piece?.curve.kind;
      const runsForward = kind === 'circle' || kind === 'ellipse' ? e.sameSense : isForward(ps, e);
      // The ends exactly at the vertices, so edges meeting there (and a closed circle's two ends) give the same (u, v).
      ps[0] = runsForward ? e.start : e.end;
      ps[ps.length - 1] = runsForward ? e.end : e.start;
      if (runsForward !== e.forward) ps = ps.reverse();
      pts.push(...ps);
      const uv = ps.map((p) => uvOf(s, p));
      // On the axis u has no value: take the neighbour's.
      for (let i = 0; i < uv.length; i++) if (uv[i]!.u === undefined) uv[i] = { ...uv[i]!, u: uv[i - 1]?.u ?? uv.find((w) => w.u !== undefined)?.u ?? 0 };
      let prev: { at: UV; raw: UV } | undefined;
      for (const w of uv) {
        const raw: UV = { u: w.u!, v: w.v };
        let cur = raw;
        if (prev) {
          if (pu) cur = { ...cur, u: cur.u + TURN * Math.round((prev.at.u - cur.u) / TURN) };
          if (pv) cur = { ...cur, v: cur.v + TURN * Math.round((prev.at.v - cur.v) / TURN) };
          segs.push({ p: prev.at, q: cur, pr: prev.raw, qr: raw });
        }
        prev = { at: cur, raw };
      }
    }
  }
  for (const g of segs) span.push(g.p.v, g.q.v);
  return { face, surface: s, box: boxOf(s, pts), segs, left: face.sameSense !== backwards, vSpan: [Math.min(...span), Math.max(...span)] };
}

/** True when the samples (taken along the curve) run from the edge's start to its end. */
function isForward(ps: readonly Vec3[], e: { start: Vec3; end: Vec3 }): boolean {
  const first = ps[0]!;
  return length3(sub3(first, e.start)) <= length3(sub3(first, e.end));
}

function boxOf(s: Surface, pts: readonly Vec3[]): [Vec3, Vec3] {
  const all = [...pts];
  // A sphere or torus can bulge past its boundary (a ball end's pole): take its whole box.
  if (s.kind === 'sphere' || s.kind === 'torus') {
    const r = s.kind === 'sphere' ? s.radius : s.major + s.minor;
    for (const k of [-1, 1]) all.push(add3(s.at.origin, { x: k * r, y: k * r, z: k * r }));
  }
  const lo = { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)), z: Math.min(...all.map((p) => p.z)) };
  const hi = { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)), z: Math.max(...all.map((p) => p.z)) };
  return [lo, hi];
}

/** How far a step in u and in v moves along the surface at `uv`, so (u, v) distances can be judged in lengths. */
function scales(s: Surface, uv: UV): [number, number] {
  switch (s.kind) {
    case 'plane':
      return [1, 1];
    case 'cylinder':
      return [s.radius, 1];
    case 'cone':
      return [Math.max(Math.abs(s.radius + uv.v * Math.tan(s.semiAngle)), 1e-300), 1];
    case 'sphere':
      return [s.radius * Math.max(Math.cos(uv.v), 1e-300), s.radius];
    case 'torus':
      return [Math.max(s.major + s.minor * Math.cos(uv.v), 1e-300), s.minor];
  }
}

/** Whether point `p` (on the face's surface) lies inside the face; within `tol` of its boundary counts as inside (0: strictly inside). */
export function insideFace(f: SolidFace, p: Vec3, tol: number): boolean {
  const s = f.surface;
  const w = uvOf(s, p);
  const h: UV = { u: w.u ?? 0, v: w.v };
  const [pu, pv] = periodic(s);
  const [su, sv] = scales(s, h);
  // On the boundary? (tol 0: only strictly inside counts)
  if (tol > 0) for (const g of f.segs) if (segDistance(g, h, pu, pv, su, sv) <= tol) return true;
  const left = f.left;
  const verdict = (hit: Hit | undefined): boolean | undefined => (hit === undefined ? undefined : hit.leftOfPath !== left);
  // Along v from the point: up the meridian (over a sphere's pole and back round), or a torus's tube all the way round.
  const meridian = (u: number, v: number): Hit | undefined => {
    if (s.kind !== 'sphere') return alongV(f.segs, u, v, pv ? v + TURN : Infinity, 1, pu, pv);
    const legs: [number, number, number, number][] = [
      [u, v, Math.PI / 2, 1],
      [u + Math.PI, Math.PI / 2, -Math.PI / 2, -1],
      [u, -Math.PI / 2, v, 1],
    ];
    for (const [lu, from, to, dir] of legs) {
      const hit = alongV(f.segs, lu, from, to, dir, pu);
      if (hit) return hit;
    }
    return undefined;
  };
  const up = meridian(h.u, h.v);
  if (up) return verdict(up)!;
  // A cylinder, cone or plane runs on past its boundary: nothing crossed, so outside.
  if (s.kind !== 'sphere' && s.kind !== 'torus') return false;
  // A sphere or torus closes on itself: where its meridian meets no boundary (a slot cut through a fillet), go round
  // the axis to a meridian that does, then along it, and take the first boundary crossed on that path.
  const target = f.segs.find((g) => g.q.u !== g.p.u);
  if (!target) return true; // no boundary across any meridian: the face is the whole surface round
  const uT = (target.pr.u + target.qr.u) / 2;
  const round = alongU(f.segs, h.u, h.v, pv, wrap(uT - h.u));
  if (round) return verdict(round)!;
  const there = meridian(uT, h.v);
  return there ? verdict(there)! : true;
}

type Hit = { readonly at: number; readonly leftOfPath: boolean };

/**
 * The first boundary crossed going from v = from toward v = to (direction
 * `dir`, ±1) at u, and whether the face side of that boundary (its left)
 * lies ahead of the path.
 */
function alongV(segs: readonly Seg[], u: number, from: number, to: number, dir: number, pu: boolean, pv = false): Hit | undefined {
  let best: Hit | undefined;
  for (const { p, q, pr, qr } of segs) {
    const du = q.u - p.u;
    const dp = offset(u - pr.u, pu);
    if (du === 0 || !crosses(du, dp, offset(u - qr.u, pu))) continue;
    let v = p.v + (dp * (q.v - p.v)) / du;
    if (pv) v = from + wrap(v - from);
    const at = (v - from) * dir;
    if (at <= 0 || at > Math.abs(to - from)) continue;
    // A boundary running +u has its left (the face) on its +v side.
    if (!best || at < best.at) best = { at, leftOfPath: du * dir > 0 };
  }
  return best;
}

/** The first boundary crossed going round in +u at v, as far as `upTo` (the full turn when not given). */
function alongU(segs: readonly Seg[], u: number, v: number, pv: boolean, upTo = TURN): Hit | undefined {
  let best: Hit | undefined;
  for (const { p, q, pr, qr } of segs) {
    const dv = q.v - p.v;
    const dp = offset(v - pr.v, pv);
    if (dv === 0 || !crosses(dv, dp, offset(v - qr.v, pv))) continue;
    const uc = p.u + (dp * (q.u - p.u)) / dv;
    const at = wrap(uc - u);
    if (at <= 0 || at > upTo) continue;
    // A boundary running +v has its left on its −u side: behind a path going +u.
    if (!best || at < best.at) best = { at, leftOfPath: dv < 0 };
  }
  return best;
}

/** A difference of coordinates; of angles, the short way round. */
const offset = (x: number, per: boolean): number => (per ? x - TURN * Math.round(x / TURN) : x);

/**
 * Whether a path at coordinate c crosses a boundary piece from p to q (a
 * step of `d`), given c − p and c − q: half-open, so a path through the
 * point where two pieces meet crosses exactly one of them.
 */
const crosses = (d: number, fromP: number, fromQ: number): boolean => (d > 0 ? fromP >= 0 && fromQ < 0 : fromQ >= 0 && fromP < 0);

/** The distance on the surface (approximately, by the local scales) from h to a boundary piece. */
function segDistance(g: Seg, h: UV, pu: boolean, pv: boolean, su: number, sv: number): number {
  const shift = (a: number, b: number, per: boolean): number => (per ? b + TURN * Math.round((a - b) / TURN) : b);
  const pu0 = shift(h.u, g.p.u, pu);
  const off = pu0 - g.p.u;
  const pv0 = shift(h.v, g.p.v, pv);
  const offv = pv0 - g.p.v;
  const a = { x: pu0 * su, y: pv0 * sv };
  const b = { x: (g.q.u + off) * su, y: (g.q.v + offv) * sv };
  const x = { x: h.u * su, y: h.v * sv };
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len2 = d.x * d.x + d.y * d.y;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x.x - a.x) * d.x + (x.y - a.y) * d.y) / len2));
  return Math.hypot(x.x - a.x - t * d.x, x.y - a.y - t * d.y);
}

/** Where the ray from `o` along unit `d` meets the surface: every t > 0 (unsorted). */
export function rayHits(s: Surface, o: Vec3, d: Vec3): number[] {
  const at = s.at;
  switch (s.kind) {
    case 'plane': {
      const den = dot3(d, at.axis);
      if (den === 0) return [];
      const t = dot3(sub3(at.origin, o), at.axis) / den;
      return t > 0 ? [t] : [];
    }
    case 'sphere': {
      const w = sub3(o, at.origin);
      return quadratic(1, 2 * dot3(w, d), dot3(w, w) - s.radius * s.radius);
    }
    case 'cylinder': {
      const w = sub3(o, at.origin);
      const wp = sub3(w, scale3(at.axis, dot3(w, at.axis)));
      const dp = sub3(d, scale3(at.axis, dot3(d, at.axis)));
      return quadratic(dot3(dp, dp), 2 * dot3(wp, dp), dot3(wp, wp) - s.radius * s.radius);
    }
    case 'cone': {
      const T = Math.tan(s.semiAngle);
      const w = sub3(o, at.origin);
      const h0 = dot3(w, at.axis);
      const hd = dot3(d, at.axis);
      const r0 = sub3(w, scale3(at.axis, h0));
      const rd = sub3(d, scale3(at.axis, hd));
      const k0 = s.radius + T * h0;
      const ts = quadratic(dot3(rd, rd) - T * T * hd * hd, 2 * dot3(r0, rd) - 2 * T * hd * k0, dot3(r0, r0) - k0 * k0);
      return ts.filter((t) => k0 + T * hd * t >= 0); // this nappe of the double cone
    }
    case 'torus': {
      const w = sub3(o, at.origin);
      const R = s.major;
      const r = s.minor;
      const f = (t: number): number => {
        const p = add3(w, scale3(d, t));
        const pp = dot3(p, p);
        const z = dot3(p, at.axis);
        return (pp + R * R - r * r) ** 2 - 4 * R * R * (pp - z * z);
      };
      // Within the sphere round the torus, look for sign changes, then narrow each.
      const around = quadratic(1, 2 * dot3(w, d), dot3(w, w) - (R + r) ** 2);
      const far = Math.max(0, ...around);
      if (far === 0) return [];
      const n = 96;
      const out: number[] = [];
      let a = 0;
      let fa = f(a);
      for (let i = 1; i <= n; i++) {
        const b = (far * i) / n;
        const fb = f(b);
        if (fa === 0 && a > 0) out.push(a);
        else if (fa * fb < 0) {
          let [lo, hi, flo] = [a, b, fa];
          for (let k = 0; k < 60; k++) {
            const m = (lo + hi) / 2;
            const fm = f(m);
            if (flo * fm <= 0) hi = m;
            else [lo, flo] = [m, fm];
          }
          out.push((lo + hi) / 2);
        }
        [a, fa] = [b, fb];
      }
      return out;
    }
  }
}

/** The positive roots of a t² + b t + c (a line, when a is 0). */
function quadratic(a: number, b: number, c: number): number[] {
  if (a === 0) return b === 0 ? [] : [-c / b].filter((t) => t > 0);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  // The stable form: no cancellation in either root.
  const q = -0.5 * (b + (b >= 0 ? sq : -sq));
  const roots = q === 0 ? [0] : [q / a, c / q];
  return roots.filter((t) => t > 0);
}

/** Whether the ray from `o` along `d` passes through the box (beyond t = 0). */
export function rayMeetsBox(box: readonly [Vec3, Vec3], o: Vec3, d: Vec3, pad: number): boolean {
  let t0 = 0;
  let t1 = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const lo = box[0][k] - pad;
    const hi = box[1][k] + pad;
    if (d[k] === 0) {
      if (o[k] < lo || o[k] > hi) return false;
      continue;
    }
    let a = (lo - o[k]) / d[k];
    let b = (hi - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
