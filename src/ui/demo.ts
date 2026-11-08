import type { Vec2 } from '../geometry/vec';
import { type Drawing, newEntityId } from '../model/drawing';
import type { LineStyleName } from '../model/lineStyle';

/**
 * Development-only test drawing, loaded with `?demo`: the upper half of a 2"
 * turned profile on its centerline, with a 0.0005" step on the largest diameter
 * for checking deep zoom, a hidden bore and a tangent edge to show the line
 * styles. Loaded as initial state, like opening a file, so it is not on the
 * undo stack.
 */
export function loadDemo(d: Drawing): void {
  d.layers.set('CENTER', { name: 'CENTER', color: '#c0a040', visible: true, style: 'center' });

  const addLine = (start: Vec2, end: Vec2, layer = '0', style?: LineStyleName): void => {
    const id = newEntityId(d);
    d.entities.set(id, style ? { kind: 'line', id, layer, style, start, end } : { kind: 'line', id, layer, start, end });
  };

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
  for (let i = 0; i + 1 < profile.length; i++) addLine(profile[i]!, profile[i + 1]!);

  // Hidden bore, 0.0625" radius, 0.75" deep from the right face.
  addLine({ x: 1.25, y: 0.0625 }, { x: 2, y: 0.0625 }, '0', 'hidden');
  addLine({ x: 1.25, y: 0 }, { x: 1.25, y: 0.0625 }, '0', 'hidden');
  // Tangent edge where a blend would meet the face: it stops short of the centerline and the top edge.
  addLine({ x: 0.25, y: 0 }, { x: 0.25, y: 0.125 }, '0', 'tangent');

  addLine({ x: -0.1, y: 0 }, { x: 2.1, y: 0 }, 'CENTER');

  const pointId = newEntityId(d);
  d.entities.set(pointId, { kind: 'point', id: pointId, layer: '0', at: { x: 1, y: 0.2505 } });
}
