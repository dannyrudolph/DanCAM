import { distanceToArc } from '../geometry/arc';
import { distanceToCircle } from '../geometry/circle';
import { distanceToSegment } from '../geometry/distance';
import { distanceToXline } from '../geometry/xline';
import type { Vec2 } from '../geometry/vec';
import type { Drawing } from './drawing';
import type { Entity, EntityId } from './entity';

export function distanceToEntity(p: Vec2, e: Entity): number {
  switch (e.kind) {
    case 'point':
      return Math.hypot(p.x - e.at.x, p.y - e.at.y);
    case 'line':
      return distanceToSegment(p, e.start, e.end);
    case 'circle':
      return distanceToCircle(p, e);
    case 'arc':
      return distanceToArc(p, e);
    case 'xline':
      return distanceToXline(p, e);
  }
}

/**
 * The visible entity nearest to `p` within `radius` drawing units, or
 * undefined. Ties go to the entity drawn last, which is the one on top.
 * `accepts` limits the pick to the entities a tool step can use.
 */
export function pickEntity(d: Drawing, p: Vec2, radius: number, accepts?: (e: Entity) => boolean): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDist = radius;
  for (const e of d.entities.values()) {
    if (d.layers.get(e.layer)?.visible === false) continue;
    if (accepts && !accepts(e)) continue;
    const dist = distanceToEntity(p, e);
    if (dist <= bestDist) {
      best = e.id;
      bestDist = dist;
    }
  }
  return best;
}
