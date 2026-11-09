import { type BBox, fromPoints, union } from '../geometry/bbox';
import { type Transform, rotation } from '../geometry/transform';
import type { Drawing } from './drawing';
import { type ArcEntity, type CircleEntity, type Entity, type InsertEntity, type LineEntity, type PointEntity, entityBBox, scaleEntity, transformEntity } from './entity';

/**
 * Blocks (spec, "Blocks"): named, reusable geometry kept in the drawing's
 * block table and placed as `insert` entities. A definition's geometry is
 * stored about its base point at the origin, in the drawing's units, with
 * ids unique within the block. No nesting: a block holds only lines,
 * circles, arcs and points.
 */

export type BlockGeometry = PointEntity | LineEntity | CircleEntity | ArcEntity;

export type BlockDef = {
  readonly name: string;
  /** Free text saved with the block (holder, insert, grade, notes); shown, never drawn. */
  readonly description: string;
  readonly entities: readonly BlockGeometry[];
};

export function isBlockGeometry(e: Entity): e is BlockGeometry {
  return e.kind === 'point' || e.kind === 'line' || e.kind === 'circle' || e.kind === 'arc';
}

const ORIGIN = { x: 0, y: 0 };

/** The instance's placement as transforms applied in order: mirror, scale, rotate, move. Identity steps are left out, keeping values exact. */
export function instanceTransforms(ins: InsertEntity): Transform[] {
  const out: Transform[] = [];
  if (ins.mirrored) out.push({ kind: 'mirror', a: ORIGIN, deg: 0 });
  if (ins.scale !== 1) out.push({ kind: 'scale', center: ORIGIN, factor: ins.scale });
  if (ins.rotationDeg !== 0) out.push(rotation(ORIGIN, ins.rotationDeg));
  if (ins.at.x !== 0 || ins.at.y !== 0) out.push({ kind: 'translate', dx: ins.at.x, dy: ins.at.y });
  return out;
}

/**
 * The instance's geometry where it is drawn: each of its block's entities
 * placed, keeping its id within the block. Geometry on layer 0 takes the
 * instance's layer (and its style when it sets none of its own). Empty when
 * the block isn't defined.
 */
export function instanceEntities(d: Drawing, ins: InsertEntity): BlockGeometry[] {
  const def = d.blocks.get(ins.block);
  if (!def) return [];
  const ts = instanceTransforms(ins);
  return def.entities.map((e) => {
    let out: Entity = e;
    for (const t of ts) out = transformEntity(out, t);
    if (e.layer !== '0') return out as BlockGeometry;
    return { ...out, layer: ins.layer, ...(e.style === undefined && ins.style !== undefined ? { style: ins.style } : {}) } as BlockGeometry;
  });
}

/** Bounds of what the instance draws; its insertion point when the block is empty or missing. */
export function insertBBox(d: Drawing, ins: InsertEntity): BBox {
  const parts = instanceEntities(d, ins);
  return parts.length === 0 ? fromPoints([ins.at]) : parts.map(entityBBox).reduce(union);
}

/** The drawing's instances of the block named `name`. */
export function insertsOf(d: Drawing, name: string): InsertEntity[] {
  return [...d.entities.values()].filter((e): e is InsertEntity => e.kind === 'insert' && e.block === name);
}

/** The block with every length passed through `f`, for converting units. */
export function scaleBlock(def: BlockDef, f: (length: number) => number): BlockDef {
  return { ...def, entities: def.entities.map((e) => scaleEntity(e, f) as BlockGeometry) };
}
