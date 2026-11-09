import { type BBox, isEmpty } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { dimensionBBox, dimensionLayout, layoutTouchesBox } from './dimLayout';
import type { Drawing } from './drawing';
import { type Entity, type EntityId, entityBBox, entityCurve } from './entity';

/** A window takes objects entirely inside the box; a crossing takes any it touches. */
export type BoxMode = 'window' | 'crossing';

/** Left-to-right drags make a window, right-to-left a crossing, as in AutoCAD. */
export function boxModeFor(fromX: number, toX: number): BoxMode {
  return toX >= fromX ? 'window' : 'crossing';
}

function inside(d: Drawing, e: Entity, box: BBox): boolean {
  const b = e.kind === 'dimension' ? dimensionBBox(d, e) : entityBBox(e);
  // Xlines and rays have no bounds: they are never inside a window.
  if (isEmpty(b)) return false;
  return b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY;
}

function touches(d: Drawing, e: Entity, box: BBox): boolean {
  if (e.kind === 'dimension') return layoutTouchesBox(dimensionLayout(d, e), box);
  const c = entityCurve(e);
  if (c) return curveTouchesBox(c, box);
  return inside(d, e, box); // a point
}

/** Ids of the visible entities the box selects, in drawing order. */
export function selectInBox(d: Drawing, box: BBox, mode: BoxMode): EntityId[] {
  const out: EntityId[] = [];
  for (const e of d.entities.values()) {
    if (d.layers.get(e.layer)?.visible === false) continue;
    if (mode === 'window' ? inside(d, e, box) : touches(d, e, box)) out.push(e.id);
  }
  return out;
}
