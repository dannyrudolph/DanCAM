import { type DimFormat, INCH_ZEROS, MM_ZEROS, type Tolerance, type ZeroRules, scaleTolerance } from './dimFormat';
import type { Drawing, Units } from './drawing';

/**
 * A named dimension style. Sizes are sheet sizes in drawing units (the
 * printed text height, not the part's); tolerance values are drawing units.
 */
export type DimStyle = {
  readonly name: string;
  /** Cap height of the text. */
  readonly textHeight: number;
  /** Arrowhead length; arrows are filled, 3:1 long to wide. */
  readonly arrowSize: number;
  /** Gap between the object and the start of an extension line. */
  readonly extOffset: number;
  /** How far an extension line runs past the dimension line. */
  readonly extExtend: number;
  /** Clearance around the text where it breaks the dimension line. */
  readonly textGap: number;
  readonly precision: number;
  readonly zeros: ZeroRules;
  readonly tolerance: Tolerance;
  readonly tolPrecision: number;
  readonly angleFormat: 'decimal' | 'dms';
  readonly anglePrecision: number;
  /** Alternate units in brackets (mm for an inch drawing, inch for mm). */
  readonly dual?: { readonly precision: number; readonly zeros: ZeroRules };
  readonly prefix?: string;
  readonly suffix?: string;
  /** Symmetric diameters: one side of the axis drawn (absent: half) or both. */
  readonly symmetric?: 'half' | 'full';
};

const INCH_STYLE: DimStyle = {
  name: 'INCH-3PL',
  textHeight: 0.12,
  arrowSize: 0.12,
  extOffset: 0.0625,
  extExtend: 0.125,
  textGap: 0.0625,
  precision: 3,
  zeros: INCH_ZEROS,
  tolerance: { kind: 'none' },
  tolPrecision: 3,
  angleFormat: 'decimal',
  anglePrecision: 0,
};

const MM_STYLE: DimStyle = {
  name: 'MM-2PL',
  textHeight: 3,
  arrowSize: 3,
  extOffset: 1.5,
  extExtend: 3,
  textGap: 1.5,
  precision: 2,
  zeros: MM_ZEROS,
  tolerance: { kind: 'none' },
  tolPrecision: 2,
  angleFormat: 'decimal',
  anglePrecision: 0,
};

/** The style a new drawing starts with: ASME defaults for its unit. */
export function defaultDimStyle(units: Units): DimStyle {
  return units === 'in' ? INCH_STYLE : MM_STYLE;
}

/**
 * The style a dimension draws with: its own, else the current one, else the
 * unit default (a file can't name a missing style, but undo can remove one).
 */
export function dimStyleOf(d: Drawing, name: string): DimStyle {
  return d.dimStyles.get(name) ?? d.dimStyles.get(d.currentDimStyle) ?? defaultDimStyle(d.units);
}

/** The format for a length measured with `style`; `altFactor` turns drawing units into the alternate unit. */
export function lengthFormat(style: DimStyle, altFactor: number): DimFormat {
  return {
    precision: style.precision,
    zeros: style.zeros,
    tolerance: style.tolerance,
    tolPrecision: style.tolPrecision,
    ...(style.dual && { dual: { factor: altFactor, ...style.dual } }),
    ...(style.prefix !== undefined && { prefix: style.prefix }),
    ...(style.suffix !== undefined && { suffix: style.suffix }),
  };
}

/**
 * The format for an angle measured with `style`: its angle precision and
 * format (decimal degrees or D°M'S). Tolerances and dual units are lengths,
 * so they don't apply.
 */
export function angleFormat(style: DimStyle): DimFormat {
  return { precision: style.anglePrecision, zeros: style.zeros, tolerance: { kind: 'none' }, tolPrecision: style.tolPrecision, angle: style.angleFormat };
}

/** The style with every size and tolerance passed through `f`, for converting units. */
export function scaleDimStyle(s: DimStyle, f: (length: number) => number): DimStyle {
  const tolerance = scaleTolerance(s.tolerance, f);
  return {
    ...s,
    textHeight: f(s.textHeight),
    arrowSize: f(s.arrowSize),
    extOffset: f(s.extOffset),
    extExtend: f(s.extExtend),
    textGap: f(s.textGap),
    tolerance,
  };
}
