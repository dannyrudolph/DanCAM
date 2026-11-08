import { type BBox, EMPTY_BBOX, union } from '../geometry/bbox';
import { type Entity, type EntityId, entityBBox } from './entity';
import { LINE_STYLES, type LineStyle, type LineStyleName } from './lineStyle';

export type Units = 'in' | 'mm';

export type Layer = {
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
  /** Style used by entities on this layer that don't set their own. */
  readonly style: LineStyleName;
};

/**
 * The drawing document. Entities are immutable values; the maps are changed
 * only by the undo stack applying a Transaction (CAD-3).
 */
export type Drawing = {
  readonly schemaVersion: 1;
  /** Changed only through the undo stack (a `units` change). */
  units: Units;
  readonly layers: Map<string, Layer>;
  readonly entities: Map<EntityId, Entity>;
  /** Next id counter. Ids are never reused, even after undo. */
  nextId: number;
};

export const DEFAULT_LAYER = '0';

export function createDrawing(units: Units): Drawing {
  return {
    schemaVersion: 1,
    units,
    layers: new Map([[DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#000000', visible: true, style: 'visible' }]]),
    entities: new Map(),
    nextId: 1,
  };
}

export function newEntityId(d: Drawing): EntityId {
  const id = `e${d.nextId}`;
  d.nextId += 1;
  return id;
}

/** The style an entity draws with: its own, else its layer's, else Visible. */
export function effectiveStyle(d: Drawing, e: Entity): LineStyle {
  const name = e.style ?? d.layers.get(e.layer)?.style ?? 'visible';
  return LINE_STYLES[name];
}

export function drawingBBox(d: Drawing): BBox {
  let b = EMPTY_BBOX;
  for (const e of d.entities.values()) b = union(b, entityBBox(e));
  return b;
}
