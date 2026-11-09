import { arcContainsDeg, arcEnd, arcMid, arcStart } from '../geometry/arc';
import { pointAtDeg } from '../geometry/circle';
import { intersectCurves } from '../geometry/curve';
import { type Vec2, distance, vecNearlyEqual } from '../geometry/vec';
import { refEntityId, resolveGeometry } from './block';
import { type Drawing, newEntityId } from './drawing';
import { type DimensionEntity, type Entity, type EntityId, entityCurve } from './entity';

/**
 * Where a dimension's measured point sits on the geometry: a feature of
 * one entity, found again after the entity changes (spec, "Associative
 * dimensions"). A line's ends are `start` and `end`, a ray's base is
 * `start`, a point entity is `node`; `quad` is the circle or arc point at
 * `deg` (0, 90, 180, 270); `int` is where the entity crosses `other`.
 */
export type Anchor =
  | { readonly id: EntityId; readonly feature: 'start' | 'end' | 'mid' | 'center' | 'node' }
  | { readonly id: EntityId; readonly feature: 'quad'; readonly deg: number }
  | { readonly id: EntityId; readonly feature: 'int'; readonly other: EntityId };

/**
 * What a dimension measures, so it follows the geometry. Point anchors for
 * the points it measures (`p1`, `p2`; `vertex` too for an angle by three
 * points); `curve` for a radius, diameter or arc angle (the arc or circle
 * itself); `lines` for the angle between two lines; `axis` for the
 * centerline of a symmetric diameter.
 */
export type DimAnchors = {
  readonly p1?: Anchor;
  readonly p2?: Anchor;
  readonly vertex?: Anchor;
  readonly curve?: EntityId;
  readonly lines?: readonly [EntityId, EntityId];
  /** A symmetric diameter's centerline: a line, ray or xline (none: the lathe axis, fixed). */
  readonly axis?: EntityId;
};

export type DimAnchorKey = keyof DimAnchors;

/** The entities an anchor needs. */
export function anchorIds(a: Anchor): EntityId[] {
  return a.feature === 'int' ? [a.id, a.other] : [a.id];
}

/** The entities a dimension's anchors need, by anchor. */
export function dimAnchorIds(a: DimAnchors, key: DimAnchorKey): EntityId[] {
  if (key === 'curve') return a.curve === undefined ? [] : [a.curve];
  if (key === 'lines') return a.lines ? [...a.lines] : [];
  if (key === 'axis') return a.axis === undefined ? [] : [a.axis];
  const p = a[key];
  return p ? anchorIds(p) : [];
}

/** Plain geometry, or a part of a block instance by its path (`block.resolveGeometry`). */
const geometry = resolveGeometry;

/**
 * Where the anchor is now, or undefined when its entity no longer has that
 * feature (an arc trimmed past the quadrant, lines that no longer cross).
 * Of several crossings, the one nearest `near` (the point as last measured).
 */
export function anchorPoint(d: Drawing, a: Anchor, near: Vec2): Vec2 | undefined {
  const e = geometry(d, a.id);
  if (!e) return undefined;
  if (e.kind === 'point') return a.feature === 'node' ? e.at : undefined;
  const c = entityCurve(e)!;
  switch (a.feature) {
    case 'node':
      return undefined;
    case 'start':
      return c.kind === 'segment' ? c.a : c.kind === 'arc' ? arcStart(c) : c.kind === 'ray' ? c.base : undefined;
    case 'end':
      return c.kind === 'segment' ? c.b : c.kind === 'arc' ? arcEnd(c) : undefined;
    case 'mid':
      return c.kind === 'segment' ? { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 } : c.kind === 'arc' ? arcMid(c) : undefined;
    case 'center':
      return c.kind === 'circle' || c.kind === 'arc' ? c.center : undefined;
    case 'quad':
      return c.kind === 'circle' || (c.kind === 'arc' && arcContainsDeg(c, a.deg)) ? pointAtDeg(c.center, c.radius, a.deg) : undefined;
    case 'int': {
      const o = geometry(d, a.other);
      const oc = o && entityCurve(o);
      if (!oc) return undefined;
      let best: Vec2 | undefined;
      for (const p of intersectCurves(c, oc)) if (!best || distance(p, near) < distance(best, near)) best = p;
      return best;
    }
  }
}

const QUADS = [0, 90, 180, 270] as const;

/** A feature of `id` at `p`, if it has one there (ends before midpoints before centers). */
export function featureAt(d: Drawing, id: EntityId, p: Vec2): Anchor | undefined {
  const candidates: Anchor[] = [
    ...(['start', 'end', 'mid', 'center', 'node'] as const).map((feature) => ({ id, feature })),
    ...QUADS.map((deg) => ({ id, feature: 'quad' as const, deg })),
  ];
  return candidates.find((a) => {
    const at = anchorPoint(d, a, p);
    return at !== undefined && vecNearlyEqual(at, p);
  });
}

/**
 * Anchors for a dimension saved before associativity, from the geometry it
 * named (`refs`, file version 2): two lines give an angle's lines, an arc
 * or circle a radius, diameter or arc angle; otherwise each measured point
 * that sits on a feature of a named entity is anchored there. Anything that
 * no longer matches is left unanchored.
 */
export function anchorsFromRefs(d: Drawing, e: DimensionEntity, refs: readonly EntityId[]): DimAnchors | undefined {
  const kinds = refs.map((id) => geometry(d, id)?.kind);
  if (e.type === 'radius' || e.type === 'diameter') {
    return refs.length === 1 && (kinds[0] === 'arc' || kinds[0] === 'circle') ? { curve: refs[0]! } : undefined;
  }
  if (e.type === 'angular' && refs.length === 2 && kinds.every((k) => k === 'line')) return { lines: [refs[0]!, refs[1]!] };
  if (e.type === 'angular' && refs.length === 1 && kinds[0] === 'arc') return { curve: refs[0]! };
  if (e.type !== 'linear' && e.type !== 'aligned') return undefined;
  const on = (p: Vec2): Anchor | undefined => refs.map((id) => featureAt(d, id, p)).find((a) => a !== undefined);
  const p1 = on(e.p1);
  const p2 = on(e.p2);
  return p1 || p2 ? { ...(p1 && { p1 }), ...(p2 && { p2 }) } : undefined;
}

/**
 * A copied dimension's anchors moved onto the copied geometry: ids in `map`
 * (original → copy) are replaced. Anchors on geometry that wasn't copied stay,
 * and are dropped when the copy no longer sits on it.
 */
export function remapAnchors(e: Entity, map: ReadonlyMap<EntityId, EntityId>): Entity {
  if (e.kind !== 'dimension' || !e.anchors) return e;
  // A part's path follows its instance: e5/b2 copied with e5 → e9 is e9/b2.
  const id = (x: EntityId): EntityId => {
    const head = refEntityId(x);
    const to = map.get(head);
    return to === undefined ? x : to + x.slice(head.length);
  };
  const point = (a: Anchor | undefined): Anchor | undefined => a && (a.feature === 'int' ? { ...a, id: id(a.id), other: id(a.other) } : { ...a, id: id(a.id) });
  const a = e.anchors;
  const p1 = point(a.p1);
  const p2 = point(a.p2);
  const vertex = point(a.vertex);
  const anchors: DimAnchors = {
    ...(p1 && { p1 }),
    ...(p2 && { p2 }),
    ...(vertex && { vertex }),
    ...(a.curve !== undefined && { curve: id(a.curve) }),
    ...(a.lines && { lines: [id(a.lines[0]), id(a.lines[1])] as const }),
    ...(a.axis !== undefined && { axis: id(a.axis) }),
  };
  return { ...e, anchors };
}

/**
 * Copies of `es` (already moved into place) with new ids; a dimension copied
 * with the geometry it measures is anchored to the copied geometry.
 */
export function withNewIds(d: Drawing, es: readonly Entity[]): Entity[] {
  const map = new Map<EntityId, EntityId>();
  const renamed = es.map((e) => {
    const id = newEntityId(d);
    map.set(e.id, id);
    return { ...e, id };
  });
  return renamed.map((e) => remapAnchors(e, map));
}

/** The dimension without the anchors named (all of them when they were the last). */
export function withoutAnchors(e: DimensionEntity, keys: readonly DimAnchorKey[]): DimensionEntity {
  if (!e.anchors) return e;
  const rest: Record<string, unknown> = { ...e.anchors };
  for (const k of keys) delete rest[k];
  const { anchors: _old, ...dim } = e;
  return (Object.keys(rest).length === 0 ? dim : { ...dim, anchors: rest as DimAnchors }) as DimensionEntity;
}
