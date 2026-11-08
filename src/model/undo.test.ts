import { describe, expect, it } from 'vitest';
import { createDrawing } from './drawing';
import type { LineEntity } from './entity';
import { UndoStack } from './undo';

const line = (id: string, x2 = 1): LineEntity => ({
  kind: 'line',
  id,
  layer: '0',
  start: { x: 0, y: 0 },
  end: { x: x2, y: 0 },
});

function setup() {
  const drawing = createDrawing('in');
  return { drawing, undo: new UndoStack(drawing) };
}

describe('UndoStack', () => {
  it('undoing an add leaves the drawing empty again; redo puts it back', () => {
    const { drawing, undo } = setup();
    undo.commit({ label: 'LINE', changes: [{ op: 'add', entity: line('e1') }] });
    expect([...drawing.entities.keys()]).toEqual(['e1']);

    expect(undo.undo()).toBe(true);
    expect(drawing.entities.size).toBe(0);

    expect(undo.redo()).toBe(true);
    expect(drawing.entities.get('e1')).toEqual(line('e1'));
  });

  it('modify round-trips exactly through undo and redo', () => {
    const { drawing, undo } = setup();
    undo.commit({ label: 'LINE', changes: [{ op: 'add', entity: line('e1', 1) }] });
    undo.commit({ label: 'STRETCH', changes: [{ op: 'modify', before: line('e1', 1), after: line('e1', 0.375) }] });
    expect((drawing.entities.get('e1') as LineEntity).end.x).toBe(0.375);

    undo.undo();
    expect((drawing.entities.get('e1') as LineEntity).end.x).toBe(1);
    undo.redo();
    expect((drawing.entities.get('e1') as LineEntity).end.x).toBe(0.375);
  });

  it('undoing a remove restores the entity', () => {
    const { drawing, undo } = setup();
    undo.commit({ label: 'LINE', changes: [{ op: 'add', entity: line('e1') }] });
    undo.commit({ label: 'ERASE', changes: [{ op: 'remove', entity: line('e1') }] });
    expect(drawing.entities.size).toBe(0);
    undo.undo();
    expect(drawing.entities.get('e1')).toEqual(line('e1'));
  });

  it('undoes a whole multi-change transaction in one step, in reverse order', () => {
    const { drawing, undo } = setup();
    // add then modify the same entity: undo must reverse the modify before the add
    undo.commit({
      label: 'LINE',
      changes: [
        { op: 'add', entity: line('e1', 1) },
        { op: 'add', entity: line('e2', 2) },
        { op: 'modify', before: line('e1', 1), after: line('e1', 3) },
      ],
    });
    expect(undo.undo()).toBe(true);
    expect(drawing.entities.size).toBe(0);
    expect(undo.undo()).toBe(false);
  });

  it('a new commit after undo clears redo', () => {
    const { drawing, undo } = setup();
    undo.commit({ label: 'A', changes: [{ op: 'add', entity: line('e1') }] });
    undo.undo();
    undo.commit({ label: 'B', changes: [{ op: 'add', entity: line('e2') }] });
    expect(undo.redo()).toBe(false);
    expect([...drawing.entities.keys()]).toEqual(['e2']);
  });

  it('undo and redo with nothing to do report false and change nothing', () => {
    const { drawing, undo } = setup();
    expect(undo.undo()).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(drawing.entities.size).toBe(0);
  });

  it('labels the next undo and redo step', () => {
    const { undo } = setup();
    expect(undo.undoLabel).toBeUndefined();
    undo.commit({ label: 'LINE', changes: [{ op: 'add', entity: line('e1') }] });
    expect(undo.undoLabel).toBe('LINE');
    undo.undo();
    expect(undo.undoLabel).toBeUndefined();
    expect(undo.redoLabel).toBe('LINE');
  });

  it('ignores an empty transaction so it does not create a no-op undo step', () => {
    const { undo } = setup();
    undo.commit({ label: 'NOTHING', changes: [] });
    expect(undo.undo()).toBe(false);
  });

  it('rejects changes that do not match the drawing', () => {
    const { undo } = setup();
    undo.commit({ label: 'LINE', changes: [{ op: 'add', entity: line('e1') }] });
    expect(() => undo.commit({ label: 'X', changes: [{ op: 'add', entity: line('e1') }] })).toThrow(/already exists/);
    expect(() => undo.commit({ label: 'X', changes: [{ op: 'remove', entity: line('e9') }] })).toThrow(/not found/);
    expect(() => undo.commit({ label: 'X', changes: [{ op: 'modify', before: line('e1'), after: line('e2') }] })).toThrow(
      /ids differ/,
    );
  });
});
