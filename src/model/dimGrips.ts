import { cosSinDeg } from '../geometry/angle';
import { type Vec2, distance, vecNearlyEqual } from '../geometry/vec';
import { angularSector, dimLine, dimensionLayout } from './dimLayout';
import { dimStyleOf } from './dimStyle';
import type { Drawing } from './drawing';
import type { DimensionEntity } from './entity';
import type { Grip } from './grips';

/**
 * Grips on a selected dimension (spec, "Dimension styles": text and
 * dimension-line position are dragged by grips and snap to sensible
 * offsets). By type:
 * - linear, aligned: `p1`, `p2` move a measured point (the dimension then
 *   measures to the new point and drops its geometry refs); `line1`,
 *   `line2` at the dimension line's ends move the line; `text` moves the
 *   text along the line, and the line with it.
 * - radius, diameter: `text` moves the text (and its leader).
 * - angular: `arc`, on the dimension arc, sets its radius and side.
 * - leader: `tip` moves the arrow point, `text` the landing.
 */

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export function dimensionGrips(d: Drawing, e: DimensionEntity): Grip[] {
  switch (e.type) {
    case 'linear':
    case 'aligned': {
      const { a1, a2 } = dimLine(e);
      const t = dimensionLayout(d, e).textBox;
      return [
        { key: 'p1', at: e.p1 },
        { key: 'p2', at: e.p2 },
        { key: 'line1', at: a1 },
        { key: 'line2', at: a2 },
        { key: 'text', at: mid({ x: t.minX, y: t.minY }, { x: t.maxX, y: t.maxY }) },
      ];
    }
    case 'radius':
    case 'diameter':
      return [{ key: 'text', at: e.at }];
    case 'angular': {
      const { start, sweep } = angularSector(e);
      const [c, s] = cosSinDeg(start + sweep / 2);
      const r = distance(e.at, e.vertex);
      return [{ key: 'arc', at: { x: e.vertex.x + r * c, y: e.vertex.y + r * s } }];
    }
    case 'leader':
      return [
        { key: 'tip', at: e.tip },
        { key: 'text', at: e.at },
      ];
  }
}

/** First dimension line from the part, then the spacing between lines, in sheet units (ASME Y14.5: 10 and 6 mm). */
const SPACING = { in: { first: 0.375, step: 0.25 }, mm: { first: 10, step: 6 } } as const;

/**
 * `at` moved along the dimension's normal so the line's clearance from the
 * nearer measured point lands on a standard spacing (the first line .375"
 * or 10 mm out, then every .25" or 6 mm, as printed at the sheet scale)
 * when it is within half a text height of one. A line between the
 * measured points isn't snapped.
 */
export function snapLineOffset(d: Drawing, e: Extract<DimensionEntity, { type: 'linear' | 'aligned' }>, at: Vec2): Vec2 {
  const { n } = dimLine(e);
  const o1 = dot(sub(at, e.p1), n);
  const o2 = dot(sub(at, e.p2), n);
  if (o1 * o2 <= 0) return at;
  const sign = o1 > 0 ? 1 : -1;
  const clearance = Math.min(Math.abs(o1), Math.abs(o2));
  const k = 1 / d.sheetScale;
  const { first, step } = SPACING[d.units];
  const i = Math.max(0, Math.round((clearance / k - first) / step));
  const target = (first + i * step) * k;
  if (Math.abs(clearance - target) > (dimStyleOf(d, e.dimStyle).textHeight * k) / 2) return at;
  return add(at, n, sign * (target - clearance));
}

/** The dimension after dragging grip `key` to `to`; undefined when that would leave nothing to show. */
export function applyDimensionGrip(d: Drawing, e: DimensionEntity, key: string, to: Vec2): DimensionEntity | undefined {
  switch (e.type) {
    case 'linear':
    case 'aligned': {
      if (key === 'p1' || key === 'p2') {
        const other = key === 'p1' ? e.p2 : e.p1;
        if (vecNearlyEqual(to, other)) return undefined;
        const { refs: _refs, ...rest } = e; // no longer on the geometry it measured
        return { ...rest, [key]: to };
      }
      if (key === 'line1' || key === 'line2') return { ...e, at: snapLineOffset(d, e, to) };
      if (key === 'text') {
        const at = snapLineOffset(d, e, to);
        const { textAt: _old, ...rest } = e;
        // Back to centered when dropped near the middle (within half a text height).
        const { a1, a2, u } = dimLine({ ...e, at });
        const centered = Math.abs(dot(sub(to, mid(a1, a2)), u)) <= (dimStyleOf(d, e.dimStyle).textHeight / d.sheetScale) / 2;
        return centered ? { ...rest, at } : { ...rest, at, textAt: to };
      }
      return undefined;
    }
    case 'radius':
    case 'diameter':
      return key === 'text' && !vecNearlyEqual(to, e.center) ? { ...e, at: to } : undefined;
    case 'angular':
      return key === 'arc' && !vecNearlyEqual(to, e.vertex) ? { ...e, at: to } : undefined;
    case 'leader':
      if (key === 'tip') return vecNearlyEqual(to, e.at) ? undefined : { ...e, tip: to };
      if (key === 'text') return vecNearlyEqual(to, e.tip) ? undefined : { ...e, at: to };
      return undefined;
  }
}
