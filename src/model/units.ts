import type { Drawing, Units } from './drawing';
import { scaleEntity } from './entity';
import type { Change, Transaction } from './undo';

export const MM_PER_INCH = 25.4;

export const UNIT_LABEL: Readonly<Record<Units, string>> = { in: 'inch', mm: 'mm' };

/**
 * Converts the drawing to `to`: every entity is scaled so its real size is
 * unchanged (inch → mm multiplies by 25.4, mm → inch divides). Undefined when
 * the drawing already uses `to`.
 */
export function convertUnits(d: Drawing, to: Units): Transaction | undefined {
  if (d.units === to) return undefined;
  const scale = (v: number): number => (to === 'mm' ? v * MM_PER_INCH : v / MM_PER_INCH);
  const changes: Change[] = [{ op: 'units', before: d.units, after: to }];
  for (const e of d.entities.values()) {
    changes.push({ op: 'modify', before: e, after: scaleEntity(e, scale) });
  }
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
