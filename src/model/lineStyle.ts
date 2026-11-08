import type { Vec2 } from '../geometry/vec';

/**
 * Drafting line styles: a linetype (dash pattern) plus a line weight.
 * Patterns and weights are in screen pixels, so dashes stay readable at every
 * zoom; Phase 6 maps them to sheet units for printing.
 */
export type LineStyleName = 'visible' | 'hidden' | 'center' | 'tangent';

export type LineStyle = {
  readonly name: LineStyleName;
  readonly label: string;
  /** Dash, gap, dash, gap... in CSS pixels. Empty is continuous. */
  readonly dash: readonly number[];
  /** Line width in CSS pixels. */
  readonly weight: number;
  /**
   * Gap left at each end, in CSS pixels, so the line stops short of the edges
   * it meets (tangent edges). Display only: the stored endpoints are exact.
   */
  readonly endGap: number;
};

const THICK = 2;
const THIN = 1;
/** Tangent edges are lighter than the other thin lines. */
const LIGHT = 0.75;
/** Gap at each end of a tangent edge, CSS pixels. */
const TANGENT_GAP = 4;

export const LINE_STYLES: Readonly<Record<LineStyleName, LineStyle>> = {
  visible: { name: 'visible', label: 'Visible', dash: [], weight: THICK, endGap: 0 },
  hidden: { name: 'hidden', label: 'Hidden', dash: [8, 4], weight: THIN, endGap: 0 },
  center: { name: 'center', label: 'Center', dash: [24, 4, 6, 4], weight: THIN, endGap: 0 },
  tangent: { name: 'tangent', label: 'Tangent', dash: [], weight: LIGHT, endGap: TANGENT_GAP },
};

export const LINE_STYLE_NAMES: readonly LineStyleName[] = ['visible', 'hidden', 'center', 'tangent'];

/** Total length of one repeat of a dash pattern. */
export function patternLength(dash: readonly number[]): number {
  return dash.reduce((a, b) => a + b, 0);
}

/**
 * Canvas lineDashOffset that keeps a pattern anchored to the entity's real start
 * point when the drawn segment was clipped to start `clippedAway` pixels later.
 * Without it, dashes would slide along the line as you pan.
 */
export function dashOffset(dash: readonly number[], clippedAway: number): number {
  const len = patternLength(dash);
  return len === 0 ? 0 : clippedAway % len;
}

/**
 * Pulls both ends of a screen-space segment in by `gap` pixels. A segment too
 * short for full gaps keeps its middle half, so it never disappears entirely.
 */
export function insetSegment(a: Vec2, b: Vec2, gap: number): [Vec2, Vec2] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (gap <= 0 || len === 0) return [a, b];
  const g = Math.min(gap, len / 4);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  return [
    { x: a.x + ux * g, y: a.y + uy * g },
    { x: b.x - ux * g, y: b.y - uy * g },
  ];
}
