import { describe, expect, it } from 'vitest';
import type { ArcEntity, Entity } from '../model/entity';
import { createArcTool } from './arcTool';
import { lineTool } from './lineTool';
import { setup } from './toolHarness';

const arc = (e: Entity | undefined): ArcEntity => {
  if (e?.kind !== 'arc') throw new Error(`expected an arc, got ${e?.kind}`);
  return e;
};

const activeMethod = (t: ReturnType<typeof setup>) => t.runner.request?.options?.find((o) => o.active)?.key;

describe('Arc tool', () => {
  it('3-Point stores a clockwise pick counter-clockwise, and continues from the picked end', () => {
    const t = setup();
    t.runner.start(createArcTool());
    t.click(0, 1);
    t.click(1, 0);
    t.click(0, -1);
    expect(arc(t.last())).toMatchObject({ center: { x: 0, y: 0 }, radius: 1, startDeg: 270, endDeg: 90 });
    // Travelled clockwise, it ends at (0, -1) heading -X.
    expect(t.ctx.continuation?.end).toEqual({ x: 0, y: -1 });
    expect(t.ctx.continuation?.dir.x).toBeCloseTo(-1, 15);
    expect(t.ctx.continuation?.dir.y).toBeCloseTo(0, 15);
  });

  it('Start, Center, End takes the radius from start and center', () => {
    const t = setup();
    t.runner.start(createArcTool());
    t.option('method:sce');
    t.click(1, 0);
    t.click(0, 0);
    t.click(0, 5);
    expect(arc(t.last())).toMatchObject({ center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 90 });
  });

  it('Start, Center, Angle runs clockwise for a negative angle', () => {
    const t = setup();
    t.runner.start(createArcTool());
    t.option('method:sca');
    t.click(1, 0);
    t.click(0, 0);
    const req = t.runner.request;
    expect(req).toMatchObject({ kind: 'value', quantity: 'angle' });
    expect(req?.kind === 'value' && req.fromCursor?.({ x: 0, y: -1 })).toBe(270);
    t.value(-90);
    expect(arc(t.last())).toMatchObject({ startDeg: 270, endDeg: 0 });
  });

  it('Start, End, Radius bulges toward the cursor and refuses a radius shorter than half the chord', () => {
    const t = setup();
    t.runner.start(createArcTool());
    t.option('method:ser');
    t.click(0, 0);
    t.click(2, 0);
    t.value(0.5, { x: 1, y: 1 });
    expect(t.messages).toEqual(['The radius must be at least half the distance between the ends.']);
    t.value(Math.SQRT2, { x: 1, y: 1 });
    const a = arc(t.last());
    expect(a.center.x).toBeCloseTo(1, 12);
    expect(a.center.y).toBeCloseTo(-1, 12);
    expect(a.startDeg).toBeCloseTo(45, 12);
    expect(a.endDeg).toBeCloseTo(135, 12);
  });

  it('Continue starts tangent to the last line, and repeating it chains tangent arcs', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    const arcs = createArcTool();
    t.runner.start(arcs);
    t.option('method:continue');
    expect(t.runner.request).toMatchObject({ prompt: 'Arc: pick the end point', base: { x: 1, y: 0 } });
    t.click(2, 1);
    expect(arc(t.last())).toMatchObject({ center: { x: 1, y: 1 }, radius: 1, startDeg: 270, endDeg: 0 });
    expect(t.runner.request?.base).toEqual({ x: 2, y: 1 });
    t.click(1, 2);
    expect(arc(t.last())).toMatchObject({ center: { x: 1, y: 1 }, radius: 1, startDeg: 0, endDeg: 90 });
  });

  it('Continue falls back to 3-Point when the last line was undone', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    t.runner.stop();
    t.undo.undo();
    t.runner.start(createArcTool());
    t.option('method:continue');
    expect(t.messages).toEqual(['Continue needs a line or arc to start from; draw one first.']);
    expect(activeMethod(t)).toBe('method:3p');
    expect(t.runner.request?.prompt).toBe('Arc: pick the start point');
  });

  it('previews the 3-point arc through the cursor', () => {
    const t = setup();
    t.runner.start(createArcTool());
    t.click(1, 0);
    t.click(0, 1);
    expect(t.preview({ x: -1, y: 0 })[0]).toMatchObject({ kind: 'arc', startDeg: 0, endDeg: 180 });
  });
});
