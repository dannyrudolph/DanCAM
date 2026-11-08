import { describe, expect, it } from 'vitest';
import { createDrawing } from './drawing';
import { UndoStack } from './undo';
import { convertUnits, relabelUnits } from './units';

function drawing() {
  const d = createDrawing('in');
  d.entities.set('l', { kind: 'line', id: 'l', layer: '0', start: { x: 0.1, y: 0 }, end: { x: 1, y: 0.25 } });
  d.entities.set('a', { kind: 'arc', id: 'a', layer: '0', center: { x: 1, y: 1 }, radius: 0.5, startDeg: 30, endDeg: 150 });
  d.entities.set('x', { kind: 'xline', id: 'x', layer: '0', base: { x: 2, y: 0 }, dir: { x: 0.6, y: 0.8 } });
  return d;
}

describe('units', () => {
  it('Convert to mm scales lengths by 25.4 and leaves angles and directions alone', () => {
    const d = drawing();
    new UndoStack(d).commit(convertUnits(d, 'mm')!);
    expect(d.units).toBe('mm');
    expect(d.entities.get('l')).toMatchObject({ start: { x: 0.1 * 25.4, y: 0 }, end: { x: 25.4, y: 6.35 } });
    expect(d.entities.get('a')).toMatchObject({ center: { x: 25.4, y: 25.4 }, radius: 12.7, startDeg: 30, endDeg: 150 });
    expect(d.entities.get('x')).toMatchObject({ base: { x: 50.8, y: 0 }, dir: { x: 0.6, y: 0.8 } });
  });

  it('Convert to inch divides by 25.4 exactly, so whole millimetres come back as their inch values', () => {
    const d = createDrawing('mm');
    d.entities.set('c', { kind: 'circle', id: 'c', layer: '0', center: { x: 25.4, y: 0 }, radius: 6.35 });
    new UndoStack(d).commit(convertUnits(d, 'in')!);
    expect(d.entities.get('c')).toMatchObject({ center: { x: 1, y: 0 }, radius: 0.25 });
  });

  it('Relabel changes only the unit, and undo restores both exactly', () => {
    const d = drawing();
    const before = [...d.entities.values()];
    const undo = new UndoStack(d);
    undo.commit(relabelUnits(d, 'mm')!);
    expect(d.units).toBe('mm');
    expect([...d.entities.values()]).toEqual(before);

    undo.commit(convertUnits(d, 'in')!);
    undo.undo();
    undo.undo();
    expect(d.units).toBe('in');
    expect([...d.entities.values()]).toEqual(before);
  });

  it('does nothing when the drawing already uses that unit', () => {
    expect(convertUnits(drawing(), 'in')).toBeUndefined();
    expect(relabelUnits(drawing(), 'in')).toBeUndefined();
  });
});
