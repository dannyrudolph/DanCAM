import { describe, expect, it } from 'vitest';
import { rayTool } from './rayTool';
import { setup } from './toolHarness';

describe('Ray tool', () => {
  it('adds one ray per click from the same start, each its own undo step', () => {
    const t = setup();
    t.runner.start(rayTool);
    t.click(1, 1);
    t.click(1, 5);
    t.click(4, 1);
    expect(t.entities().map((e) => (e.kind === 'ray' ? [e.base, e.dir] : e.kind))).toEqual([
      [{ x: 1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 1, y: 1 }, { x: 1, y: 0 }],
    ]);
    t.undo.undo();
    expect(t.entities()).toHaveLength(1);
  });

  it('refuses a through point on the start, and starts over after Enter', () => {
    const t = setup();
    t.runner.start(rayTool);
    t.click(2, 2);
    t.click(2, 2);
    expect(t.entities()).toHaveLength(0);
    expect(t.messages).toEqual(['That point is the start point; pick another.']);
    t.runner.send({ kind: 'finish' });
    expect(t.runner.request?.prompt).toBe('Ray: pick the start point');
  });
});
