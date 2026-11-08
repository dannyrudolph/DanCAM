import { angleDeg } from '../geometry/angle';
import { type Drawing, effectiveStyle } from '../model/drawing';
import type { Entity } from '../model/entity';
import { formatNumber } from './statusBar';

type Row = { label: string; value: number | string; unit?: string };

function rowsFor(d: Drawing, e: Entity): Row[] {
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
  }
}

const KIND_LABEL: Record<Entity['kind'], string> = { point: 'Point', line: 'Line' };

/**
 * Read-only exact values of the selected entity (editing arrives in Phase 2).
 * Hovering a value shows it at full stored precision.
 */
export class PropertiesPanel {
  constructor(private readonly root: HTMLElement) {}

  show(d: Drawing, e: Entity | undefined, precision: number): void {
    const title = document.createElement('h2');
    const table = document.createElement('dl');
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
