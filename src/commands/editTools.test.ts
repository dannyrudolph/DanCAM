import { describe, expect, it } from 'vitest';
import type { ArcEntity, CircleEntity, Entity, LineEntity, XlineEntity } from '../model/entity';
import { copyTool, createMirrorTool, eraseTool, moveTool, rotateTool, scaleTool } from './editTools';
import { setup } from './toolHarness';

const line: LineEntity = { kind: 'line', id: 'L', layer: '0', start: { x: 1, y: 0 }, end: { x: 2, y: 0 } };
const circle: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: { x: 2, y: 1 }, radius: 0.25 };
const arc: ArcEntity = { kind: 'arc', id: 'A', layer: '0', center: { x: 1, y: 1 }, radius: 0.5, startDeg: 0, endDeg: 90 };

function withShapes(...shapes: Entity[]) {
  const t = setup();
  for (const e of shapes) t.add(e);
  return t;
}

const get = <E extends Entity>(t: ReturnType<typeof setup>, id: string) => t.drawing.entities.get(id) as E;

describe('selecting the objects', () => {
  it('uses the selection when there is one, without asking', () => {
    const t = withShapes(line, circle);
    t.select('L');
    t.runner.start(eraseTool);
    expect([...t.drawing.entities.keys()]).toEqual(['C']);
    expect(t.runner.tool).toBeUndefined(); // one-shot: back to selecting
  });

  it('asks for objects when nothing is selected, and keeps asking until some are given', () => {
    const t = withShapes(line, circle);
    t.runner.start(eraseTool);
    expect(t.runner.request).toMatchObject({ kind: 'selection', prompt: 'Erase: select objects, then press Enter' });
    t.selectionDone();
    expect(t.runner.request?.kind).toBe('selection');
    t.selectionDone('L', 'C');
    expect(t.drawing.entities.size).toBe(0);
    t.undo.undo();
    expect(t.drawing.entities.size).toBe(2);
    expect(t.undo.undoLabel).toBeUndefined(); // erase was one step
  });
});

describe('Move', () => {
  it('moves by base point to second point, exactly, as one step', () => {
    const t = withShapes(line, circle);
    t.select('L', 'C');
    t.runner.start(moveTool);
    t.click(1, 0);
    expect(t.runner.request?.base).toEqual({ x: 1, y: 0 });
    expect(t.preview({ x: 1.5, y: 2 })).toHaveLength(2);
    t.click(1.5, 2);
    expect(get<LineEntity>(t, 'L')).toEqual({ ...line, start: { x: 1.5, y: 2 }, end: { x: 2.5, y: 2 } });
    expect(get<CircleEntity>(t, 'C').center).toEqual({ x: 2.5, y: 3 });
    t.undo.undo();
    expect(get(t, 'L')).toEqual(line);
    expect(get(t, 'C')).toEqual(circle);
  });
});

describe('Copy', () => {
  it('places a copy at each point until Enter, each its own undo step, originals untouched', () => {
    const t = withShapes(line);
    t.select('L');
    t.runner.start(copyTool);
    t.click(1, 0);
    t.click(1, 1);
    t.click(1, 2);
    expect(t.runner.tool?.id).toBe('copy');
    t.runner.send({ kind: 'finish' });
    expect(t.runner.tool).toBeUndefined();
    expect(t.lines()).toEqual([
      [1, 0, 2, 0],
      [1, 1, 2, 1],
      [1, 2, 2, 2],
    ]);
    expect(new Set(t.entities().map((e) => e.id)).size).toBe(3);
    t.undo.undo();
    expect(t.lines()).toHaveLength(2);
  });
});

describe('Rotate', () => {
  it('a typed 90° is exact, and arc angles turn with it', () => {
    const t = withShapes(line, arc);
    t.select('L', 'A');
    t.runner.start(rotateTool);
    t.click(0, 0);
    expect(t.runner.request).toMatchObject({ kind: 'value', quantity: 'angle' });
    t.value(90);
    expect(get<LineEntity>(t, 'L')).toEqual({ ...line, start: { x: 0, y: 1 }, end: { x: 0, y: 2 } });
    expect(get<ArcEntity>(t, 'A')).toEqual({ ...arc, center: { x: -1, y: 1 }, startDeg: 90, endDeg: 180 });
  });

  it('the cursor gives the angle from the center', () => {
    const t = withShapes(line);
    t.select('L');
    t.runner.start(rotateTool);
    t.click(0, 0);
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.fromCursor?.({ x: -1, y: 0 })).toBe(180);
  });
});

describe('Mirror', () => {
  it('keeps the originals by default and adds mirrored copies; arcs stay counter-clockwise', () => {
    const t = withShapes(arc);
    t.select('A');
    t.runner.start(createMirrorTool());
    t.click(0, 0);
    t.click(0, 5); // the Y axis
    const [orig, copy] = t.entities() as ArcEntity[];
    expect(orig).toEqual(arc);
    expect(copy).toMatchObject({ center: { x: -1, y: 1 }, radius: 0.5, startDeg: 90, endDeg: 180 });
    expect(copy!.id).not.toBe('A');
  });

  it('Erase originals replaces them, and the choice is remembered for the next run', () => {
    const t = withShapes(line);
    const mirror = createMirrorTool();
    t.select('L');
    t.runner.start(mirror);
    t.click(0, 1);
    t.option('erase');
    expect(t.runner.request?.options?.find((o) => o.key === 'erase')?.active).toBe(true);
    t.click(5, 1); // y = 1
    expect(t.lines()).toEqual([[1, 2, 2, 2]]);
    t.runner.start(mirror);
    t.click(0, 0);
    expect(t.runner.request?.options?.find((o) => o.key === 'erase')?.active).toBe(true);
  });

  it('refuses a mirror line with no length and keeps waiting', () => {
    const t = withShapes(line);
    t.select('L');
    t.runner.start(createMirrorTool());
    t.click(0, 0);
    t.click(0, 0);
    expect(t.messages.at(-1)).toBe('The mirror line needs two different points; pick another.');
    expect(t.runner.tool?.id).toBe('mirror');
  });
});

describe('Scale', () => {
  it('scales positions and radii about the base point by a typed factor', () => {
    const t = withShapes(circle, line);
    t.select('C', 'L');
    t.runner.start(scaleTool);
    t.click(1, 0);
    expect(t.runner.request).toMatchObject({ kind: 'value', quantity: 'factor' });
    t.value(2);
    expect(get<CircleEntity>(t, 'C')).toEqual({ ...circle, center: { x: 3, y: 2 }, radius: 0.5 });
    expect(get<LineEntity>(t, 'L')).toEqual({ ...line, end: { x: 3, y: 0 } });
  });

  it('refuses a factor of zero and keeps waiting', () => {
    const t = withShapes(circle);
    t.select('C');
    t.runner.start(scaleTool);
    t.click(0, 0);
    t.value(0);
    expect(get(t, 'C')).toEqual(circle);
    expect(t.runner.request?.kind).toBe('value');
  });
});

describe('construction lines', () => {
  it('rotate their direction and keep it a unit vector; scaling leaves it alone', () => {
    const xl: XlineEntity = { kind: 'xline', id: 'X', layer: '0', base: { x: 1, y: 0 }, dir: { x: 1, y: 0 } };
    const t = withShapes(xl);
    t.select('X');
    t.runner.start(rotateTool);
    t.click(0, 0);
    t.value(90);
    expect(get(t, 'X')).toEqual({ ...xl, base: { x: 0, y: 1 }, dir: { x: 0, y: 1 } });
    t.runner.start(scaleTool);
    t.click(0, 0);
    t.value(3);
    expect(get(t, 'X')).toEqual({ ...xl, base: { x: 0, y: 3 }, dir: { x: 0, y: 1 } });
  });
});

describe('Rotate with Reference', () => {
  it('turns an edge from its measured angle to the typed one: a 30° line set to 90° lands exactly vertical', () => {
    const slanted: LineEntity = { kind: 'line', id: 'S', layer: '0', start: { x: 0, y: 0 }, end: { x: Math.sqrt(3), y: 1 } };
    const t = withShapes(slanted);
    t.select('S');
    t.runner.start(rotateTool);
    t.click(0, 0);
    t.option('reference');
    expect(t.runner.request?.prompt).toBe('Rotate: pick the first point of the reference edge');
    t.click(0, 0);
    t.click(Math.sqrt(3), 1); // 30°
    expect(t.runner.request?.prompt).toBe('Rotate: pick or type the new angle (reference 30°)');
    t.value(90);
    const s = get<LineEntity>(t, 'S');
    expect(s.start).toEqual({ x: 0, y: 0 });
    expect(s.end.x).toBeCloseTo(0, 15);
    expect(s.end.y).toBeCloseTo(2, 15);
    expect(t.undo.undoLabel).toBe('Rotate');
  });

  it('the preview turns by new − reference', () => {
    const t = withShapes(line);
    t.select('L');
    t.runner.start(rotateTool);
    t.click(0, 0);
    t.option('reference');
    t.click(0, 0);
    t.click(0, 1); // 90°
    const [shown] = t.preview({ x: 0, y: 0 }, 180) as LineEntity[]; // 180 − 90 = +90
    expect(shown).toEqual({ ...line, start: { x: 0, y: 1 }, end: { x: 0, y: 2 } });
  });

  it('refuses a reference edge with no length and keeps waiting for its second point', () => {
    const t = withShapes(line);
    t.select('L');
    t.runner.start(rotateTool);
    t.click(0, 0);
    t.option('reference');
    t.click(1, 1);
    t.click(1, 1);
    expect(t.messages.at(-1)).toBe('The reference edge needs two different points; pick another.');
    expect(t.runner.request?.prompt).toBe('Rotate: pick the second point of the reference edge');
  });
});
