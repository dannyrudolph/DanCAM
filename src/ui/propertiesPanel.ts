import { angleDeg } from '../geometry/angle';
import { arcEnd, arcLength, arcSweepDeg, arcStart } from '../geometry/arc';
import { parseAngle, parseLength } from '../commands/valueExpr';
import { type Drawing, type Units, effectiveStyle } from '../model/drawing';
import type { Entity } from '../model/entity';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import { type PropertySetter, propertySetter, withLayer, withStyle } from '../model/propertyEdit';
import type { Transaction } from '../model/undo';
import { formatNumber } from './statusBar';

export type Row = { label: string; value: number | string; unit?: string };

/** The rows the properties panel shows for `e`, with values unrounded. */
export function rowsFor(d: Drawing, e: Entity): Row[] {
  const style = effectiveStyle(d, e);
  const common: Row[] = [
    { label: 'Layer', value: e.layer },
    { label: 'Style', value: e.style ? style.label : `${style.label} (by layer)` },
  ];
  switch (e.kind) {
    case 'point':
      return [...common, { label: 'X', value: e.at.x }, { label: 'Y', value: e.at.y }];
    case 'line': {
      const dx = e.end.x - e.start.x;
      const dy = e.end.y - e.start.y;
      return [
        ...common,
        { label: 'Start X', value: e.start.x },
        { label: 'Start Y', value: e.start.y },
        { label: 'End X', value: e.end.x },
        { label: 'End Y', value: e.end.y },
        { label: 'ΔX', value: dx },
        { label: 'ΔY', value: dy },
        { label: 'Length', value: Math.hypot(dx, dy) },
        { label: 'Angle', value: angleDeg({ x: dx, y: dy }), unit: '°' },
      ];
    }
    case 'circle':
      return [
        ...common,
        { label: 'Center X', value: e.center.x },
        { label: 'Center Y', value: e.center.y },
        { label: 'Radius', value: e.radius },
        { label: 'Diameter', value: 2 * e.radius },
        { label: 'Circumference', value: 2 * Math.PI * e.radius },
      ];
    case 'arc': {
      const s = arcStart(e);
      const t = arcEnd(e);
      return [
        ...common,
        { label: 'Center X', value: e.center.x },
        { label: 'Center Y', value: e.center.y },
        { label: 'Radius', value: e.radius },
        { label: 'Start angle', value: e.startDeg, unit: '°' },
        { label: 'End angle', value: e.endDeg, unit: '°' },
        { label: 'Included angle', value: arcSweepDeg(e), unit: '°' },
        { label: 'Arc length', value: arcLength(e) },
        { label: 'Start X', value: s.x },
        { label: 'Start Y', value: s.y },
        { label: 'End X', value: t.x },
        { label: 'End Y', value: t.y },
      ];
    }
    case 'xline':
    case 'ray':
      return [
        ...common,
        { label: 'Base X', value: e.base.x },
        { label: 'Base Y', value: e.base.y },
        { label: 'Angle', value: angleDeg(e.dir), unit: '°' },
      ];
  }
}

const KIND_LABEL: Record<Entity['kind'], string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  xline: 'Xline',
  ray: 'Ray',
};

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
      if (typeof r.value === 'string') continue; // Layer and Style, done above
      const text = formatNumber(r.value, precision) + (r.unit ?? '');
      const dd = this.addRow(table, r.label, text);
      dd.title = String(r.value);
      const setter = propertySetter(e, r.label);
      if (setter) this.makeEditable(dd, e, r.label, setter);
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
          this.host.message(`${label} can't be ${text}: the object would have no size.`);
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
