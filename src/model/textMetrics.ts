/**
 * Text sizes without the DOM, so dimension layout (and later DXF and PDF
 * output) is the same everywhere. Widths are Helvetica's (Arial has the
 * same), in 1/1000 em; the renderer draws with that font.
 */

/** Drafting text height is the cap height; Helvetica's capitals are 0.718 em tall. */
export const CAP_HEIGHT_EM = 0.718;

/** The CSS font stack that matches these widths. */
export const TEXT_FONT = 'Helvetica, Arial, sans-serif';

const WIDTHS: Readonly<Record<string, number>> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333,
  '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
  '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, '{': 334,
  '|': 260, '}': 334, '~': 584, '°': 400, '±': 584, 'Ø': 778, 'ø': 611, '×': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
/** Digits all share one width, so columns of numbers line up. */
const DIGIT = 556;
/** For characters not in the table. */
const DEFAULT = 556;

/** Width of `text` set at cap height `height`, in the same units. */
export function textWidth(text: string, height: number): number {
  let units = 0;
  for (const ch of text) units += ch >= '0' && ch <= '9' ? DIGIT : (WIDTHS[ch] ?? DEFAULT);
  return (units / 1000) * (height / CAP_HEIGHT_EM);
}
