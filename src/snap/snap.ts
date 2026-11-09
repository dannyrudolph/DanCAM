import { arcContainsDeg, arcEnd, arcMid, arcStart } from '../geometry/arc';
import { pointAtDeg } from '../geometry/circle';
import { type Curve, type Deferred, intersectCurves, nearestOnCurve, perpendicularFeet, tangentPointsFrom } from '../geometry/curve';
import { TOL } from '../geometry/tolerance';
import { type Vec2, distance } from '../geometry/vec';
import type { Anchor } from '../model/anchor';
import { drawnGeometry } from '../model/block';
import type { Drawing } from '../model/drawing';
import { type EntityId, entityCurve } from '../model/entity';
import { distanceToEntity } from '../model/pick';

export type SnapKind = 'end' | 'mid' | 'cen' | 'quad' | 'int' | 'perp' | 'tan' | 'nea' | 'node';

/** Menu order; also breaks ties between snaps at the same point (Endpoint before Intersection, …). */
export const SNAP_KINDS: readonly SnapKind[] = ['end', 'mid', 'cen', 'quad', 'int', 'perp', 'tan', 'nea', 'node'];

export const SNAP_LABEL: Readonly<Record<SnapKind, string>> = {
  end: 'Endpoint',
  mid: 'Midpoint',
  cen: 'Center',
  quad: 'Quadrant',
  int: 'Intersection',
  perp: 'Perpendicular',
  tan: 'Tangent',
  nea: 'Nearest',
  node: 'Node',
};

/** Running snaps in a new session. Perpendicular, Tangent and Nearest are opt-in. */
export const DEFAULT_SNAP_KINDS: readonly SnapKind[] = ['end', 'mid', 'cen', 'quad', 'int', 'node'];

/** Snaps that need the step's base point (the line is drawn from it), unless the step takes a deferred pick. */
export const NEEDS_BASE: ReadonlySet<SnapKind> = new Set<SnapKind>(['perp', 'tan']);

/** `deferred`: a Tangent or Perpendicular picked with no base point yet; `at` is the point on the curve under the cursor. */
/** `on`: the geometry feature the snap point is, for a dimension to stay on (none for Perpendicular, Tangent, Nearest). */
export type Snap = { readonly kind: SnapKind; readonly at: Vec2; readonly deferred?: Deferred; readonly on?: Anchor };

type Candidate = Snap & { readonly score: number; readonly dist: number };

/**
 * The snap a click near `cursor` takes, or undefined.
 *
 * Only visible entities within `aperture` (drawing units) of the cursor
 * count, plus any circle or arc whose center is within it. Endpoint,
 * Midpoint, Quadrant, Intersection, Node and Nearest points must themselves
 * be within the aperture. Center, Perpendicular and Tangent points can be
 * anywhere, as long as their object is under the cursor; they rank as if
 * they were at the edge of the aperture, so a point snap close to the cursor
 * beats them. Otherwise the point nearest the cursor wins, and Nearest only
 * when nothing else is found. Perpendicular and Tangent need `base`; without
 * one, `deferOk` lets them give a deferred snap on the object under the
 * cursor (Tangent on circles and arcs, Perpendicular on anything), ranked
 * like Center so that point snaps in the aperture win.
 */
export function findSnap(
  d: Drawing,
  cursor: Vec2,
  aperture: number,
  kinds: ReadonlySet<SnapKind>,
  base?: Vec2,
  deferOk = false,
): Snap | undefined {
  const found: Candidate[] = [];
  const point = (kind: SnapKind, at: Vec2, on?: Anchor): void => {
    if (!kinds.has(kind)) return;
    const dist = distance(cursor, at);
    if (dist <= aperture) found.push({ kind, at, score: dist, dist, ...(on && { on }) });
  };
  const fromObject = (kind: SnapKind, at: Vec2, on?: Anchor): void => {
    if (!kinds.has(kind)) return;
    const dist = distance(cursor, at);
    found.push({ kind, at, score: Math.min(dist, aperture), dist, ...(on && { on }) });
  };

  const hovered: Curve[] = [];
  const hoveredIds: EntityId[] = [];
  // Plain geometry and the parts of block instances (by path), on visible layers; never dimensions.
  for (const e of drawnGeometry(d)) {
    const onIt = distanceToEntity(d, cursor, e) <= aperture;
    if (e.kind === 'point') {
      if (onIt) point('node', e.at, { id: e.id, feature: 'node' });
      continue;
    }
    const c = entityCurve(e)!;
    const id = e.id;
    if ((c.kind === 'circle' || c.kind === 'arc') && !onIt) point('cen', c.center, { id, feature: 'center' });
    if (!onIt) continue;
    hovered.push(c);
    hoveredIds.push(id);
    switch (c.kind) {
      case 'segment':
        point('end', c.a, { id, feature: 'start' });
        point('end', c.b, { id, feature: 'end' });
        point('mid', { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }, { id, feature: 'mid' });
        break;
      case 'ray':
        point('end', c.base, { id, feature: 'start' });
        break;
      case 'xline':
        break;
      case 'arc':
      case 'circle':
        if (c.kind === 'arc') {
          point('end', arcStart(c), { id, feature: 'start' });
          point('end', arcEnd(c), { id, feature: 'end' });
          point('mid', arcMid(c), { id, feature: 'mid' });
        }
        fromObject('cen', c.center, { id, feature: 'center' });
        for (const q of [0, 90, 180, 270]) {
          if (c.kind === 'circle' || arcContainsDeg(c, q)) point('quad', pointAtDeg(c.center, c.radius, q), { id, feature: 'quad', deg: q });
        }
        break;
    }
    if (base) {
      for (const p of perpendicularFeet(c, base)) fromObject('perp', p);
      for (const p of tangentPointsFrom(c, base)) fromObject('tan', p);
    } else if (deferOk) {
      const at = nearestOnCurve(c, cursor);
      const dist = distance(cursor, at);
      for (const kind of ['tan', 'perp'] as const) {
        if (!kinds.has(kind) || (kind === 'tan' && (c.kind !== 'circle' && c.kind !== 'arc'))) continue;
        found.push({ kind, at, score: aperture, dist, deferred: { kind, curve: c, pick: at } });
      }
    }
    point('nea', nearestOnCurve(c, cursor));
  }
  if (kinds.has('int')) {
    for (let i = 0; i < hovered.length; i++) {
      for (let j = i + 1; j < hovered.length; j++) {
        for (const p of intersectCurves(hovered[i]!, hovered[j]!)) point('int', p, { id: hoveredIds[i]!, feature: 'int', other: hoveredIds[j]! });
      }
    }
  }

  const ranked = found.filter((c) => c.kind !== 'nea');
  const pool = ranked.length > 0 ? ranked : found;
  let best: Candidate | undefined;
  for (const c of pool) if (!best || beats(c, best)) best = c;
  if (!best) return undefined;
  const { score: _s, dist: _d, ...snap } = best;
  return snap;
}

/** Lower score wins, then the nearer point; snaps at the same point go by SNAP_KINDS order. */
function beats(a: Candidate, b: Candidate): boolean {
  if (Math.abs(a.score - b.score) > TOL) return a.score < b.score;
  if (Math.abs(a.dist - b.dist) > TOL) return a.dist < b.dist;
  return SNAP_KINDS.indexOf(a.kind) < SNAP_KINDS.indexOf(b.kind);
}
