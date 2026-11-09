import type { Vec2 } from '../geometry/vec';
import type { Drawing } from './drawing';
import type { Row } from './properties';

/**
 * How coordinates are named and shown (spec, "Lathe-aware"). Plain: X
 * horizontal, Y vertical. Lathe: the drawing's X axis is the part
 * centerline, horizontal is Z and vertical is X; with `diameter` on,
 * vertical values are shown and typed as diameters (twice the stored Y).
 * Only display and entry change: stored coordinates never do (CAD-5), and
 * halving or doubling a double is exact.
 */
export type AxisView = { readonly lathe: boolean; readonly diameter: boolean };

export const PLAIN_VIEW: AxisView = { lathe: false, diameter: false };

export function axisView(d: Drawing): AxisView {
  return { lathe: d.lathe, diameter: d.lathe && d.diameterMode };
}

/** What a vertical value is multiplied by for display (and divided by on entry). */
export function radialFactor(v: AxisView): number {
  return v.lathe && v.diameter ? 2 : 1;
}

/** The names of the horizontal and vertical axes. */
export function axisNames(v: AxisView): { readonly h: string; readonly v: string } {
  if (!v.lathe) return { h: 'X', v: 'Y' };
  return { h: 'Z', v: v.diameter ? 'Ø' : 'X' };
}

const AXIS_LABEL = /^(.*?)(Δ?)([XY])$/;

/**
 * A coordinate label ("Start X", "ΔY", "Y") as this view names it, with the
 * factor its value is shown at. Labels that aren't coordinates are kept.
 */
export function viewLabel(label: string, v: AxisView): { readonly label: string; readonly factor: number } {
  const m = AXIS_LABEL.exec(label);
  if (!m || !v.lathe) return { label, factor: 1 };
  const names = axisNames(v);
  const vertical = m[3] === 'Y';
  return { label: `${m[1]}${m[2]}${vertical ? names.v : names.h}`, factor: vertical ? radialFactor(v) : 1 };
}

/** The row as this view shows it: renamed, and a vertical coordinate as a diameter when that is on. */
export function viewRow(r: Row, v: AxisView): Row {
  const { label, factor } = viewLabel(r.label, v);
  return { ...r, label, value: typeof r.value === 'number' ? r.value * factor : r.value };
}

/** A point as the view shows it: [horizontal, vertical]. */
export function viewPoint(p: Vec2, v: AxisView): readonly [number, number] {
  return [p.x, p.y * radialFactor(v)];
}
