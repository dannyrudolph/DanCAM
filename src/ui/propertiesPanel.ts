import { parseAngle, parseLength } from '../commands/valueExpr';
import type { Drawing, Units } from '../model/drawing';
import { editableText, toleranceSetter, withDimStyle, withPrecision, withText, withToleranceKind, type ToleranceKind } from '../model/dimOverride';
import { dimStyleOf } from '../model/dimStyle';
import type { DimensionEntity, Entity } from '../model/entity';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import { axisView, viewLabel } from '../model/latheView';
import { KIND_LABEL, type Row, TOLERANCE_LABEL, rowsFor } from '../model/properties';
import { type PropertySetter, propertySetter, withLayer, withStyle } from '../model/propertyEdit';
import type { Transaction } from '../model/undo';
import { formatNumber } from './statusBar';

/** "Line ×2", "Circle ×1": counts by kind for a multiple selection, in KIND_LABEL order. */
export function selectionSummary(entities: readonly Entity[]): Row[] {
  const rows: Row[] = [];
  for (const kind of Object.keys(KIND_LABEL) as Entity['kind'][]) {
    const n = entities.filter((e) => e.kind === kind).length;
    if (n > 0) rows.push({ label: KIND_LABEL[kind], value: String(n) });
  }
  return rows;
}

/** What the panel needs from the app to apply an edit. */
export type PropertiesHost = {
  units(): Units;
  /** Commits one undo step. */
  commit(tx: Transaction): void;
  message(text: string): void;
};

/**
 * Exact values of the selection. One object: every value, and clicking an
 * editable one opens it for typing (the value parser applies: fractions,
 * arithmetic, unit suffixes); Enter or leaving the field applies it, Esc
 * cancels. Layer and Style are dropdowns, for one object or many. Hovering
 * a value shows it at full stored precision. Each edit is one undo step.
 * A dimension also has its style, precision and tolerance as dropdowns
 * ("By style" removes this dimension's override) and its text to edit.
 */
export class PropertiesPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly host: PropertiesHost,
  ) {}

  show(d: Drawing, selected: readonly Entity[], precision: number): void {
    // Don't pull the field out from under someone typing in it.
    if (this.root.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    const title = document.createElement('h2');
    const table = document.createElement('dl');
    if (selected.length === 0) {
      title.textContent = 'Drawing';
      this.addRow(table, 'Units', d.units === 'in' ? 'inch' : 'mm');
      this.addRow(table, 'Entities', String(d.entities.size), 'entity-count');
      this.root.replaceChildren(title, table);
      return;
    }
    if (selected.length > 1) {
      title.textContent = `${selected.length} objects`;
      this.addRow(table, 'Selected', String(selected.length), 'selection-count');
      for (const r of selectionSummary(selected)) this.addRow(table, r.label, String(r.value));
      this.addLayerAndStyle(d, table, selected);
      this.root.replaceChildren(title, table);
      return;
    }
    const e = selected[0]!;
    title.textContent = `${KIND_LABEL[e.kind]} ${e.id}`;
    this.addLayerAndStyle(d, table, selected);
    for (const r of rowsFor(d, e)) {
      if (r.label === 'Layer' || r.label === 'Style') continue; // dropdowns, done above
      if (e.kind === 'dimension' && this.addDimensionRow(d, table, e, r)) continue;
      if (typeof r.value === 'string') {
        this.addRow(table, r.label, r.value);
        continue;
      }
      // Lathe mode names coordinates Z and X, and shows a vertical one as a diameter when that is on.
      const shown = viewLabel(r.label, axisView(d));
      const value = r.value * shown.factor;
      const text = formatNumber(value, precision) + (r.unit ?? '');
      const dd = this.addRow(table, shown.label, text);
      dd.title = String(value);
      const setter = propertySetter(e, r.label) ?? (e.kind === 'dimension' ? toleranceSetter(d, e, r.label) : undefined);
      if (setter) this.makeEditable(dd, e, shown.label, shown.factor === 1 ? setter : { ...setter, set: (v) => setter.set(v / shown.factor) });
    }
    this.root.replaceChildren(title, table);
  }

  /** Click to type a new value; Enter or blur applies, Esc cancels. */
  private makeEditable(dd: HTMLElement, e: Entity, label: string, setter: PropertySetter): void {
    dd.classList.add('editable');
    dd.addEventListener('click', () => {
      if (dd.querySelector('input')) return;
      const shown = dd.textContent ?? '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = shown.replace(/°$/, '');
      input.dataset.edit = label;
      input.spellcheck = false;
      let done = false;
      const finish = (apply: boolean): void => {
        if (done) return;
        done = true;
        const text = input.value.trim();
        dd.textContent = shown;
        if (!apply || text === shown.replace(/°$/, '')) return; // unchanged: never re-store a rounded value
        const r = setter.quantity === 'angle' ? parseAngle(text) : parseLength(text, this.host.units());
        if (!r.ok) {
          this.host.message(`${label}: ${r.error}`);
          return;
        }
        const after = setter.set(r.value);
        if (!after) {
          this.host.message(`${label} can't be ${text}: ${setter.refusal ?? 'the object would have no size'}.`);
          return;
        }
        this.host.commit({ label: `Edit ${label}`, changes: [{ op: 'modify', before: e, after }] });
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      dd.replaceChildren(input);
      input.focus();
      input.select();
    });
  }

  /** The rows a dimension edits its own way; false for an ordinary row. */
  private addDimensionRow(d: Drawing, table: HTMLElement, e: DimensionEntity, r: Row): boolean {
    const commit = (label: string, after: DimensionEntity): void => this.host.commit({ label, changes: [{ op: 'modify', before: e, after }] });
    const style = dimStyleOf(d, e.dimStyle);
    let control: HTMLElement;
    switch (r.label) {
      case 'Dim style':
        control = this.select(
          [...d.dimStyles.keys()].map((n) => [n, n]),
          e.dimStyle,
          (v) => commit('Change dimension style', withDimStyle(e, v)),
        );
        break;
      case 'Precision': {
        const own = e.type === 'angular' ? style.anglePrecision : style.precision;
        control = this.select(
          [['', `By style (${own})`], ...Array.from({ length: 9 }, (_, n) => [String(n), String(n)])],
          e.precision === undefined ? '' : String(e.precision),
          (v) => commit('Change precision', withPrecision(e, v === '' ? undefined : Number(v))),
        );
        break;
      }
      case 'Tolerance':
        control = this.select(
          [['', `By style (${TOLERANCE_LABEL[style.tolerance.kind]})`], ...(Object.keys(TOLERANCE_LABEL) as ToleranceKind[]).map((k) => [k, TOLERANCE_LABEL[k]])],
          e.tolerance?.kind ?? '',
          (v) => commit('Change tolerance', withToleranceKind(d, e, v === '' ? undefined : (v as ToleranceKind))),
        );
        break;
      case 'Text': {
        const dd = this.addRow(table, r.label, String(r.value));
        dd.title = e.type === 'leader' ? 'Click to edit the note' : 'Click to replace the text; <> stands for the measured value, empty goes back to it';
        this.makeTextEditable(dd, e, (typed) => {
          const after = withText(e, typed);
          if (after) commit(e.type === 'leader' ? 'Edit note' : 'Edit dimension text', after);
          else this.host.message('A note needs some text.');
        });
        return true;
      }
      default:
        return false;
    }
    this.addRow(table, r.label, '').replaceChildren(control);
    return true;
  }

  /** Click to type over the text; Enter or blur applies, Esc cancels. Unchanged text changes nothing. */
  private makeTextEditable(dd: HTMLElement, e: DimensionEntity, apply: (typed: string) => void): void {
    dd.classList.add('editable');
    dd.addEventListener('click', () => {
      if (dd.querySelector('input')) return;
      const shown = dd.textContent ?? '';
      const start = editableText(e);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = start;
      input.dataset.edit = 'Text';
      input.spellcheck = false;
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        dd.textContent = shown;
        if (ok && input.value !== start) apply(input.value);
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          finish(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      dd.replaceChildren(input);
      input.focus();
      input.select();
    });
  }

  /** Layer and Style dropdowns for the selection; "(varies)" when the objects differ. */
  private addLayerAndStyle(d: Drawing, table: HTMLElement, selected: readonly Entity[]): void {
    const commitAll = (label: string, change: (e: Entity) => Entity): void => {
      const changes = selected.map((e) => ({ op: 'modify' as const, before: e, after: change(e) }));
      this.host.commit({ label, changes });
    };

    const layers = new Set(selected.map((e) => e.layer));
    const layer = this.select(
      [...(layers.size > 1 ? [['', '(varies)']] : []), ...[...d.layers.keys()].map((n) => [n, n])],
      layers.size > 1 ? '' : selected[0]!.layer,
      (v) => v !== '' && commitAll('Change layer', (e) => withLayer(e, v)),
    );
    this.addRow(table, 'Layer', '', 'Layer').replaceChildren(layer);
    if (selected.every((e) => e.kind === 'dimension')) return; // dimensions always draw thin: no line style

    const styleKey = (e: Entity): string => e.style ?? '';
    const styles = new Set(selected.map(styleKey));
    const style = this.select(
      [
        ...(styles.size > 1 ? [['*', '(varies)']] : []),
        ['', 'By layer'],
        ...LINE_STYLE_NAMES.map((n) => [n, LINE_STYLES[n].label]),
      ],
      styles.size > 1 ? '*' : styleKey(selected[0]!),
      (v) => v !== '*' && commitAll('Change style', (e) => withStyle(e, v === '' ? undefined : (v as LineStyleName))),
    );
    this.addRow(table, 'Style', '', 'Style').replaceChildren(style);
  }

  private select(options: string[][], value: string, onChange: (v: string) => unknown): HTMLSelectElement {
    const s = document.createElement('select');
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v!;
      o.textContent = text!;
      s.append(o);
    }
    s.value = value;
    s.addEventListener('change', () => {
      s.blur();
      onChange(s.value);
    });
    return s;
  }

  private addRow(table: HTMLElement, label: string, value: string, testId?: string): HTMLElement {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.dataset.prop = testId ?? label;
    table.append(dt, dd);
    return dd;
  }
}
