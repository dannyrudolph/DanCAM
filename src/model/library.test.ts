import { describe, expect, it } from 'vitest';
import { LIBRARY_FORMAT, parseLibrary, serializeLibrary } from '../io/nativeFile';
import type { BlockDef } from './block';
import { createDrawing } from './drawing';
import type { DimensionEntity, InsertEntity } from './entity';
import {
  type LibraryBlock,
  copyIn,
  freeName,
  importEntries,
  inUnits,
  libraryEntry,
  libraryStatus,
  planImport,
  sameBlock,
  updateFromLibrary,
} from './library';
import { UndoStack } from './undo';

const v = (x: number, y: number) => ({ x, y });
const HIDDEN = { name: 'Hidden', color: '#0000ff', visible: true, style: 'hidden' } as const;
/** A tool drawn in mm: a 25.4 mm edge on layer 0, a point on Hidden. */
const TOOL_MM: LibraryBlock = {
  name: 'Tool',
  description: 'MGEHR holder',
  units: 'mm',
  layers: [HIDDEN],
  entities: [
    { kind: 'line', id: 'b1', layer: '0', start: v(0, 0), end: v(25.4, 0) },
    { kind: 'point', id: 'b2', layer: 'Hidden', at: v(0, 12.7) },
  ],
};

function inchDrawing() {
  const d = createDrawing('in');
  return { d, undo: new UndoStack(d) };
}

describe('library entries', () => {
  it('a drawing\'s block goes in with the drawing\'s units and the layers it uses (not 0, not unused ones)', () => {
    const { d, undo } = inchDrawing();
    const def: BlockDef = { name: 'Tool', description: 'd', entities: [{ kind: 'point', id: 'b1', layer: 'Hidden', at: v(1, 2) }, { kind: 'point', id: 'b2', layer: '0', at: v(0, 0) }] };
    undo.commit({
      label: 'Setup',
      changes: [{ op: 'layer', after: HIDDEN }, { op: 'layer', after: { ...HIDDEN, name: 'Other' } }, { op: 'block', after: def }],
    });
    expect(libraryEntry(d, 'Tool')).toEqual({ ...def, units: 'in', layers: [HIDDEN] });
  });

  it('converted to the drawing\'s units when drawn in the other; the same block either way within the tolerance', () => {
    const inch = inUnits(TOOL_MM, 'in');
    expect(inch.entities[0]).toMatchObject({ end: v(1, 0) });
    expect(inch.entities[1]).toMatchObject({ at: v(0, 0.5) });
    expect(inUnits(TOOL_MM, 'mm', 'Other')).toEqual({ name: 'Other', description: 'MGEHR holder', entities: TOOL_MM.entities });
    const back = inUnits({ ...inch, units: 'in', layers: [] }, 'mm');
    expect(sameBlock(back, TOOL_MM)).toBe(true);
    expect(sameBlock({ ...back, description: 'other' }, TOOL_MM)).toBe(false);
    const moved = { ...back, entities: [back.entities[0]!, { ...TOOL_MM.entities[1]!, at: v(0, 12.7001) }] };
    expect(sameBlock(moved, TOOL_MM)).toBe(false);
  });

  it('free names count up without case', () => {
    expect(freeName('Tool', ['Spare'])).toBe('Tool');
    expect(freeName('Tool', ['TOOL', 'tool 2'])).toBe('Tool 3');
  });
});

describe('copying in and Update from library', () => {
  it('copy in: the definition in the drawing\'s units with the layers it needs, one undo step; status then the same', () => {
    const { d, undo } = inchDrawing();
    const tx = copyIn(d, TOOL_MM);
    expect(tx.label).toBe('Copy block Tool from the library');
    undo.commit(tx);
    expect(d.layers.get('Hidden')).toEqual(HIDDEN);
    expect(d.blocks.get('Tool')!.entities[0]).toMatchObject({ end: v(1, 0) });
    expect(libraryStatus(d, d.blocks.get('Tool')!, [TOOL_MM])).toBe('same');
    expect(libraryStatus(d, d.blocks.get('Tool')!, [])).toBe('none');
    undo.undo();
    expect([d.blocks.size, d.layers.has('Hidden')]).toEqual([0, false]);

    undo.commit(copyIn(d, TOOL_MM, 'Tool 2'));
    expect([...d.blocks.keys()]).toEqual(['Tool 2']);
  });

  it('a layer the drawing already has keeps the drawing\'s colour', () => {
    const { d, undo } = inchDrawing();
    undo.commit({ label: 'Layer', changes: [{ op: 'layer', after: { ...HIDDEN, color: '#00ff00' } }] });
    undo.commit(copyIn(d, TOOL_MM));
    expect(d.layers.get('Hidden')?.color).toBe('#00ff00');
  });

  it('Update from library redefines the drawing\'s block in one step: instances change, dimensions on them re-measure', () => {
    const { d, undo } = inchDrawing();
    undo.commit(copyIn(d, TOOL_MM));
    const ins: InsertEntity = { kind: 'insert', id: 'I', layer: '0', block: 'Tool', at: v(0, 0), rotationDeg: 0, scale: 1, mirrored: false };
    const dim: DimensionEntity = {
      kind: 'dimension', id: 'D', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', p1: v(0, 0), p2: v(1, 0), dir: v(1, 0), at: v(0.5, 1),
      anchors: { p1: { id: 'I/b1', feature: 'start' }, p2: { id: 'I/b1', feature: 'end' } },
    };
    undo.commit({ label: 'Place', changes: [{ op: 'add', entity: ins }, { op: 'add', entity: dim }] });
    expect(updateFromLibrary(d, 'Tool', [TOOL_MM])).toBeUndefined();

    const longer: LibraryBlock = { ...TOOL_MM, entities: [{ ...TOOL_MM.entities[0]!, end: v(50.8, 0) } as (typeof TOOL_MM.entities)[number], TOOL_MM.entities[1]!] };
    expect(libraryStatus(d, d.blocks.get('Tool')!, [longer])).toBe('differs');
    const tx = updateFromLibrary(d, 'Tool', [{ ...longer, name: 'TOOL' }])!;
    expect(tx.label).toBe('Update block Tool from the library');
    undo.commit(tx);
    expect([...d.blocks.keys()]).toEqual(['Tool']);
    expect((d.entities.get('D') as Extract<DimensionEntity, { type: 'linear' }>).p2.x).toBeCloseTo(2, 12);
    undo.undo();
    expect(d.entities.get('D')).toEqual(dim);
  });
});

describe('importing a library file', () => {
  const library: LibraryBlock[] = [TOOL_MM, { ...TOOL_MM, name: 'Bar', description: 'boring bar' }];
  /** The same Tool in inches, a changed Bar, and a new Drill. */
  const incoming: LibraryBlock[] = [
    { ...TOOL_MM, ...inUnits(TOOL_MM, 'in'), units: 'in' },
    { ...TOOL_MM, name: 'BAR', description: 'boring bar, long' },
    { ...TOOL_MM, name: 'Drill', description: '' },
  ];

  it('sorts the file\'s blocks into new, already there (in either unit) and clashing', () => {
    const plan = planImport(library, incoming);
    expect([plan.added, plan.same, plan.clashes].map((l) => l.map((b) => b.name))).toEqual([['Drill'], ['Tool'], ['BAR']]);
  });

  it('clashes replace, are renamed past every name taken, or are skipped', () => {
    const plan = planImport(library, incoming);
    expect(importEntries(library, plan, 'replace').map((b) => b.name)).toEqual(['Drill', 'BAR']);
    expect(importEntries(library, plan, 'rename').map((b) => b.name)).toEqual(['Drill', 'BAR 2']);
    expect(importEntries(library, plan, 'skip').map((b) => b.name)).toEqual(['Drill']);
  });

  it('the file round-trips every block bit for bit', () => {
    const r = parseLibrary(serializeLibrary(library));
    expect(r.ok && r.blocks).toEqual(library);
  });

  it('a bad file is refused with the reason', () => {
    const error = (file: unknown) => {
      const r = parseLibrary(typeof file === 'string' ? file : JSON.stringify(file));
      return r.ok ? 'read' : r.error;
    };
    const file = (blocks: unknown[], over: object = {}) => ({ format: LIBRARY_FORMAT, schemaVersion: 1, blocks, ...over });
    expect(error('{')).toBe('This file is not valid JSON.');
    expect(error({ format: 'DanCAM drawing', schemaVersion: 4 })).toBe('This is not a DanCAM block library.');
    expect(error(file([], { schemaVersion: 2 }))).toBe('This library was saved by a newer DanCAM (file version 2); update DanCAM to open it.');
    expect(error(file([{ ...TOOL_MM, units: 'ft' }]))).toBe('blocks[0].units must be "in" or "mm".');
    expect(error(file([{ ...TOOL_MM, layers: [] }]))).toBe('blocks[0].entities[1]: layer "Hidden" is not defined.');
    expect(error(file([TOOL_MM, { ...TOOL_MM, name: 'TOOL' }]))).toBe('blocks[1]: block "TOOL" appears twice.');
  });
});
