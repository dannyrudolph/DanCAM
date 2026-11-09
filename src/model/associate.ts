import { cosSinDeg } from '../geometry/angle';
import { arcEnd, arcStart } from '../geometry/arc';
import { lineLine } from '../geometry/intersect';
import { TOL, nearlyEqual } from '../geometry/tolerance';
import { type Vec2, add, cross, distance, dot, sub, vecNearlyEqual } from '../geometry/vec';
import { type Anchor, type DimAnchorKey, type DimAnchors, anchorIds, anchorPoint, dimAnchorIds, withoutAnchors } from './anchor';
import type { Drawing } from './drawing';
import { type ArcEntity, type DimensionEntity, type EntityId, type LineEntity, dimensionPoints } from './entity';
import type { Change } from './undo';

/**
 * Associative dimensions (spec, "Dimensioning"): after any change
 * to the drawing, the dimensions anchored to the geometry it touched are
 * measured again, as changes in the same transaction, so one undo restores
 * the geometry and its dimensions together.
 *
 * - Geometry changed: its dimensions re-measure. When both measured points
 *   move by the same amount (a Move), the dimension line and text move with
 *   them; otherwise they stay where they were put.
 * - Geometry deleted, or no longer the kind of thing measured (a line that
 *   is no longer two lines' worth of angle): its dimensions are deleted.
 * - A feature that is gone (an arc trimmed past an anchored quadrant):
 *   that point stays where it was, unanchored.
 * - A dimension changed itself (dragged by a grip, edited in the
 *   properties panel, moved without its geometry): anchors that no longer
 *   match where it measures are dropped.
 */

type Arms = Pick<Extract<DimensionEntity, { type: 'angular' }>, 'vertex' | 'p1' | 'p2' | 'dir1' | 'dir2'>;

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};

/**
 * The angle between two lines, in the quadrant where `at` is: each arm runs
 * from the lines' crossing along the line, toward `at`'s side. An arm's
 * extension line starts at the end of its line farthest along it, or at the
 * crossing when the line doesn't reach that side. Undefined for parallel lines.
 */
export function angleBetweenLines(l1: LineEntity, l2: LineEntity, at: Vec2): Arms | undefined {
  const d1 = unit(sub(l1.end, l1.start));
  const d2 = unit(sub(l2.end, l2.start));
  const vertex = lineLine(l1.start, d1, l2.start, d2);
  if (!vertex) return undefined;
  // at - vertex = α d1 + β d2: the signs pick the quadrant.
  const w = sub(at, vertex);
  const den = cross(d1, d2);
  const s1 = cross(w, d2) / den >= 0 ? 1 : -1;
  const s2 = cross(d1, w) / den >= 0 ? 1 : -1;
  const dir1 = { x: d1.x * s1 || 0, y: d1.y * s1 || 0 };
  const dir2 = { x: d2.x * s2 || 0, y: d2.y * s2 || 0 };
  const armStart = (l: LineEntity, d: Vec2): Vec2 => {
    const [a, b] = [l.start, l.end].map((p) => ({ p, t: dot(sub(p, vertex), d) })) as [{ p: Vec2; t: number }, { p: Vec2; t: number }];
    const far = a.t >= b.t ? a : b;
    return far.t > TOL ? far.p : vertex;
  };
  return { vertex, p1: armStart(l1, dir1), p2: armStart(l2, dir2), dir1, dir2 };
}

/** An arc's included angle, as an angular dimension measures it. */
export function arcArms(a: ArcEntity): Arms {
  const [c1, s1] = cosSinDeg(a.startDeg);
  const [c2, s2] = cosSinDeg(a.endDeg);
  return { vertex: a.center, p1: arcStart(a), p2: arcEnd(a), dir1: { x: c1, y: s1 }, dir2: { x: c2, y: s2 } };
}

/** The dimension's placement (`at`, `textAt`) moved by `v`. */
function shifted<E extends DimensionEntity>(e: E, v: Vec2): E {
  return { ...e, at: add(e.at, v), ...(e.textAt && { textAt: add(e.textAt, v) }) };
}

const GONE = Symbol('gone');

/**
 * Where a point anchor puts its point now: the point and the anchor to
 * keep (none when the feature is gone), or GONE when its entity was deleted.
 */
function follow(d: Drawing, a: Anchor | undefined, was: Vec2): { at: Vec2; anchor?: Anchor } | typeof GONE {
  if (!a) return { at: was };
  if (anchorIds(a).some((id) => !isGeometry(d, id))) return GONE;
  const at = anchorPoint(d, a, was);
  return at ? { at, anchor: a } : { at: was };
}

const isGeometry = (d: Drawing, id: EntityId): boolean => {
  const e = d.entities.get(id);
  return e !== undefined && e.kind !== 'dimension';
};

/** The anchors with `key` set, or removed when `a` is undefined. */
function setAnchor(anchors: DimAnchors, key: 'p1' | 'p2' | 'vertex', a: Anchor | undefined): DimAnchors {
  const { [key]: _old, ...rest } = anchors;
  return a ? { ...rest, [key]: a } : rest;
}

/** `e` with `anchors`, or with none when it's empty. */
function withAnchors(e: DimensionEntity, anchors: DimAnchors): DimensionEntity {
  const { anchors: _old, ...rest } = e;
  return (Object.keys(anchors).length === 0 ? rest : { ...rest, anchors }) as DimensionEntity;
}

/** The dimension measured again from its anchors; undefined when the geometry it measures is lost. */
export function remeasure(d: Drawing, e: DimensionEntity): DimensionEntity | undefined {
  const anchors = e.anchors;
  if (!anchors) return e;
  switch (e.type) {
    case 'linear':
    case 'aligned': {
      const r1 = follow(d, anchors.p1, e.p1);
      const r2 = follow(d, anchors.p2, e.p2);
      if (r1 === GONE || r2 === GONE || vecNearlyEqual(r1.at, r2.at)) return undefined;
      const m1 = sub(r1.at, e.p1);
      const m2 = sub(r2.at, e.p2);
      const moved = vecNearlyEqual(m1, m2) ? shifted(e, m1) : e;
      return withAnchors({ ...moved, p1: r1.at, p2: r2.at }, setAnchor(setAnchor(anchors, 'p1', r1.anchor), 'p2', r2.anchor));
    }
    case 'radius':
    case 'diameter': {
      if (anchors.curve === undefined) return e;
      const c = d.entities.get(anchors.curve);
      if (c?.kind !== 'arc' && c?.kind !== 'circle') return undefined;
      return { ...shifted(e, sub(c.center, e.center)), center: c.center, radius: c.radius };
    }
    case 'angular': {
      if (anchors.lines) {
        const [l1, l2] = anchors.lines.map((id) => d.entities.get(id));
        if (l1?.kind !== 'line' || l2?.kind !== 'line') return undefined;
        const first = angleBetweenLines(l1, l2, e.at);
        if (!first) return undefined;
        const moved = shifted(e, sub(first.vertex, e.vertex));
        return { ...moved, ...angleBetweenLines(l1, l2, moved.at)! };
      }
      if (anchors.curve !== undefined) {
        const a = d.entities.get(anchors.curve);
        if (a?.kind !== 'arc') return undefined;
        return { ...shifted(e, sub(a.center, e.vertex)), ...arcArms(a) };
      }
      const rv = follow(d, anchors.vertex, e.vertex);
      const r1 = follow(d, anchors.p1, e.p1);
      const r2 = follow(d, anchors.p2, e.p2);
      if (rv === GONE || r1 === GONE || r2 === GONE) return undefined;
      if (distance(r1.at, rv.at) <= TOL || distance(r2.at, rv.at) <= TOL) return undefined;
      const dir1 = unit(sub(r1.at, rv.at));
      const dir2 = unit(sub(r2.at, rv.at));
      if (vecNearlyEqual(dir1, dir2)) return undefined;
      let next = setAnchor(anchors, 'vertex', rv.anchor);
      next = setAnchor(setAnchor(next, 'p1', r1.anchor), 'p2', r2.anchor);
      return withAnchors({ ...shifted(e, sub(rv.at, e.vertex)), vertex: rv.at, p1: r1.at, p2: r2.at, dir1, dir2 }, next);
    }
    case 'leader':
      return e;
  }
}

/** True when `a` and `b` measure the same thing from the same place. */
function sameMeasure(a: DimensionEntity, b: DimensionEntity): boolean {
  const pa = dimensionPoints(a);
  const pb = dimensionPoints(b);
  if (pa.length !== pb.length || pa.some((p, i) => !vecNearlyEqual(p, pb[i]!))) return false;
  if ((a.type === 'radius' || a.type === 'diameter') && (b.type === 'radius' || b.type === 'diameter')) return nearlyEqual(a.radius, b.radius);
  if (a.type === 'angular' && b.type === 'angular') return vecNearlyEqual(a.dir1, b.dir1) && vecNearlyEqual(a.dir2, b.dir2);
  return true;
}

const KEYS: readonly DimAnchorKey[] = ['p1', 'p2', 'vertex', 'curve', 'lines'];

/** The dimension without the anchors that no longer measure it where it is. */
export function keepMatching(d: Drawing, e: DimensionEntity): DimensionEntity {
  const anchors = e.anchors;
  if (!anchors) return e;
  const stale = KEYS.filter((k) => {
    if (anchors[k] === undefined) return false;
    const alone = remeasure(d, { ...e, anchors: { [k]: anchors[k] } as DimAnchors });
    return !alone || !sameMeasure(alone, e) || dimAnchorIds(alone.anchors ?? {}, k).length === 0;
  });
  return stale.length === 0 ? e : withoutAnchors(e, stale);
}

/** True when one of `e`'s anchors needs an entity in `ids`. */
function dependsOn(e: DimensionEntity, ids: ReadonlySet<EntityId>): boolean {
  const anchors = e.anchors;
  return anchors !== undefined && KEYS.some((k) => dimAnchorIds(anchors, k).some((id) => ids.has(id)));
}

/**
 * The changes that keep dimensions on their geometry after `changes` have
 * been applied to `d`: modify for a re-measured dimension (or one whose
 * stale anchors are dropped), remove for one whose geometry is lost.
 */
export function dimensionFollowUp(d: Drawing, changes: readonly Change[]): Change[] {
  const geometry = new Set<EntityId>();
  const dimensions = new Set<EntityId>();
  for (const c of changes) {
    const e = c.op === 'add' || c.op === 'remove' ? c.entity : c.op === 'modify' ? c.after : undefined;
    if (!e) continue;
    if (e.kind !== 'dimension') geometry.add(e.id);
    else if (c.op !== 'remove') dimensions.add(e.id);
  }
  if (geometry.size === 0 && dimensions.size === 0) return [];
  const out: Change[] = [];
  for (const e of d.entities.values()) {
    if (e.kind !== 'dimension' || !e.anchors) continue;
    const next = dimensions.has(e.id) ? keepMatching(d, e) : dependsOn(e, geometry) ? remeasure(d, e) : e;
    if (next === e) continue;
    if (next === undefined) out.push({ op: 'remove', entity: e });
    else if (!sameMeasure(next, e) || JSON.stringify(next.anchors) !== JSON.stringify(e.anchors)) out.push({ op: 'modify', before: e, after: next });
  }
  return out;
}
