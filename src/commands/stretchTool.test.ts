import { describe, expect, it } from 'vitest';
import type { CircleEntity, LineEntity, PointEntity } from '../model/entity';
import { setup } from './toolHarness';
import { stretchTool } from './stretchTool';

const v = (x: number, y: number) => ({ x, y });
const ln = (id: string, ax: number, ay: number, bx: number, by: number): LineEntity => ({ kind: 'line', id, layer: '0', start: v(ax, ay), end: v(bx, by) });

describe('Stretch', () => {
  it('moves the ends inside the crossing window, and objects wholly inside, as one undo step', () => {
    const t = setup();
    // A step on a shaft: shoulder at x = 2, stretched 0.5 to the right.
    t.add(ln('Top', 0, 1, 2, 1));
    t.add(ln('Face', 2, 1, 2, 0.5));
    t.add(ln('Small', 2, 0.5, 4, 0.5));
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: v(2, 0.75), radius: 0.05 };
    const far: PointEntity = { kind: 'point', id: 'P', layer: '0', at: v(9, 9) };
    t.add(c);
    t.add(far);
    t.runner.start(stretchTool);
    t.click(1.5, 0.25);
    expect(t.preview(v(2.5, 1.25))).toHaveLength(4); // the window
    t.click(2.5, 1.25);
    t.click(0, 0);
    expect(t.preview(v(0.5, 0)).map((e) => e.kind)).toEqual(['line', 'line', 'line', 'circle']);
    t.click(0.5, 0);
    expect(t.lines()).toEqual([
      [0, 1, 2.5, 1],
      [2.5, 1, 2.5, 0.5],
      [2.5, 0.5, 4, 0.5],
    ]);
    expect((t.drawing.entities.get('C') as CircleEntity).center).toEqual(v(2.5, 0.75));
    expect((t.drawing.entities.get('P') as PointEntity).at).toEqual(v(9, 9));
    t.undo.undo();
    expect(t.lines()[0]).toEqual([0, 1, 2, 1]);
  });

  it('says so when the window touches nothing', () => {
    const t = setup();
    t.add(ln('L', 0, 0, 1, 0));
    t.runner.start(stretchTool);
    t.click(5, 5);
    t.click(6, 6);
    expect(t.messages).toEqual(['Stretch: the window touches nothing.']);
    expect(t.runner.tool).toBeUndefined();
  });
});
