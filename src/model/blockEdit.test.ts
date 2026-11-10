import { describe, expect, it } from 'vitest';
import type { BlockDef } from './block';
import { blockEditDrawing, deleteBlock, purgeBlocks, renameBlock, saveBlockEdit } from './blockEdit';
import { createDrawing } from './drawing';
import type { DimensionEntity, Entity, InsertEntity } from './entity';
import { UndoStack } from './undo';

const v = (x: number, y: number) => ({ x, y });
const TOOL: BlockDef = {
  name: 'Tool',
  description: 'Turning tool',
  entities: [
    { kind: 'line', id: 'b1', layer: '0', start: v(0, 0), end: v(1, 0) },
    { kind: 'circle', id: 'e7', layer: '0', center: v(1, 0), radius: 0.25 },
  ],
};
const SPARE: BlockDef = { name: 'Spare', description: '', entities: [{ kind: 'point', id: 'p', layer: '0', at: v(0, 0) }] };
const ins = (id: string, at = v(0, 0)): InsertEntity => ({
  kind: 'insert', id, layer: 'Part', block: 'Tool', at, rotationDeg: 0, scale: 1, mirrored: false,
});
/** From the tip of instance A's edge to the start of L: 4 long. */
const DIM: DimensionEntity = {
  kind: 'dimension', id: 'D', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', p1: v(1, 0), p2: v(5, 0), dir: v(1, 0), at: v(3, 1),
  anchors: { p1: { id: 'A/b1', feature: 'end' }, p2: { id: 'L', feature: 'start' } },
};

/** Tool and Spare defined; instances A at the origin and B at (0, 3); a line L and the dimension D. */
function drawing() {
  const d = createDrawing('in');
  const undo = new UndoStack(d);
  undo.commit({
    label: 'Setup',
    changes: [
      { op: 'layer', after: { name: 'Part', color: '#ff0000', visible: true, style: 'visible' } },
      { op: 'block', after: TOOL },
      { op: 'block', after: SPARE },
      { op: 'add', entity: ins('A') },
      { op: 'add', entity: ins('B', v(0, 3)) },
      { op: 'add', entity: { kind: 'line', id: 'L', layer: '0', start: v(5, 0), end: v(5, 1) } },
      { op: 'add', entity: DIM },
    ],
  });
  return { d, undo };
}

/** The block opened for editing, with its edge shortened to end at (0.5, 0). */
function shortened(d: ReturnType<typeof drawing>['d']) {
  const e = blockEditDrawing(d, 'Tool');
  const edge = e.entities.get('b1') as Extract<Entity, { kind: 'line' }>;
  e.entities.set('b1', { ...edge, end: v(0.5, 0) });
  return e;
}

describe('Edit block', () => {
  it('opens the block by itself: its parts, the drawing\'s layers and units, no blocks, and new ids past its e<n> ids', () => {
    const { d } = drawing();
    const e = blockEditDrawing(d, 'Tool');
    expect([...e.entities.values()]).toEqual(TOOL.entities);
    expect(e.units).toBe('in');
    expect([...e.layers.keys()]).toEqual([...d.layers.keys()]);
    expect(e.blocks.size).toBe(0);
    expect(e.nextId).toBe(8);
  });

  it('Save redefines the block in one undo step: every instance changes, a dimension on a kept part re-measures and stays anchored', () => {
    const { d, undo } = drawing();
    const r = saveBlockEdit(d, 'Tool', shortened(d));
    if (!r.ok || !r.tx) throw new Error('expected a change');
    expect(r.tx.label).toBe('Edit block Tool');
    undo.commit(r.tx);
    expect((d.blocks.get('Tool')!.entities[0] as Extract<Entity, { kind: 'line' }>).end).toEqual(v(0.5, 0));
    const dim = d.entities.get('D') as Extract<DimensionEntity, { type: 'linear' }>;
    expect(dim.p1).toEqual(v(0.5, 0));
    expect(dim.anchors?.p1).toEqual({ id: 'A/b1', feature: 'end' });
    undo.undo();
    expect(d.blocks.get('Tool')).toEqual(TOOL);
    expect(d.entities.get('D')).toEqual(DIM);
  });

  it('a dimension on a part deleted while editing goes with it', () => {
    const { d, undo } = drawing();
    const e = blockEditDrawing(d, 'Tool');
    e.entities.delete('b1');
    const r = saveBlockEdit(d, 'Tool', e);
    if (!r.ok || !r.tx) throw new Error('expected a change');
    undo.commit(r.tx);
    expect(d.entities.has('D')).toBe(false);
  });

  it('leaves out what a block can\'t hold and counts it; carries layers made or changed while editing, in the same undo step', () => {
    const { d, undo } = drawing();
    const e = shortened(d);
    e.layers.set('Insert', { name: 'Insert', color: '#00ff00', visible: true, style: 'visible' });
    e.layers.set('Part', { ...e.layers.get('Part')!, color: '#123456' });
    e.entities.set('e8', { kind: 'circle', id: 'e8', layer: 'Insert', center: v(0, 0), radius: 0.1 });
    const { anchors: _, ...loose } = DIM;
    e.entities.set('e9', { ...loose, id: 'e9' });
    const r = saveBlockEdit(d, 'Tool', e);
    if (!r.ok || !r.tx) throw new Error('expected a change');
    expect(r.left).toBe(1);
    undo.commit(r.tx);
    expect(d.blocks.get('Tool')!.entities.map((g) => g.id)).toEqual(['b1', 'e7', 'e8']);
    expect(d.layers.get('Insert')?.color).toBe('#00ff00');
    expect(d.layers.get('Part')?.color).toBe('#123456');
    undo.undo();
    expect([d.layers.has('Insert'), d.layers.get('Part')?.color]).toEqual([false, '#ff0000']);
  });

  it('nothing changed: no undo step; nothing left: refused', () => {
    const { d } = drawing();
    expect(saveBlockEdit(d, 'Tool', blockEditDrawing(d, 'Tool'))).toEqual({ ok: true, tx: undefined, left: 0 });
    const e = blockEditDrawing(d, 'Tool');
    e.entities.clear();
    expect(saveBlockEdit(d, 'Tool', e)).toEqual({ ok: false, error: 'A block needs at least one line, circle, arc or point.' });
  });
});

describe('Rename, Delete and Purge', () => {
  it('Rename points every instance at the new name in one undo step; a dimension on an instance keeps its anchor', () => {
    const { d, undo } = drawing();
    const r = renameBlock(d, 'Tool', '  Boring bar ');
    if (!r.ok) throw new Error(r.error);
    expect(r.tx.label).toBe('Rename block Tool to Boring bar');
    undo.commit(r.tx);
    expect([...d.blocks.keys()].sort()).toEqual(['Boring bar', 'Spare']);
    expect(d.blocks.get('Boring bar')?.entities).toEqual(TOOL.entities);
    expect(['A', 'B'].map((id) => (d.entities.get(id) as InsertEntity).block)).toEqual(['Boring bar', 'Boring bar']);
    expect(d.entities.get('D')).toEqual(DIM);
    undo.undo();
    expect(d.blocks.get('Tool')).toEqual(TOOL);
    expect((d.entities.get('A') as InsertEntity).block).toBe('Tool');
  });

  it('Rename allows a change of case; refuses the same name, a blank one, and another block\'s name in any case', () => {
    const { d, undo } = drawing();
    const r = renameBlock(d, 'Tool', 'TOOL');
    if (!r.ok) throw new Error(r.error);
    undo.commit(r.tx);
    expect([...d.blocks.keys()].sort()).toEqual(['Spare', 'TOOL']);
    const error = (to: string) => {
      const x = renameBlock(d, 'TOOL', to);
      return x.ok ? 'renamed' : x.error;
    };
    expect(error('TOOL')).toBe('That is already its name.');
    expect(error('  ')).toBe('A block needs a name.');
    expect(error('spare')).toBe('There is already a block named Spare.');
  });

  it('Delete is refused while instances use the block, and takes an unused one', () => {
    const { d, undo } = drawing();
    expect(deleteBlock(d, 'Tool')).toEqual({ ok: false, error: 'Tool has 2 instances in the drawing; erase or explode them first.' });
    const r = deleteBlock(d, 'Spare');
    if (!r.ok) throw new Error(r.error);
    undo.commit(r.tx);
    expect([...d.blocks.keys()]).toEqual(['Tool']);
  });

  it('Purge deletes every unused block in one undo step, and says when there is none', () => {
    const { d, undo } = drawing();
    undo.commit({ label: 'Another', changes: [{ op: 'block', after: { ...SPARE, name: 'Old' } }] });
    const r = purgeBlocks(d);
    if (!r.ok) throw new Error(r.error);
    expect(r.tx.label).toBe('Purge 2 blocks');
    undo.commit(r.tx);
    expect([...d.blocks.keys()]).toEqual(['Tool']);
    expect(purgeBlocks(d)).toEqual({ ok: false, error: 'Every block is in use; nothing to purge.' });
    undo.undo();
    expect(d.blocks.size).toBe(3);
  });
});
