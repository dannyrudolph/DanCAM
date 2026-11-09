import { parseLength } from '../commands/valueExpr';
import { INCH_ZEROS, MM_ZEROS, type Tolerance, toleranceOfKind } from '../model/dimFormat';
import type { DimStyle } from '../model/dimStyle';
import { type StylePatch, addDimStyle, deleteDimStyle, dimStyleUsage, editDimStyle, renameDimStyle, sortedDimStyles } from '../model/dimStyles';
import type { Drawing } from '../model/drawing';
import { TOLERANCE_LABEL } from '../model/properties';
import type { Transaction } from '../model/undo';
import { ICONS } from './icons';

export type DimStylesHost = {
  /** Applies an edit through the undo stack. `renamed` is set for a rename. */
  commit(tx: Transaction, renamed?: { from: string; to: string }): void;
  setCurrent(name: string): void;
  message(text: string): void;
};

type Patch = StylePatch;

const SIZES: readonly [keyof DimStyle, string, string][] = [
  ['textHeight', 'Text height', 'Cap height of the text, as printed'],
  ['arrowSize', 'Arrow size', 'Arrowhead length, as printed'],
  ['extOffset', 'Ext. offset', 'Gap between the object and an extension line'],
  ['extExtend', 'Ext. extension', 'How far an extension line runs past the dimension line'],
  ['textGap', 'Text gap', 'Clearance around the text where it breaks the line'],
];

const PLACES = Array.from({ length: 9 }, (_, n) => [String(n), String(n)]);

/**
 * The Dimension Styles panel: the list (current style, name, how many
 * dimensions use it, delete), New (a copy of the style being edited), and
 * the settings of the style being edited. Sizes are sheet sizes, typed with
 * the value parser and shown exactly as stored. Every change but choosing
 * the current style is one undo step; dimensions using the style follow it.
 */
export class DimStylesPanel {
  private drawing: Drawing | undefined;
  /** The style whose settings are shown; the current one unless another was clicked. */
  private editing: string | undefined;
  private renaming: string | undefined;
  private settingsOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: DimStylesHost,
  ) {}

  show(d: Drawing): void {
    this.drawing = d;
    const focused = document.activeElement;
    const typing = focused instanceof HTMLInputElement || focused instanceof HTMLSelectElement;
    if (typing && this.root.contains(focused)) return; // don't rebuild under the user's hands
    this.render();
  }

  private render(): void {
    const d = this.drawing;
    if (!d) return;
    if (!this.editing || !d.dimStyles.has(this.editing)) this.editing = d.currentDimStyle;
    const editing = this.editing;

    const header = document.createElement('div');
    header.className = 'layers-header';
    const title = document.createElement('h2');
    title.textContent = 'Dimension styles';
    const add = iconButton(ICONS.plus, 'New style: a copy of the one being edited', 'new-dim-style');
    add.addEventListener('click', () => {
      const { tx, name } = addDimStyle(d, editing);
      this.host.commit(tx);
      this.editing = name;
      this.renaming = name; // type a name straight away
      this.render();
    });
    header.append(title, add);

    const usage = dimStyleUsage(d);
    const list = document.createElement('ul');
    list.className = 'layer-list';
    for (const style of sortedDimStyles(d)) {
      const li = document.createElement('li');
      li.className = 'dimstyle-row';
      li.dataset.dimStyle = style.name;
      li.classList.toggle('current', style.name === d.currentDimStyle);
      li.classList.toggle('editing', style.name === editing);
      li.addEventListener('click', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || this.editing === style.name) return;
        this.editing = style.name;
        this.render();
      });

      const current = document.createElement('input');
      current.type = 'radio';
      current.name = 'current-dim-style';
      current.checked = style.name === d.currentDimStyle;
      current.title = 'Current style: new dimensions use it';
      current.tabIndex = -1;
      current.dataset.role = 'current';
      current.addEventListener('change', () => {
        current.blur();
        this.editing = style.name;
        this.host.setCurrent(style.name);
      });

      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = String(usage.get(style.name) ?? 0);
      count.title = 'Dimensions using this style';

      const del = iconButton(ICONS.trash, 'Delete style (only one no dimension uses)');
      del.dataset.role = 'delete';
      del.addEventListener('click', () => {
        const r = deleteDimStyle(d, style.name);
        if (r.ok) this.host.commit(r.tx);
        else this.host.message(r.error);
      });

      li.append(current, this.nameCell(d, style.name), count, del);
      list.append(li);
    }

    const details = document.createElement('details');
    details.className = 'dimstyle-settings';
    details.open = this.settingsOpen;
    const summary = document.createElement('summary');
    // Recorded on the click itself: the async toggle event can land after a rebuild.
    summary.addEventListener('click', () => (this.settingsOpen = !details.open));
    summary.textContent = `Settings: ${editing}`;
    summary.dataset.testid = 'dim-style-settings';
    const style = d.dimStyles.get(editing);
    details.append(summary);
    if (style) details.append(this.settings(d, style));

    this.root.replaceChildren(header, list, details);
    this.root.querySelector<HTMLInputElement>('input.layer-name-input')?.select();
  }

  /** The settings of `s`, one row each. */
  private settings(d: Drawing, s: DimStyle): HTMLElement {
    const dl = document.createElement('dl');
    const row = (label: string, control: HTMLElement, title?: string): void => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      if (title) dt.title = title;
      const dd = document.createElement('dd');
      dd.append(control);
      dl.append(dt, dd);
    };
    const edit = (patch: Patch): void => this.edit(s.name, patch);
    const length = (key: string, value: number, set: (v: number) => Patch): HTMLInputElement =>
      this.textInput(key, String(value), (text) => {
        const r = parseLength(text, d.units);
        if (r.ok) edit(set(r.value));
        else this.refused(r.error);
      });

    for (const [key, label, title] of SIZES) row(label, length(key, s[key] as number, (v) => ({ [key]: v })), title);
    row('Precision', this.selectInput('precision', PLACES, String(s.precision), (v) => edit({ precision: Number(v) })));
    row('Leading zero', this.checkbox('zeros.leading', s.zeros.leading, (on) => edit({ zeros: { ...s.zeros, leading: on } })), 'Show 0.500 rather than .500');
    row('Trailing zeros', this.checkbox('zeros.trailing', s.zeros.trailing, (on) => edit({ zeros: { ...s.zeros, trailing: on } })), 'Show .500 rather than .5');

    const kinds = (Object.keys(TOLERANCE_LABEL) as Tolerance['kind'][]).map((k) => [k, TOLERANCE_LABEL[k]]);
    row('Tolerance', this.selectInput('tolerance', kinds, s.tolerance.kind, (v) => edit({ tolerance: toleranceOfKind(s.tolerance, v as Tolerance['kind']) })));
    const t = s.tolerance;
    if (t.kind === 'symmetric') row('Tol ±', length('tolerance.value', t.value, (v) => ({ tolerance: { ...t, value: v } })));
    if (t.kind === 'deviation' || t.kind === 'limits') {
      row('Tol upper', length('tolerance.upper', t.upper, (v) => ({ tolerance: { ...t, upper: v } })));
      row('Tol lower', length('tolerance.lower', t.lower, (v) => ({ tolerance: { ...t, lower: v } })));
    }
    if (t.kind !== 'none') row('Tol precision', this.selectInput('tolPrecision', PLACES, String(s.tolPrecision), (v) => edit({ tolPrecision: Number(v) })));

    const angles = [
      ['decimal', 'Decimal °'],
      ['dms', "D°M'S\""],
    ];
    row('Angles', this.selectInput('angleFormat', angles, s.angleFormat, (v) => edit({ angleFormat: v as DimStyle['angleFormat'] })));
    row('Angle precision', this.selectInput('anglePrecision', PLACES, String(s.anglePrecision), (v) => edit({ anglePrecision: Number(v) })));

    const sym = [
      ['half', 'Half'],
      ['full', 'Full'],
    ];
    row('Symmetric Ø', this.selectInput('symmetric', sym, s.symmetric ?? 'half', (v) => edit({ symmetric: v === 'full' ? 'full' : undefined })));

    const alt = d.units === 'in' ? 'mm' : 'inch';
    const dualDefault = d.units === 'in' ? { precision: 2, zeros: MM_ZEROS } : { precision: 3, zeros: INCH_ZEROS };
    row(`Dual units (${alt})`, this.checkbox('dual', s.dual !== undefined, (on) => edit({ dual: on ? dualDefault : undefined })));
    if (s.dual) {
      const dual = s.dual;
      row('Dual precision', this.selectInput('dual.precision', PLACES, String(dual.precision), (v) => edit({ dual: { ...dual, precision: Number(v) } })));
    }
    row('Prefix', this.textInput('prefix', s.prefix ?? '', (text) => edit({ prefix: text === '' ? undefined : text }), true));
    row('Suffix', this.textInput('suffix', s.suffix ?? '', (text) => edit({ suffix: text === '' ? undefined : text }), true));
    return dl;
  }

  private edit(name: string, patch: Patch): void {
    const d = this.drawing;
    if (!d) return;
    const r = editDimStyle(d, name, patch);
    if (r.ok) this.host.commit(r.tx);
    else this.refused(r.error);
  }

  /** Shows why an edit was refused (nothing, when it changed nothing) and puts the settings back. */
  private refused(error: string): void {
    if (error) this.host.message(error);
    this.render();
  }

  /**
   * A text box that applies on Enter or leaving it, only when the text
   * changed; Esc puts it back. Spaces are trimmed unless `keepSpaces`
   * (a prefix or suffix such as " TYP").
   */
  private textInput(key: string, value: string, apply: (text: string) => void, keepSpaces = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.spellcheck = false;
    input.dataset.setting = key;
    let cancelled = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        cancelled = e.key === 'Escape';
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      const text = keepSpaces ? input.value : input.value.trim();
      if (cancelled || text === value) {
        cancelled = false;
        input.value = value; // no rebuild: focus may be moving to the next box
        return;
      }
      apply(text);
    });
    return input;
  }

  private selectInput(key: string, options: string[][], value: string, apply: (v: string) => void): HTMLSelectElement {
    const s = document.createElement('select');
    s.dataset.setting = key;
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v!;
      o.textContent = text!;
      s.append(o);
    }
    s.value = value;
    s.addEventListener('change', () => {
      s.blur();
      apply(s.value);
    });
    return s;
  }

  private checkbox(key: string, on: boolean, apply: (on: boolean) => void): HTMLInputElement {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = on;
    c.dataset.setting = key;
    c.addEventListener('change', () => {
      c.blur();
      apply(c.checked);
    });
    return c;
  }

  /** The name, or a text box while renaming. Double-click a name to rename it. */
  private nameCell(d: Drawing, styleName: string): HTMLElement {
    if (this.renaming !== styleName) {
      const span = document.createElement('span');
      span.className = 'layer-name';
      span.textContent = styleName;
      span.title = 'Click to see its settings; double-click to rename';
      span.dataset.role = 'name';
      span.addEventListener('dblclick', () => {
        this.renaming = styleName;
        this.render();
      });
      return span;
    }
    const input = document.createElement('input');
    input.className = 'layer-name-input';
    input.value = styleName;
    input.spellcheck = false;
    input.dataset.role = 'name-input';
    let done = false;
    const finish = (apply: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = undefined;
      const to = input.value.trim();
      input.blur();
      if (apply && to !== styleName) {
        const r = renameDimStyle(d, styleName, to);
        if (r.ok) {
          if (this.editing === styleName) this.editing = to;
          this.host.commit(r.tx, { from: styleName, to });
        } else {
          this.host.message(r.error);
        }
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
}

function iconButton(icon: string, title: string, testId?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'layer-icon-button';
  b.innerHTML = icon;
  b.title = title;
  b.tabIndex = -1;
  if (testId) b.dataset.testid = testId;
  return b;
}
