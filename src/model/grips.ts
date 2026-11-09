import { arc3P, arcEnd, arcMid, arcStart } from '../geometry/arc';
import { angleFrom, pointAtDeg } from '../geometry/circle';
import { TOL } from '../geometry/tolerance';
import { type Vec2, distance, vecNearlyEqual } from '../geometry/vec';
import type { Entity } from './entity';

/**
 * A handle on a selected entity. `key` names what dragging it does:
 * - `start`, `end`: a line end stretches; an arc end slides along its circle
 *   (center and radius fixed).
 * - `move`: moves the whole entity (a point, a line's midpoint, a center, an
 *   xline or ray base).
 * - `quad0` … `quad270`: a circle's quadrants set its radius.
 * - `mid` on an arc: the arc passes through the dragged point, keeping both ends.
 */
export type Grip = { readonly key: string; readonly at: Vec2 };

export function gripsFor(e: Entity): Grip[] {
  switch (e.kind) {
    case 'point':
      return [{ key: 'move', at: e.at }];
    case 'line':
      return [
        { key: 'start', at: e.start },
        { key: 'move', at: { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 } },
        { key: 'end', at: e.end },
      ];
    case 'circle':
      return [
        { key: 'move', at: e.center },
        ...[0, 90, 180, 270].map((deg) => ({ key: `quad${deg}`, at: pointAtDeg(e.center, e.radius, deg) })),
      ];
    case 'arc':
      return [
        { key: 'move', at: e.center },
        { key: 'start', at: arcStart(e) },
        { key: 'mid', at: arcMid(e) },
        { key: 'end', at: arcEnd(e) },
      ];
    case 'xline':
    case 'ray':
      return [{ key: 'move', at: e.base }];
    case 'dimension':
      return []; // dimension grips come in Phase 4 step 7
  }
}

const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * The entity after dragging grip `key` (which was at `from`) to `to`.
 * Undefined when the result would be degenerate: a zero-length line, a
 * zero radius, an arc whose three points are collinear, or an arc end
 * dragged onto the center.
 */
export function applyGrip(e: Entity, key: string, from: Vec2, to: Vec2): Entity | undefined {
  const d = { x: to.x - from.x, y: to.y - from.y };
  if (key === 'move') {
    switch (e.kind) {
      case 'point':
        return { ...e, at: shift(e.at, d) };
      case 'line':
        return { ...e, start: shift(e.start, d), end: shift(e.end, d) };
      case 'circle':
      case 'arc':
        return { ...e, center: shift(e.center, d) };
      case 'xline':
      case 'ray':
        return { ...e, base: shift(e.base, d) };
      case 'dimension':
        return undefined;
    }
  }
  switch (e.kind) {
    case 'line': {
      const next = key === 'start' ? { ...e, start: to } : key === 'end' ? { ...e, end: to } : undefined;
      return next && !vecNearlyEqual(next.start, next.end) ? next : undefined;
    }
    case 'circle': {
      if (!key.startsWith('quad')) return undefined;
      const r = distance(e.center, to);
      return r > TOL ? { ...e, radius: r } : undefined;
    }
    case 'arc': {
      if (key === 'mid') {
        const a = arc3P(arcStart(e), to, arcEnd(e));
        // Dragged across the chord, the CCW arc runs end → start; it still passes through `to`.
        return a && { ...e, center: a.center, radius: a.radius, startDeg: a.startDeg, endDeg: a.endDeg };
      }
      if (key !== 'start' && key !== 'end') return undefined;
      if (distance(e.center, to) <= TOL) return undefined;
      const deg = angleFrom(e.center, to);
      const next = key === 'start' ? { ...e, startDeg: deg } : { ...e, endDeg: deg };
      return vecNearlyEqual(arcStart(next), arcEnd(next)) ? undefined : next;
    }
    default:
      return undefined;
  }
}
