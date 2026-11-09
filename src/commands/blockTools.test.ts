import { describe, expect, it } from 'vitest';
import type { Entity } from '../model/entity';
import { blockPreviewSvg } from '../ui/blocksPanel';
import { createBlockTool, createInsertTool } from './blockTools';
import { setup } from './toolHarness';

const v = (x: number, y: number) => ({ x, y });
const edge: Entity = { kind: 'line', id: 'A', layer: '0', start: v(1, 1), end: v(2, 1) };
const nose: Entity = { kind: 'circle', id: 'C', layer: '0', style: 'hidden', center: v(2, 1), radius: 0.25 };
const note: Entity = { kind: 'dimension', id: 'N', layer: '0', dimStyle: 'INCH-3PL', type: 'leader', tip: v(0, 0), at: v(1, 0), text: 'X' };

function withSketch() {
  const t = setup();
  t.add(edge);
  t.add(nose);
  t.add(note);
  return t;
}

describe('Create block', () => {
  it('from the selection: base point, name, description; the geometry moved about the base, replaced by an instance there, in one undo step', () => {
    const t = withSketch();
    t.select('A', 'C', 'N');
    t.runner.start(createBlockTool());
    expect(t.messages).toEqual(['1 object left out: a block holds only lines, circles, arcs and points.']);
    expect(t.runner.request?.prompt).toBe('Create block: pick the base point, the point it is placed by');
    expect(t.runner.request?.options?.map((o) => [o.label, o.active])).toEqual([['Convert to block', true], ['Keep objects', false], ['Delete objects', false]]);
    t.click(1, 1);
    expect(t.runner.request).toMatchObject({ kind: 'text', prompt: 'Create block: type its name, then press Enter', at: v(1, 1) });
    t.text('  Tool ');
    expect(t.runner.request?.prompt).toBe('Create block Tool: type a description (holder, insert, notes), or press Enter for none');
    t.text('MGEHR 1212-2 holder');
    expect(t.drawing.blocks.get('Tool')).toEqual({
      name: 'Tool',
      description: 'MGEHR 1212-2 holder',
      entities: [
        { kind: 'line', id: 'b1', layer: '0', start: v(0, 0), end: v(1, 0) },
        { kind: 'circle', id: 'b2', layer: '0', style: 'hidden', center: v(1, 0), radius: 0.25 },
      ],
    });
    expect(t.entities()).toEqual([note, { kind: 'insert', id: 'e1', layer: '0', block: 'Tool', at: v(1, 1), rotationDeg: 0, scale: 1, mirrored: false }]);
    expect(t.runner.tool).toBeUndefined(); // one-shot, like the edit tools
    expect(t.undo.undoLabel).toBe('Create block Tool');
    t.undo.undo();
    expect(t.drawing.blocks.size).toBe(0);
    expect(t.entities().sort((a, b) => a.id.localeCompare(b.id))).toEqual([edge, nose, note]); // restored at the end, as undoing an erase does
  });

  it('Keep leaves the objects; Delete erases them; the choice is kept for the next use; Enter gives no description', () => {
    const t = withSketch();
    const tool = createBlockTool();
    t.select('A');
    t.runner.start(tool);
    t.option('after:keep');
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('Keep objects');
    t.click(1, 1);
    t.text('Edge');
    t.finish();
    expect(t.drawing.blocks.get('Edge')?.description).toBe('');
    expect(t.entities()).toEqual([edge, nose, note]);

    t.select('C');
    t.runner.start(tool);
    expect(t.runner.request?.options?.find((o) => o.active)?.label).toBe('Keep objects');
    t.option('after:delete');
    t.click(2, 1);
    t.text('Nose');
    t.text('');
    expect(t.entities()).toEqual([edge, note]);
    expect(t.drawing.blocks.get('Nose')?.entities).toEqual([{ kind: 'circle', id: 'b1', layer: '0', style: 'hidden', center: v(0, 0), radius: 0.25 }]);
  });

  it('a blank name or one already used (in any case) is refused, and it asks again', () => {
    const t = withSketch();
    t.drawing.blocks.set('Tool', { name: 'Tool', description: '', entities: [] });
    t.select('A');
    t.runner.start(createBlockTool());
    t.click(0, 0);
    t.text('   ');
    t.text('TOOL');
    expect(t.messages).toEqual(['A block needs a name.', 'There is already a block named Tool.']);
    expect(t.runner.request?.prompt).toBe('Create block: type its name, then press Enter');
    t.text('Tool 2');
    t.text('');
    expect([...t.drawing.blocks.keys()]).toEqual(['Tool', 'Tool 2']);
  });

  it('asks for objects when none are selected; with only annotation picked, says why and changes nothing', () => {
    const t = withSketch();
    t.runner.start(createBlockTool());
    expect(t.runner.request).toMatchObject({ kind: 'selection', prompt: 'Create block: select objects, then press Enter' });
    t.runner.send({ kind: 'selection', ids: ['N'] });
    expect(t.messages).toEqual(['A block holds lines, circles, arcs and points, and none are selected.']);
    expect(t.drawing.blocks.size).toBe(0);
    expect(t.runner.tool).toBeUndefined();
  });
});

describe('Insert', () => {
  const line = (id: string) => ({ kind: 'line' as const, id, layer: '0', start: v(0, 0), end: v(1, 0) });
  function withBlocks() {
    const t = setup();
    t.drawing.blocks.set('Tool', { name: 'Tool', description: '', entities: [line('b1')] });
    t.drawing.blocks.set('Boring bar', { name: 'Boring bar', description: '', entities: [line('b1')] });
    return t;
  }

  it('places the first block by name where clicked, at the picked rotation, one undo step each, again and again', () => {
    const t = withBlocks();
    t.runner.start(createInsertTool());
    expect(t.runner.request?.prompt).toBe('Insert Boring bar: pick where its base point goes');
    expect(t.runner.request?.options?.map((o) => [o.label, o.active ?? false])).toEqual([['Boring bar', true], ['Tool', false], ['Mirror', false], ['Scale 1', false]]);
    expect(t.preview(v(2, 3))).toEqual([{ kind: 'insert', id: 'preview', layer: '0', block: 'Boring bar', at: v(2, 3), rotationDeg: 0, scale: 1, mirrored: false }]);
    t.click(2, 3);
    expect(t.runner.request).toMatchObject({ kind: 'value', prompt: 'Insert Boring bar: pick or type the rotation, or press Enter for 0°', label: '∠', base: v(2, 3) });
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.fromCursor?.(v(2, 4))).toBe(90); // straight up from the base point
    t.value(-90);
    expect(t.last()).toEqual({ kind: 'insert', id: 'e1', layer: '0', block: 'Boring bar', at: v(2, 3), rotationDeg: 270, scale: 1, mirrored: false });
    expect(t.undo.undoLabel).toBe('Insert Boring bar');
    expect(t.runner.request?.prompt).toBe('Insert Boring bar: pick where its base point goes'); // sticky
    t.click(5, 3);
    expect(t.runner.request?.prompt).toBe('Insert Boring bar: pick or type the rotation, or press Enter for 270°');
    t.finish(); // Enter keeps the last rotation
    expect(t.last()).toMatchObject({ id: 'e2', at: v(5, 3), rotationDeg: 270 });
  });

  it('another block, Mirror and Scale from the options bar, kept for the session; a bad scale is refused', () => {
    const t = withBlocks();
    const tool = createInsertTool();
    t.runner.start(tool);
    t.option('block:Tool');
    t.option('mirror');
    t.option('scale');
    expect(t.runner.request).toMatchObject({ kind: 'value', prompt: 'Insert: type the scale (now 1)', label: '×', quantity: 'factor' });
    t.value(0);
    expect(t.messages).toEqual(['The scale needs to be more than zero.']);
    t.value(2.5);
    expect(t.runner.request?.options?.map((o) => [o.label, o.active ?? false])).toEqual([['Boring bar', false], ['Tool', true], ['Mirror', true], ['Scale 2.5', false]]);
    t.click(1, 1);
    t.value(0);
    expect(t.last()).toMatchObject({ block: 'Tool', at: v(1, 1), scale: 2.5, mirrored: true });
    t.runner.stop();
    t.runner.start(tool);
    expect(t.runner.request?.prompt).toBe('Insert Tool: pick where its base point goes');
  });

  it('the Blocks panel picks the block; with no blocks it says how to make one', () => {
    const t = withBlocks();
    const tool = createInsertTool();
    tool.use('Tool');
    t.runner.start(tool);
    expect(t.runner.request?.prompt).toBe('Insert Tool: pick where its base point goes');

    const u = setup();
    u.runner.start(createInsertTool());
    expect(u.messages).toEqual(['No blocks yet: select geometry and choose Create block (K).']);
    expect(u.runner.tool).toBeUndefined();
  });
});

describe('Blocks panel preview', () => {
  it('fits the geometry with a margin, upright, arcs counter-clockwise with the large-arc flag past 180°', () => {
    const svg = blockPreviewSvg({
      name: 'T',
      description: '',
      entities: [
        { kind: 'line', id: 'b1', layer: '0', start: v(0, 0), end: v(1, 0) },
        { kind: 'arc', id: 'b2', layer: '0', center: v(0, 0), radius: 0.5, startDeg: 0, endDeg: 270 },
      ],
    });
    // Bounds -.5..1 by -.5..+.5: size 1.5, margin .12; Y flipped into the view box.
    expect(svg).toBe(
      '<svg viewBox="-0.62 -0.62 1.74 1.24" fill="none" stroke="currentColor"><g transform="scale(1,-1)">' +
        '<line x1="0" y1="0" x2="1" y2="0"/><path d="M0.5 0 A0.5 0.5 0 1 1 0 -0.5"/></g></svg>',
    );
  });
});
