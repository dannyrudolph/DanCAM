import { nearlyEqual } from '../geometry/tolerance';
import { type BlockDef, scaleBlock } from './block';
import type { Drawing, Layer, Units } from './drawing';
import type { Change, Transaction } from './undo';
import { MM_PER_INCH } from './units';

/**
 * The block library shared by every drawing (spec, "Blocks", Library): what
 * an entry holds, copying one into a drawing, Update from library, and how
 * an imported library file meets the one already there. Names match
 * without case, as block names do in a drawing. Storage is in
 * `io/libraryStore`; this module is pure.
 */

/** A library block: the definition, the units it was drawn in, and the layers its geometry is on (so a drawing without them can take it). */
export type LibraryBlock = BlockDef & { readonly units: Units; readonly layers: readonly Layer[] };

const key = (name: string): string => name.toLowerCase();

/** The library entry for the drawing's block `name`. */
export function libraryEntry(d: Drawing, name: string): LibraryBlock {
  const def = d.blocks.get(name);
  if (!def) throw new Error(`libraryEntry: no block ${name}`);
  const used = new Set(def.entities.map((e) => e.layer));
  const layers = [...d.layers.values()].filter((l) => used.has(l.name) && l.name !== '0');
  return { name: def.name, description: def.description, entities: def.entities, units: d.units, layers };
}

/** The library block as a definition in `units` (converted when it was drawn in the other unit), named `name`. */
export function inUnits(lib: LibraryBlock, units: Units, name: string = lib.name): BlockDef {
  const def: BlockDef = { name, description: lib.description, entities: lib.entities };
  if (lib.units === units) return def;
  return scaleBlock(def, (v) => (units === 'mm' ? v * MM_PER_INCH : v / MM_PER_INCH));
}

/** True when the two hold the same description and geometry, coordinates within the shared tolerance. Names aren't compared. */
export function sameBlock(a: BlockDef, b: BlockDef): boolean {
  return a.description === b.description && near(a.entities, b.entities);
}

function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return nearlyEqual(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => near(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const rb = b as Record<string, unknown>;
    return ka.length === Object.keys(rb).length && ka.every((k) => k in rb && near((a as Record<string, unknown>)[k], rb[k]));
  }
  return a === b;
}

/** The entry named `name` in any case, if there is one. */
export function findEntry(library: readonly LibraryBlock[], name: string): LibraryBlock | undefined {
  return library.find((b) => key(b.name) === key(name));
}

/** The drawing's block named `name` in any case, if there is one. */
export function findBlock(d: Drawing, name: string): BlockDef | undefined {
  return [...d.blocks.values()].find((b) => key(b.name) === key(name));
}

/** How the drawing's block stands against the library: not there, the same, or different. */
export function libraryStatus(d: Drawing, def: BlockDef, library: readonly LibraryBlock[]): 'none' | 'same' | 'differs' {
  const lib = findEntry(library, def.name);
  if (!lib) return 'none';
  return sameBlock(def, inUnits(lib, d.units)) ? 'same' : 'differs';
}

/** `name`, or `name 2`, `name 3`, … : the first not in `taken` (without case). */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(key));
  if (!used.has(key(name))) return name;
  for (let n = 2; ; n++) if (!used.has(key(`${name} ${n}`))) return `${name} ${n}`;
}

/** The library block's layers the drawing doesn't have, as changes. */
function missingLayers(d: Drawing, lib: LibraryBlock): Change[] {
  const used = new Set(lib.entities.map((e) => e.layer));
  return lib.layers.filter((l) => used.has(l.name) && !d.layers.has(l.name)).map((l) => ({ op: 'layer', after: l }));
}

/**
 * Copies the library block into the drawing as `name` (its own name by
 * default), in the drawing's units, with any layers it needs: one undo step.
 * The caller makes sure the name is free.
 */
export function copyIn(d: Drawing, lib: LibraryBlock, name: string = lib.name): Transaction {
  return {
    label: `Copy block ${name} from the library`,
    changes: [...missingLayers(d, lib), { op: 'block', after: inUnits(lib, d.units, name) }],
  };
}

/**
 * Update from library: the drawing's block of the same name redefined from
 * the library, one undo step (every instance changes; dimensions on kept
 * parts re-measure). Undefined when there's nothing to update.
 */
export function updateFromLibrary(d: Drawing, name: string, library: readonly LibraryBlock[]): Transaction | undefined {
  const before = d.blocks.get(name);
  const lib = findEntry(library, name);
  if (!before || !lib) return undefined;
  const after = inUnits(lib, d.units, before.name);
  if (sameBlock(before, after)) return undefined;
  return { label: `Update block ${name} from the library`, changes: [...missingLayers(d, lib), { op: 'block', before, after }] };
}

/** An imported library file against the library: new names, unchanged ones, and names taken by a different block. */
export type ImportPlan = { readonly added: readonly LibraryBlock[]; readonly same: readonly LibraryBlock[]; readonly clashes: readonly LibraryBlock[] };

export function planImport(library: readonly LibraryBlock[], incoming: readonly LibraryBlock[]): ImportPlan {
  const added: LibraryBlock[] = [];
  const same: LibraryBlock[] = [];
  const clashes: LibraryBlock[] = [];
  for (const b of incoming) {
    const there = findEntry(library, b.name);
    if (!there) added.push(b);
    else if (sameBlock(inUnits(b, there.units), there)) same.push(b);
    else clashes.push(b);
  }
  return { added, same, clashes };
}

/** What to do with names taken by a different block: replace the library's, keep both (the imported one renamed), or skip. */
export type ClashChoice = 'replace' | 'rename' | 'skip';

/** The entries to write for an import: the new ones, and the clashes as chosen. */
export function importEntries(library: readonly LibraryBlock[], plan: ImportPlan, choice: ClashChoice): LibraryBlock[] {
  const out = [...plan.added];
  if (choice === 'replace') out.push(...plan.clashes);
  if (choice === 'rename') {
    const taken = [...library, ...plan.added].map((b) => b.name);
    for (const b of plan.clashes) {
      const name = freeName(b.name, taken);
      taken.push(name);
      out.push({ ...b, name });
    }
  }
  return out;
}
