import { type BBox, fromPoints, union } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { distanceToSegment } from '../geometry/distance';
import { TOL } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';
import { type DimText, formatDimension } from './dimFormat';
import { type DimStyle, dimStyleOf, lengthFormat } from './dimStyle';
import type { Drawing } from './drawing';
import type { DimensionEntity } from './entity';
import { textWidth } from './textMetrics';
import { altUnitFactor } from './units';

/**
 * Where a dimension's pieces go, in drawing units: what the renderer draws,
 * and what picking and selection test against. Pure, no DOM: text widths
 * come from `textMetrics`.
 *
 * ASME unidirectional text: always horizontal, centered on the dimension
 * line, which breaks around it. Fit, AutoCAD's "best fit": text and arrows
 * inside the extension lines when both fit; else the text inside and the
 * arrows outside; else the arrows inside and the text outside, past the
 * second point; else both outside.
 */
export type DimLayout = {
  /** The measured distance, unrounded. */
  readonly value: number;
  readonly text: DimText;
  /** Extension lines and dimension-line pieces. */
  readonly lines: readonly Segment[];
  /** Filled triangles, tip first. */
  readonly arrows: readonly Triangle[];
  readonly runs: readonly TextRun[];
  /** The text's extent, without the gap around it. */
  readonly textBox: BBox;
  readonly fit: Fit;
};

export type Segment = readonly [Vec2, Vec2];
export type Triangle = readonly [Vec2, Vec2, Vec2];
/** One piece of text: `at` is the left end of its baseline; `height` its cap height. */
export type TextRun = { readonly text: string; readonly at: Vec2; readonly height: number };
export type Fit = 'inside' | 'arrowsOutside' | 'textOutside' | 'outside';

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/** The direction a dimension measures along, a unit vector. */
function measureDir(e: DimensionEntity): Vec2 {
  if (e.type === 'linear') return e.dir;
  const v = sub(e.p2, e.p1);
  const len = Math.hypot(v.x, v.y);
  return len > TOL ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
}

/** The distance a dimension reads: along its direction for linear, the true length for aligned. */
export function measuredValue(e: DimensionEntity): number {
  const v = sub(e.p2, e.p1);
  return e.type === 'aligned' ? Math.hypot(v.x, v.y) : Math.abs(dot(v, e.dir));
}

/** Arrow with its tip at `tip`, pointing along the unit vector `d`; 3:1 long to wide. */
function arrow(tip: Vec2, d: Vec2, len: number): Triangle {
  const back = add(tip, d, -len);
  const side = { x: -d.y * (len / 6), y: d.x * (len / 6) };
  return [tip, add(back, side), add(back, side, -1)];
}

/**
 * The text as runs around (0, 0), with the block's width and height. One
 * line: main, inline tolerance, alternate units, a space apart. A stacked
 * tolerance (deviation or limits) is two lines at the same height, half a
 * line apart, centered on the main line.
 */
function textBlock(t: DimText, h: number): { runs: TextRun[]; width: number; height: number } {
  const space = textWidth(' ', h);
  const runs: TextRun[] = [];
  let x = 0;
  const put = (text: string, y: number): number => {
    runs.push({ text, at: { x, y }, height: h });
    return textWidth(text, h);
  };
  const advance = (w: number): void => {
    x += w + space;
  };
  if (t.main) advance(put(t.main, -h / 2));
  if (t.tol?.kind === 'inline') advance(put(t.tol.text, -h / 2));
  if (t.tol?.kind === 'stack') advance(Math.max(put(t.tol.upper, h / 4), put(t.tol.lower, -1.25 * h)));
  if (t.alt) advance(put(t.alt, -h / 2));
  const width = Math.max(0, x - space);
  const height = t.tol?.kind === 'stack' ? 2.5 * h : h;
  return { runs: runs.map((r) => ({ ...r, at: { x: r.at.x - width / 2, y: r.at.y } })), width, height };
}

/** The layout of `e` drawn with `style`; `altFactor` converts to the alternate unit. */
export function layoutDimension(e: DimensionEntity, style: DimStyle, altFactor: number): DimLayout {
  const value = measuredValue(e);
  const text = formatDimension(value, lengthFormat(style, altFactor));
  const u = measureDir(e);
  const n = { x: -u.y, y: u.x };
  const a1 = add(e.p1, n, dot(sub(e.at, e.p1), n));
  const a2 = add(e.p2, n, dot(sub(e.at, e.p2), n));

  const lines: Segment[] = [];
  for (const [p, a] of [[e.p1, a1], [e.p2, a2]] as const) {
    const off = sub(a, p);
    const dist = Math.hypot(off.x, off.y);
    if (dist <= style.extOffset) continue; // the dimension line runs at the object: no room for an extension line
    const d = { x: off.x / dist, y: off.y / dist };
    lines.push([add(p, d, style.extOffset), add(a, d, style.extExtend)]);
  }

  const v = sub(a2, a1);
  const len = Math.hypot(v.x, v.y);
  const w = len > TOL ? { x: v.x / len, y: v.y / len } : u;
  const block = textBlock(text, style.textHeight);
  // Half the length of dimension line hidden by the text and its gap.
  const hw = block.width / 2 + style.textGap;
  const hh = block.height / 2 + style.textGap;
  const half = Math.min(Math.abs(w.x) > TOL ? hw / Math.abs(w.x) : Infinity, Math.abs(w.y) > TOL ? hh / Math.abs(w.y) : Infinity);
  const arrowLen = style.arrowSize;
  const fit: Fit = len >= 2 * half + 2 * arrowLen ? 'inside' : len >= 2 * half ? 'arrowsOutside' : len >= 2 * arrowLen ? 'textOutside' : 'outside';

  const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  const piece = (from: Vec2, to: Vec2): void => {
    if (Math.hypot(to.x - from.x, to.y - from.y) > TOL) lines.push([from, to]);
  };
  let center: Vec2;
  const arrows: Triangle[] = [];
  if (fit === 'inside' || fit === 'textOutside') {
    arrows.push(arrow(a1, { x: -w.x, y: -w.y }, arrowLen), arrow(a2, w, arrowLen));
  } else {
    arrows.push(arrow(a1, w, arrowLen), arrow(a2, { x: -w.x, y: -w.y }, arrowLen));
    piece(add(a1, w, -2 * arrowLen), a1);
  }
  switch (fit) {
    case 'inside':
    case 'arrowsOutside':
      center = mid;
      piece(a1, add(mid, w, -half));
      piece(add(mid, w, half), a2);
      if (fit === 'arrowsOutside') piece(a2, add(a2, w, 2 * arrowLen));
      break;
    case 'textOutside':
      center = add(a2, w, arrowLen + half);
      piece(a1, add(a2, w, arrowLen));
      break;
    case 'outside':
      center = add(a2, w, 2 * arrowLen + half);
      piece(a2, add(a2, w, 2 * arrowLen));
      break;
  }

  const runs = block.runs.map((r) => ({ ...r, at: add(r.at, center) }));
  const textBox: BBox = {
    minX: center.x - block.width / 2,
    maxX: center.x + block.width / 2,
    minY: center.y - block.height / 2,
    maxY: center.y + block.height / 2,
  };
  return { value, text, lines, arrows, runs, textBox, fit };
}

/** `e` laid out with its style in `d`. */
export function dimensionLayout(d: Drawing, e: DimensionEntity): DimLayout {
  return layoutDimension(e, dimStyleOf(d, e.dimStyle), altUnitFactor(d.units));
}

export function layoutBBox(l: DimLayout): BBox {
  return union(fromPoints([...l.lines.flat(), ...l.arrows.flat()]), l.textBox);
}

/** Bounds of everything `e` draws. */
export function dimensionBBox(d: Drawing, e: DimensionEntity): BBox {
  return layoutBBox(dimensionLayout(d, e));
}

const edges = (t: Triangle): Segment[] => [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];

/** Distance from `p` to the nearest drawn piece; zero anywhere on the text. */
export function distanceToLayout(p: Vec2, l: DimLayout): number {
  const b = l.textBox;
  let best = Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minY - p.y, 0, p.y - b.maxY));
  for (const [a, c] of [...l.lines, ...l.arrows.flatMap(edges)]) best = Math.min(best, distanceToSegment(p, a, c));
  return best;
}

/** True when any drawn piece, or the text, touches `box` (crossing selection). */
export function layoutTouchesBox(l: DimLayout, box: BBox): boolean {
  const t = l.textBox;
  if (t.minX <= box.maxX && t.maxX >= box.minX && t.minY <= box.maxY && t.maxY >= box.minY) return true;
  return [...l.lines, ...l.arrows.flatMap(edges)].some(([a, b]) => curveTouchesBox({ kind: 'segment', a, b }, box));
}
