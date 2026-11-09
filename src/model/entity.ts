import type { DimAnchors } from './anchor';
import { arcBBox } from '../geometry/arc';
import { type BBox, EMPTY_BBOX, fromPoints } from '../geometry/bbox';
import { circleBBox } from '../geometry/circle';
import type { Curve } from '../geometry/curve';
import { type Transform, transformArc, transformDir, transformLength, transformPoint } from '../geometry/transform';
import type { Vec2 } from '../geometry/vec';
import { type Tolerance, scaleTolerance } from './dimFormat';
import type { LineStyleName } from './lineStyle';

/** Stable id, unique within a drawing and never reused. */
export type EntityId = string;

/** Properties every entity carries. `style` absent means "by layer". */
type EntityBase = {
  readonly id: EntityId;
  readonly layer: string;
  readonly style?: LineStyleName;
};

export type PointEntity = EntityBase & {
  readonly kind: 'point';
  readonly at: Vec2;
};

export type LineEntity = EntityBase & {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
};

export type CircleEntity = EntityBase & {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly radius: number;
};

/**
 * Runs counter-clockwise from `startDeg` to `endDeg`, degrees in [0, 360)
 * from +X (the geometry `Arc`).
 */
export type ArcEntity = EntityBase & {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  readonly startDeg: number;
  readonly endDeg: number;
};

/** Construction line, infinite both ways. `dir` is a unit vector (the geometry `Xline`). */
export type XlineEntity = EntityBase & {
  readonly kind: 'xline';
  readonly base: Vec2;
  readonly dir: Vec2;
};

/** Ray: starts at `base`, infinite along `dir`, a unit vector (the geometry `Ray`). */
export type RayEntity = EntityBase & {
  readonly kind: 'ray';
  readonly base: Vec2;
  readonly dir: Vec2;
};

/**
 * A dimension: a readout of the points it measures, never an input (CAD-1).
 * `at` places it: a point on the dimension line or arc, or where the text
 * goes for radius and diameter. `anchors` ties what it measures to the
 * geometry, so it follows a change (`model/associate`); without them it
 * measures fixed points. The line style is ignored: dimensions
 * draw thin. By `type`:
 * - `linear`: the distance from `p1` to `p2` along `dir` (a unit vector:
 *   (1, 0) horizontal, (0, 1) vertical, other angles after a rotate).
 * - `aligned`: the true distance from `p1` to `p2`.
 * - `radius`, `diameter`: of the circle at `center` with `radius`.
 * - `angular`: the angle at `vertex` between the arms along the unit
 *   vectors `dir1` and `dir2`, on the side where `at` is (so it can read
 *   the reflex angle). `p1` and `p2` are where each arm's extension line
 *   starts (the end of the measured geometry; the vertex when there is none).
 * - `leader`: a note, not a measurement. An arrow at `tip`, a line to `at`
 *   (the landing), a short horizontal shoulder, then `text` as typed.
 *
 * Overrides of the style for this one dimension (none apply to a leader):
 * `precision` (decimal places of the value and its tolerance; of the angle
 * for angular), `tolerance` (lengths only), and `textOverride`, which
 * replaces the text, `<>` standing for the measured value.
 */
export type DimensionEntity = EntityBase & {
  readonly kind: 'dimension';
  readonly dimStyle: string;
  readonly at: Vec2;
  readonly anchors?: DimAnchors;
  readonly precision?: number;
  readonly tolerance?: Tolerance;
  readonly textOverride?: string;
  /** Linear and aligned: where the text was dragged to; it sits on the dimension line there. Absent: placed by fit. */
  readonly textAt?: Vec2;
} & (
    | { readonly type: 'linear'; readonly p1: Vec2; readonly p2: Vec2; readonly dir: Vec2 }
    | { readonly type: 'aligned'; readonly p1: Vec2; readonly p2: Vec2 }
    | { readonly type: 'radius' | 'diameter'; readonly center: Vec2; readonly radius: number }
    | { readonly type: 'angular'; readonly vertex: Vec2; readonly p1: Vec2; readonly p2: Vec2; readonly dir1: Vec2; readonly dir2: Vec2 }
    | { readonly type: 'leader'; readonly tip: Vec2; readonly text: string }
  );

/** A dimension's defining points: what it measures, and `at`. */
export function dimensionPoints(e: DimensionEntity): Vec2[] {
  return [...measuredPoints(e), ...(e.textAt ? [e.textAt] : [])];
}

function measuredPoints(e: DimensionEntity): Vec2[] {
  switch (e.type) {
    case 'linear':
    case 'aligned':
      return [e.p1, e.p2, e.at];
    case 'radius':
    case 'diameter':
      return [e.center, e.at];
    case 'angular':
      return [e.vertex, e.p1, e.p2, e.at];
    case 'leader':
      return [e.tip, e.at];
  }
}

/** The dimension with each defining point passed through `f`; directions and radius unchanged. */
export function mapDimensionPoints(e: DimensionEntity, f: (p: Vec2) => Vec2): DimensionEntity {
  const m = mapMeasured(e, f);
  return e.textAt ? { ...m, textAt: f(e.textAt) } : m;
}

function mapMeasured(e: DimensionEntity, f: (p: Vec2) => Vec2): DimensionEntity {
  const at = f(e.at);
  switch (e.type) {
    case 'linear':
    case 'aligned':
      return { ...e, at, p1: f(e.p1), p2: f(e.p2) };
    case 'radius':
    case 'diameter':
      return { ...e, at, center: f(e.center) };
    case 'angular':
      return { ...e, at, vertex: f(e.vertex), p1: f(e.p1), p2: f(e.p2) };
    case 'leader':
      return { ...e, at, tip: f(e.tip) };
  }
}

export type Entity = PointEntity | LineEntity | CircleEntity | ArcEntity | XlineEntity | RayEntity | DimensionEntity;

/** The layer and style a tool gives each new entity. */
export type EntityProps = { readonly layer: string; readonly style?: LineStyleName };

/**
 * Bounds of the geometry. Xlines and rays are infinite, so they contribute
 * nothing, as in AutoCAD. A dimension gives the bounds of its defining
 * points; its drawn extent (text, arrows) needs its style, in `dimLayout`.
 */
export function entityBBox(e: Entity): BBox {
  switch (e.kind) {
    case 'point':
      return fromPoints([e.at]);
    case 'line':
      return fromPoints([e.start, e.end]);
    case 'circle':
      return circleBBox(e);
    case 'arc':
      return arcBBox(e);
    case 'xline':
    case 'ray':
      return EMPTY_BBOX;
    case 'dimension':
      return fromPoints(dimensionPoints(e));
  }
}

/** The entity moved, rotated, mirrored or scaled; same id, layer and style. */
export function transformEntity(e: Entity, t: Transform): Entity {
  const p = (v: Vec2): Vec2 => transformPoint(t, v);
  switch (e.kind) {
    case 'point':
      return { ...e, at: p(e.at) };
    case 'line':
      return { ...e, start: p(e.start), end: p(e.end) };
    case 'circle':
      return { ...e, center: p(e.center), radius: transformLength(t, e.radius) };
    case 'arc':
      return { ...e, ...transformArc(t, e) };
    case 'xline':
    case 'ray':
      return { ...e, base: p(e.base), dir: transformDir(t, e.dir) };
    case 'dimension': {
      const m = mapDimensionPoints(e, p);
      switch (m.type) {
        case 'linear':
          return { ...m, dir: transformDir(t, m.dir) };
        case 'radius':
        case 'diameter':
          return { ...m, radius: transformLength(t, m.radius) };
        case 'angular':
          return { ...m, dir1: transformDir(t, m.dir1), dir2: transformDir(t, m.dir2) };
        default:
          return m;
      }
    }
  }
}

/**
 * The entity with every length passed through `f` (a scale about the origin):
 * positions and radii change; angles and xline directions don't. Used to
 * convert units, where `f` divides by 25.4 exactly rather than multiplying by
 * a rounded reciprocal.
 */
export function scaleEntity(e: Entity, f: (length: number) => number): Entity {
  const p = (v: Vec2): Vec2 => ({ x: f(v.x), y: f(v.y) });
  switch (e.kind) {
    case 'point':
      return { ...e, at: p(e.at) };
    case 'line':
      return { ...e, start: p(e.start), end: p(e.end) };
    case 'circle':
      return { ...e, center: p(e.center), radius: f(e.radius) };
    case 'arc':
      return { ...e, center: p(e.center), radius: f(e.radius) };
    case 'xline':
    case 'ray':
      return { ...e, base: p(e.base) };
    case 'dimension': {
      const m = mapDimensionPoints(e, p);
      const tol = m.tolerance ? { ...m, tolerance: scaleTolerance(m.tolerance, f) } : m;
      return tol.type === 'radius' || tol.type === 'diameter' ? { ...tol, radius: f(tol.radius) } : tol;
    }
  }
}

/** The entity as a curve with its real extent, or undefined for a point or a dimension. */
export function entityCurve(e: Entity): Curve | undefined {
  switch (e.kind) {
    case 'point':
    case 'dimension':
      return undefined;
    case 'line':
      return { kind: 'segment', a: e.start, b: e.end };
    case 'ray':
    case 'xline':
      return { kind: e.kind, base: e.base, dir: e.dir };
    case 'circle':
      return { kind: 'circle', center: e.center, radius: e.radius };
    case 'arc':
      return { kind: 'arc', center: e.center, radius: e.radius, startDeg: e.startDeg, endDeg: e.endDeg };
  }
}

/**
 * `e` reshaped to the curve `c`, keeping its id, layer and style. The kind
 * follows the curve: a trimmed xline becomes a ray, a trimmed circle an arc.
 */
export function entityFromCurve(e: Pick<Entity, 'id' | 'layer' | 'style'>, c: Curve): Entity {
  const base = { id: e.id, layer: e.layer, ...(e.style ? { style: e.style } : {}) };
  switch (c.kind) {
    case 'segment':
      return { ...base, kind: 'line', start: c.a, end: c.b };
    case 'ray':
    case 'xline':
      return { ...base, kind: c.kind, base: c.base, dir: c.dir };
    case 'circle':
      return { ...base, kind: 'circle', center: c.center, radius: c.radius };
    case 'arc':
      return { ...base, kind: 'arc', center: c.center, radius: c.radius, startDeg: c.startDeg, endDeg: c.endDeg };
  }
}

/** `score` ranks it; `dist` (true distance to the cursor) breaks ties. */
