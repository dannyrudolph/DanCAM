import { type BSpline, expandKnots } from '../../geometry/bspline';
import { type Vec3, cross3, dot3, scale3, sub3, unit3 } from '../../geometry/vec3';
import { type StepInstance, type StepRecord, type StepValue, parsePart21 } from './part21';

/**
 * A STEP file's solid faces, typed: the surfaces and edges a turned part is
 * made of (spec, "STEP import"). Lengths stay in the file's unit;
 * `mmPerUnit` converts. Angles are in radians whatever unit the file uses.
 * A face that can't be read (a missing or unexpected reference) is listed in
 * `unreadable` with the reason rather than failing the file.
 */

/** An AXIS2_PLACEMENT_3D: origin, unit Z axis, unit X axis square to it. */
export type Placement = { readonly origin: Vec3; readonly axis: Vec3; readonly ref: Vec3 };

export type StepSurface =
  | { readonly kind: 'plane'; readonly at: Placement }
  | { readonly kind: 'cylinder'; readonly at: Placement; readonly radius: number }
  /** `radius` at the placement's origin; the radius grows along +axis at `semiAngle` (radians). */
  | { readonly kind: 'cone'; readonly at: Placement; readonly radius: number; readonly semiAngle: number }
  | { readonly kind: 'torus'; readonly at: Placement; readonly major: number; readonly minor: number }
  | { readonly kind: 'sphere'; readonly at: Placement; readonly radius: number }
  /** Any other surface (B-spline, surface of revolution, offset …), by its STEP type. */
  | { readonly kind: 'other'; readonly type: string };

export type StepCurve =
  | { readonly kind: 'line'; readonly point: Vec3; readonly dir: Vec3 }
  | { readonly kind: 'circle'; readonly at: Placement; readonly radius: number }
  | { readonly kind: 'ellipse'; readonly at: Placement; readonly a: number; readonly b: number }
  | { readonly kind: 'bspline'; readonly spline: BSpline }
  | { readonly kind: 'other'; readonly type: string };

/**
 * An edge from `start` to `end` along `curve`; `sameSense`: in the curve's
 * own direction (counter-clockwise about a circle's axis). `id` names the
 * edge (its EDGE_CURVE), shared by the two faces it bounds; `forward`: its
 * loop runs from `start` to `end` (the face then lies to the loop's left,
 * seen from the side the face's normal points to).
 */
export type StepEdge = { readonly id: number; readonly start: Vec3; readonly end: Vec3; readonly curve: StepCurve; readonly sameSense: boolean; readonly forward: boolean };

/** A face boundary: its edges, or a single vertex (a cone's apex, a sphere's pole). */
export type StepLoop = { readonly edges: readonly StepEdge[]; readonly vertex?: Vec3 };

/** `sameSense`: the face's normal is the surface's (outward from a cylinder's axis, along a plane's axis); otherwise reversed. */
export type StepFace = { readonly id: number; readonly surface: StepSurface; readonly loops: readonly StepLoop[]; readonly sameSense: boolean };

export type StepModel = {
  readonly faces: readonly StepFace[];
  readonly unreadable: readonly { readonly id: number; readonly reason: string }[];
  /** How many millimetres one file length unit is. */
  readonly mmPerUnit: number;
  /** The distance the file says its geometry is accurate to, in its unit, when it says. */
  readonly uncertainty: number | undefined;
};

export type StepResult = { readonly ok: true; readonly model: StepModel } | { readonly ok: false; readonly error: string };

/** Thrown while reading one entity; the face it belongs to becomes unreadable. */
class EntityError extends Error {}

/** Reads a STEP file's faces and units, or says why it can't. */
export function readStep(text: string): StepResult {
  const parsed = parsePart21(text);
  if (!parsed.ok) return parsed;
  const r = new Reader(parsed.file.instances);
  const faces: StepFace[] = [];
  const unreadable: { id: number; reason: string }[] = [];
  for (const inst of parsed.file.instances.values()) {
    if (!inst.records.some((x) => x.type === 'ADVANCED_FACE' || x.type === 'FACE_SURFACE')) continue;
    try {
      faces.push(r.face(inst.id));
    } catch (err) {
      if (!(err instanceof EntityError)) throw err;
      unreadable.push({ id: inst.id, reason: err.message });
    }
  }
  if (faces.length === 0 && unreadable.length === 0) {
    return { ok: false, error: 'There are no solid faces in this file (it may hold only a mesh, wireframe or assembly structure).' };
  }
  let mmPerUnit: number;
  try {
    mmPerUnit = r.lengthUnit();
  } catch (err) {
    if (!(err instanceof EntityError)) throw err;
    return { ok: false, error: `The length unit can't be read: ${err.message}` };
  }
  return { ok: true, model: { faces, unreadable, mmPerUnit, uncertainty: r.uncertainty() } };
}

const X: Vec3 = { x: 1, y: 0, z: 0 };
const Z: Vec3 = { x: 0, y: 0, z: 1 };

const METRE_PREFIX_MM: Readonly<Record<string, number>> = { MICRO: 1e-3, MILLI: 1, CENTI: 10, DECI: 100, KILO: 1e6 };

class Reader {
  private radiansPerAngleUnit: number | undefined;

  constructor(private readonly instances: ReadonlyMap<number, StepInstance>) {}

  /** The record of instance `id` whose type is one of `types`. */
  private rec(id: number, ...types: string[]): StepRecord {
    const inst = this.instances.get(id);
    if (!inst) throw new EntityError(`#${id} is referenced but not defined.`);
    const found = inst.records.find((x) => types.includes(x.type));
    if (!found) throw new EntityError(`#${id} is ${inst.records.map((x) => x.type).join('+')}, expected ${types.join(' or ')}.`);
    return found;
  }

  private type(id: number): string {
    const inst = this.instances.get(id);
    if (!inst) throw new EntityError(`#${id} is referenced but not defined.`);
    return inst.records.map((x) => x.type).join('+');
  }

  private static ref(v: StepValue | undefined, what: string): number {
    if (v !== null && typeof v === 'object' && 'ref' in v) return v.ref;
    throw new EntityError(`${what} should be a reference.`);
  }

  private static num(v: StepValue | undefined, what: string): number {
    if (typeof v === 'number') return v;
    if (v !== null && typeof v === 'object' && 'type' in v && typeof v.args[0] === 'number') return v.args[0]; // a typed measure
    throw new EntityError(`${what} should be a number.`);
  }

  private static list(v: StepValue | undefined, what: string): readonly StepValue[] {
    if (Array.isArray(v)) return v;
    throw new EntityError(`${what} should be a list.`);
  }

  private static bool(v: StepValue | undefined, what: string): boolean {
    if (v !== null && typeof v === 'object' && 'enum' in v && (v.enum === 'T' || v.enum === 'F')) return v.enum === 'T';
    throw new EntityError(`${what} should be .T. or .F.`);
  }

  point(id: number): Vec3 {
    const c = Reader.list(this.rec(id, 'CARTESIAN_POINT').args[1], `#${id} coordinates`);
    const n = c.map((v, i) => Reader.num(v, `#${id} coordinate ${i + 1}`));
    return { x: n[0] ?? 0, y: n[1] ?? 0, z: n[2] ?? 0 };
  }

  private direction(id: number): Vec3 {
    const p = Reader.list(this.rec(id, 'DIRECTION').args[1], `#${id} ratios`).map((v, i) => Reader.num(v, `#${id} ratio ${i + 1}`));
    const d = unit3({ x: p[0] ?? 0, y: p[1] ?? 0, z: p[2] ?? 0 });
    if (!d) throw new EntityError(`#${id} is a zero direction.`);
    return d;
  }

  placement(id: number): Placement {
    const a = this.rec(id, 'AXIS2_PLACEMENT_3D').args;
    const origin = this.point(Reader.ref(a[1], `#${id} location`));
    const axis = a[2] === null || a[2] === undefined ? Z : this.direction(Reader.ref(a[2], `#${id} axis`));
    const want = a[3] === null || a[3] === undefined ? X : this.direction(Reader.ref(a[3], `#${id} ref_direction`));
    // The X axis is the reference direction made square to the axis (or any square direction when parallel).
    let ref = unit3(sub3(want, scale3(axis, dot3(want, axis))));
    if (!ref) ref = unit3(cross3(axis, Math.abs(axis.x) < 0.9 ? X : Z))!;
    return { origin, axis, ref };
  }

  private angle(v: StepValue | undefined, what: string): number {
    this.radiansPerAngleUnit ??= this.angleUnit();
    return Reader.num(v, what) * this.radiansPerAngleUnit;
  }

  surface(id: number): StepSurface {
    const t = this.type(id);
    const a = (types: string): readonly StepValue[] => this.rec(id, types).args;
    const at = (args: readonly StepValue[]): Placement => this.placement(Reader.ref(args[1], `#${id} position`));
    switch (t) {
      case 'PLANE': {
        const args = a(t);
        return { kind: 'plane', at: at(args) };
      }
      case 'CYLINDRICAL_SURFACE': {
        const args = a(t);
        return { kind: 'cylinder', at: at(args), radius: Reader.num(args[2], `#${id} radius`) };
      }
      case 'CONICAL_SURFACE': {
        const args = a(t);
        return { kind: 'cone', at: at(args), radius: Reader.num(args[2], `#${id} radius`), semiAngle: this.angle(args[3], `#${id} semi_angle`) };
      }
      case 'TOROIDAL_SURFACE': {
        const args = a(t);
        return { kind: 'torus', at: at(args), major: Reader.num(args[2], `#${id} major_radius`), minor: Reader.num(args[3], `#${id} minor_radius`) };
      }
      case 'SPHERICAL_SURFACE': {
        const args = a(t);
        return { kind: 'sphere', at: at(args), radius: Reader.num(args[2], `#${id} radius`) };
      }
      default:
        return { kind: 'other', type: t };
    }
  }

  curve(id: number): StepCurve {
    const t = this.type(id);
    if (this.instances.get(id)?.records.some((x) => x.type === 'B_SPLINE_CURVE_WITH_KNOTS')) return { kind: 'bspline', spline: this.spline(id) };
    switch (t) {
      case 'SURFACE_CURVE':
      case 'SEAM_CURVE':
      case 'INTERSECTION_CURVE':
        return this.curve(Reader.ref(this.rec(id, t).args[1], `#${id} curve_3d`));
      case 'TRIMMED_CURVE':
        return this.curve(Reader.ref(this.rec(id, t).args[1], `#${id} basis_curve`));
      case 'LINE': {
        const a = this.rec(id, t).args;
        const vec = this.rec(Reader.ref(a[2], `#${id} dir`), 'VECTOR').args;
        return { kind: 'line', point: this.point(Reader.ref(a[1], `#${id} pnt`)), dir: this.direction(Reader.ref(vec[1], `#${id} orientation`)) };
      }
      case 'CIRCLE': {
        const a = this.rec(id, t).args;
        return { kind: 'circle', at: this.placement(Reader.ref(a[1], `#${id} position`)), radius: Reader.num(a[2], `#${id} radius`) };
      }
      case 'ELLIPSE': {
        const a = this.rec(id, t).args;
        return { kind: 'ellipse', at: this.placement(Reader.ref(a[1], `#${id} position`)), a: Reader.num(a[2], `#${id} semi_axis_1`), b: Reader.num(a[3], `#${id} semi_axis_2`) };
      }
      default:
        return { kind: 'other', type: t };
    }
  }

  /** A B_SPLINE_CURVE_WITH_KNOTS, simple or complex (rational, with RATIONAL_B_SPLINE_CURVE weights). */
  private spline(id: number): BSpline {
    const inst = this.instances.get(id)!;
    const simple = inst.records.length === 1;
    const base = simple ? this.rec(id, 'B_SPLINE_CURVE_WITH_KNOTS').args.slice(1) : this.rec(id, 'B_SPLINE_CURVE').args;
    const withKnots = simple ? this.rec(id, 'B_SPLINE_CURVE_WITH_KNOTS').args.slice(6) : this.rec(id, 'B_SPLINE_CURVE_WITH_KNOTS').args;
    const degree = Reader.num(base[0], `#${id} degree`);
    const points = Reader.list(base[1], `#${id} control_points_list`).map((v) => this.point(Reader.ref(v, `#${id} control point`)));
    const mults = Reader.list(withKnots[0], `#${id} knot_multiplicities`).map((v) => Reader.num(v, `#${id} multiplicity`));
    const knots = expandKnots(
      Reader.list(withKnots[1], `#${id} knots`).map((v) => Reader.num(v, `#${id} knot`)),
      mults,
    );
    if (knots.length !== points.length + degree + 1) throw new EntityError(`#${id} has ${knots.length} knots for ${points.length} points of degree ${degree}.`);
    const rational = inst.records.find((x) => x.type === 'RATIONAL_B_SPLINE_CURVE');
    const weights = rational && Reader.list(rational.args[0], `#${id} weights_data`).map((v) => Reader.num(v, `#${id} weight`));
    return weights ? { degree, points, knots, weights } : { degree, points, knots };
  }

  private vertex(id: number): Vec3 {
    return this.point(Reader.ref(this.rec(id, 'VERTEX_POINT').args[1], `#${id} vertex_geometry`));
  }

  private edge(id: number): StepEdge {
    const oriented = this.rec(id, 'ORIENTED_EDGE', 'EDGE_CURVE');
    const curveId = oriented.type === 'ORIENTED_EDGE' ? Reader.ref(oriented.args[3], `#${id} edge_element`) : id;
    const a = this.rec(curveId, 'EDGE_CURVE').args;
    return {
      id: curveId,
      forward: oriented.type === 'ORIENTED_EDGE' ? Reader.bool(oriented.args[4], `#${id} orientation`) : true,
      start: this.vertex(Reader.ref(a[1], `#${curveId} edge_start`)),
      end: this.vertex(Reader.ref(a[2], `#${curveId} edge_end`)),
      curve: this.curve(Reader.ref(a[3], `#${curveId} edge_geometry`)),
      sameSense: Reader.bool(a[4], `#${curveId} same_sense`),
    };
  }

  private loop(id: number): StepLoop {
    const r = this.rec(id, 'EDGE_LOOP', 'VERTEX_LOOP', 'POLY_LOOP');
    if (r.type === 'VERTEX_LOOP') return { edges: [], vertex: this.vertex(Reader.ref(r.args[1], `#${id} loop_vertex`)) };
    if (r.type === 'POLY_LOOP') {
      const pts = Reader.list(r.args[1], `#${id} polygon`).map((v) => this.point(Reader.ref(v, `#${id} polygon point`)));
      return { edges: pts.map((p, i) => ({ id: -(id * 1000 + i), start: p, end: pts[(i + 1) % pts.length]!, curve: { kind: 'other', type: 'POLY_LOOP' }, sameSense: true, forward: true })) };
    }
    return { edges: Reader.list(r.args[1], `#${id} edge_list`).map((v) => this.edge(Reader.ref(v, `#${id} edge`))) };
  }

  face(id: number): StepFace {
    const a = this.rec(id, 'ADVANCED_FACE', 'FACE_SURFACE').args;
    const loops = Reader.list(a[1], `#${id} bounds`).map((v) => {
      const bound = Reader.ref(v, `#${id} bound`);
      const b = this.rec(bound, 'FACE_OUTER_BOUND', 'FACE_BOUND').args;
      const loop = this.loop(Reader.ref(b[1], `#${bound} bound`));
      // A bound against its loop's direction runs every edge the other way.
      return Reader.bool(b[2], `#${bound} orientation`) ? loop : { ...loop, edges: loop.edges.map((e) => ({ ...e, forward: !e.forward })) };
    });
    const sameSense = Reader.bool(a[3], `#${id} same_sense`);
    return { id, surface: this.surface(Reader.ref(a[2], `#${id} face_geometry`)), loops, sameSense };
  }

  /** The length uncertainty (UNCERTAINTY_MEASURE_WITH_UNIT for distance), in the file's unit. */
  uncertainty(): number | undefined {
    for (const inst of this.instances.values()) {
      const u = inst.records.find((x) => x.type === 'UNCERTAINTY_MEASURE_WITH_UNIT');
      if (!u) continue;
      try {
        const v = Reader.num(u.args[0], `#${inst.id} value`);
        const unit = Reader.ref(u.args[1], `#${inst.id} unit`);
        if (this.instances.get(unit)?.records.some((x) => x.type === 'LENGTH_UNIT')) return (v * this.mmPer(unit)) / this.lengthUnit();
      } catch (err) {
        if (!(err instanceof EntityError)) throw err;
      }
    }
    return undefined;
  }

  /** Millimetres per length unit: SI metres with a prefix, or a converted unit (inch, foot, or by its measure). Millimetres when the file names none. */
  lengthUnit(): number {
    const id = this.unitOf('LENGTH_UNIT');
    return id === undefined ? 1 : this.mmPer(id);
  }

  private mmPer(id: number): number {
    const inst = this.instances.get(id);
    const si = inst?.records.find((x) => x.type === 'SI_UNIT');
    if (si) {
      const prefix = si.args[0];
      const p = prefix !== null && typeof prefix === 'object' && 'enum' in prefix ? prefix.enum : undefined;
      if (p === undefined) return 1000;
      const k = METRE_PREFIX_MM[p];
      if (k === undefined) throw new EntityError(`#${id}: unknown prefix ${p}.`);
      return k;
    }
    const conv = this.rec(id, 'CONVERSION_BASED_UNIT').args;
    const name = typeof conv[0] === 'string' ? conv[0].toUpperCase() : '';
    if (name === 'INCH') return 25.4;
    if (name === 'FOOT') return 304.8;
    const m = this.rec(Reader.ref(conv[1], `#${id} conversion_factor`), 'LENGTH_MEASURE_WITH_UNIT', 'MEASURE_WITH_UNIT').args;
    return Reader.num(m[0], `#${id} factor`) * this.mmPer(Reader.ref(m[1], `#${id} unit`));
  }

  /** Radians per plane angle unit: radians, or a converted unit (degrees, or by its measure). Radians when the file names none. */
  private angleUnit(): number {
    const id = this.unitOf('PLANE_ANGLE_UNIT');
    return id === undefined ? 1 : this.radiansPer(id);
  }

  private radiansPer(id: number): number {
    const inst = this.instances.get(id);
    if (inst?.records.some((x) => x.type === 'SI_UNIT')) return 1;
    const conv = this.rec(id, 'CONVERSION_BASED_UNIT').args;
    const name = typeof conv[0] === 'string' ? conv[0].toUpperCase() : '';
    if (name === 'DEGREE' || name === 'DEGREES') return Math.PI / 180;
    const m = this.rec(Reader.ref(conv[1], `#${id} conversion_factor`), 'PLANE_ANGLE_MEASURE_WITH_UNIT', 'MEASURE_WITH_UNIT').args;
    return Reader.num(m[0], `#${id} factor`) * this.radiansPer(Reader.ref(m[1], `#${id} unit`));
  }

  /** The unit of `kind` the geometry context assigns, else the first one defined. */
  private unitOf(kind: string): number | undefined {
    for (const inst of this.instances.values()) {
      const ctx = inst.records.find((x) => x.type === 'GLOBAL_UNIT_ASSIGNED_CONTEXT');
      if (!ctx) continue;
      for (const v of Reader.list(ctx.args[0], `#${inst.id} units`)) {
        const u = Reader.ref(v, `#${inst.id} unit`);
        if (this.instances.get(u)?.records.some((x) => x.type === kind)) return u;
      }
    }
    for (const inst of this.instances.values()) if (inst.records.some((x) => x.type === kind)) return inst.id;
    return undefined;
  }
}
