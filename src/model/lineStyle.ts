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
};

const THICK = 2;
const THIN = 1;

export const LINE_STYLES: Readonly<Record<LineStyleName, LineStyle>> = {
  visible: { name: 'visible', label: 'Visible', dash: [], weight: THICK },
  hidden: { name: 'hidden', label: 'Hidden', dash: [8, 4], weight: THIN },
  center: { name: 'center', label: 'Center', dash: [24, 4, 6, 4], weight: THIN },
  tangent: { name: 'tangent', label: 'Tangent', dash: [24, 4, 4, 4, 4, 4], weight: THIN },
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
