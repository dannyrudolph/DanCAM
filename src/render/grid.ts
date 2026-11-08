/** Minimum on-screen gap between minor grid lines, in CSS pixels. */
export const MIN_GRID_PX = 12;

export type GridSpacing = {
  /** World distance between minor lines: 1, 2 or 5 times a power of ten. */
  readonly step: number;
  /** Every Nth minor line is major, so major lines fall on powers of ten. */
  readonly majorEvery: number;
};

const MANTISSAS = [1, 2, 5, 10] as const;

/**
 * The smallest 1-2-5 step whose lines are at least `minPx` apart at `scale`
 * pixels per unit.
 */
export function gridSpacing(scale: number, minPx: number = MIN_GRID_PX): GridSpacing {
  const raw = minPx / scale;
  let exp = Math.floor(Math.log10(raw));
  for (const m of MANTISSAS) {
    const step = m * 10 ** exp;
    if (step >= raw) {
      if (m === 10) {
        exp += 1;
        return { step: 10 ** exp, majorEvery: 10 };
      }
      return { step, majorEvery: 10 / m };
    }
  }
  // Unreachable: 10 * 10^floor(log10(raw)) is always >= raw.
  throw new Error(`gridSpacing: no step for scale ${scale}`);
}

export type GridLine = { readonly value: number; readonly major: boolean };

/**
 * Grid lines between min and max inclusive. Each value is index * step, not a
 * running sum, so positions don't drift far from the origin.
 */
export function gridLines(min: number, max: number, spacing: GridSpacing): GridLine[] {
  const first = Math.ceil(min / spacing.step);
  const last = Math.floor(max / spacing.step);
  const lines: GridLine[] = [];
  for (let k = first; k <= last; k++) {
    lines.push({ value: k * spacing.step, major: k % spacing.majorEvery === 0 });
  }
  return lines;
}
