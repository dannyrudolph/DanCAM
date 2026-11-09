import { arcBBox } from '../geometry/arc';
import { type BBox, EMPTY_BBOX, fromPoints } from '../geometry/bbox';
import { circleBBox } from '../geometry/circle';
import type { Curve } from '../geometry/curve';
import { type Transform, transformArc, transformDir, transformLength, transformPoint } from '../geometry/transform';
import type { Vec2 } from '../geometry/vec';
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
 * `p1` and `p2` are the measured points; the dimension line passes through
 * `at`. A linear dimension measures along `dir` (a unit vector: (1, 0)
 * horizontal, (0, 1) vertical, other angles after a rotate); an aligned one
 * along p1 → p2. `refs` names the measured geometry, unused until
 * associativity (Phase 5). The line style is ignored: dimensions draw thin.
 */
export type DimensionEntity = EntityBase & {
  readonly kind: 'dimension';
  readonly dimStyle: string;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly at: Vec2;
  readonly refs?: readonly EntityId[];
} & ({ readonly type: 'linear'; readonly dir: Vec2 } | { readonly type: 'aligned' });

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
      return fromPoints([e.p1, e.p2, e.at]);
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
      const pts = { p1: p(e.p1), p2: p(e.p2), at: p(e.at) };
      return e.type === 'linear' ? { ...e, ...pts, dir: transformDir(t, e.dir) } : { ...e, ...pts };
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
    case 'dimension':
      return { ...e, p1: p(e.p1), p2: p(e.p2), at: p(e.at) };
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
