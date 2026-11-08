import { angleDeg } from '../geometry/angle';
import type { Vec2 } from '../geometry/vec';
import type { Units } from '../model/drawing';
import type { ScrollMode } from './input';

export const DEFAULT_PRECISION = 4;
export const MAX_PRECISION = 8;
export const POLAR_INCREMENTS = [5, 10, 15, 30, 45, 90] as const;

/** How long a message replaces the prompt, ms. */
const MESSAGE_MS = 4000;

/** Formats a number for display only; never feed the result back into geometry (CAD-5). */
export function formatNumber(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  // "-0.0000" reads as a sign error; show it as zero.
  return Number(s) === 0 ? (0).toFixed(decimals) : s;
}

export function formatReadout(p: Vec2, decimals: number = DEFAULT_PRECISION): string {
  return `${formatNumber(p.x, decimals)}, ${formatNumber(p.y, decimals)}`;
}

/** "L 1.2500  ∠ 30.0000°" from base to p. */
export function formatFromBase(base: Vec2, p: Vec2, decimals: number): string {
  const d = { x: p.x - base.x, y: p.y - base.y };
  return `L ${formatNumber(Math.hypot(d.x, d.y), decimals)}  ∠ ${formatNumber(angleDeg(d), decimals)}°`;
}

export type StatusSettings = {
  scrollMode: ScrollMode;
  ortho: boolean;
  polar: boolean;
  polarIncrementDeg: number;
  precision: number;
};

/** Bottom bar: tool instruction or message, cursor readout, Ortho/Polar toggles, precision. */
export class StatusBar {
  private readonly prompt: HTMLElement;
  private readonly coords: HTMLElement;
  private readonly fromBase: HTMLElement;
  private readonly ortho: HTMLButtonElement;
  private readonly polar: HTMLButtonElement;
  private readonly increment: HTMLSelectElement;
  private readonly precision: HTMLSelectElement;
  private messageUntil = 0;

  constructor(
    root: HTMLElement,
    private readonly settings: StatusSettings,
    private readonly onSettingsChanged: () => void,
  ) {
    const span = (cls: string): HTMLElement => {
      const s = document.createElement('span');
      s.className = cls;
      return s;
    };
    this.prompt = span('status-prompt');
    this.coords = span('status-coords');
    this.fromBase = span('status-from-base');

    this.ortho = this.toggle('Ortho', 'Ortho (F8): horizontal and vertical only', () => {
      settings.ortho = !settings.ortho;
    });
    this.polar = this.toggle('Polar', 'Polar tracking (F10)', () => {
      settings.polar = !settings.polar;
    });
    this.increment = this.select(
      POLAR_INCREMENTS.map((d) => [String(d), `${d}°`]),
      String(settings.polarIncrementDeg),
      'Polar tracking increment',
      (v) => (settings.polarIncrementDeg = Number(v)),
    );
    this.precision = this.select(
      Array.from({ length: MAX_PRECISION + 1 }, (_, i) => [String(i), `${i} dp`]),
      String(settings.precision),
      'Display precision (decimal places)',
      (v) => (settings.precision = Number(v)),
    );
    this.precision.dataset.testid = 'precision';
    const scroll = this.select(
      [
        ['pan', 'Scroll: Pan'],
        ['zoom', 'Scroll: Zoom'],
      ],
      settings.scrollMode,
      'Two-finger scroll or mouse wheel: pan (trackpad) or zoom (mouse). Pinch always zooms.',
      (v) => (settings.scrollMode = v as ScrollMode),
    );
    scroll.dataset.testid = 'scroll-mode';

    const right = span('status-right');
    right.append(scroll, this.ortho, this.polar, this.increment, this.precision);
    root.append(this.prompt, this.coords, this.fromBase, right);
    this.refreshToggles();
  }

  setPrompt(text: string): void {
    if (performance.now() < this.messageUntil) return;
    this.prompt.textContent = text;
    this.prompt.classList.remove('message');
  }

  showMessage(text: string): void {
    this.messageUntil = performance.now() + MESSAGE_MS;
    this.prompt.textContent = text;
    this.prompt.classList.add('message');
  }

  setCursor(p: Vec2 | undefined, base: Vec2 | undefined): void {
    const dp = this.settings.precision;
    this.coords.textContent = p ? formatReadout(p, dp) : '';
    this.fromBase.textContent = p && base ? formatFromBase(base, p, dp) : '';
  }

  /** Call after settings change from elsewhere (F8, F10). */
  refreshToggles(): void {
    this.ortho.classList.toggle('on', this.settings.ortho);
    this.polar.classList.toggle('on', this.settings.polar);
    this.ortho.setAttribute('aria-pressed', String(this.settings.ortho));
    this.polar.setAttribute('aria-pressed', String(this.settings.polar));
  }

  private toggle(label: string, title: string, flip: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'status-toggle';
    b.textContent = label;
    b.title = title;
    b.tabIndex = -1;
    b.addEventListener('click', () => {
      flip();
      this.refreshToggles();
      this.onSettingsChanged();
    });
    return b;
  }

  private select(options: string[][], value: string, title: string, set: (v: string) => void): HTMLSelectElement {
    const s = document.createElement('select');
    s.title = title;
    s.tabIndex = -1;
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v!;
      o.textContent = text!;
      s.append(o);
    }
    s.value = value;
    s.addEventListener('change', () => {
      set(s.value);
      s.blur();
      this.onSettingsChanged();
    });
    return s;
  }
}
