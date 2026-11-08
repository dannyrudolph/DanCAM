import type { Vec2 } from '../geometry/vec';
import { type Drawing, newEntityId } from '../model/drawing';

/**
 * Development-only test drawing, loaded with `?demo`: the upper half of a 2"
 * turned profile on its centerline, with a 0.0005" step on the largest diameter
 * for checking deep zoom. Loaded as initial state, like opening a file, so it
 * is not on the undo stack.
 */
export function loadDemo(d: Drawing): void {
  d.layers.set('CENTER', { name: 'CENTER', color: '#c0a040', visible: true });

  const profile: Vec2[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0.125 },
    { x: 0.5, y: 0.125 },
    { x: 0.5, y: 0.25 },
    { x: 1, y: 0.25 },
    { x: 1, y: 0.2505 }, // the 0.0005" step
    { x: 1.5, y: 0.2505 },
    { x: 1.5, y: 0.1875 },
    { x: 2, y: 0.1875 },
    { x: 2, y: 0 },
  ];
  for (let i = 0; i + 1 < profile.length; i++) {
    const id = newEntityId(d);
    d.entities.set(id, { kind: 'line', id, layer: '0', start: profile[i]!, end: profile[i + 1]! });
  }

  const centerId = newEntityId(d);
  d.entities.set(centerId, {
    kind: 'line',
    id: centerId,
    layer: 'CENTER',
    start: { x: -0.1, y: 0 },
    end: { x: 2.1, y: 0 },
  });

  const pointId = newEntityId(d);
  d.entities.set(pointId, { kind: 'point', id: pointId, layer: '0', at: { x: 1, y: 0.2505 } });
}
