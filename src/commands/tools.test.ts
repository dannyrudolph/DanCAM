import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model/drawing';
import type { Entity, LineEntity } from '../model/entity';
import { UndoStack } from '../model/undo';
import { lineTool } from './lineTool';
import { pointTool } from './pointTool';
import { type ToolContext, type ToolDef, ToolRunner } from './tool';

function setup(style?: 'hidden') {
  const drawing = createDrawing('in');
  const undo = new UndoStack(drawing);
  const messages: string[] = [];
  const ctx: ToolContext = {
    drawing,
    undo,
    newProps: () => (style ? { layer: '0', style } : { layer: '0' }),
    message: (m) => messages.push(m),
  };
  const runner = new ToolRunner(ctx);
  const click = (x: number, y: number): void => runner.send({ kind: 'point', at: { x, y } });
  const option = (key: string): void => runner.send({ kind: 'option', key });
  const lines = (): [number, number, number, number][] =>
    [...drawing.entities.values()]
      .filter((e): e is LineEntity => e.kind === 'line')
      .map((l) => [l.start.x, l.start.y, l.end.x, l.end.y]);
  return { drawing, undo, messages, runner, click, option, lines };
}

describe('Line tool', () => {
  it('chains segments from each end point, one undo step per segment', () => {
    const t = setup();
    t.runner.start(lineTool);
    expect(t.runner.request?.prompt).toBe('Line: pick the first point');
    t.click(0, 0);
    t.click(1, 0);
    t.click(1, 0.5);
    expect(t.lines()).toEqual([
      [0, 0, 1, 0],
      [1, 0, 1, 0.5],
    ]);
    expect(t.runner.request?.base).toEqual({ x: 1, y: 0.5 });
    t.undo.undo();
    expect(t.lines()).toEqual([[0, 0, 1, 0]]);
  });

  it('previews a rubber band from the last point to the cursor', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    const preview = t.runner.request?.preview?.({ x: 2, y: 1 }) as Entity[];
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 2, y: 1 } });
    expect(t.drawing.entities.size).toBe(0);
  });

  it('Close draws back to the chain start and starts a new chain', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    expect(t.runner.request?.options?.find((o) => o.key === 'close')?.enabled).toBe(false);
    t.click(1, 1);
    expect(t.runner.request?.options?.find((o) => o.key === 'close')?.enabled).toBe(true);
    t.option('close');
    expect(t.lines()).toEqual([
      [0, 0, 1, 0],
      [1, 0, 1, 1],
      [1, 1, 0, 0],
    ]);
    // sticky: the tool is waiting for a new first point
    expect(t.runner.tool).toBe(lineTool);
    expect(t.runner.request?.base).toBeUndefined();
  });

  it('Undo last segment removes it and continues from the previous point', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    t.click(2, 0);
    t.option('undo');
    expect(t.lines()).toEqual([[0, 0, 1, 0]]);
    expect(t.runner.request?.base).toEqual({ x: 1, y: 0 });
    t.option('undo');
    expect(t.lines()).toEqual([]);
    expect(t.runner.request?.base).toEqual({ x: 0, y: 0 });
    expect(t.runner.request?.options?.find((o) => o.key === 'undo')?.enabled).toBe(false);
    t.option('undo'); // nothing left: no-op, does not undo anything older
    expect(t.runner.request?.base).toEqual({ x: 0, y: 0 });
  });

  it('Undo last segment never reaches past the current chain', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(5, 5);
    t.click(6, 5);
    t.runner.send({ kind: 'finish' });
    t.click(0, 0);
    t.option('undo');
    expect(t.lines()).toEqual([[5, 5, 6, 5]]);
  });

  it('Enter finishes the chain and the tool waits for a new first point', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    t.runner.send({ kind: 'finish' });
    expect(t.runner.tool).toBe(lineTool);
    expect(t.runner.request?.base).toBeUndefined();
    t.click(3, 3);
    t.click(4, 3);
    expect(t.lines()).toHaveLength(2);
    expect(t.lines()[1]).toEqual([3, 3, 4, 3]);
  });

  it('refuses a zero-length segment and keeps waiting', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(1, 1);
    t.click(1, 1 + 1e-12);
    expect(t.lines()).toEqual([]);
    expect(t.messages).toEqual(['That point is the same as the last one; pick another.']);
    expect(t.runner.request?.base).toEqual({ x: 1, y: 1 });
  });

  it('stores exactly the coordinates it was given', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0.1, 0.2);
    t.click(0.30000000000000004, 1 / 3);
    expect(t.lines()).toEqual([[0.1, 0.2, 0.30000000000000004, 1 / 3]]);
  });

  it('gives new lines the current style', () => {
    const t = setup('hidden');
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    expect([...t.drawing.entities.values()][0]).toMatchObject({ layer: '0', style: 'hidden' });
  });

  it('stopping mid-chain keeps the committed segments', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.click(1, 0);
    t.runner.stop();
    expect(t.runner.tool).toBeUndefined();
    expect(t.runner.request).toBeUndefined();
    expect(t.lines()).toEqual([[0, 0, 1, 0]]);
  });
});

describe('Point tool', () => {
  it('places one point per click and repeats', () => {
    const t = setup();
    t.runner.start(pointTool);
    t.click(0.25, 0.5);
    t.click(1, 1);
    const pts = [...t.drawing.entities.values()];
    expect(pts.map((e) => e.kind)).toEqual(['point', 'point']);
    expect(pts[0]).toMatchObject({ at: { x: 0.25, y: 0.5 } });
    expect(t.runner.tool).toBe(pointTool);
    t.undo.undo();
    expect(t.drawing.entities.size).toBe(1);
  });
});

describe('ToolRunner', () => {
  it('starting another tool abandons the current one', () => {
    const t = setup();
    t.runner.start(lineTool);
    t.click(0, 0);
    t.runner.start(pointTool);
    expect(t.runner.tool).toBe(pointTool);
    t.click(2, 2);
    expect([...t.drawing.entities.values()].map((e) => e.kind)).toEqual(['point']);
  });

  it('a tool that throws is ended and its error reported', () => {
    const t = setup();
    const boom: ToolDef = {
      id: 'boom',
      label: 'Boom',
      shortcut: 'b',
      *run() {
        yield { kind: 'point', prompt: 'go' };
        throw new Error('kaboom');
      },
    };
    t.runner.start(boom);
    t.click(0, 0);
    expect(t.messages).toEqual(['Boom failed: kaboom']);
    expect(t.runner.tool).toBeUndefined();
  });

  it('a tool that ends without asking for anything does not restart forever', () => {
    const t = setup();
    let runs = 0;
    const once: ToolDef = {
      id: 'once',
      label: 'Once',
      shortcut: 'o',
      *run() {
        runs += 1;
        if (runs === 1) yield { kind: 'point', prompt: 'go' };
      },
    };
    t.runner.start(once);
    t.click(0, 0);
    expect(runs).toBe(2);
    expect(t.runner.tool).toBeUndefined();
  });

  it('input with no active tool is ignored', () => {
    const t = setup();
    t.click(0, 0);
    expect(t.drawing.entities.size).toBe(0);
  });
});
