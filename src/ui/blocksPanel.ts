import { arcEnd, arcStart, arcSweepDeg } from '../geometry/arc';
import { union } from '../geometry/bbox';
import { type BlockDef, insertsOf } from '../model/block';
import type { Drawing } from '../model/drawing';
import { entityBBox } from '../model/entity';

export type BlocksHost = {
  /** Starts Insert with the block named `name`. */
  insert(name: string): void;
};

/**
 * The Blocks panel (spec, "Blocks"): the drawing's blocks by name, each
 * with a small preview, how many instances there are, and its description.
 * Clicking one starts Insert with it.
 */
export class BlocksPanel {
  constructor(
    private readonly root: HTMLElement,
    private readonly host: BlocksHost,
  ) {}

  show(d: Drawing): void {
    const title = document.createElement('h2');
    title.textContent = 'Blocks';
    const header = document.createElement('div');
    header.className = 'layers-header';
    header.append(title);
    if (d.blocks.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'blocks-empty';
      empty.textContent = 'None yet. Select geometry and choose Create block (K).';
      this.root.replaceChildren(header, empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'layer-list';
    const byName = [...d.blocks.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    for (const def of byName) {
      const li = document.createElement('li');
      li.className = 'block-row';
      li.dataset.block = def.name;
      li.title = `Insert ${def.name}${def.description === '' ? '' : `: ${def.description}`}`;
      li.addEventListener('click', () => this.host.insert(def.name));
      const preview = document.createElement('span');
      preview.className = 'block-preview';
      preview.innerHTML = blockPreviewSvg(def);
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = def.name;
      const count = document.createElement('span');
      count.className = 'layer-count';
      count.textContent = String(insertsOf(d, def.name).length);
      count.title = 'Instances in the drawing';
      const description = document.createElement('span');
      description.className = 'block-description';
      description.textContent = def.description;
      li.append(preview, name, count, description);
      list.append(li);
    }
    this.root.replaceChildren(header, list);
  }
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
