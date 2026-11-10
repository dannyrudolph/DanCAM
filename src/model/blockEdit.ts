import { type BlockGeometry, blockNameError, insertsOf, isBlockGeometry } from './block';
import { type Drawing, createDrawing } from './drawing';
import type { Change, Transaction } from './undo';

/**
 * Managing block definitions (spec, "Blocks"): Edit block, Rename, Delete
 * and Purge. Each returns one transaction, or why it can't.
 */

export type BlockEdit = { readonly ok: true; readonly tx: Transaction } | { readonly ok: false; readonly error: string };

const refuse = (error: string): BlockEdit => ({ ok: false, error });

/**
 * The block `name` opened by itself for Edit block: a drawing holding its
 * geometry (base point at the origin) with the drawing's units, layers,
 * dimension styles and settings, and no blocks (no nesting). New objects
 * get ids that don't clash with the block's.
 */
export function blockEditDrawing(d: Drawing, name: string): Drawing {
  const def = d.blocks.get(name);
  if (!def) throw new Error(`blockEditDrawing: no block ${name}`);
  const e = createDrawing(d.units);
  e.layers.clear();
  for (const [k, l] of d.layers) e.layers.set(k, l);
  e.dimStyles.clear();
  for (const [k, s] of d.dimStyles) e.dimStyles.set(k, s);
  e.currentDimStyle = d.currentDimStyle;
  e.currentLayer = d.currentLayer;
  e.sheetScale = d.sheetScale;
  e.lathe = d.lathe;
  e.diameterMode = d.diameterMode;
  let maxId = 0;
  for (const g of def.entities) {
    e.entities.set(g.id, g);
    const n = /^e(\d+)$/.exec(g.id);
    if (n) maxId = Math.max(maxId, Number(n[1]));
  }
  e.nextId = maxId + 1;
  return e;
}

/** Save of Edit block: the transaction, and how many objects were left out (not lines, circles, arcs or points). */
export type BlockSave = { readonly ok: true; readonly tx: Transaction | undefined; readonly left: number } | { readonly ok: false; readonly error: string };

/**
 * Edit block's Save: the block redefined from what `edited` holds, as one
 * undo step in `d` (every instance is drawn anew, and dimensions on them
 * re-measure). Parts keep their ids, so dimensions on a kept part stay on
 * it. Layers made or changed while editing (colour, style, shown) are
 * carried into `d` too; renaming or deleting one there doesn't carry. `tx`
 * is undefined when nothing changed.
 */
export function saveBlockEdit(d: Drawing, name: string, edited: Drawing): BlockSave {
  const before = d.blocks.get(name);
  if (!before) return { ok: false, error: `There is no block ${name}.` };
  const all = [...edited.entities.values()];
  const entities = all.filter(isBlockGeometry) as BlockGeometry[];
  if (entities.length === 0) return { ok: false, error: 'A block needs at least one line, circle, arc or point.' };
  const left = all.length - entities.length;
  const changes: Change[] = [];
  for (const [layer, l] of edited.layers) {
    const was = d.layers.get(layer);
    if (!was) changes.push({ op: 'layer', after: l });
    else if (JSON.stringify(was) !== JSON.stringify(l)) changes.push({ op: 'layer', before: was, after: l });
  }
  if (JSON.stringify(entities) !== JSON.stringify(before.entities)) changes.push({ op: 'block', before, after: { ...before, entities } });
  if (changes.length === 0) return { ok: true, tx: undefined, left };
  return { ok: true, tx: { label: `Edit block ${name}`, changes }, left };
}

/** Renames a block and points its instances at the new name, as one undo step. A change of case alone is fine. */
export function renameBlock(d: Drawing, from: string, toRaw: string): BlockEdit {
  const def = d.blocks.get(from);
  if (!def) return refuse(`There is no block ${from}.`);
  const to = toRaw.trim();
  if (to === from) return refuse('That is already its name.');
  const error = to.toLowerCase() === from.toLowerCase() ? undefined : blockNameError(d, to);
  if (error) return refuse(error);
  const changes: Change[] = [{ op: 'block', after: { ...def, name: to } }];
  for (const ins of insertsOf(d, from)) changes.push({ op: 'modify', before: ins, after: { ...ins, block: to } });
  changes.push({ op: 'block', before: def });
  return { ok: true, tx: { label: `Rename block ${from} to ${to}`, changes } };
}

/** Deletes a block no instance uses. */
export function deleteBlock(d: Drawing, name: string): BlockEdit {
  const def = d.blocks.get(name);
  if (!def) return refuse(`There is no block ${name}.`);
  const n = insertsOf(d, name).length;
  if (n > 0) return refuse(`${name} has ${n} instance${n === 1 ? '' : 's'} in the drawing; erase or explode them first.`);
  return { ok: true, tx: { label: `Delete block ${name}`, changes: [{ op: 'block', before: def }] } };
}

/** Purge: deletes every block no instance uses, as one undo step. */
export function purgeBlocks(d: Drawing): BlockEdit {
  const unused = [...d.blocks.values()].filter((b) => insertsOf(d, b.name).length === 0);
  if (unused.length === 0) return refuse('Every block is in use; nothing to purge.');
  const n = unused.length;
  return { ok: true, tx: { label: `Purge ${n} block${n === 1 ? '' : 's'}`, changes: unused.map((before) => ({ op: 'block', before })) } };
}
