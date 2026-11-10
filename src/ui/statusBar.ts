import { angleDeg } from '../geometry/angle';
import type { Vec2 } from '../geometry/vec';
import type { Units } from '../model/drawing';
import { type AxisView, PLAIN_VIEW, axisNames, viewPoint } from '../model/latheView';
import { SHEET_SCALES, formatSheetScale, parseSheetScale } from '../model/sheetScale';
import type { SnapKind } from '../snap/snap';
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

/** "1.2500, 0.5000"; in lathe mode with the axes named: "Z 1.2500  X 0.2500" or "Z 1.2500  Ø 0.5000". */
export function formatReadout(p: Vec2, decimals: number = DEFAULT_PRECISION, view: AxisView = PLAIN_VIEW): string {
  if (!view.lathe) return `${formatNumber(p.x, decimals)}, ${formatNumber(p.y, decimals)}`;
  const [h, v] = viewPoint(p, view);
  const names = axisNames(view);
  return `${names.h} ${formatNumber(h, decimals)}  ${names.v} ${formatNumber(v, decimals)}`;
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
  /** The running object snaps, switched on and off in the Snaps toolbar. */
  readonly snapKinds: Set<SnapKind>;
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
  private readonly sheetScale: HTMLSelectElement;
  private readonly latheButton: HTMLButtonElement;
  private readonly diameterButton: HTMLButtonElement;
  private view: AxisView = PLAIN_VIEW;
  private readonly customScale: HTMLInputElement;
  private shownScale = 1;
  private messageUntil = 0;

  constructor(
    root: HTMLElement,
    private readonly settings: StatusSettings,
    private readonly onSettingsChanged: () => void,
    /** The drawing's sheet scale was chosen; the app commits it as an undo step. */
    private readonly onSheetScale: (scale: number) => void,
    /** Lathe mode or diameter display was switched; the app stores it in the drawing. */
    private readonly onAxisView: (lathe: boolean, diameter: boolean) => void,
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

    // Sheet scale: drawing state, not a browser setting, so it goes to the app rather than `settings`.
    this.sheetScale = document.createElement('select');
    this.sheetScale.title = 'Sheet scale: dimension text, arrows and gaps are sized to print at this scale';
    this.sheetScale.tabIndex = -1;
    this.sheetScale.dataset.testid = 'sheet-scale';
    this.sheetScale.addEventListener('change', () => {
      const v = this.sheetScale.value;
      this.sheetScale.blur();
      if (v === 'custom') {
        this.sheetScale.hidden = true;
        this.customScale.hidden = false;
        this.customScale.value = formatSheetScale(this.shownScale);
        this.customScale.focus();
        this.customScale.select();
        return;
      }
      this.onSheetScale(Number(v));
    });
    this.customScale = document.createElement('input');
    this.customScale.className = 'status-scale-input';
    this.customScale.hidden = true;
    this.customScale.spellcheck = false;
    this.customScale.dataset.testid = 'sheet-scale-custom';
    this.customScale.title = 'Type a scale, such as 50:1, 1:2 or 2.5, then Enter; Esc cancels';
    const closeCustom = (): void => {
      this.customScale.hidden = true;
      this.sheetScale.hidden = false;
      this.showSheetScale(this.shownScale);
    };
    this.customScale.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCustom();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const scale = parseSheetScale(this.customScale.value);
        if (scale === undefined) {
          this.customScale.classList.add('invalid');
          return;
        }
        this.customScale.classList.remove('invalid');
        closeCustom();
        this.onSheetScale(scale);
      }
    });
    this.customScale.addEventListener('blur', () => {
      if (!this.customScale.hidden) closeCustom();
    });
    this.showSheetScale(1);

    // Lathe mode and diameter display are drawing settings too.
    this.latheButton = this.toggle('Lathe', 'Lathe mode: axes Z and X, with a centerline at X 0', () => this.onAxisView(!this.view.lathe, this.view.diameter));
    this.latheButton.dataset.testid = 'lathe';
    this.diameterButton = this.toggle('Ø', 'Diameter: show and type X values as diameters (lathe mode)', () =>
      this.onAxisView(this.view.lathe, !this.view.diameter),
    );
    this.diameterButton.dataset.testid = 'diameter';

    const right = span('status-right');
    right.append(this.latheButton, this.diameterButton, this.sheetScale, this.customScale, scroll, this.ortho, this.polar, this.increment, this.precision);
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

  /** Shows the drawing's lathe and diameter settings, and names the readout's axes to match. */
  showAxisView(lathe: boolean, diameter: boolean): void {
    this.view = { lathe, diameter };
    const set = (b: HTMLButtonElement, on: boolean): void => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    set(this.latheButton, lathe);
    set(this.diameterButton, lathe && diameter);
    this.diameterButton.disabled = !lathe;
  }

  setCursor(p: Vec2 | undefined, base: Vec2 | undefined): void {
    const dp = this.settings.precision;
    this.coords.textContent = p ? formatReadout(p, dp, { lathe: this.view.lathe, diameter: this.view.lathe && this.view.diameter }) : '';
    this.fromBase.textContent = p && base ? formatFromBase(base, p, dp) : '';
  }

  /** Shows the drawing's sheet scale; a scale not in the list gets its own entry. */
  showSheetScale(scale: number): void {
    if (scale === this.shownScale && this.sheetScale.options.length > 0) {
      this.sheetScale.value = String(scale); // after a cancelled Custom…
      return;
    }
    this.shownScale = scale;
    const scales = SHEET_SCALES.includes(scale) ? SHEET_SCALES : [...SHEET_SCALES, scale].sort((a, b) => a - b);
    this.sheetScale.replaceChildren(
      ...[...scales.map((s) => [String(s), `Scale ${formatSheetScale(s)}`]), ['custom', 'Custom…']].map(([v, text]) => {
        const o = document.createElement('option');
        o.value = v!;
        o.textContent = text!;
        return o;
      }),
    );
    this.sheetScale.value = String(scale);
  }

  /** Call after settings change from elsewhere (F8, F10). */
  refreshToggles(): void {
    const set = (b: HTMLButtonElement, on: boolean): void => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    };
    set(this.ortho, this.settings.ortho);
    set(this.polar, this.settings.polar);
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
