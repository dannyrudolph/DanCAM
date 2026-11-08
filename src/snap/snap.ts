import { arcContainsDeg, arcEnd, arcMid, arcStart } from '../geometry/arc';
import { pointAtDeg } from '../geometry/circle';
import { type Curve, intersectCurves, nearestOnCurve, perpendicularFeet, tangentPointsFrom } from '../geometry/curve';
import { TOL } from '../geometry/tolerance';
import { type Vec2, distance } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import type { Entity } from '../model/entity';
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

/** Snaps that need the step's base point (the line is drawn from it). */
export const NEEDS_BASE: ReadonlySet<SnapKind> = new Set<SnapKind>(['perp', 'tan']);

export type Snap = { readonly kind: SnapKind; readonly at: Vec2 };

/** The entity as a curve with its real extent, or undefined for a point. */
export function entityCurve(e: Entity): Curve | undefined {
  switch (e.kind) {
    case 'point':
      return undefined;
    case 'line':
      return { kind: 'segment', a: e.start, b: e.end };
    case 'ray':
    case 'xline':
      return { kind: e.kind, base: e.base, dir: e.dir };
    case 'circle':
      return { kind: 'circle', center: e.center, radius: e.radius };
    case 'arc':
      return { kind: 'arc', center: e.center, radius: e.radius, startDeg: e.startDeg, endDeg: e.endDeg };
  }
}

/** `score` ranks it; `dist` (true distance to the cursor) breaks ties. */
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
 * when nothing else is found. Perpendicular and Tangent need `base`.
 */
export function findSnap(
  d: Drawing,
  cursor: Vec2,
  aperture: number,
  kinds: ReadonlySet<SnapKind>,
  base?: Vec2,
): Snap | undefined {
  const found: Candidate[] = [];
  const point = (kind: SnapKind, at: Vec2): void => {
    if (!kinds.has(kind)) return;
    const dist = distance(cursor, at);
    if (dist <= aperture) found.push({ kind, at, score: dist, dist });
  };
  const fromObject = (kind: SnapKind, at: Vec2): void => {
    if (!kinds.has(kind)) return;
    const dist = distance(cursor, at);
    found.push({ kind, at, score: Math.min(dist, aperture), dist });
  };

  const hovered: Curve[] = [];
  for (const e of d.entities.values()) {
    if (d.layers.get(e.layer)?.visible === false) continue;
    const onIt = distanceToEntity(cursor, e) <= aperture;
    if (e.kind === 'point') {
      if (onIt) point('node', e.at);
      continue;
    }
    const c = entityCurve(e)!;
    if ((c.kind === 'circle' || c.kind === 'arc') && !onIt) point('cen', c.center);
    if (!onIt) continue;
    hovered.push(c);
    switch (c.kind) {
      case 'segment':
        point('end', c.a);
        point('end', c.b);
        point('mid', { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 });
        break;
      case 'ray':
        point('end', c.base);
        break;
      case 'xline':
        break;
      case 'arc':
      case 'circle':
        if (c.kind === 'arc') {
          point('end', arcStart(c));
          point('end', arcEnd(c));
          point('mid', arcMid(c));
        }
        fromObject('cen', c.center);
        for (const q of [0, 90, 180, 270]) {
          if (c.kind === 'circle' || arcContainsDeg(c, q)) point('quad', pointAtDeg(c.center, c.radius, q));
        }
        break;
    }
    if (base) {
      for (const p of perpendicularFeet(c, base)) fromObject('perp', p);
      for (const p of tangentPointsFrom(c, base)) fromObject('tan', p);
    }
    point('nea', nearestOnCurve(c, cursor));
  }
  if (kinds.has('int')) {
    for (let i = 0; i < hovered.length; i++) {
      for (let j = i + 1; j < hovered.length; j++) {
        for (const p of intersectCurves(hovered[i]!, hovered[j]!)) point('int', p);
      }
    }
  }

  const ranked = found.filter((c) => c.kind !== 'nea');
  const pool = ranked.length > 0 ? ranked : found;
  let best: Candidate | undefined;
  for (const c of pool) if (!best || beats(c, best)) best = c;
  return best && { kind: best.kind, at: best.at };
}

/** Lower score wins, then the nearer point; snaps at the same point go by SNAP_KINDS order. */
function beats(a: Candidate, b: Candidate): boolean {
  if (Math.abs(a.score - b.score) > TOL) return a.score < b.score;
  if (Math.abs(a.dist - b.dist) > TOL) return a.dist < b.dist;
  return SNAP_KINDS.indexOf(a.kind) < SNAP_KINDS.indexOf(b.kind);
}
