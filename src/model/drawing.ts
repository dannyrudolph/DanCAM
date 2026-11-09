import { type BBox, EMPTY_BBOX, union } from '../geometry/bbox';
import { dimensionBBox } from './dimLayout';
import { type DimStyle, defaultDimStyle } from './dimStyle';
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
  readonly schemaVersion: 2;
  /** Changed only through the undo stack (a `units` change). */
  units: Units;
  readonly layers: Map<string, Layer>;
  readonly entities: Map<EntityId, Entity>;
  /** Named dimension styles; changed only through the undo stack (`dimStyle` changes). */
  readonly dimStyles: Map<string, DimStyle>;
  /** Style new dimensions use. A setting like `currentLayer`: saved, not undoable. */
  currentDimStyle: string;
  /**
   * Layer new entities go on. Saved in the file but not undoable (a setting,
   * like the active tool); see `ensureCurrentLayer` for when its layer goes away.
   */
  currentLayer: string;
  /** Next id counter. Ids are never reused, even after undo. */
  nextId: number;
};

export const DEFAULT_LAYER = '0';

export function createDrawing(units: Units): Drawing {
  const dimStyle = defaultDimStyle(units);
  return {
    schemaVersion: 2,
    units,
    layers: new Map([[DEFAULT_LAYER, { name: DEFAULT_LAYER, color: '#000000', visible: true, style: 'visible' }]]),
    entities: new Map(),
    dimStyles: new Map([[dimStyle.name, dimStyle]]),
    currentDimStyle: dimStyle.name,
    currentLayer: DEFAULT_LAYER,
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

/** Bounds of everything drawn, dimension text and arrows included, for Zoom Extents. */
export function drawingBBox(d: Drawing): BBox {
  let b = EMPTY_BBOX;
  for (const e of d.entities.values()) b = union(b, e.kind === 'dimension' ? dimensionBBox(d, e) : entityBBox(e));
  return b;
}
