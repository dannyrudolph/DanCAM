import { TOL } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';
import { dimensionLayout } from './dimLayout';
import { dimStyleOf } from './dimStyle';
import type { Drawing } from './drawing';
import type { DimensionEntity, EntityId } from './entity';

/**
 * Ordinates laid out as a set (spec, "Ordinate"): leader ends on a common
 * baseline, texts kept clear of each other by jogging, and Align Ordinates
 * to restack a set. Pure; text sizes come from `dimLayout`.
 *
 * For an X ordinate (vertical leader) the baseline is a height and texts
 * sit side by side along X; for a Y ordinate (horizontal leader) the
 * baseline is an X position and texts stack along Y.
 */

type Ordinate = Extract<DimensionEntity, { type: 'ordinate' }>;

/** The coordinate along the baseline (where texts sit side by side) and the one across it (the baseline's level). */
const along = (o: Ordinate): 'x' | 'y' => o.axis;
const level = (o: Ordinate): 'x' | 'y' => (o.axis === 'x' ? 'y' : 'x');

const withAt = (o: Ordinate, k: 'x' | 'y', value: number): Ordinate => ({ ...o, at: { ...o.at, [k]: value } as Vec2 });

/** Which way the leader runs from the feature: +1 or -1 along the level coordinate. */
const side = (o: Ordinate): number => (o.at[level(o)] - o.p1[level(o)] < 0 ? -1 : 1);

/** The text's size along the baseline, and the gap kept between texts. */
function extent(d: Drawing, o: Ordinate): { size: number; gap: number } {
  const b = dimensionLayout(d, o).textBox;
  const gap = dimStyleOf(d, o.dimStyle).textGap / d.sheetScale;
  return { size: o.axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY, gap };
}

/** The drawing's other ordinates that share `o`'s axis and leader direction. */
function neighbors(d: Drawing, o: Ordinate): Ordinate[] {
  const out: Ordinate[] = [];
  for (const e of d.entities.values()) {
    if (e.kind === 'dimension' && e.type === 'ordinate' && e.id !== o.id && e.axis === o.axis && side(e) === side(o)) out.push(e);
  }
  return out;
}

/**
 * `o` with its leader end moved level with the nearest neighbor's when it
 * is within two text heights of it: the common baseline.
 */
export function onCommonBaseline(d: Drawing, o: Ordinate): Ordinate {
  const k = level(o);
  const reach = (2 * dimStyleOf(d, o.dimStyle).textHeight) / d.sheetScale;
  let best: number | undefined;
  for (const n of neighbors(d, o)) {
    const gap = Math.abs(n.at[k] - o.at[k]);
    if (gap <= reach && (best === undefined || gap < Math.abs(best - o.at[k]))) best = n.at[k];
  }
  return best === undefined ? o : withAt(o, k, best);
}

/**
 * `o` with its text moved along the baseline to the nearest place clear of
 * its neighbors' texts on the same baseline (a text gap apart); the leader
 * then jogs to it. Unchanged when it is already clear.
 */
export function clearOfNeighbors(d: Drawing, o: Ordinate): Ordinate {
  const k = along(o);
  const lv = level(o);
  const me = extent(d, o);
  const blocked: [number, number][] = [];
  for (const n of neighbors(d, o)) {
    if (Math.abs(n.at[lv] - o.at[lv]) > TOL) continue;
    const them = extent(d, n);
    const reach = (me.size + them.size) / 2 + Math.max(me.gap, them.gap);
    blocked.push([n.at[k] - reach, n.at[k] + reach]);
  }
  const want = o.at[k];
  const free = (c: number): boolean => blocked.every(([lo, hi]) => c <= lo + TOL || c >= hi - TOL);
  if (free(want)) return o;
  let best: number | undefined;
  for (const c of blocked.flat()) if (free(c) && (best === undefined || Math.abs(c - want) < Math.abs(best - want))) best = c;
  return best === undefined ? o : withAt(o, k, best);
}

/** Where a new or dragged ordinate's text goes: on a common baseline, clear of its neighbors. */
export function placeOrdinate(d: Drawing, o: Ordinate): Ordinate {
  return clearOfNeighbors(d, onCommonBaseline(d, o));
}

/**
 * Align Ordinates: each ordinate's leader end on the level through `at`
 * (its height for X ordinates, its X position for Y ordinates), and the
 * texts of each set packed in order of their features, a text gap apart,
 * as near their features as they can be.
 */
export function alignOrdinates(d: Drawing, os: readonly Ordinate[], at: Vec2): Map<EntityId, Ordinate> {
  const out = new Map<EntityId, Ordinate>();
  for (const axis of ['x', 'y'] as const) {
    const set = os.filter((o) => o.axis === axis).map((o) => withAt(o, level(o), at[level(o)]));
    if (set.length === 0) continue;
    const k = axis;
    set.sort((a, b) => a.p1[k] - b.p1[k]);
    const sizes = set.map((o) => extent(d, o));
    // Packed left to right from each feature, then the whole row shifted to sit as near the features as it can on average.
    const pos: number[] = [];
    set.forEach((o, i) => {
      const prev = i === 0 ? undefined : pos[i - 1]! + (sizes[i - 1]!.size + sizes[i]!.size) / 2 + Math.max(sizes[i - 1]!.gap, sizes[i]!.gap);
      pos.push(prev === undefined ? o.p1[k] : Math.max(o.p1[k], prev));
    });
    const shift = pos.reduce((s, p, i) => s + (set[i]!.p1[k] - p), 0) / pos.length;
    set.forEach((o, i) => out.set(o.id, withAt(o, k, pos[i]! + shift)));
  }
  return out;
}
