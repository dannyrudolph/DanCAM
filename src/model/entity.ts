import { type BBox, fromPoints } from '../geometry/bbox';
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

/** Phase 1b adds circle, arc and xline. */
export type Entity = PointEntity | LineEntity;

/** The layer and style a tool gives each new entity. */
export type EntityProps = { readonly layer: string; readonly style?: LineStyleName };

export function entityBBox(e: Entity): BBox {
  switch (e.kind) {
    case 'point':
      return fromPoints([e.at]);
    case 'line':
      return fromPoints([e.start, e.end]);
  }
}
