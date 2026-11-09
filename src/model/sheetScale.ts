import type { DimStyle } from './dimStyle';

/**
 * The print scale of the sheet: 10 is 10:1 (the part printed ten times
 * size), 0.5 is 1:2. Dimension styles give sheet sizes (text height,
 * arrows, gaps), so a dimension's sizes in drawing units are those divided
 * by the scale: a 10:1 detail still prints .12" text, like AutoCAD's
 * DIMSCALE (spec, "Dimension scale").
 */
export const SHEET_SCALES: readonly number[] = [1, 2, 5, 10, 20];

/** The style's sheet sizes in drawing units at `scale`; tolerances and everything else unchanged. */
export function atSheetScale(s: DimStyle, scale: number): DimStyle {
  if (scale === 1) return s;
  const k = (x: number): number => x / scale;
  return { ...s, textHeight: k(s.textHeight), arrowSize: k(s.arrowSize), extOffset: k(s.extOffset), extExtend: k(s.extExtend), textGap: k(s.textGap) };
}

const clean = (x: number): string => String(Number(x.toPrecision(6)));

/** "10:1", "1:2", "2.5:1". */
export function formatSheetScale(scale: number): string {
  return scale >= 1 ? `${clean(scale)}:1` : `1:${clean(1 / scale)}`;
}

/** Reads "10:1", "1:2", "3/2" or a plain factor ("2.5"); undefined unless it is more than zero. */
export function parseSheetScale(text: string): number | undefined {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(?:[:/]\s*([0-9]*\.?[0-9]+))?\s*$/.exec(text);
  if (!m) return undefined;
  const scale = Number(m[1]) / (m[2] === undefined ? 1 : Number(m[2]));
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}
