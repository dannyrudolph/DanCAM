import { describe, expect, it } from 'vitest';
import type { CircleEntity, Entity, LineEntity, XlineEntity } from '../model/entity';
import { createChamferTool, createFilletTool } from './cornerTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const ln = (id: string, ax: number, ay: number, bx: number, by: number, layer = '0'): LineEntity => ({ kind: 'line', id, layer, start: v(ax, ay), end: v(bx, by) });
const xl = (id: string, x: number, y: number, dx: number, dy: number): XlineEntity => ({ kind: 'xline', id, layer: '0', base: v(x, y), dir: v(dx, dy) });

function withShapes(...shapes: Entity[]) {
  const t = setup();
  for (const e of shapes) t.add(e);
  return t;
}

describe('Fillet', () => {
  it('asks for the radius first, rounds a corner as one undo step, and remembers the radius', () => {
    const fillet = createFilletTool();
    const t = withShapes(ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5));
    t.runner.start(fillet);
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'R', prompt: 'Fillet: type the radius, then press Enter (0 makes a sharp corner)' });
    t.value(-1);
    expect(t.messages).toEqual(['The radius cannot be negative.']);
    t.value(0.5);
    expect(t.runner.request?.prompt).toBe('Fillet R 0.5: pick the first object, or drag across two');
    expect(t.runner.request?.options?.[0]).toMatchObject({ key: 'size', label: 'Change size (R 0.5)…' });
    t.pick('A', 3, 0);
    t.pick('B', 0, 3);
    expect(t.drawing.entities.get('A')).toEqual(ln('A', 0.5, 0, 5, 0));
    expect(t.drawing.entities.get('B')).toEqual(ln('B', 0, 0.5, 0, 5));
    expect(t.drawing.entities.get('e1')).toEqual({ kind: 'arc', id: 'e1', layer: '0', center: v(0.5, 0.5), radius: 0.5, startDeg: 180, endDeg: 270 });
    expect(t.undo.undoLabel).toBe('Fillet');
    t.undo.undo();
    expect([...t.drawing.entities.values()]).toEqual([ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5)]);
    // Sticky: straight to the next corner, with the radius kept; a new Fillet run doesn't ask again either.
    expect(t.runner.request?.prompt).toBe('Fillet R 0.5: pick the first object, or drag across two');
    t.runner.stop();
    t.runner.start(fillet);
    expect(t.runner.request?.kind).toBe('entity');
  });

  it('asks for the radius again from Change size', () => {
    const t = withShapes(ln('A', 0, 0, 5, 0));
    t.runner.start(createFilletTool());
    t.value(0.5);
    t.option('size');
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'R' });
    t.value(0.25);
    expect(t.runner.request?.prompt).toBe('Fillet R 0.25: pick the first object, or drag across two');
  });

  it('turns crossing xlines into rays meeting the arc', () => {
    const fillet = createFilletTool();
    const t = withShapes(xl('H', 0, 0, 1, 0), xl('V', 0, 0, 0, 1));
    t.runner.start(fillet);
    t.value(0.25);
    t.pick('H', 2, 0);
    t.pick('V', 0, -2);
    expect(t.drawing.entities.get('H')).toMatchObject({ kind: 'ray', base: v(0.25, 0), dir: v(1, 0) });
    expect(t.drawing.entities.get('V')).toMatchObject({ kind: 'ray', base: v(0, -0.25), dir: v(-0, -1) });
  });

  it('with No trim adds only the arc', () => {
    const t = withShapes(ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5));
    t.runner.start(createFilletTool());
    t.value(1);
    t.option('notrim');
    expect(t.runner.request?.options?.find((o) => o.key === 'notrim')?.active).toBe(true);
    t.pick('A', 3, 0);
    t.pick('B', 0, 3);
    expect(t.drawing.entities.get('A')).toEqual(ln('A', 0, 0, 5, 0));
    expect(t.drawing.entities.size).toBe(3);
  });

  it('makes a sharp corner at radius 0, with no arc', () => {
    const t = withShapes(ln('A', 1, 0, 5, 0), ln('B', 0, 1, 0, 5));
    t.runner.start(createFilletTool());
    t.value(0);
    t.pick('A', 3, 0);
    t.pick('B', 0, 3);
    expect([...t.drawing.entities.values()]).toEqual([ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5)]);
  });

  it('leaves a circle whole and puts the arc on the current layer when the layers differ', () => {
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: 'B', center: v(3, 1.5), radius: 1 };
    const t = withShapes(ln('A', -5, 0, 5, 0), c);
    t.runner.start(createFilletTool());
    t.value(0.5);
    t.pick('A', 0, 0);
    t.pick('C', 2, 1.5);
    expect(t.drawing.entities.get('C')).toEqual(c);
    expect(t.drawing.entities.get('e1')).toMatchObject({ kind: 'arc', layer: '0', radius: 0.5 });
  });

  it('previews the arc and trimmed objects without using up ids, and says so when nothing fits', () => {
    const t = withShapes(ln('A', 0, 0, 1, 0), ln('B', 0, 0, 0, 1));
    t.runner.start(createFilletTool());
    t.value(0.25);
    t.pick('A', 0.5, 0);
    const next = t.drawing.nextId;
    t.hover('B');
    expect(t.preview(v(0, 0.5))).toEqual([ln('preview', 0.25, 0, 1, 0), ln('preview', 0, 0.25, 0, 1), { kind: 'arc', id: 'preview', layer: '0', center: v(0.25, 0.25), radius: 0.25, startDeg: 180, endDeg: 270 }]);
    expect(t.drawing.nextId).toBe(next);
    t.runner.stop();
    t.runner.start(createFilletTool());
    t.value(5);
    t.pick('A', 0.5, 0);
    t.pick('B', 0, 0.5);
    expect(t.messages).toEqual(['No fillet of that radius fits there.']);
    expect(t.runner.request?.prompt).toBe('Fillet R 5: pick the second object');
  });

  it('will not take the same object twice', () => {
    const t = withShapes(ln('A', 0, 0, 5, 0));
    t.runner.start(createFilletTool());
    t.value(1);
    t.pick('A', 1, 0);
    const req = t.runner.request;
    expect(req?.kind === 'entity' && req.accepts(t.drawing.entities.get('A')!)).toBe(false);
  });
});

describe('Fillet and Chamfer by a dragged path', () => {
  const stroke = (t: ReturnType<typeof setup>, ...pts: [number, number][]) => t.runner.send({ kind: 'stroke', points: pts.map(([x, y]) => v(x, y)) });

  it('a path across two lines fillets the corner between them, keeping the sides it crosses, previewed while dragging', () => {
    const t = withShapes(ln('A', -5, 0, 5, 0), ln('B', 0, -5, 0, 5));
    t.runner.start(createFilletTool());
    t.value(0.5);
    const req = t.runner.request;
    const arc = { kind: 'arc', id: 'preview', layer: '0', center: v(0.5, 0.5), radius: 0.5, startDeg: 180, endDeg: 270 };
    expect(req?.kind === 'entity' && req.stroke?.([v(1, -0.5), v(1, 1), v(-0.5, 1)])).toEqual([ln('preview', 0.5, 0, 5, 0), ln('preview', 0, 0.5, 0, 5), arc]);
    expect(req?.kind === 'entity' && req.stroke?.([v(1, -0.5), v(1, 1)])).toEqual([]); // one object so far
    stroke(t, [1, -0.5], [1, 1], [-0.5, 1]);
    expect(t.drawing.entities.get('A')).toEqual(ln('A', 0.5, 0, 5, 0));
    expect(t.drawing.entities.get('B')).toEqual(ln('B', 0, 0.5, 0, 5));
    expect(t.drawing.entities.get('e1')).toEqual({ ...arc, id: 'e1' });
    expect(t.undo.undoLabel).toBe('Fillet');
    expect(t.runner.request?.prompt).toBe('Fillet R 0.5: pick the first object, or drag across two'); // ready for the next corner
  });

  it('takes the first two objects in the order the path crosses them; a third is left alone', () => {
    const t = withShapes(ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5), ln('C', 3, -1, 3, 5));
    t.runner.start(createChamferTool());
    t.value(0.1);
    t.value(0.2); // 0.1 along the first line crossed, 0.2 along the second
    stroke(t, [-0.5, 1], [1, 1], [1, -0.5], [4, -0.5], [4, 1]); // B, then A, then C
    expect(t.drawing.entities.get('B')).toEqual(ln('B', 0, 0.1, 0, 5));
    expect(t.drawing.entities.get('A')).toEqual(ln('A', 0.2, 0, 5, 0));
    expect(t.drawing.entities.get('C')).toEqual(ln('C', 3, -1, 3, 5));
  });

  it('says so when the path crosses fewer than two objects, or no corner fits', () => {
    const t = withShapes(ln('A', 0, 0, 1, 0), ln('B', 0, 0, 0, 1));
    t.runner.start(createFilletTool());
    t.value(5);
    stroke(t, [0.5, -1], [0.5, 1]);
    stroke(t, [0.5, -1], [0.5, 0.5], [-1, 0.5]);
    expect(t.messages).toEqual(['Drag across two objects to fillet the corner between them.', 'No fillet of that radius fits there.']);
    expect(t.undo.undoLabel).toBeUndefined();
  });
});

describe('Chamfer', () => {
  it('cuts a .010 x 45° edge break with Distance, Angle', () => {
    const t = withShapes(ln('A', 0, 0, 1, 0), ln('B', 0, 0, 0, 1));
    t.runner.start(createChamferTool());
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'D1', prompt: "Chamfer (two distances): type the distance along the first line you'll pick, then press Enter" });
    t.option('angle'); // the method is chosen right at the size step
    expect(t.runner.request?.prompt).toBe("Chamfer (distance and angle): type the distance along the first line you'll pick, then press Enter");
    t.value(0.01);
    expect(t.runner.request).toMatchObject({ kind: 'value', label: '∠' });
    t.value(45);
    expect(t.runner.request?.prompt).toBe('Chamfer 0.01 × 45°: pick the first object, or drag across two');
    t.pick('A', 0.5, 0);
    t.pick('B', 0, 0.5);
    expect(t.drawing.entities.get('A')).toEqual(ln('A', 0.01, 0, 1, 0));
    const b = t.drawing.entities.get('B') as LineEntity;
    expect(b.start.x).toBe(0);
    expect(b.start.y).toBeCloseTo(0.01, 15);
    const joint = t.drawing.entities.get('e1') as LineEntity;
    expect(joint.start).toEqual(v(0.01, 0));
    expect(t.undo.undoLabel).toBe('Chamfer');
  });

  it('uses two distances, and only takes straight objects', () => {
    const c: CircleEntity = { kind: 'circle', id: 'C', layer: '0', center: v(0, 0), radius: 1 };
    const t = withShapes(ln('A', 0, 0, 5, 0), ln('B', 0, 0, 0, 5), c);
    t.runner.start(createChamferTool());
    t.value(0.5);
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'D2' });
    t.value(0.25);
    const req = t.runner.request;
    expect(req?.kind === 'entity' && req.accepts(c)).toBe(false);
    t.pick('A', 3, 0);
    t.pick('B', 0, 3);
    expect(t.drawing.entities.get('e1')).toEqual(ln('e1', 0.5, 0, 0, 0.25));
  });
});
