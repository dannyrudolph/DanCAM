import type { Report } from '../commands/tool';
import { formatNumber } from './statusBar';

/** How many results the panel keeps, newest first. */
const KEEP = 10;

/**
 * Results of Dist, ID, List and Angle, newest first. Values are shown at the
 * display precision; hovering one shows it at full stored precision.
 */
export class InquiryPanel {
  private results: Report[] = [];

  constructor(private readonly root: HTMLElement) {}

  add(r: Report, precision: number): void {
    this.results = [r, ...this.results].slice(0, KEEP);
    this.show(precision);
  }

  show(precision: number): void {
    this.root.hidden = this.results.length === 0;
    if (this.results.length === 0) {
      this.root.replaceChildren();
      return;
    }
    const header = document.createElement('div');
    header.className = 'inquiry-header';
    const h = document.createElement('h2');
    h.textContent = 'Results';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'inquiry-clear';
    clear.textContent = 'Clear';
    clear.tabIndex = -1;
    clear.addEventListener('click', () => {
      this.results = [];
      this.show(precision);
    });
    header.append(h, clear);
    const items = this.results.map((r) => {
      const block = document.createElement('div');
      block.className = 'inquiry-result';
      const title = document.createElement('h3');
      title.textContent = r.title;
      const dl = document.createElement('dl');
      for (const row of r.rows) {
        const dt = document.createElement('dt');
        dt.textContent = row.label;
        const dd = document.createElement('dd');
        dd.dataset.prop = row.label;
        if (typeof row.value === 'number') {
          dd.textContent = formatNumber(row.value, precision) + (row.unit ?? '');
          dd.title = String(row.value);
        } else {
          dd.textContent = row.value;
        }
        dl.append(dt, dd);
      }
      block.append(title, dl);
      return block;
    });
    this.root.replaceChildren(header, ...items);
  }
}
