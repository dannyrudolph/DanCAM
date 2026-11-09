import { type Tolerance, expandSymbols, toleranceOfKind } from './dimFormat';
import { dimStyleOf } from './dimStyle';
import type { Drawing } from './drawing';
import type { DimensionEntity } from './entity';
import type { PropertySetter } from './propertyEdit';

/**
 * Per-dimension overrides of its style, as the properties panel edits them:
 * precision, tolerance and text (spec, "Dimension styles"). Each function
 * returns the changed dimension; the panel commits it as one undo step.
 * Removing an override (`undefined`) goes back to the style.
 */

export type ToleranceKind = Tolerance['kind'];

/** Lengths take a tolerance; angles and leaders don't. */
export const takesTolerance = (e: DimensionEntity): boolean => e.type !== 'angular' && e.type !== 'leader';

/** The tolerance `e` shows: its own, else its style's. */
export function effectiveTolerance(d: Drawing, e: DimensionEntity): Tolerance {
  return e.tolerance ?? dimStyleOf(d, e.dimStyle).tolerance;
}

/** The decimal places `e` shows: its own, else its style's (the angle precision for angular). */
export function effectivePrecision(d: Drawing, e: DimensionEntity): number {
  const s = dimStyleOf(d, e.dimStyle);
  return e.precision ?? (e.type === 'angular' ? s.anglePrecision : s.precision);
}

/** Removes `key` from a dimension, or sets it. */
function withField<K extends 'precision' | 'tolerance' | 'textOverride'>(e: DimensionEntity, key: K, value: DimensionEntity[K] | undefined): DimensionEntity {
  const { [key]: _old, ...rest } = e;
  return (value === undefined ? rest : { ...rest, [key]: value }) as DimensionEntity;
}

export function withDimStyle(e: DimensionEntity, dimStyle: string): DimensionEntity {
  return { ...e, dimStyle };
}

/** `places` undefined: back to the style's precision. */
export function withPrecision(e: DimensionEntity, places: number | undefined): DimensionEntity {
  return withField(e, 'precision', places);
}

/**
 * The dimension with a tolerance of `kind` (undefined: back to the style's).
 * Values carry over from the tolerance it shows when they fit the new kind
 * (± to ±, deviation to and from limits); otherwise they start at zero.
 */
export function withToleranceKind(d: Drawing, e: DimensionEntity, kind: ToleranceKind | undefined): DimensionEntity {
  return withField(e, 'tolerance', kind === undefined ? undefined : toleranceOfKind(effectiveTolerance(d, e), kind));
}

/**
 * The text as typed in the panel, symbol codes expanded. A leader's note
 * can't be empty (undefined: refused). For a dimension it is the text
 * override; empty or a bare `<>` removes it.
 */
export function withText(e: DimensionEntity, typed: string): DimensionEntity | undefined {
  const text = expandSymbols(typed).trim();
  if (e.type === 'leader') return text === '' ? undefined : { ...e, text };
  return withField(e, 'textOverride', text === '' || text === '<>' ? undefined : text);
}

/** What the Text row offers for editing: the note, or the override (`<>` when there is none). */
export function editableText(e: DimensionEntity): string {
  return e.type === 'leader' ? e.text : (e.textOverride ?? '<>');
}

/**
 * Setters for the tolerance value rows ("Tol ±", "Tol upper", "Tol lower")
 * of the tolerance `e` shows. Editing one makes the tolerance the
 * dimension's own. The upper value can't go below the lower one.
 */
export function toleranceSetter(d: Drawing, e: DimensionEntity, label: string): PropertySetter | undefined {
  if (!takesTolerance(e)) return undefined;
  const t = effectiveTolerance(d, e);
  const set = (f: (v: number) => Tolerance | undefined, refusal: string): PropertySetter => ({
    quantity: 'length',
    refusal,
    set: (v) => {
      const next = f(v);
      return next && withField(e, 'tolerance', next);
    },
  });
  if (t.kind === 'symmetric' && label === 'Tol ±') {
    return set((v) => (v >= 0 ? { kind: t.kind, value: v } : undefined), 'a ± tolerance is zero or more');
  }
  if (t.kind === 'deviation' || t.kind === 'limits') {
    const refusal = 'the upper value must not be below the lower one';
    if (label === 'Tol upper') return set((v) => (v >= t.lower ? { ...t, upper: v } : undefined), refusal);
    if (label === 'Tol lower') return set((v) => (v <= t.upper ? { ...t, lower: v } : undefined), refusal);
  }
  return undefined;
}
