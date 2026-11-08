import { type BBox, fromPoints } from '../geometry/bbox';
import type { Vec2 } from '../geometry/vec';

/** Stable id, unique within a drawing and never reused. */
export type EntityId = string;

export type PointEntity = {
  readonly kind: 'point';
  readonly id: EntityId;
  readonly layer: string;
  readonly at: Vec2;
};

export type LineEntity = {
  readonly kind: 'line';
  readonly id: EntityId;
  readonly layer: string;
  readonly start: Vec2;
  readonly end: Vec2;
};

/** Phase 1 adds circle, arc, xline, ray and text. */
export type Entity = PointEntity | LineEntity;

export function entityBBox(e: Entity): BBox {
  switch (e.kind) {
    case 'point':
      return fromPoints([e.at]);
    case 'line':
      return fromPoints([e.start, e.end]);
  }
}
