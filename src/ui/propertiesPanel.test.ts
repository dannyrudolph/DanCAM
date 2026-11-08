import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model/drawing';
import type { Entity } from '../model/entity';
import { rowsFor, selectionSummary } from './propertiesPanel';

/** Rows as label → value, skipping Layer and Style. */
function values(e: Entity): Record<string, number | string> {
  return Object.fromEntries(rowsFor(createDrawing('in'), e).map((r) => [r.label, r.value]));
}

describe('properties rows', () => {
  it('lists a circle by center, radius, diameter and circumference', () => {
    const v = values({ kind: 'circle', id: 'e1', layer: '0', center: { x: 2.6, y: 0 }, radius: 0.2505 });
    expect(v).toMatchObject({ 'Center X': 2.6, 'Center Y': 0, Radius: 0.2505, Diameter: 0.501 });
    expect(v.Circumference).toBeCloseTo(Math.PI * 0.501, 15);
  });

  it('lists an arc that crosses 0° with its CCW included angle, length and end points', () => {
    const v = values({ kind: 'arc', id: 'e1', layer: '0', center: { x: 1, y: 1 }, radius: 2, startDeg: 270, endDeg: 90 });
    expect(v).toMatchObject({
      'Start angle': 270,
      'End angle': 90,
      'Included angle': 180,
      'Start X': 1,
      'Start Y': -1,
      'End X': 1,
      'End Y': 3,
    });
    expect(v['Arc length']).toBeCloseTo(2 * Math.PI, 14);
  });

  it('lists an xline by base point and direction angle', () => {
    const v = values({ kind: 'xline', id: 'e1', layer: '0', base: { x: 1, y: 2 }, dir: { x: 0, y: -1 } });
    expect(v).toMatchObject({ 'Base X': 1, 'Base Y': 2, Angle: 270 });
  });
});

describe('selectionSummary', () => {
  it('counts a multiple selection by kind', () => {
    const l = (id: string): Entity => ({ kind: 'line', id, layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    const c: Entity = { kind: 'circle', id: 'c', layer: '0', center: { x: 0, y: 0 }, radius: 1 };
    expect(selectionSummary([l('a'), c, l('b')])).toEqual([
      { label: 'Line', value: '2' },
      { label: 'Circle', value: '1' },
    ]);
  });
});
