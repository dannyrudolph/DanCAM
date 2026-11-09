import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stretchTool } from '../commands/stretchTool';
import { setup } from '../commands/toolHarness';
import { normDeg } from '../geometry/angle';
import { type Transform } from '../geometry/transform';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { type BlockDef, type BlockGeometry, insertBBox, instanceEntities } from './block';
import { createDrawing, drawingBBox } from './drawing';
import { type Entity, type InsertEntity, transformEntity } from './entity';
import { deleteLayer, renameLayer } from './layers';
import { pickEntity } from './pick';
import { rowsFor } from './properties';
import { selectInBox } from './selection';
import { UndoStack } from './undo';
import { convertUnits } from './units';

const v = (x: number, y: number) => ({ x, y });
/** A tool sketch: a cutting edge, a nose circle and arc on layer 0, a point on Hidden. */
const TOOL: BlockDef = {
  name: 'Tool',
  description: 'MGEHR 1212-2 holder, MGMN200 insert',
  entities: [
    { kind: 'line', id: 'b1', layer: '0', start: v(0, 0), end: v(1, 0) },
    { kind: 'circle', id: 'b2', layer: '0', center: v(1, 0), radius: 0.25 },
    { kind: 'arc', id: 'b3', layer: '0', center: v(0, 0), radius: 0.5, startDeg: 0, endDeg: 90 },
    { kind: 'point', id: 'b4', layer: 'Hidden', at: v(0, 0.5) },
  ],
};
const insert = (over: Partial<InsertEntity> = {}): InsertEntity => ({
  kind: 'insert', id: 'I', layer: 'Part', block: 'Tool', at: v(0, 0), rotationDeg: 0, scale: 1, mirrored: false, ...over,
});

/** A drawing with layers Part and Hidden and the Tool block, through the undo stack. */
function drawingWithTool() {
  const d = createDrawing('in');
  const undo = new UndoStack(d);
  undo.commit({
    label: 'Setup',
    changes: [
      { op: 'layer', after: { name: 'Part', color: '#ff0000', visible: true, style: 'visible' } },
      { op: 'layer', after: { name: 'Hidden', color: '#0000ff', visible: true, style: 'hidden' } },
      { op: 'block', after: TOOL },
    ],
  });
  return { d, undo };
}

describe('instance geometry', () => {
  it('mirrored about its own X, scaled, rotated, then moved to its insertion point; layer 0 parts take its layer', () => {
    const { d } = drawingWithTool();
    const parts = instanceEntities(d, insert({ at: v(2, 1), rotationDeg: 90, scale: 2, mirrored: true }));
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      expect(p.x).toBeCloseTo(q.x, 12);
      expect(p.y).toBeCloseTo(q.y, 12);
    };
    const [line, circle, arc, point] = parts as [Extract<BlockGeometry, { kind: 'line' }>, Extract<BlockGeometry, { kind: 'circle' }>, Extract<BlockGeometry, { kind: 'arc' }>, Extract<BlockGeometry, { kind: 'point' }>];
    near(line.start, v(2, 1));
    near(line.end, v(2, 3));
    near(circle.center, v(2, 3));
    expect(circle.radius).toBe(0.5);
    near(arc.center, v(2, 1));
    expect([arc.radius, arc.startDeg, arc.endDeg]).toEqual([1, 0, 90]); // mirrored 0→90 runs 270→0, turned 90°
    near(point.at, v(3, 1));
    expect(parts.map((p) => [p.id, p.layer])).toEqual([['b1', 'Part'], ['b2', 'Part'], ['b3', 'Part'], ['b4', 'Hidden']]);
  });

  it('an undefined block draws nothing; its bounds are its insertion point', () => {
    const d = createDrawing('in');
    expect(instanceEntities(d, insert({ block: 'Gone', at: v(3, 4) }))).toEqual([]);
    expect(insertBBox(d, insert({ block: 'Gone', at: v(3, 4) }))).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it('moving, rotating, mirroring or scaling an instance places its geometry where the same edit puts each part', () => {
    const { d } = drawingWithTool();
    const coord = fc.double({ min: -50, max: 50, noNaN: true });
    const pt = fc.record({ x: coord, y: coord });
    const transform: fc.Arbitrary<Transform> = fc.oneof(
      fc.record({ kind: fc.constant('translate' as const), dx: coord, dy: coord }),
      fc.record({ kind: fc.constant('rotate' as const), center: pt, deg: fc.double({ min: -360, max: 360, noNaN: true }) }),
      fc.record({ kind: fc.constant('mirror' as const), a: pt, deg: fc.double({ min: 0, max: 180, noNaN: true }) }),
      fc.record({ kind: fc.constant('scale' as const), center: pt, factor: fc.double({ min: 0.1, max: 10, noNaN: true }) }),
    );
    const ins = fc.record({
      at: pt,
      rotationDeg: fc.double({ min: 0, max: 359.999, noNaN: true }),
      scale: fc.double({ min: 0.1, max: 10, noNaN: true }),
      mirrored: fc.boolean(),
    });
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
    const sameDeg = (a: number, b: number) => close(normDeg(a - b + 180) - 180, 0);
    const same = (a: Entity, b: Entity): boolean => {
      if (a.kind === 'line' && b.kind === 'line') return [a.start.x - b.start.x, a.start.y - b.start.y, a.end.x - b.end.x, a.end.y - b.end.y].every((x) => close(x, 0) || close(Math.abs(x), 0));
      if (a.kind === 'circle' && b.kind === 'circle') return close(a.center.x, b.center.x) && close(a.center.y, b.center.y) && close(a.radius, b.radius);
      if (a.kind === 'arc' && b.kind === 'arc') return close(a.center.x, b.center.x) && close(a.center.y, b.center.y) && close(a.radius, b.radius) && sameDeg(a.startDeg, b.startDeg) && sameDeg(a.endDeg, b.endDeg);
      if (a.kind === 'point' && b.kind === 'point') return close(a.at.x, b.at.x) && close(a.at.y, b.at.y);
      return false;
    };
    fc.assert(
      fc.property(ins, transform, (o, t) => {
        const before = insert(o);
        const after = transformEntity(before, t);
        if (after.kind !== 'insert') return false;
        const want = instanceEntities(d, before).map((p) => transformEntity(p, t));
        return instanceEntities(d, after).every((p, i) => same(p, want[i]!));
      }),
    );
  });
});

describe('blocks in the drawing', () => {
  it('undo refuses an instance of an undefined block, and removing a block that still has instances', () => {
    const { d, undo } = drawingWithTool();
    expect(() => undo.commit({ label: 'Insert', changes: [{ op: 'add', entity: insert({ block: 'Nope' }) }] })).toThrow('insert I: block Nope is not defined');
    undo.commit({ label: 'Insert', changes: [{ op: 'add', entity: insert() }] });
    expect(() => undo.commit({ label: 'Delete block', changes: [{ op: 'block', before: TOOL }] })).toThrow('block: Tool still has instances');
    undo.undo();
    undo.undo();
    expect(d.blocks.size).toBe(0);
    undo.redo();
    expect(d.blocks.get('Tool')).toEqual(TOOL);
  });

  it('extents, picking and window/crossing selection go by the instance\'s geometry', () => {
    const { d, undo } = drawingWithTool();
    undo.commit({ label: 'Insert', changes: [{ op: 'add', entity: insert({ at: v(10, 0) }) }] });
    expect(drawingBBox(d)).toEqual({ minX: 10, minY: -0.25, maxX: 11.25, maxY: 0.5 });
    expect(pickEntity(d, v(11.25, 0.01), 0.02)).toBe('I'); // on the circle, well away from the insertion point
    expect(pickEntity(d, v(12, 0), 0.02)).toBeUndefined();
    expect(selectInBox(d, { minX: 9.9, minY: -0.3, maxX: 11.3, maxY: 0.6 }, 'window')).toEqual(['I']);
    expect(selectInBox(d, { minX: 9.9, minY: -0.3, maxX: 11.2, maxY: 0.6 }, 'window')).toEqual([]); // circle sticks out
    expect(selectInBox(d, { minX: 10.4, minY: -0.1, maxX: 10.6, maxY: 0.1 }, 'crossing')).toEqual(['I']); // across the edge line
    expect(selectInBox(d, { minX: 10.1, minY: 0.1, maxX: 10.2, maxY: 0.2 }, 'crossing')).toEqual([]); // inside, touching nothing
  });

  it('converting units converts the block and moves the instance, keeping its scale: the same real size', () => {
    const { d, undo } = drawingWithTool();
    undo.commit({ label: 'Insert', changes: [{ op: 'add', entity: insert({ at: v(1, 0), scale: 2 }) }] });
    undo.commit(convertUnits(d, 'mm')!);
    expect(d.entities.get('I')).toMatchObject({ at: v(25.4, 0), scale: 2 });
    expect(d.blocks.get('Tool')!.entities[1]).toMatchObject({ center: v(25.4, 0), radius: 6.35 });
    const b = insertBBox(d, d.entities.get('I') as InsertEntity);
    const want = { minX: 25.4, minY: -12.7, maxX: 88.9, maxY: 25.4 }; // the inch bounds (1 to 3.5 by -.5 to 1) times 25.4
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(b[k]).toBeCloseTo(want[k], 12);
    undo.undo();
    expect(d.blocks.get('Tool')).toEqual(TOOL);
  });

  it('a layer a block uses can\'t be deleted; renaming it renames the block geometry too, in one undo step', () => {
    const { d, undo } = drawingWithTool();
    expect(deleteLayer(d, 'Hidden')).toEqual({ ok: false, error: 'Block Tool has geometry on Hidden.' });
    const r = renameLayer(d, 'Hidden', 'Hid');
    if (!r.ok) throw new Error(r.error);
    undo.commit(r.tx);
    expect(d.blocks.get('Tool')!.entities[3]!.layer).toBe('Hid');
    undo.undo();
    expect(d.blocks.get('Tool')).toEqual(TOOL);
  });

  it('the properties panel shows the block, its description and its placement', () => {
    const { d } = drawingWithTool();
    expect(rowsFor(d, insert({ at: v(2, 1), rotationDeg: 90, scale: 2, mirrored: true })).map((r) => [r.label, r.value])).toEqual([
      ['Layer', 'Part'], ['Style', 'Visible (by layer)'], ['Block', 'Tool'], ['Description', 'MGEHR 1212-2 holder, MGMN200 insert'],
      ['X', 2], ['Y', 1], ['Rotation', 90], ['Scale', 2], ['Mirrored', 'Yes'],
    ]);
  });

  it('Stretch moves an instance whose insertion point is in the window, and leaves one whose isn\'t', () => {
    const t = setup();
    t.drawing.blocks.set('Tool', { ...TOOL, entities: TOOL.entities.slice(0, 3) });
    t.add(insert({ id: 'A', layer: '0', at: v(0, 0) }));
    t.add(insert({ id: 'B', layer: '0', at: v(5, 0) }));
    t.runner.start(stretchTool);
    t.click(-0.1, -0.1);
    t.click(0.1, 0.1);
    t.click(0, 0);
    t.click(0.5, 0);
    expect(t.drawing.entities.get('A')).toMatchObject({ at: v(0.5, 0) });
    expect(t.drawing.entities.get('B')).toMatchObject({ at: v(5, 0) });
  });
});

describe('blocks in the file (v4)', () => {
  const saved = () => {
    const { d, undo } = drawingWithTool();
    undo.commit({ label: 'Insert', changes: [{ op: 'add', entity: insert({ at: v(2, 1), rotationDeg: 30, scale: 0.5, mirrored: true }) }] });
    return { d, text: serializeDrawing(d) };
  };

  it('saves and reopens blocks and instances bit for bit', () => {
    const { d, text } = saved();
    expect(JSON.parse(text).schemaVersion).toBe(4);
    const back = parseDrawing(text);
    if (!back.ok) throw new Error(back.error);
    expect([...back.drawing.blocks.values()]).toEqual([TOOL]);
    expect([...back.drawing.entities.values()]).toEqual([...d.entities.values()]);
  });

  it('a version 3 drawing opens with no blocks', () => {
    const file = JSON.parse(serializeDrawing(createDrawing('in')));
    delete file.blocks;
    file.schemaVersion = 3;
    const back = parseDrawing(JSON.stringify(file));
    if (!back.ok) throw new Error(back.error);
    expect(back.drawing.blocks.size).toBe(0);
  });

  it('refuses an undefined block, a block holding something other than geometry, a repeated id, and an anchor on an instance', () => {
    const { text } = saved();
    const edit = (f: (file: any) => void) => {
      const file = JSON.parse(text);
      f(file);
      const r = parseDrawing(JSON.stringify(file));
      return r.ok ? 'opened' : r.error;
    };
    expect(edit((f) => (f.entities[0].block = 'Gone'))).toBe('entities[0]: block "Gone" is not defined.');
    expect(edit((f) => f.blocks[0].entities.push({ kind: 'xline', id: 'b9', layer: '0', base: v(0, 0), dir: v(1, 0) }))).toBe('blocks[0].entities[4]: a block holds only lines, circles, arcs and points.');
    expect(edit((f) => (f.blocks[0].entities[1].id = 'b1'))).toBe('blocks[0].entities[1]: id "b1" appears twice in the block.');
    expect(edit((f) => (f.entities[0].scale = 0))).toBe('entities[0].scale must be more than zero.');
    expect(
      edit((f) => f.entities.push({ kind: 'dimension', id: 'e9', layer: '0', dimStyle: 'INCH-3PL', type: 'centerMark', center: v(0, 0), radius: 1, at: v(0, 0), anchors: { curve: 'I' } })),
    ).toBe('entity e9: anchors.curve names "I", which is not geometry in the drawing.');
  });
});
