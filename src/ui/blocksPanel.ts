import { arcEnd, arcStart, arcSweepDeg } from '../geometry/arc';
import { union } from '../geometry/bbox';
import { type BlockDef, insertsOf } from '../model/block';
import { type BlockEdit, deleteBlock, purgeBlocks, renameBlock } from '../model/blockEdit';
import type { Drawing } from '../model/drawing';
import { entityBBox } from '../model/entity';
import { type LibraryBlock, libraryStatus } from '../model/library';
import type { Transaction } from '../model/undo';
import { ICONS } from './icons';

export type BlocksHost = {
  /** Starts Insert with the block named `name`. */
  insert(name: string): void;
  /** Opens the block named `name` in Edit block. */
  edit(name: string): void;
  /** Applies a change (rename, delete, purge) through the undo stack. */
  commit(tx: Transaction): void;
  message(text: string): void;
  /** Save to library (asks at `at` before replacing a different library block). */
  saveToLibrary(name: string, at: DOMRect): void;
  /** Update from library: redefines the block from the library's of the same name. */
  updateFromLibrary(name: string): void;
};

/**
 * The Blocks panel (spec, "Blocks"): the drawing's blocks by name, each
 * with a small preview, how many instances there are, and its description.
 * Clicking one starts Insert with it; double-clicking its name renames it;
 * its buttons open Edit block or delete it (when unused). Purge in the
 * header deletes every unused block. While a block is being edited the
 * panel says so instead.
 */
export class BlocksPanel {
  private drawing: Drawing | undefined;
  private editing: string | undefined;
  private renaming: string | undefined;
  private library: readonly LibraryBlock[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly host: BlocksHost,
  ) {}

  /** `editing`: the block open in Edit block, if any; `library`: the block library, to offer Update from library. */
  show(d: Drawing, editing: string | undefined, library: readonly LibraryBlock[]): void {
    this.drawing = d;
    this.editing = editing;
    this.library = library;
    if (this.renaming !== undefined) return; // don't rebuild under the user's hands
    this.render();
  }

  private render(): void {
    const d = this.drawing;
    if (!d) return;
    const title = document.createElement('h2');
    title.textContent = 'Blocks';
    const header = document.createElement('div');
    header.className = 'layers-header';
    header.append(title);
    const note = (text: string): HTMLParagraphElement => {
      const p = document.createElement('p');
      p.className = 'blocks-empty';
      p.textContent = text;
      return p;
    };
    if (this.editing !== undefined) {
      this.root.replaceChildren(header, note(`Editing ${this.editing}. Save block or Cancel in the bar above the drawing.`));
      return;
    }
    if (d.blocks.size === 0) {
      this.root.replaceChildren(header, note('None yet. Select geometry and choose Create block (K).'));
      return;
    }
    const purge = iconButton(ICONS.trash, 'Purge: delete every block no instance uses', 'purge-blocks');
    purge.addEventListener('click', () => this.apply(purgeBlocks(d)));
    header.append(purge);

    const list = document.createElement('ul');
    list.className = 'layer-list';
    const byName = [...d.blocks.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    for (const def of byName) {
      const li = document.createElement('li');
      li.className = 'block-row';
      li.dataset.block = def.name;
      li.title = `Insert ${def.name}${def.description === '' ? '' : `: ${def.description}`}`;
      li.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest('button, input')) return;
        this.host.insert(def.name);
      });
      const preview = document.createElement('span');
      preview.className = 'block-preview';
      preview.innerHTML = blockPreviewSvg(def);
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = String(insertsOf(d, def.name).length);
      count.title = 'Instances in the drawing';
      const edit = iconButton(ICONS.editBlock, 'Edit block: change its geometry; every instance follows');
      edit.dataset.role = 'edit';
      edit.addEventListener('click', () => this.host.edit(def.name));
      const del = iconButton(ICONS.trash, 'Delete block (only one no instance uses)');
      del.dataset.role = 'delete';
      del.addEventListener('click', () => this.apply(deleteBlock(d, def.name)));
      const save = iconButton(ICONS.toLibrary, 'Save to library: every drawing can use it');
      save.dataset.role = 'to-library';
      save.addEventListener('click', () => this.host.saveToLibrary(def.name, save.getBoundingClientRect()));
      const actions = document.createElement('span');
      actions.className = 'block-actions';
      if (libraryStatus(d, def, this.library) === 'differs') {
        const update = iconButton(ICONS.fromLibrary, 'Update from library: the library\'s block differs; take it (every instance changes)');
        update.dataset.role = 'from-library';
        update.addEventListener('click', () => this.host.updateFromLibrary(def.name));
        actions.append(update);
      }
      actions.append(save, edit, del);
      const description = document.createElement('span');
      description.className = 'block-description';
      description.textContent = def.description;
      li.append(preview, this.nameCell(d, def.name), count, actions, description);
      list.append(li);
    }
    this.root.replaceChildren(header, list);
    this.root.querySelector<HTMLInputElement>('input.layer-name-input')?.select();
  }

  private apply(r: BlockEdit): void {
    if (r.ok) this.host.commit(r.tx);
    else this.host.message(r.error);
  }

  /** The name, or a text box while renaming (double-click; Enter or leaving it applies, Esc cancels). */
  private nameCell(d: Drawing, name: string): HTMLElement {
    if (this.renaming !== name) {
      const span = document.createElement('span');
      span.className = 'layer-name';
      span.textContent = name;
      span.dataset.role = 'name';
      span.title = `Double-click to rename; click the row to insert`;
      span.addEventListener('dblclick', () => {
        this.renaming = name;
        this.render();
      });
      return span;
    }
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = name;
    input.spellcheck = false;
    input.dataset.role = 'name-input';
    let done = false;
    const finish = (apply: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = undefined;
      const to = input.value;
      if (apply && to.trim() !== name) this.apply(renameBlock(d, name, to));
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not start tools
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        finish(e.key === 'Enter');
      }
    });
    input.addEventListener('blur', () => finish(true));
    return input;
  }
}

export function iconButton(icon: string, title: string, testId?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'layer-icon-button';
  b.innerHTML = icon;
  b.title = title;
  b.tabIndex = -1;
  if (testId) b.dataset.testid = testId;
  return b;
}

const fmt = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/**
 * A small SVG of the block's geometry, fitted to its bounds with a margin.
 * Drawn in drawing coordinates inside a group flipped upright, so Y points
 * up and arcs sweep counter-clockwise as stored. Rounded only for display.
 */
export function blockPreviewSvg(def: BlockDef): string {
  if (def.entities.length === 0) return '<svg viewBox="0 0 1 1"></svg>';
  const b = def.entities.map(entityBBox).reduce(union);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) || 1;
  const pad = size * 0.08;
  const [x, w] = [b.minX - pad, b.maxX - b.minX + 2 * pad];
  const [y, h] = [-(b.maxY + pad), b.maxY - b.minY + 2 * pad];
  const dot = size * 0.02;
  const parts = def.entities.map((e) => {
    switch (e.kind) {
      case 'line':
        return `<line x1="${fmt(e.start.x)}" y1="${fmt(e.start.y)}" x2="${fmt(e.end.x)}" y2="${fmt(e.end.y)}"/>`;
      case 'circle':
        return `<circle cx="${fmt(e.center.x)}" cy="${fmt(e.center.y)}" r="${fmt(e.radius)}"/>`;
      case 'arc': {
        const s = arcStart(e);
        const t = arcEnd(e);
        const large = arcSweepDeg(e) > 180 ? 1 : 0;
        return `<path d="M${fmt(s.x)} ${fmt(s.y)} A${fmt(e.radius)} ${fmt(e.radius)} 0 ${large} 1 ${fmt(t.x)} ${fmt(t.y)}"/>`;
      }
      case 'point':
        return `<circle cx="${fmt(e.at.x)}" cy="${fmt(e.at.y)}" r="${fmt(dot)}"/>`;
    }
  });
  return `<svg viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" fill="none" stroke="currentColor"><g transform="scale(1,-1)">${parts.join('')}</g></svg>`;
}
