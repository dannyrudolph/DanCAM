import { type BBox, EMPTY_BBOX, union } from '../geometry/bbox';
import { type Entity, type EntityId, entityBBox } from './entity';

export type Units = 'in' | 'mm';

export type Layer = {
  readonly name: string;
  readonly color: string;
  readonly visible: boolean;
};

/**
 * The drawing document. Entities are immutable values; the maps are changed
 * only by the undo stack applying a Transaction (CAD-3).
 */
export type Drawing = {
  readonly schemaVersion: 1;
  readonly units: Units;
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
    layers: new Map([[DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#e6e6e6', visible: true }]]),
    entities: new Map(),
    nextId: 1,
  };
}

export function newEntityId(d: Drawing): EntityId {
  const id = `e${d.nextId}`;
  d.nextId += 1;
  return id;
}

export function drawingBBox(d: Drawing): BBox {
  let b = EMPTY_BBOX;
  for (const e of d.entities.values()) b = union(b, entityBBox(e));
  return b;
}
