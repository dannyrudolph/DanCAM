import { type DimStyle, defaultDimStyle } from './dimStyle';
import type { Drawing } from './drawing';
import type { Change, Transaction } from './undo';

/**
 * Managing a drawing's named dimension styles, as undoable transactions:
 * the counterpart of `layers.ts` for the Dimension Styles panel.
 */

/** An edit as an undoable transaction, or the reason it isn't allowed. */
export type StyleEdit = { readonly ok: true; readonly tx: Transaction } | { readonly ok: false; readonly error: string };

const refuse = (error: string): StyleEdit => ({ ok: false, error });

/** Styles for display, by name, numbers in numeric order. */
export function sortedDimStyles(d: Drawing): DimStyle[] {
  return [...d.dimStyles.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** How many dimensions use each style. */
export function dimStyleUsage(d: Drawing): Map<string, number> {
  const n = new Map<string, number>();
  for (const e of d.entities.values()) if (e.kind === 'dimension') n.set(e.dimStyle, (n.get(e.dimStyle) ?? 0) + 1);
  return n;
}

/** Names are compared without case, as layer names are. */
function nameTaken(d: Drawing, name: string): boolean {
  const key = name.toLowerCase();
  return [...d.dimStyles.keys()].some((n) => n.toLowerCase() === key);
}

/** A copy of `from` named `from`-2, -3, ... (the first free one). */
export function addDimStyle(d: Drawing, from: string): { readonly tx: Transaction; readonly name: string } {
  const source = d.dimStyles.get(from) ?? defaultDimStyle(d.units);
  let i = 2;
  while (nameTaken(d, `${source.name}-${i}`)) i += 1;
  const style: DimStyle = { ...source, name: `${source.name}-${i}` };
  return { tx: { label: `New dimension style ${style.name}`, changes: [{ op: 'dimStyle', after: style }] }, name: style.name };
}

const SIZES = ['textHeight', 'arrowSize', 'extOffset', 'extExtend', 'textGap'] as const;
const PLACES = ['precision', 'tolPrecision', 'anglePrecision'] as const;

/** Why `s` can't be a style, or undefined when it can. */
function invalid(s: DimStyle): string | undefined {
  if (!(s.textHeight > 0)) return 'The text height must be more than zero.';
  if (SIZES.some((k) => !(s[k] >= 0))) return 'Sizes can not be negative.';
  const places = [...PLACES.map((k) => s[k]), ...(s.dual ? [s.dual.precision] : [])];
  if (places.some((p) => !Number.isInteger(p) || p < 0 || p > 8)) return 'Precision is a whole number from 0 to 8.';
  const t = s.tolerance;
  if (t.kind === 'symmetric' && !(t.value >= 0)) return 'A ± tolerance is zero or more.';
  if ((t.kind === 'deviation' || t.kind === 'limits') && !(t.upper >= t.lower)) return 'The upper tolerance must not be below the lower one.';
  return undefined;
}

/** Settings to change; an optional one given as undefined is removed. */
export type StylePatch = { readonly [K in Exclude<keyof DimStyle, 'name'>]?: DimStyle[K] | undefined };

/**
 * Changes a style's settings. An optional field (`dual`, `prefix`,
 * `suffix`) given as undefined is removed. Not ok when nothing would change
 * (`error` empty) or the result isn't a valid style.
 */
export function editDimStyle(d: Drawing, name: string, patch: StylePatch): StyleEdit {
  const before = d.dimStyles.get(name);
  if (!before) return refuse(`There is no dimension style ${name}.`);
  const merged: Record<string, unknown> = { ...before, ...patch };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const after = merged as DimStyle;
  if (JSON.stringify(after) === JSON.stringify(before)) return refuse('');
  const why = invalid(after);
  if (why) return refuse(why);
  return { ok: true, tx: { label: `Dimension style ${name}`, changes: [{ op: 'dimStyle', before, after }] } };
}

/** Renames a style and moves its dimensions with it, as one undo step. */
export function renameDimStyle(d: Drawing, from: string, toRaw: string): StyleEdit {
  const to = toRaw.trim();
  const style = d.dimStyles.get(from);
  if (!style) return refuse(`There is no dimension style ${from}.`);
  if (to === '') return refuse('A dimension style needs a name.');
  if (to === from) return refuse('That is already its name.');
  if (to.toLowerCase() !== from.toLowerCase() && nameTaken(d, to)) return refuse(`There is already a dimension style named ${to}.`);
  const changes: Change[] = [{ op: 'dimStyle', after: { ...style, name: to } }];
  for (const e of d.entities.values()) {
    if (e.kind === 'dimension' && e.dimStyle === from) changes.push({ op: 'modify', before: e, after: { ...e, dimStyle: to } });
  }
  changes.push({ op: 'dimStyle', before: style });
  return { ok: true, tx: { label: `Rename dimension style ${from} to ${to}`, changes } };
}

/** Deletes a style no dimension uses. The current style and the last one stay. */
export function deleteDimStyle(d: Drawing, name: string): StyleEdit {
  const style = d.dimStyles.get(name);
  if (!style) return refuse(`There is no dimension style ${name}.`);
  if (d.dimStyles.size === 1) return refuse('A drawing keeps at least one dimension style.');
  if (name === d.currentDimStyle) return refuse(`${name} is the current style; make another current first.`);
  const used = dimStyleUsage(d).get(name) ?? 0;
  if (used > 0) return refuse(`${used} dimension${used === 1 ? ' uses' : 's use'} ${name}.`);
  return { ok: true, tx: { label: `Delete dimension style ${name}`, changes: [{ op: 'dimStyle', before: style }] } };
}

/**
 * Keeps the current style pointing at one that exists: it follows a rename,
 * and after an undo removes it, falls back to the first style by name. New
 * dimensions must never name a missing style (the file would not reopen).
 */
export function ensureCurrentDimStyle(d: Drawing, renamedFrom?: string, renamedTo?: string): void {
  if (renamedFrom !== undefined && renamedTo !== undefined && d.currentDimStyle === renamedFrom && d.dimStyles.has(renamedTo)) {
    d.currentDimStyle = renamedTo;
  }
  if (d.dimStyles.has(d.currentDimStyle)) return;
  const first = sortedDimStyles(d)[0];
  if (first) d.currentDimStyle = first.name;
}
