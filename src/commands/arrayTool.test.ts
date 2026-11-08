import { describe, expect, it } from 'vitest';
import type { CircleEntity, LineEntity } from '../model/entity';
import { createArrayTool } from './arrayTool';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const hole: CircleEntity = { kind: 'circle', id: 'H', layer: '0', center: v(1, 0), radius: 0.1 };

describe('Array', () => {
  it('makes a rectangular grid of copies as one undo step, previewing the last value', () => {
    const t = setup();
    t.add(hole);
    t.select('H');
    t.runner.start(createArrayTool());
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'Rows' });
    t.value(2);
    t.value(3);
    t.value(-0.5); // rows go down
    expect(t.preview(v(0, 0), 0.25)).toHaveLength(5);
    t.value(0.25);
    const centers = [...t.drawing.entities.values()].map((e) => (e as CircleEntity).center);
    expect(centers).toEqual([v(1, 0), v(1.25, 0), v(1.5, 0), v(1, -0.5), v(1.25, -0.5), v(1.5, -0.5)]);
    expect(t.undo.undoLabel).toBe('Array');
    t.undo.undo();
    expect(t.drawing.entities.size).toBe(1);
  });

  it('skips the row spacing for a single row, and refuses counts that are not whole', () => {
    const t = setup();
    t.add(hole);
    t.select('H');
    t.runner.start(createArrayTool());
    t.value(1.5);
    expect(t.messages).toEqual(['Rows must be a whole number, 1 or more.']);
    t.value(1);
    t.value(1);
    expect(t.messages.at(-1)).toBe('Columns must be a whole number, and rows × columns at least 2.');
    t.value(4);
    expect(t.runner.request).toMatchObject({ label: 'ΔX' });
    t.value(1);
    expect(t.drawing.entities.size).toBe(4);
  });

  it('makes a bolt circle with Polar, rotating items about the center', () => {
    const slot: LineEntity = { kind: 'line', id: 'S', layer: '0', start: v(1, 0), end: v(2, 0) };
    const t = setup();
    t.add(slot);
    t.select('S');
    t.runner.start(createArrayTool());
    t.option('polar');
    expect(t.runner.request?.prompt).toBe('Array (polar): pick the center');
    t.click(0, 0);
    t.value(4);
    t.value(360);
    const lines = t.lines();
    expect(lines).toHaveLength(4);
    expect(lines[1]).toEqual([0, 1, 0, 2]);
    expect(lines[2]).toEqual([-1, 0, -2, 0]);
  });

  it('moves copies without turning them when told not to rotate', () => {
    const slot: LineEntity = { kind: 'line', id: 'S', layer: '0', start: v(1, 0), end: v(2, 0) };
    const t = setup();
    t.add(slot);
    t.select('S');
    t.runner.start(createArrayTool());
    t.option('polar');
    t.click(0, 0);
    t.value(2);
    t.option('norotate');
    t.value(180);
    expect(t.lines()[1]).toEqual([-2, 0, -1, 0]); // the middle (1.5, 0) went to (-1.5, 0), still horizontal
  });
});
