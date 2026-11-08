import { angleDeg } from '../geometry/angle';
import { arcEnd, arcLength, arcSweepDeg, arcStart } from '../geometry/arc';
import { type Drawing, effectiveStyle } from '../model/drawing';
import type { Entity } from '../model/entity';
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

/**
 * Read-only exact values of the selected entity (editing arrives in Phase 2
 * step 4). With several selected, a count by kind. Hovering a value shows it
 * at full stored precision.
 */
export class PropertiesPanel {
  constructor(private readonly root: HTMLElement) {}

  show(d: Drawing, selected: readonly Entity[], precision: number): void {
    const title = document.createElement('h2');
    const table = document.createElement('dl');
    if (selected.length > 1) {
      title.textContent = `${selected.length} objects`;
      this.addRow(table, 'Selected', String(selected.length), 'selection-count');
      for (const r of selectionSummary(selected)) this.addRow(table, r.label, String(r.value));
      this.root.replaceChildren(title, table);
      return;
    }
    const e = selected[0];
    if (!e) {
      title.textContent = 'Drawing';
      this.addRow(table, 'Units', d.units === 'in' ? 'inch' : 'mm');
      this.addRow(table, 'Entities', String(d.entities.size), 'entity-count');
      this.root.replaceChildren(title, table);
      return;
    }
    title.textContent = `${KIND_LABEL[e.kind]} ${e.id}`;
    for (const r of rowsFor(d, e)) {
      if (typeof r.value === 'string') {
        this.addRow(table, r.label, r.value);
      } else {
        const dd = this.addRow(table, r.label, formatNumber(r.value, precision) + (r.unit ?? ''));
        dd.title = String(r.value);
      }
    }
    this.root.replaceChildren(title, table);
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
