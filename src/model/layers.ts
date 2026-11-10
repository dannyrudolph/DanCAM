import { DEFAULT_LAYER, type Drawing, type Layer } from './drawing';
import type { Change, Transaction } from './undo';

/** A layer edit as an undoable transaction, or the reason it isn't allowed. */
export type LayerEdit = { readonly ok: true; readonly tx: Transaction } | { readonly ok: false; readonly error: string };

const refuse = (error: string): LayerEdit => ({ ok: false, error });

/** Layers for display: "0" first, then by name, numbers in numeric order (Layer2 before Layer10). */
export function sortedLayers(d: Drawing): Layer[] {
  return [...d.layers.values()].sort((a, b) => {
    if (a.name === DEFAULT_LAYER) return -1;
    if (b.name === DEFAULT_LAYER) return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** How many entities are on each layer. */
export function layerUsage(d: Drawing): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of d.entities.values()) n.set(e.layer, (n.get(e.layer) ?? 0) + 1);
  return n;
}

/** Names are compared without case, so "Hidden" and "HIDDEN" can't both exist. */
function nameTaken(d: Drawing, name: string): boolean {
  const key = name.toLowerCase();
  return [...d.layers.keys()].some((n) => n.toLowerCase() === key);
}

/** A new layer named Layer1, Layer2, ... (the first free one), black, visible, Visible style. */
export function addLayer(d: Drawing): { readonly tx: Transaction; readonly name: string } {
  let i = 1;
  while (nameTaken(d, `Layer${i}`)) i += 1;
  const layer: Layer = { name: `Layer${i}`, color: '#000000', visible: true, style: 'visible' };
  return { tx: { label: `New layer ${layer.name}`, changes: [{ op: 'layer', after: layer }] }, name: layer.name };
}

/** Changes a layer's color, visibility or style. Undefined when nothing would change. */
export function editLayer(d: Drawing, name: string, patch: Partial<Omit<Layer, 'name'>>): Transaction | undefined {
  const before = d.layers.get(name);
  if (!before) return undefined;
  const after: Layer = { ...before, ...patch };
  if (after.color === before.color && after.visible === before.visible && after.style === before.style) return undefined;
  return { label: `Layer ${name}`, changes: [{ op: 'layer', before, after }] };
}

/**
 * Renames a layer and moves its entities (and block geometry) with it, as one undo step. Layer "0"
 * keeps its name, as in AutoCAD.
 */
export function renameLayer(d: Drawing, from: string, toRaw: string): LayerEdit {
  const to = toRaw.trim();
  const layer = d.layers.get(from);
  if (!layer) return refuse(`There is no layer ${from}.`);
  if (from === DEFAULT_LAYER) return refuse('Layer 0 cannot be renamed.');
  if (to === '') return refuse('A layer needs a name.');
  if (to === from) return refuse('That is already its name.');
  // A change of case alone is fine; any other clash is not.
  if (to.toLowerCase() !== from.toLowerCase() && nameTaken(d, to)) return refuse(`There is already a layer named ${to}.`);

  const changes: Change[] = [{ op: 'layer', after: { ...layer, name: to } }];
  for (const e of d.entities.values()) {
    if (e.layer === from) changes.push({ op: 'modify', before: e, after: { ...e, layer: to } });
  }
  for (const b of d.blocks.values()) {
    if (b.entities.some((e) => e.layer === from)) {
      changes.push({ op: 'block', before: b, after: { ...b, entities: b.entities.map((e) => (e.layer === from ? { ...e, layer: to } : e)) } });
    }
  }
  changes.push({ op: 'layer', before: layer });
  return { ok: true, tx: { label: `Rename layer ${from} to ${to}`, changes } };
}

/** Deletes an empty layer. Layer "0" and the current layer stay. */
export function deleteLayer(d: Drawing, name: string): LayerEdit {
  const layer = d.layers.get(name);
  if (!layer) return refuse(`There is no layer ${name}.`);
  if (name === DEFAULT_LAYER) return refuse('Layer 0 cannot be deleted.');
  if (name === d.currentLayer) return refuse(`${name} is the current layer; make another layer current first.`);
  const used = layerUsage(d).get(name) ?? 0;
  if (used > 0) return refuse(`${name} still has ${used} object${used === 1 ? '' : 's'} on it.`);
  const block = [...d.blocks.values()].find((b) => b.entities.some((e) => e.layer === name));
  if (block) return refuse(`Block ${block.name} has geometry on ${name}.`);
  return { ok: true, tx: { label: `Delete layer ${name}`, changes: [{ op: 'layer', before: layer }] } };
}

/**
 * Keeps the current layer pointing at a layer that exists: after an undo
 * removes it, or a rename moves it, the current layer follows or falls back
 * to "0" (or the first layer, in a file without one).
 */
export function ensureCurrentLayer(d: Drawing, renamedFrom?: string, renamedTo?: string): void {
  if (renamedFrom !== undefined && renamedTo !== undefined && d.currentLayer === renamedFrom && d.layers.has(renamedTo)) {
    d.currentLayer = renamedTo;
  }
  if (d.layers.has(d.currentLayer)) return;
  d.currentLayer = d.layers.has(DEFAULT_LAYER) ? DEFAULT_LAYER : (d.layers.keys().next().value ?? DEFAULT_LAYER);
}
