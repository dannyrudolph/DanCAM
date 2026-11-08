import { describe, expect, it } from 'vitest';
import type { LineEntity } from '../model/entity';
import { gripTool } from './gripTool';
import { setup } from './toolHarness';

const line: LineEntity = { kind: 'line', id: 'e1', layer: '0', start: { x: 0, y: 0 }, end: { x: 2, y: 0 } };

describe('grip tool', () => {
  it('asks for the new point from the grip, previews the edit, commits one modify, and does not restart', () => {
    const t = setup();
    t.add(line);
    t.runner.start(gripTool('e1', { key: 'end', at: line.end }));
    expect(t.runner.request?.base).toEqual({ x: 2, y: 0 });
    expect(t.preview({ x: 3, y: 1 })).toEqual([{ ...line, end: { x: 3, y: 1 } }]);
    t.click(3, 1);
    expect(t.lines()).toEqual([[0, 0, 3, 1]]);
    expect(t.runner.tool).toBeUndefined();
    expect(t.undo.undoLabel).toBe('Grip edit');
    t.undo.undo();
    expect(t.lines()).toEqual([[0, 0, 2, 0]]);
  });

  it('a drop that would collapse the line changes nothing and says so', () => {
    const t = setup();
    t.add(line);
    t.runner.start(gripTool('e1', { key: 'end', at: line.end }));
    t.click(0, 0);
    expect(t.lines()).toEqual([[0, 0, 2, 0]]);
    expect(t.undo.undoLabel).toBeUndefined();
    expect(t.messages).toHaveLength(1);
  });

  it('a drop on the same point commits nothing', () => {
    const t = setup();
    t.add(line);
    t.runner.start(gripTool('e1', { key: 'end', at: line.end }));
    t.click(2, 0);
    expect(t.undo.undoLabel).toBeUndefined();
  });
});
