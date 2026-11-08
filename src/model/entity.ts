import { arcBBox } from '../geometry/arc';
import { type BBox, EMPTY_BBOX, fromPoints } from '../geometry/bbox';
import { circleBBox } from '../geometry/circle';
import type { Curve } from '../geometry/curve';
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

export type Entity = PointEntity | LineEntity | CircleEntity | ArcEntity | XlineEntity | RayEntity;

/** The layer and style a tool gives each new entity. */
export type EntityProps = { readonly layer: string; readonly style?: LineStyleName };

/**
 * Bounds used by Zoom Extents. Xlines and rays are infinite, so they
 * contribute nothing, as in AutoCAD.
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
  }
}

/** The entity as a curve with its real extent, or undefined for a point. */
export function entityCurve(e: Entity): Curve | undefined {
  switch (e.kind) {
    case 'point':
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

/** `score` ranks it; `dist` (true distance to the cursor) breaks ties. */
