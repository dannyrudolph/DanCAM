import type { Drawing } from '../model/drawing';
import { addLayer, deleteLayer, editLayer, layerUsage, renameLayer, sortedLayers } from '../model/layers';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import type { Transaction } from '../model/undo';
import { ICONS } from './icons';

export type LayersHost = {
  /** Applies a layer edit through the undo stack. `renamed` is set for a rename. */
  commit(tx: Transaction, renamed?: { from: string; to: string }): void;
  setCurrent(name: string): void;
  message(text: string): void;
};

/**
 * The layers list: current layer, visibility, color, line style, name and
 * object count per layer, with New and Delete. Every edit except choosing the
 * current layer is undoable.
 */
export class LayersPanel {
  private drawing: Drawing | undefined;
  /** Layer whose name is being edited, if any. */
  private renaming: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: LayersHost,
  ) {}

  show(d: Drawing): void {
    this.drawing = d;
    // Don't rebuild under the user's hands: a rename being typed, an open color picker or style list.
    const focused = document.activeElement;
    const editing = focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement;
    if (editing && this.root.contains(focused)) return;
    this.render();
  }

  private render(): void {
    const d = this.drawing;
    if (!d) return;
    const header = document.createElement('div');
    header.className = 'layers-header';
    const title = document.createElement('h2');
    title.textContent = 'Layers';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'layer-icon-button';
    add.innerHTML = ICONS.plus;
    add.title = 'New layer';
    add.tabIndex = -1;
    add.dataset.testid = 'new-layer';
    add.addEventListener('click', () => {
      const { tx, name } = addLayer(d);
      this.host.commit(tx);
      this.renaming = name; // type a name straight away
      this.render();
    });
    header.append(title, add);

    const usage = layerUsage(d);
    const list = document.createElement('ul');
    list.className = 'layer-list';
    for (const layer of sortedLayers(d)) {
      const li = document.createElement('li');
      li.className = 'layer-row';
      li.dataset.layer = layer.name;
      li.classList.toggle('current', layer.name === d.currentLayer);
      li.classList.toggle('hidden-layer', !layer.visible);

      const current = document.createElement('input');
      current.type = 'radio';
      current.name = 'current-layer';
      current.checked = layer.name === d.currentLayer;
      current.title = 'Current layer: new objects go here';
      current.tabIndex = -1;
      current.dataset.role = 'current';
      current.addEventListener('change', () => {
        current.blur();
        this.host.setCurrent(layer.name);
      });

      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'layer-icon-button';
      eye.innerHTML = layer.visible ? ICONS.eye : ICONS.eyeOff;
      eye.title = layer.visible ? 'Hide this layer' : 'Show this layer';
      eye.tabIndex = -1;
      eye.dataset.role = 'visible';
      eye.setAttribute('aria-pressed', String(layer.visible));
      eye.addEventListener('click', () => this.edit(layer.name, { visible: !layer.visible }));

      const color = document.createElement('input');
      color.type = 'color';
      color.value = layer.color;
      color.title = 'Layer color';
      color.tabIndex = -1;
      color.dataset.role = 'color';
      color.addEventListener('change', () => {
        color.blur();
        this.edit(layer.name, { color: color.value });
      });

      const name = this.nameCell(d, layer.name);

      const style = document.createElement('select');
      style.title = 'Line style for objects on this layer that use "by layer"';
      style.tabIndex = -1;
      style.dataset.role = 'style';
      for (const s of LINE_STYLE_NAMES) {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = LINE_STYLES[s].label;
        style.append(o);
      }
      style.value = layer.style;
      style.addEventListener('change', () => {
        style.blur();
        this.edit(layer.name, { style: style.value as LineStyleName });
      });

      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = String(usage.get(layer.name) ?? 0);
      count.title = 'Objects on this layer';

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'layer-icon-button';
      del.innerHTML = ICONS.trash;
      del.title = 'Delete layer (only an empty one)';
      del.tabIndex = -1;
      del.dataset.role = 'delete';
      del.addEventListener('click', () => {
        const r = deleteLayer(d, layer.name);
        if (r.ok) this.host.commit(r.tx);
        else this.host.message(r.error);
      });

      li.append(current, eye, color, name, style, count, del);
      list.append(li);
    }
    this.root.replaceChildren(header, list);
    this.root.querySelector<HTMLInputElement>('input.layer-name-input')?.select();
  }

  /** The name, or a text box while renaming. Double-click a name to rename it. */
  private nameCell(d: Drawing, layerName: string): HTMLElement {
    if (this.renaming !== layerName) {
      const span = document.createElement('span');
      span.className = 'layer-name';
      span.textContent = layerName;
      span.title = layerName === '0' ? 'Layer 0 cannot be renamed' : 'Double-click to rename';
      span.dataset.role = 'name';
      span.addEventListener('dblclick', () => {
        if (layerName === '0') return;
        this.renaming = layerName;
        this.render();
      });
      return span;
    }
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = layerName;
    input.spellcheck = false;
    input.dataset.role = 'name-input';
    let done = false;
    const finish = (apply: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = undefined;
      const to = input.value;
      input.blur();
      if (apply && to.trim() !== layerName) {
        const r = renameLayer(d, layerName, to);
        if (r.ok) this.host.commit(r.tx, { from: layerName, to: to.trim() });
        else this.host.message(r.error);
      }
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(e.key === 'Enter');
      }
    });
    input.addEventListener('blur', () => finish(true));
    queueMicrotask(() => input.focus());
    return input;
  }

  private edit(name: string, patch: Parameters<typeof editLayer>[2]): void {
    const d = this.drawing;
    if (!d) return;
    const tx = editLayer(d, name, patch);
    if (tx) this.host.commit(tx);
  }
}
