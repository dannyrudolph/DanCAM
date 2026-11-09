import type { Circle } from './circle';
import { circleCircle, lineCircle, lineLine } from './intersect';
import { TOL } from './tolerance';
import { type Vec2, cross, distance, dot, sub } from './vec';

/**
 * Something a circle can be tangent to: an infinite line through `a` and `b`,
 * or a full circle. Arcs are passed as their full circle (as in AutoCAD).
 */
export type TangentTarget =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number };

type NormalLine = { nx: number; ny: number; c: number }; // n·P = c, |n| = 1

function normalForm(a: Vec2, b: Vec2): NormalLine | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= TOL) return undefined;
  const nx = -dy / len;
  const ny = dx / len;
  return { nx, ny, c: nx * a.x + ny * a.y };
}

function sameCircle(a: Circle, b: Circle): boolean {
  return distance(a.center, b.center) <= TOL && Math.abs(a.radius - b.radius) <= TOL;
}

/** Drops repeats, and any "solution" that is just one of the target circles itself. */
function dedupe(circles: Circle[], targets: readonly TangentTarget[]): Circle[] {
  const out: Circle[] = [];
  for (const c of circles) {
    if (targets.some((t) => t.kind === 'circle' && sameCircle(t, c))) continue;
    if (!out.some((o) => sameCircle(o, c))) out.push(c);
  }
  return out;
}

/** Centers at distance `r` from a line: its two parallel offsets, as point + direction. */
function offsets(l: NormalLine, r: number): [Vec2, Vec2][] {
  const dir = { x: l.ny, y: -l.nx };
  return [r, -r].map((k) => [{ x: l.nx * (l.c + k), y: l.ny * (l.c + k) }, dir]);
}

/** The foot of the perpendicular from `p` to the line through `a` along the unit vector `d`. */
function foot(p: Vec2, a: Vec2, d: Vec2): Vec2 {
  const t = dot(sub(p, a), d);
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

/** Radii a center can sit at from a circle of radius R, for tangency with radius r. */
function ringRadii(R: number, r: number): number[] {
  return [R + r, Math.abs(R - r)];
}

/**
 * Every circle of radius `r` tangent to both targets (Tangent-Tangent-Radius).
 *
 * Two parallel lines exactly `2r` apart are touched by a whole row of circles
 * centered on the midline; `hint` picks the one centered nearest it (the
 * caller passes the midpoint of the picks). Without a hint that case gives
 * nothing.
 */
export function tangentTangentRadius(t1: TangentTarget, t2: TangentTarget, r: number, hint?: Vec2): Circle[] {
  if (r <= TOL) return [];
  if (t1.kind === 'circle' && t2.kind === 'line') return tangentTangentRadius(t2, t1, r, hint);
  const centers: Vec2[] = [];
  if (t1.kind === 'line' && t2.kind === 'line') {
    const l1 = normalForm(t1.a, t1.b);
    const l2 = normalForm(t2.a, t2.b);
    if (!l1 || !l2) return [];
    for (const [p1, d1] of offsets(l1, r)) {
      for (const [p2, d2] of offsets(l2, r)) {
        const c = lineLine(p1, d1, p2, d2);
        if (c) centers.push(c);
        else if (hint && Math.abs(cross(sub(p2, p1), d1)) <= TOL) centers.push(foot(hint, p1, d1));
      }
    }
  } else if (t1.kind === 'line' && t2.kind === 'circle') {
    const l = normalForm(t1.a, t1.b);
    if (!l) return [];
    for (const [p, d] of offsets(l, r)) {
      for (const rr of ringRadii(t2.radius, r)) centers.push(...lineCircle(p, d, t2.center, rr));
    }
  } else if (t1.kind === 'circle' && t2.kind === 'circle') {
    for (const r1 of ringRadii(t1.radius, r)) {
      for (const r2 of ringRadii(t2.radius, r)) centers.push(...circleCircle(t1.center, r1, t2.center, r2));
    }
  }
  return dedupe(centers.map((center) => ({ center, radius: r })), [t1, t2]);
}

/** A linear equation ax·x + ay·y + ar·r = b in the unknowns (x, y, r). */
type Row = readonly [number, number, number, number];

type Quadric = { cx: number; cy: number; sR: number; k: number }; // circle tangency with sign σ

type CircleTarget = Extract<TangentTarget, { kind: 'circle' }>;

/**
 * Every circle tangent to all three targets (Tangent-Tangent-Tangent).
 *
 * With two or more lines, the center lies on a bisector of two of them, which
 * keeps nearly parallel lines well conditioned. Otherwise tangency to a line
 * is n·P − c = σr and to a circle |P − C|² = (r + σR)², with σ = ±1 for
 * outside and inside contact; differences of the circle equations are linear,
 * leaving two linear equations and one quadratic per sign choice.
 */
export function tangentTangentTangent(t1: TangentTarget, t2: TangentTarget, t3: TangentTarget): Circle[] {
  const targets = [t1, t2, t3];
  const lines: (NormalLine | undefined)[] = targets.map((t) => (t.kind === 'line' ? normalForm(t.a, t.b) : undefined));
  if (targets.some((t, i) => t.kind === 'line' && !lines[i])) return [];
  const lineIdx = [0, 1, 2].filter((i) => lines[i]);
  const found = lineIdx.length >= 2 ? viaBisectors(targets, lines, lineIdx) : algebraic(targets, lines);
  return dedupe(
    found.filter((c) => c.radius > TOL),
    targets,
  );
}

/**
 * Two of the targets are lines: the center lies on a bisector (n1 ± n2)·P =
 * c1 ± c2, where both lines are equally far away. Each bisector is walked from
 * the point on it nearest the third target, so coordinates stay small even
 * when the lines meet far off; parallel lines have just the midline.
 */
function viaBisectors(targets: readonly TangentTarget[], lines: readonly (NormalLine | undefined)[], lineIdx: number[]): Circle[] {
  // Use the most clearly crossing pair of lines; the remaining target is solved along their bisectors.
  let pair: [number, number] = [lineIdx[0]!, lineIdx[1]!];
  if (lineIdx.length === 3) {
    const crossOf = (i: number, j: number) => Math.abs(lines[i]!.nx * lines[j]!.ny - lines[i]!.ny * lines[j]!.nx);
    const pairs: [number, number][] = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    pair = pairs.reduce((best, p) => (crossOf(...p) > crossOf(...best) ? p : best));
  }
  const l1 = lines[pair[0]]!;
  let l2 = lines[pair[1]]!;
  if (l1.nx * l2.nx + l1.ny * l2.ny < 0) l2 = { nx: -l2.nx, ny: -l2.ny, c: -l2.c }; // same orientation
  const thirdIdx = [0, 1, 2].find((i) => i !== pair[0] && i !== pair[1])!;
  const third = targets[thirdIdx]!;
  const l3 = lines[thirdIdx];
  // Where to start each bisector walk: near the third target.
  const anchor = l3 ? { x: l3.nx * l3.c, y: l3.ny * l3.c } : (third as CircleTarget).center;

  const out: Circle[] = [];
  for (const b of [1, -1]) {
    // b = 1: opposite sides of the lines, (n1 + n2)·P = c1 + c2. b = −1: same side.
    const mx = l1.nx + b * l2.nx;
    const my = l1.ny + b * l2.ny;
    const mLen = Math.hypot(mx, my);
    if (mLen <= TOL) continue; // parallel lines have no same-side bisector
    const m = { x: mx / mLen, y: my / mLen };
    const d = (l1.c + b * l2.c) / mLen;
    const off = m.x * anchor.x + m.y * anchor.y - d;
    const base = { x: anchor.x - m.x * off, y: anchor.y - m.y * off };
    const u = { x: -m.y, y: m.x };
    // Signed distance to l1 along the walk: s(τ) = a0 + a1·τ; the radius is |s(τ)|.
    const a0 = l1.nx * base.x + l1.ny * base.y - l1.c;
    const a1 = l1.nx * u.x + l1.ny * u.y;
    const at = (tau: number): Circle => ({
      center: { x: base.x + tau * u.x, y: base.y + tau * u.y },
      radius: Math.abs(a0 + a1 * tau),
    });
    for (const lambda of [1, -1]) {
      if (l3) {
        // n3·P − c3 = λ·s(τ)
        const den = l3.nx * u.x + l3.ny * u.y - lambda * a1;
        if (Math.abs(den) <= TOL) continue;
        out.push(at((lambda * a0 - (l3.nx * base.x + l3.ny * base.y - l3.c)) / den));
      } else {
        // |P(τ) − C|² = (s(τ) + λR)², with base − C perpendicular to u.
        const c = third as CircleTarget;
        const wx = base.x - c.center.x;
        const wy = base.y - c.center.y;
        const q = a0 + lambda * c.radius;
        const A = 1 - a1 * a1;
        const B = 2 * (wx * u.x + wy * u.y - a1 * q);
        const C = wx * wx + wy * wy - q * q;
        for (const tau of quadraticRoots(A, B, C, 1)) out.push(at(tau));
      }
    }
  }
  return out;
}

/** One line or none: two linear rows from the line and circle differences, plus one circle quadric. */
function algebraic(targets: readonly TangentTarget[], lines: readonly (NormalLine | undefined)[]): Circle[] {
  const out: Circle[] = [];
  for (let signs = 0; signs < 8; signs++) {
    const sigma = [0, 1, 2].map((i) => ((signs >> i) & 1 ? -1 : 1));
    const rows: Row[] = [];
    let q0: Quadric | undefined;
    targets.forEach((t, i) => {
      const s = sigma[i]!;
      const l = lines[i];
      if (l) {
        rows.push([l.nx, l.ny, -s, l.c]);
        return;
      }
      const c = t as CircleTarget;
      const q: Quadric = { cx: c.center.x, cy: c.center.y, sR: s * c.radius, k: c.center.x ** 2 + c.center.y ** 2 - c.radius ** 2 };
      if (!q0) {
        q0 = q;
        return;
      }
      // (Q_i − Q_0) = 0 is linear in x, y, r.
      rows.push([2 * (q0.cx - q.cx), 2 * (q0.cy - q.cy), 2 * (q0.sR - q.sR), q0.k - q.k]);
    });
    for (const sol of solveWithQuadric(rows, q0!)) {
      const [x, y, r] = refine(sol, targets, lines, sigma);
      out.push({ center: { x, y }, radius: r });
    }
  }
  return out;
}

/** How far a circle (x, y, r) is from touching a target, in drawing units. */
function tangencyError(t: TangentTarget, l: NormalLine | undefined, x: number, y: number, r: number): number {
  if (l) return Math.abs(Math.abs(l.nx * x + l.ny * y - l.c) - r);
  const c = t as CircleTarget;
  const d = Math.hypot(x - c.center.x, y - c.center.y);
  return Math.min(Math.abs(d - (r + c.radius)), Math.abs(d - Math.abs(r - c.radius)));
}

/**
 * A few damped least-squares (Levenberg–Marquardt) steps on the distance form
 * of the tangency equations. Two nearly identical target circles make the
 * algebraic solution lose digits; this wins them back. A step is kept only if
 * it lowers the worst tangency error.
 */
function refine(
  start: [number, number, number],
  targets: readonly TangentTarget[],
  lines: readonly (NormalLine | undefined)[],
  sigma: readonly number[],
): [number, number, number] {
  const worst = (v: [number, number, number]) => Math.max(...targets.map((t, i) => tangencyError(t, lines[i], ...v)));
  let cur = start;
  let err = worst(cur);
  for (let iter = 0; iter < 4 && err > 0; iter++) {
    const [x, y, r] = cur;
    const J: [number, number, number][] = [];
    const F: number[] = [];
    targets.forEach((t, i) => {
      const s = sigma[i]!;
      const l = lines[i];
      if (l) {
        J.push([l.nx, l.ny, -s]);
        F.push(l.nx * x + l.ny * y - l.c - s * r);
        return;
      }
      const c = t as CircleTarget;
      const dx = x - c.center.x;
      const dy = y - c.center.y;
      const d = Math.hypot(dx, dy);
      if (d === 0) return;
      const rr = r + s * c.radius;
      const sg = rr < 0 ? -1 : 1; // |P − C| = |r + σR|
      J.push([dx / d, dy / d, -sg]);
      F.push(d - sg * rr);
    });
    if (J.length < 3) break;
    // (JᵀJ + μ·diag(JᵀJ)) Δ = −JᵀF
    const JtJ = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J.reduce((acc, row) => acc + row[a]! * row[b]!, 0)));
    const JtF = [0, 1, 2].map((a) => J.reduce((acc, row, k) => acc + row[a]! * F[k]!, 0));
    let improved = false;
    for (const mu of [0, 1e-6, 1e-3]) {
      const M = JtJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + mu) : v)));
      const step = solve3x3(M, JtF.map((v) => -v));
      if (!step) continue;
      const next: [number, number, number] = [x + step[0], y + step[1], r + step[2]];
      const e = worst(next);
      if (e < err) {
        cur = next;
        err = e;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return cur;
}

function det3(m: readonly (readonly number[])[]): number {
  return (
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
  );
}

/** Cramer's rule; undefined when the matrix is singular. */
function solve3x3(A: readonly (readonly number[])[], b: readonly number[]): [number, number, number] | undefined {
  const D = det3(A);
  if (D === 0 || !Number.isFinite(D)) return undefined;
  const col = (j: number) => det3(A.map((row, i) => row.map((v, k) => (k === j ? b[i]! : v))));
  return [col(0) / D, col(1) / D, col(2) / D];
}

/**
 * Two linear rows plus the circle quadric |P − C|² − (r + σR)² = 0. The rows'
 * solutions form a line X(t) = p + t·v in (x, y, r); substituting gives a
 * quadratic in t.
 */
function solveWithQuadric(rows: Row[], q: Quadric): [number, number, number][] {
  const [a, b] = rows as [Row, Row];
  const v: [number, number, number] = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  if (vv <= TOL * TOL) return []; // dependent rows: concentric or coincident targets
  // Minimum-norm particular solution p = Aᵀ (A Aᵀ)⁻¹ b.
  const aa = a[0] ** 2 + a[1] ** 2 + a[2] ** 2;
  const bb = b[0] ** 2 + b[1] ** 2 + b[2] ** 2;
  const ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const det = aa * bb - ab * ab;
  const la = (bb * a[3] - ab * b[3]) / det;
  const lb = (aa * b[3] - ab * a[3]) / det;
  const p = [0, 1, 2].map((i) => la * a[i]! + lb * b[i]!) as [number, number, number];

  // f(X) = x² + y² − r² − 2Cx·x − 2Cy·y − 2σR·r + k
  const L = [-2 * q.cx, -2 * q.cy, -2 * q.sR];
  const mdot = (u: number[], w: number[]) => u[0]! * w[0]! + u[1]! * w[1]! - u[2]! * w[2]!;
  const ldot = (u: number[]) => L[0]! * u[0]! + L[1]! * u[1]! + L[2]! * u[2]!;
  const A2 = mdot(v, v);
  const B2 = 2 * mdot(p, v) + ldot(v);
  const C2 = mdot(p, p) + ldot(p) + q.k;
  const ts = quadraticRoots(A2, B2, C2, vv);
  return ts.map((t) => [p[0] + t * v[0], p[1] + t * v[1], p[2] + t * v[2]]);
}

/** Real roots of a·t² + b·t + c, with a double root returned once. `scale` sizes the degeneracy checks. */
function quadraticRoots(a: number, b: number, c: number, scale: number): number[] {
  if (Math.abs(a) <= TOL * scale) return Math.abs(b) <= TOL * scale ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    // A tangent-limit case can come out a hair negative from rounding.
    return disc >= -TOL * b * b ? [-b / (2 * a)] : [];
  }
  const sq = Math.sqrt(disc);
  // Numerically stable form: avoid subtracting nearly equal numbers.
  const qq = -(b + Math.sign(b || 1) * sq) / 2;
  const roots = [qq / a];
  if (qq !== 0) roots.push(c / qq);
  return roots;
}

/** Where `c` touches `t`. For a circle target, the contact point is on the line of centers. */
export function tangentPoint(t: TangentTarget, c: Circle): Vec2 {
  if (t.kind === 'line') {
    const dx = t.b.x - t.a.x;
    const dy = t.b.y - t.a.y;
    const k = ((c.center.x - t.a.x) * dx + (c.center.y - t.a.y) * dy) / (dx * dx + dy * dy);
    return { x: t.a.x + dx * k, y: t.a.y + dy * k };
  }
  const d = distance(t.center, c.center);
  if (d === 0) return { x: t.center.x + t.radius, y: t.center.y };
  const ux = (c.center.x - t.center.x) / d;
  const uy = (c.center.y - t.center.y) / d;
  const near = { x: t.center.x + ux * t.radius, y: t.center.y + uy * t.radius };
  const far = { x: t.center.x - ux * t.radius, y: t.center.y - uy * t.radius };
  // The contact point is the one exactly r from the new circle's center.
  return Math.abs(distance(near, c.center) - c.radius) <= Math.abs(distance(far, c.center) - c.radius) ? near : far;
}

/**
 * The solution whose contact points are nearest the picks, the way AutoCAD
 * chooses between the candidates. `picks[i]` is where target i was clicked.
 */
export function nearestToPicks(solutions: readonly Circle[], targets: readonly TangentTarget[], picks: readonly Vec2[]): Circle | undefined {
  let best: Circle | undefined;
  let bestScore = Infinity;
  for (const s of solutions) {
    let score = 0;
    targets.forEach((t, i) => (score += distance(tangentPoint(t, s), picks[i]!)));
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}
