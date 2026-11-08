import type { Vec2 } from '../geometry/vec';
import type { Units } from '../model/drawing';

/** Display precision for the coordinate readout until Phase 1 makes it a setting. */
export const READOUT_DECIMALS = 4;

/** Formats a number for display only; never feed the result back into geometry (CAD-5). */
export function formatNumber(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  // "-0.0000" reads as a sign error; show it as zero.
  return Number(s) === 0 ? (0).toFixed(decimals) : s;
}

export function formatReadout(p: Vec2, decimals: number = READOUT_DECIMALS): string {
  return `${formatNumber(p.x, decimals)}, ${formatNumber(p.y, decimals)}`;
}

/** The status bar: cursor coordinates, units and the width of the view. */
export class StatusBar {
  private readonly coords: HTMLElement;
  private readonly info: HTMLElement;

  constructor(root: HTMLElement) {
    this.coords = document.createElement('span');
    this.coords.className = 'status-coords';
    this.info = document.createElement('span');
    this.info.className = 'status-info';
    root.append(this.coords, this.info);
  }

  setCursor(p: Vec2 | undefined): void {
    this.coords.textContent = p ? formatReadout(p) : '';
  }

  setView(units: Units, viewWidthUnits: number): void {
    this.info.textContent = `${units}  ·  view width ${viewWidthUnits.toPrecision(4)} ${units}`;
  }
}
