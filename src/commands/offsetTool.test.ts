import { describe, expect, it } from 'vitest';
import type { CircleEntity, Entity, LineEntity } from '../model/entity';
import { createOffsetTool } from './offsetTool';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const ln = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ kind: 'line', id, layer: 'A', style: 'hidden', start: v(ax, ay), end: v(bx, by) });

function withShapes(...shapes: Entity[]) {
  const t = setup();
  for (const e of shapes) t.add(e);
  return t;
}

describe('Offset', () => {
  it('asks for the distance first, then copies object after object toward the picked side', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0), { kind: 'circle', id: 'C', layer: '0', center: v(0, 5), radius: 1 } as CircleEntity);
    t.runner.start(createOffsetTool());
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'D' });
    t.value(0.125);
    t.pick('L', 2, 0);
    expect(t.preview(v(2, -3))).toEqual([ln('preview', 0, -0.125, 4, -0.125)]);
    t.click(2, -3);
    expect(t.drawing.entities.get('e1')).toEqual(ln('e1', 0, -0.125, 4, -0.125)); // same layer and style
    t.pick('C', 1, 5);
    t.click(0, 5.2);
    expect(t.drawing.entities.get('e2')).toMatchObject({ kind: 'circle', center: v(0, 5), radius: 0.875 });
    expect(t.undo.undoLabel).toBe('Offset');
    t.undo.undo();
    expect(t.drawing.entities.has('e2')).toBe(false);
    expect(t.drawing.entities.has('e1')).toBe(true); // each copy its own step
    t.finish();
    expect(t.runner.tool).toBeUndefined();
  });

  it('offsets through a picked point, and remembers the mode and distance', () => {
    const offset = createOffsetTool();
    const t = withShapes(ln('L', 0, 0, 4, 0));
    t.runner.start(offset);
    t.option('through');
    expect(t.runner.request?.prompt).toBe('Offset (through a point): pick the object to offset, Enter to finish');
    t.pick('L', 1, 0);
    t.click(3, 0.7);
    expect(t.drawing.entities.get('e1')).toEqual(ln('e1', 0, 0.7, 4, 0.7));
    t.finish();
    t.runner.start(offset);
    expect(t.runner.request?.kind).toBe('entity'); // through is kept: no distance asked
  });

  it('refuses a zero distance, and a side on the object', () => {
    const t = withShapes(ln('L', 0, 0, 4, 0));
    t.runner.start(createOffsetTool());
    t.value(0);
    expect(t.messages).toEqual(['The offset distance must be more than zero.']);
    t.value(1);
    t.pick('L', 1, 0);
    t.click(6, 0);
    expect(t.drawing.entities.size).toBe(1);
    expect(t.runner.request?.kind).toBe('point');
  });
});
