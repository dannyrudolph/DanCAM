import { LIBRARY_EXTENSION, parseLibrary, serializeLibrary } from '../io/nativeFile';
import type { BlockLibraryStore } from '../io/libraryStore';
import type { Drawing } from '../model/drawing';
import {
  type ClashChoice,
  type LibraryBlock,
  copyIn,
  findBlock,
  findEntry,
  freeName,
  importEntries,
  inUnits,
  libraryEntry,
  planImport,
  sameBlock,
  updateFromLibrary,
} from '../model/library';
import type { Transaction } from '../model/undo';
import { UNIT_LABEL } from '../model/units';
import { blockPreviewSvg, iconButton } from './blocksPanel';
import { download, pickTextFile } from './fileAccess';
import { ICONS } from './icons';

export type Choice = { readonly label: string; readonly run: () => void };

export type LibraryHost = {
  drawing(): Drawing;
  /** True (and says why) when the drawing can't take a block now (Edit block is open). */
  busy(): boolean;
  commit(tx: Transaction): void;
  message(text: string): void;
  /** Starts Insert with the drawing's block `name`. */
  insert(name: string): void;
  /** Asks `question` in a menu at `at`; Esc or a click elsewhere is no. */
  ask(at: DOMRect, question: string, choices: readonly Choice[]): void;
  /** The library's blocks changed: redraw what shows them. */
  changed(): void;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The block library (spec, "Blocks", Library): blocks saved in this browser
 * for every drawing. Clicking one copies it into the drawing (in the
 * drawing's units) and starts Insert. Export and Import write and read a
 * `.cad2d-blocks.json` file. A name already in the drawing or the library is
 * never overwritten without asking.
 */
export class LibraryPanel {
  /** The library's blocks by name; empty until loaded. */
  entries: readonly LibraryBlock[] = [];
  private error: string | undefined;
  private loaded = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly store: BlockLibraryStore,
    private readonly host: LibraryHost,
  ) {
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const list = await this.store.list();
      this.entries = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      this.error = undefined;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    this.loaded = true;
    this.host.changed();
  }

  /** Writes to the library, then reloads; says so when the browser won't store it. */
  private async write(work: () => Promise<void>, done: string): Promise<void> {
    try {
      await work();
      this.host.message(done);
    } catch (err) {
      this.host.message(`The library couldn't be changed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await this.reload();
  }

  show(): void {
    const title = document.createElement('h2');
    title.textContent = 'Block library';
    const header = document.createElement('div');
    header.className = 'layers-header';
    const exp = iconButton(ICONS.exportFile, `Export library: save every library block to a ${LIBRARY_EXTENSION} file`, 'export-library');
    exp.addEventListener('click', () => this.exportFile());
    const imp = iconButton(ICONS.importFile, `Import library: add the blocks in a ${LIBRARY_EXTENSION} file`, 'import-library');
    imp.addEventListener('click', () => void this.importFile(imp.getBoundingClientRect()));
    const buttons = document.createElement('span');
    buttons.className = 'header-actions';
    buttons.append(imp, exp);
    header.append(title, buttons);
    const note = (text: string): HTMLParagraphElement => {
      const p = document.createElement('p');
      p.className = 'blocks-empty';
      p.textContent = text;
      return p;
    };
    if (this.error !== undefined) {
      this.root.replaceChildren(header, note(`The library isn't available in this browser: ${this.error}`));
      return;
    }
    if (!this.loaded) {
      this.root.replaceChildren(header, note('Loading…'));
      return;
    }
    if (this.entries.length === 0) {
      this.root.replaceChildren(header, note('Empty. Save a block to the library from the Blocks panel; every drawing can use it.'));
      return;
    }
    const list = document.createElement('ul');
    list.className = 'layer-list';
    for (const lib of this.entries) {
      const li = document.createElement('li');
      li.className = 'block-row';
      li.dataset.libraryBlock = lib.name;
      li.title = `Insert ${lib.name} from the library${lib.description === '' ? '' : `: ${lib.description}`}`;
      li.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('button')) return;
        this.use(lib, li.getBoundingClientRect());
      });
      const preview = document.createElement('span');
      preview.className = 'block-preview';
      preview.innerHTML = blockPreviewSvg(lib);
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = lib.name;
      const units = document.createElement('span');
      units.className = 'layer-count';
      units.textContent = lib.units;
      units.title = `Drawn in ${UNIT_LABEL[lib.units]}`;
      const del = iconButton(ICONS.trash, 'Delete from the library (drawings keep their copies)');
      del.dataset.role = 'delete';
      del.addEventListener('click', () => this.deleteEntry(lib, del.getBoundingClientRect()));
      const actions = document.createElement('span');
      actions.className = 'block-actions';
      actions.append(del);
      const description = document.createElement('span');
      description.className = 'block-description';
      description.textContent = lib.description;
      li.append(preview, name, units, actions, description);
      list.append(li);
    }
    this.root.replaceChildren(header, list);
  }

  /** Copies the library block into the drawing (unless it's already there, the same) and starts Insert with it. */
  private use(lib: LibraryBlock, at: DOMRect): void {
    if (this.host.busy()) return;
    const d = this.host.drawing();
    const there = findBlock(d, lib.name);
    if (!there) {
      this.host.commit(copyIn(d, lib));
      this.host.insert(lib.name);
      return;
    }
    if (sameBlock(there, inUnits(lib, d.units))) {
      this.host.insert(there.name);
      return;
    }
    const as = freeName(lib.name, d.blocks.keys());
    this.host.ask(at, `The drawing's ${there.name} isn't the same as the library's.`, [
      { label: `Use the drawing's ${there.name}`, run: () => this.host.insert(there.name) },
      {
        label: `Update the drawing's ${there.name} from the library (every instance changes)`,
        run: () => {
          const tx = updateFromLibrary(d, there.name, this.entries);
          if (tx) this.host.commit(tx);
          this.host.insert(there.name);
        },
      },
      {
        label: `Copy it in as ${as}`,
        run: () => {
          this.host.commit(copyIn(d, lib, as));
          this.host.insert(as);
        },
      },
    ]);
  }

  /** Save to library: the drawing's block `name` into the library, asking before replacing a different one. */
  saveToLibrary(name: string, at: DOMRect): void {
    const d = this.host.drawing();
    const def = d.blocks.get(name);
    if (!def) return;
    const entry = libraryEntry(d, name);
    const there = findEntry(this.entries, name);
    if (!there) {
      void this.write(() => this.store.put([entry]), `Saved ${name} to the library`);
      return;
    }
    if (sameBlock(def, inUnits(there, d.units))) {
      this.host.message(`${name} is already in the library, unchanged.`);
      return;
    }
    const as = freeName(name, this.entries.map((b) => b.name));
    this.host.ask(at, `The library already has a different ${there.name}.`, [
      { label: `Replace the library's ${there.name}`, run: () => void this.write(() => this.store.put([entry]), `Replaced ${there.name} in the library`) },
      { label: `Save it as ${as}`, run: () => void this.write(() => this.store.put([{ ...entry, name: as }]), `Saved ${name} to the library as ${as}`) },
    ]);
  }

  /** Update from library: the drawing's block `name` redefined from the library's, one undo step. */
  updateFromLibrary(name: string): void {
    if (this.host.busy()) return;
    const tx = updateFromLibrary(this.host.drawing(), name, this.entries);
    if (tx) this.host.commit(tx);
    else this.host.message(`${name} is the same as the library's.`);
  }

  private deleteEntry(lib: LibraryBlock, at: DOMRect): void {
    this.host.ask(at, `Delete ${lib.name} from the library? Drawings keep their copies. This can't be undone.`, [
      { label: `Delete ${lib.name}`, run: () => void this.write(() => this.store.remove(lib.name), `Deleted ${lib.name} from the library`) },
    ]);
  }

  private exportFile(): void {
    if (this.entries.length === 0) {
      this.host.message('The library is empty; nothing to export.');
      return;
    }
    download(`DanCAM blocks${LIBRARY_EXTENSION}`, serializeLibrary(this.entries));
    this.host.message(`Exported ${plural(this.entries.length, 'block')}`);
  }

  private async importFile(at: DOMRect): Promise<void> {
    const file = await pickTextFile(`${LIBRARY_EXTENSION},.json`);
    if (!file) return;
    const r = parseLibrary(file.text);
    if (!r.ok) {
      this.host.message(`Can't import ${file.name}: ${r.error}`);
      return;
    }
    const plan = planImport(this.entries, r.blocks);
    const run = (choice: ClashChoice): void => {
      const write = importEntries(this.entries, plan, choice);
      const parts = [`Imported ${plural(write.length, 'block')}`];
      if (plan.same.length > 0) parts.push(`${plan.same.length} already in the library`);
      if (choice === 'skip' && plan.clashes.length > 0) parts.push(`${plan.clashes.length} skipped`);
      void this.write(() => this.store.put(write), parts.join(', '));
    };
    if (plan.clashes.length === 0) {
      run('skip');
      return;
    }
    const n = plan.clashes.length;
    const names = plan.clashes.map((b) => b.name).join(', ');
    this.host.ask(at, `${plural(n, 'block')} in the file ${n === 1 ? 'has a name' : 'have names'} the library uses for a different block: ${names}.`, [
      { label: 'Replace the library\'s', run: () => run('replace') },
      { label: 'Keep both (rename the imported ones)', run: () => run('rename') },
      { label: 'Skip them', run: () => run('skip') },
    ]);
  }
}
