import { angleDeg, ccwDeg, cosSinDeg, normDeg } from '../geometry/angle';
import { type Arc, arcBBox, ccwTangentAt, distanceToArc } from '../geometry/arc';
import { type BBox, fromPoints, union } from '../geometry/bbox';
import { curveTouchesBox } from '../geometry/curve';
import { distanceToSegment } from '../geometry/distance';
import { TOL } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';
import { type DimFormat, type DimText, formatDimension } from './dimFormat';
import { type DimStyle, angleFormat, dimStyleOf, lengthFormat } from './dimStyle';
import type { Drawing } from './drawing';
import type { DimensionEntity } from './entity';
import { atSheetScale } from './sheetScale';
import { textWidth } from './textMetrics';
import { altUnitFactor } from './units';

/**
 * Where a dimension's pieces go, in drawing units: what the renderer draws,
 * and what picking and selection test against. Pure, no DOM: text widths
 * come from `textMetrics`.
 *
 * ASME unidirectional text: always horizontal, centered on the dimension
 * line (or arc), which breaks around it. Fit, AutoCAD's "best fit": text
 * and arrows inside the extension lines when both fit; else the text inside
 * and the arrows outside; else the arrows inside and the text outside, past
 * the second end; else both outside. Radius and diameter text outside the
 * circle sits on a leader with a short horizontal shoulder; inside, on the
 * radius (or diameter) line itself.
 */
export type DimLayout = {
  /** The measured distance (or angle, in degrees), unrounded; absent for a leader, which measures nothing. */
  readonly value?: number;
  readonly text: DimText;
  /** Extension lines, dimension-line pieces and leaders. */
  readonly lines: readonly Segment[];
  /** Pieces of an angular dimension's arc. */
  readonly arcs: readonly Arc[];
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

type Parts = Omit<DimLayout, 'value' | 'text'>;
type Block = { readonly runs: readonly TextRun[]; readonly width: number; readonly height: number };

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const RAD_TO_DEG = 180 / Math.PI;

/**
 * The sector an angular dimension measures: counter-clockwise from `start`
 * through `sweep` degrees, between the two arms, on the side where `at` is.
 */
export function angularSector(e: Extract<DimensionEntity, { type: 'angular' }>): { start: number; sweep: number } {
  const a1 = angleDeg(e.dir1);
  const a2 = angleDeg(e.dir2);
  const s = ccwDeg(a1, a2);
  return ccwDeg(a1, angleDeg(sub(e.at, e.vertex))) <= s ? { start: a1, sweep: s } : { start: a2, sweep: 360 - s };
}

/**
 * What a dimension reads: the distance along `dir` (linear), the true
 * length (aligned), the radius or twice it, or the angle in degrees.
 * Undefined for a leader, which measures nothing.
 */
export function measuredValue(e: DimensionEntity): number | undefined {
  switch (e.type) {
    case 'linear':
      return Math.abs(dot(sub(e.p2, e.p1), e.dir));
    case 'aligned':
      return len(sub(e.p2, e.p1));
    case 'radius':
      return e.radius;
    case 'diameter':
      return 2 * e.radius;
    case 'angular':
      return angularSector(e).sweep;
    case 'symmetric':
      return 2 * Math.abs(axisOffset(e));
    case 'ordinate':
      return Math.abs(e.axis === 'x' ? e.p1.x - e.origin.x : e.p1.y - e.origin.y);
    case 'leader':
      return undefined;
  }
}

/** How far `p1` is from a symmetric dimension's axis, positive to the axis's left. */
export function axisOffset(e: Extract<DimensionEntity, { type: 'symmetric' }>): number {
  return dot(sub(e.p1, e.axisBase), { x: -e.axisDir.y, y: e.axisDir.x });
}

/**
 * A symmetric dimension's line: `ax` where it crosses the axis (square to
 * it, level with `at`), `a1` at the feature's side, `a2` mirrored across.
 */
export function symmetricLine(e: Extract<DimensionEntity, { type: 'symmetric' }>): { ax: Vec2; a1: Vec2; a2: Vec2 } {
  const n = { x: -e.axisDir.y, y: e.axisDir.x };
  const ax = add(e.axisBase, e.axisDir, dot(sub(e.at, e.axisBase), e.axisDir));
  const h = axisOffset(e);
  return { ax, a1: add(ax, n, h), a2: add(ax, n, -h) };
}

/** Arrow with its tip at `tip`, pointing along the unit vector `d`; 3:1 long to wide. */
function arrow(tip: Vec2, d: Vec2, length: number): Triangle {
  const back = add(tip, d, -length);
  const side = { x: -d.y * (length / 6), y: d.x * (length / 6) };
  return [tip, add(back, side), add(back, side, -1)];
}

/**
 * The text as runs around (0, 0), with the block's width and height. One
 * line: main, inline tolerance, alternate units, a space apart. A stacked
 * tolerance (deviation or limits) is two lines at the same height, half a
 * line apart, centered on the main line.
 */
function textBlock(t: DimText, h: number): Block {
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

/** Half the length of a line along the unit vector `w` hidden by the text block and its gap. */
function halfChord(b: Block, gap: number, w: Vec2): number {
  const hw = b.width / 2 + gap;
  const hh = b.height / 2 + gap;
  return Math.min(Math.abs(w.x) > TOL ? hw / Math.abs(w.x) : Infinity, Math.abs(w.y) > TOL ? hh / Math.abs(w.y) : Infinity);
}

function fitFor(length: number, half: number, arrowLen: number): Fit {
  if (length >= 2 * half + 2 * arrowLen) return 'inside';
  if (length >= 2 * half) return 'arrowsOutside';
  return length >= 2 * arrowLen ? 'textOutside' : 'outside';
}

/** The block's runs and box with its center at `c`. */
function placeText(b: Block, c: Vec2): Pick<Parts, 'runs' | 'textBox'> {
  return {
    runs: b.runs.map((r) => ({ ...r, at: add(r.at, c) })),
    textBox: { minX: c.x - b.width / 2, maxX: c.x + b.width / 2, minY: c.y - b.height / 2, maxY: c.y + b.height / 2 },
  };
}

/** Adds the segment unless it has no length. */
function pieceTo(lines: Segment[]): (from: Vec2, to: Vec2) => void {
  return (from, to) => {
    if (len(sub(to, from)) > TOL) lines.push([from, to]);
  };
}

/** The format for `e`: its style, with this dimension's overrides on top. */
function formatFor(e: Exclude<DimensionEntity, { type: 'leader' }>, style: DimStyle, altFactor: number, diameter: boolean): DimFormat {
  const text = e.textOverride === undefined ? {} : { override: e.textOverride };
  if (e.type === 'angular') return { ...angleFormat(e.precision === undefined ? style : { ...style, anglePrecision: e.precision }), ...text };
  const own: DimStyle = {
    ...style,
    ...(e.precision !== undefined && { precision: e.precision, tolPrecision: e.precision }),
    ...(e.tolerance && { tolerance: e.tolerance }),
  };
  const f = { ...lengthFormat(own, altFactor), ...text };
  if (e.type === 'radius') return { ...f, prefix: `R${f.prefix ?? ''}` };
  if (e.type === 'diameter' || e.type === 'symmetric' || diameter) return { ...f, prefix: `Ø${f.prefix ?? ''}` };
  return f;
}

/**
 * Linear and aligned: the unit vector `u` the dimension measures along, the
 * normal `n` (u turned a quarter left), and where the dimension line
 * through `at` meets each extension line.
 */
export function dimLine(e: Extract<DimensionEntity, { type: 'linear' | 'aligned' }>): { u: Vec2; n: Vec2; a1: Vec2; a2: Vec2 } {
  let u = e.type === 'linear' ? e.dir : sub(e.p2, e.p1);
  if (e.type === 'aligned') u = len(u) > TOL ? { x: u.x / len(u), y: u.y / len(u) } : { x: 1, y: 0 };
  const n = { x: -u.y, y: u.x };
  return { u, n, a1: add(e.p1, n, dot(sub(e.at, e.p1), n)), a2: add(e.p2, n, dot(sub(e.at, e.p2), n)) };
}

/**
 * Linear and aligned: extension lines to a straight dimension line through
 * `at`. With `textAt` (the text moved by its grip) the text sits on the line
 * where `textAt` projects onto it, the line running out to reach it; the
 * arrows are inside unless the extension lines are closer than two arrows.
 */
function linearParts(e: Extract<DimensionEntity, { type: 'linear' | 'aligned' }>, style: DimStyle, block: Block): Parts {
  const { u, a1, a2 } = dimLine(e);

  const lines: Segment[] = [];
  for (const [p, a] of [[e.p1, a1], [e.p2, a2]] as const) {
    const off = sub(a, p);
    const dist = len(off);
    if (dist <= style.extOffset) continue; // the dimension line runs at the object: no room for an extension line
    const d = { x: off.x / dist, y: off.y / dist };
    lines.push([add(p, d, style.extOffset), add(a, d, style.extExtend)]);
  }

  const span = len(sub(a2, a1));
  const w = span > TOL ? { x: (a2.x - a1.x) / span, y: (a2.y - a1.y) / span } : u;
  const half = halfChord(block, style.textGap, w);
  const arrowLen = style.arrowSize;
  const piece = pieceTo(lines);
  if (e.textAt) {
    const t = dot(sub(e.textAt, a1), w);
    const arrowsIn = span >= 2 * arrowLen;
    const textIn = t - half >= -TOL && t + half <= span + TOL;
    let lo = Math.min(0, t - half);
    let hi = Math.max(span, t + half);
    if (!arrowsIn) {
      lo = Math.min(lo, -2 * arrowLen);
      hi = Math.max(hi, span + 2 * arrowLen);
    }
    piece(add(a1, w, lo), add(a1, w, t - half));
    piece(add(a1, w, t + half), add(a1, w, hi));
    const arrows = arrowsIn ? [arrow(a1, neg(w), arrowLen), arrow(a2, w, arrowLen)] : [arrow(a1, w, arrowLen), arrow(a2, neg(w), arrowLen)];
    const fit: Fit = arrowsIn ? (textIn ? 'inside' : 'textOutside') : textIn ? 'arrowsOutside' : 'outside';
    return { lines, arcs: [], arrows, fit, ...placeText(block, add(a1, w, t)) };
  }
  const fit = fitFor(span, half, arrowLen);
  const arrows: Triangle[] = [];
  if (fit === 'inside' || fit === 'textOutside') {
    arrows.push(arrow(a1, neg(w), arrowLen), arrow(a2, w, arrowLen));
  } else {
    arrows.push(arrow(a1, w, arrowLen), arrow(a2, neg(w), arrowLen));
    piece(add(a1, w, -2 * arrowLen), a1);
  }
  const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
  let center: Vec2;
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
  return { lines, arcs: [], arrows, fit, ...placeText(block, center) };
}

/**
 * Symmetric diameter. Full: as a linear dimension from the feature to its
 * mirror across the axis. Half: the feature's extension line and one arrow,
 * the dimension line running past the centerline by an arrow length; the
 * text halfway to the axis, or past the axis when it doesn't fit, or where
 * `textAt` puts it on the line.
 */
function symmetricParts(e: Extract<DimensionEntity, { type: 'symmetric' }>, style: DimStyle, block: Block): Parts {
  const { ax, a1, a2 } = symmetricLine(e);
  if (style.symmetric === 'full') {
    const mirror = add(e.p1, sub(a2, a1));
    const { axisBase: _b, axisDir: _d, ...rest } = e;
    return linearParts({ ...rest, type: 'linear', p2: mirror, dir: { x: -e.axisDir.y, y: e.axisDir.x } }, style, block);
  }
  const lines: Segment[] = [];
  const off = sub(a1, e.p1);
  const dist = len(off);
  if (dist > style.extOffset) {
    const d = { x: off.x / dist, y: off.y / dist };
    lines.push([add(e.p1, d, style.extOffset), add(a1, d, style.extExtend)]);
  }
  const span = len(sub(ax, a1));
  const w = span > TOL ? { x: (ax.x - a1.x) / span, y: (ax.y - a1.y) / span } : { x: -e.axisDir.y, y: e.axisDir.x };
  const half = halfChord(block, style.textGap, w);
  const arrowLen = style.arrowSize;
  const end = span + arrowLen; // past the centerline
  const fits = span >= 2 * half + arrowLen;
  const t = e.textAt ? dot(sub(e.textAt, a1), w) : fits ? span / 2 : end + half;
  const piece = pieceTo(lines);
  piece(add(a1, w, Math.min(0, t - half)), add(a1, w, t - half));
  piece(add(a1, w, t + half), add(a1, w, Math.max(end, t + half)));
  const fit: Fit = t - half >= -TOL && t + half <= span + TOL ? 'inside' : 'textOutside';
  return { lines, arcs: [], arrows: [arrow(a1, neg(w), arrowLen)], fit, ...placeText(block, add(a1, w, t)) };
}

/**
 * Ordinate: a leader from the feature (after the extension offset) square
 * to the measured axis, out to `at`; when `at` is off that line the leader
 * jogs across in its last two arrow lengths. No arrow. The text sits past
 * the leader's end, a text gap away.
 */
function ordinateParts(e: Extract<DimensionEntity, { type: 'ordinate' }>, style: DimStyle, block: Block): Parts {
  const along = e.axis === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const across = e.axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const k = dot(sub(e.at, e.p1), along);
  const dir = k < 0 ? neg(along) : along;
  const reach = Math.abs(k);
  const off = dot(sub(e.at, e.p1), across);
  const lines: Segment[] = [];
  const piece = pieceTo(lines);
  const start = add(e.p1, dir, Math.min(style.extOffset, reach));
  const end = add(add(e.p1, dir, reach), across, off);
  if (Math.abs(off) <= TOL) {
    piece(start, end);
  } else {
    const jog = 2 * style.arrowSize;
    const k1 = Math.max(Math.min(style.extOffset, reach), reach - 2 * jog);
    const k2 = Math.max(k1, reach - jog);
    const a = add(e.p1, dir, k1);
    const b = add(add(e.p1, dir, k2), across, off);
    piece(start, a);
    piece(a, b);
    piece(b, end);
  }
  const clear = style.textGap + (e.axis === 'x' ? block.height : block.width) / 2;
  return { lines, arcs: [], arrows: [], fit: 'inside', ...placeText(block, add(end, dir, clear)) };
}

/**
 * Radius and diameter. With `at` outside the circle: a leader from the
 * text's shoulder to the circle along the line through the center, its
 * arrow on the circle pointing at the center. Inside: the radius line from
 * the center (the whole diameter for a diameter), arrows on the circle
 * pointing out, the text on the line at `at`.
 */
function radialParts(e: Extract<DimensionEntity, { type: 'radius' | 'diameter' }>, style: DimStyle, block: Block): Parts {
  const c = e.center;
  const r = e.radius;
  const d = sub(e.at, c);
  const dist = len(d);
  const u = dist > TOL ? { x: d.x / dist, y: d.y / dist } : { x: 1, y: 0 };
  const tip = add(c, u, r);
  const a = style.arrowSize;
  const lines: Segment[] = [];
  const piece = pieceTo(lines);
  if (dist > r + TOL) {
    // Shoulder points away from the circle, to the right when the leader is vertical.
    const side = u.x >= 0 ? 1 : -1;
    const shoulder = { x: e.at.x + side * a, y: e.at.y };
    piece(tip, e.at);
    piece(e.at, shoulder);
    const center = { x: shoulder.x + side * (style.textGap + block.width / 2), y: e.at.y };
    return { lines, arcs: [], arrows: [arrow(tip, neg(u), a)], fit: 'outside', ...placeText(block, center) };
  }
  const far = e.type === 'diameter' ? add(c, u, -r) : c;
  const half = halfChord(block, style.textGap, u);
  const before = add(e.at, u, -half);
  const after = add(e.at, u, half);
  // Only the parts of the line clear of the text, running outward along u.
  if (dot(sub(before, far), u) > TOL) piece(far, before);
  if (dot(sub(tip, after), u) > TOL) piece(after, tip);
  const arrows = [arrow(tip, u, a), ...(e.type === 'diameter' ? [arrow(far, neg(u), a)] : [])];
  return { lines, arcs: [], arrows, fit: 'inside', ...placeText(block, e.at) };
}

/**
 * Leader: the arrow at the tip, pointing along the leader; a line from the
 * tip to the landing `at`; a horizontal shoulder one arrow long, pointing
 * away from the tip (to the right when the leader is vertical); the text
 * past it, centered on the shoulder.
 */
function leaderParts(e: Extract<DimensionEntity, { type: 'leader' }>, style: DimStyle, block: Block): Parts {
  const a = style.arrowSize;
  const d = sub(e.tip, e.at);
  const dist = len(d);
  const u = dist > TOL ? { x: d.x / dist, y: d.y / dist } : { x: -1, y: 0 };
  const side = e.at.x >= e.tip.x ? 1 : -1;
  const shoulder = { x: e.at.x + side * a, y: e.at.y };
  const lines: Segment[] = [];
  const piece = pieceTo(lines);
  piece(e.at, e.tip);
  piece(e.at, shoulder);
  const center = { x: shoulder.x + side * (style.textGap + block.width / 2), y: e.at.y };
  return { lines, arcs: [], arrows: [arrow(e.tip, u, a)], fit: 'outside', ...placeText(block, center) };
}

/** Angular: extension lines along the arms out to an arc through `at`, centered on the vertex. */
function angularParts(e: Extract<DimensionEntity, { type: 'angular' }>, style: DimStyle, block: Block): Parts {
  const v = e.vertex;
  const R = len(sub(e.at, v));
  const { start, sweep } = angularSector(e);
  const end = start + sweep;
  const lines: Segment[] = [];
  for (const [p, d] of [[e.p1, e.dir1], [e.p2, e.dir2]] as const) {
    const t = Math.max(0, dot(sub(p, v), d));
    if (R > t + style.extOffset) lines.push([add(v, d, t + style.extOffset), add(v, d, R + style.extExtend)]);
  }
  const at = (deg: number): Vec2 => {
    const [cs, sn] = cosSinDeg(deg);
    return { x: v.x + R * cs, y: v.y + R * sn };
  };
  const arcs: Arc[] = [];
  const arcPiece = (from: number, to: number): void => {
    if ((to - from) * (R / RAD_TO_DEG) > TOL) arcs.push({ center: v, radius: R, startDeg: normDeg(from), endDeg: normDeg(to) });
  };
  const p1 = at(start);
  const p2 = at(end);
  const t1 = ccwTangentAt(start);
  const t2 = ccwTangentAt(end);
  const a = style.arrowSize;
  const mid = start + sweep / 2;
  const half = halfChord(block, style.textGap, ccwTangentAt(mid));
  const fit = fitFor(R * (sweep / RAD_TO_DEG), half, a);
  const piece = pieceTo(lines);
  const arrows: Triangle[] = [];
  if (fit === 'inside' || fit === 'textOutside') {
    arrows.push(arrow(p1, neg(t1), a), arrow(p2, t2, a));
  } else {
    arrows.push(arrow(p1, t1, a), arrow(p2, neg(t2), a));
    piece(add(p1, t1, -2 * a), p1);
  }
  const halfOut = halfChord(block, style.textGap, t2);
  let center: Vec2;
  switch (fit) {
    case 'inside':
    case 'arrowsOutside': {
      center = at(mid);
      const gapDeg = (half / R) * RAD_TO_DEG;
      arcPiece(start, mid - gapDeg);
      arcPiece(mid + gapDeg, end);
      if (fit === 'arrowsOutside') piece(p2, add(p2, t2, 2 * a));
      break;
    }
    case 'textOutside':
      center = add(p2, t2, a + halfOut);
      arcPiece(start, end);
      piece(p2, add(p2, t2, a));
      break;
    case 'outside':
      center = add(p2, t2, 2 * a + halfOut);
      arcPiece(start, end);
      piece(p2, add(p2, t2, 2 * a));
      break;
  }
  return { lines, arcs, arrows, fit, ...placeText(block, center) };
}

/** The layout of `e` drawn with `style`; `altFactor` converts to the alternate unit. */
export function layoutDimension(e: DimensionEntity, style: DimStyle, altFactor: number, diameter = false): DimLayout {
  if (e.type === 'leader') {
    const text = { main: e.text };
    return { text, ...leaderParts(e, style, textBlock(text, style.textHeight)) };
  }
  const value = measuredValue(e)! * (diameter && e.type === 'ordinate' ? 2 : 1);
  const text = formatDimension(value, formatFor(e, style, altFactor, diameter));
  const block = textBlock(text, style.textHeight);
  switch (e.type) {
    case 'linear':
    case 'aligned':
      return { value, text, ...linearParts(e, style, block) };
    case 'radius':
    case 'diameter':
      return { value, text, ...radialParts(e, style, block) };
    case 'angular':
      return { value, text, ...angularParts(e, style, block) };
    case 'symmetric':
      return { value, text, ...symmetricParts(e, style, block) };
    case 'ordinate':
      return { value, text, ...ordinateParts(e, style, block) };
  }
}

/**
 * True for a dimension that reads a diameter in lathe view with Ø on: a
 * linear one square to the centerline (Y = 0) and measured from one side
 * of it to the other (spec, "Symmetric diameter"), or an X (radial)
 * ordinate, which then shows twice its distance (spec, "Ordinate").
 */
export function readsDiameter(d: Drawing, e: DimensionEntity): boolean {
  if (!d.lathe || !d.diameterMode) return false;
  if (e.type === 'ordinate') return e.axis === 'y';
  if (e.type !== 'linear' || Math.abs(e.dir.x) > TOL) return false;
  return (e.p1.y > TOL && e.p2.y < -TOL) || (e.p1.y < -TOL && e.p2.y > TOL);
}

/** `e` laid out with its style in `d`, sized for the drawing's sheet scale. */
export function dimensionLayout(d: Drawing, e: DimensionEntity): DimLayout {
  return layoutDimension(e, atSheetScale(dimStyleOf(d, e.dimStyle), d.sheetScale), altUnitFactor(d.units), readsDiameter(d, e));
}

export function layoutBBox(l: DimLayout): BBox {
  return [...l.arcs.map(arcBBox), l.textBox].reduce(union, fromPoints([...l.lines.flat(), ...l.arrows.flat()]));
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
  for (const arc of l.arcs) best = Math.min(best, distanceToArc(p, arc));
  return best;
}

/** True when any drawn piece, or the text, touches `box` (crossing selection). */
export function layoutTouchesBox(l: DimLayout, box: BBox): boolean {
  const t = l.textBox;
  if (t.minX <= box.maxX && t.maxX >= box.minX && t.minY <= box.maxY && t.maxY >= box.minY) return true;
  if (l.arcs.some((arc) => curveTouchesBox({ kind: 'arc', ...arc }, box))) return true;
  return [...l.lines, ...l.arrows.flatMap(edges)].some(([a, b]) => curveTouchesBox({ kind: 'segment', a, b }, box));
}
