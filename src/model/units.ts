import { scaleDimStyle } from './dimStyle';
import type { Drawing, Units } from './drawing';
import { scaleEntity } from './entity';
import type { Change, Transaction } from './undo';

export const MM_PER_INCH = 25.4;

/** Multiplies a value in `units` to give the other unit (dual dimensions). */
export function altUnitFactor(units: Units): number {
  return units === 'in' ? MM_PER_INCH : 1 / MM_PER_INCH;
}

export const UNIT_LABEL: Readonly<Record<Units, string>> = { in: 'inch', mm: 'mm' };

/**
 * Converts the drawing to `to`: every entity is scaled so its real size is
 * unchanged (inch → mm multiplies by 25.4, mm → inch divides), and so are the
 * dimension styles' sizes and tolerances, so text prints the same size,
 * and the ordinate origin.
 * Undefined when the drawing already uses `to`.
 */
export function convertUnits(d: Drawing, to: Units): Transaction | undefined {
  if (d.units === to) return undefined;
  const scale = (v: number): number => (to === 'mm' ? v * MM_PER_INCH : v / MM_PER_INCH);
  const changes: Change[] = [{ op: 'units', before: d.units, after: to }];
  for (const e of d.entities.values()) {
    changes.push({ op: 'modify', before: e, after: scaleEntity(e, scale) });
  }
  for (const s of d.dimStyles.values()) {
    changes.push({ op: 'dimStyle', before: s, after: scaleDimStyle(s, scale) });
  }
  const o = d.dimOrigin;
  if (o.x !== 0 || o.y !== 0) changes.push({ op: 'dimOrigin', before: o, after: { x: scale(o.x), y: scale(o.y) } });
  return { label: `Convert to ${UNIT_LABEL[to]}`, changes };
}

/**
 * Relabels the drawing as `to` without touching any numbers, for a drawing
 * that was started in the wrong unit. Undefined when it already uses `to`.
 */
export function relabelUnits(d: Drawing, to: Units): Transaction | undefined {
  if (d.units === to) return undefined;
  return { label: `Relabel as ${UNIT_LABEL[to]}`, changes: [{ op: 'units', before: d.units, after: to }] };
}
