import { describe, expect, it } from 'vitest';
import { createDrawing } from './drawing';
import { addLayer, deleteLayer, editLayer, ensureCurrentLayer, layerUsage, renameLayer, sortedLayers } from './layers';
import { UndoStack } from './undo';

function setup() {
  const d = createDrawing('in');
  d.layers.set('CENTER', { name: 'CENTER', color: '#000000', visible: true, style: 'center' });
  d.entities.set('a', { kind: 'point', id: 'a', layer: 'CENTER', at: { x: 0, y: 0 } });
  d.entities.set('b', { kind: 'point', id: 'b', layer: 'CENTER', at: { x: 1, y: 0 } });
  d.entities.set('c', { kind: 'point', id: 'c', layer: '0', at: { x: 2, y: 0 } });
  return { d, undo: new UndoStack(d) };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
};

describe('layers', () => {
  it('New layer takes the first free LayerN name; undo removes it', () => {
    const { d, undo } = setup();
    d.layers.set('Layer1', { name: 'Layer1', color: '#000000', visible: true, style: 'visible' });
    const { tx, name } = addLayer(d);
    expect(name).toBe('Layer2');
    undo.commit(tx);
    expect(d.layers.get('Layer2')).toEqual({ name: 'Layer2', color: '#000000', visible: true, style: 'visible' });
    undo.undo();
    expect(d.layers.has('Layer2')).toBe(false);
  });

  it('lists 0 first, then by name with numbers in order', () => {
    const { d } = setup();
    for (const n of ['Layer10', 'Layer2', 'axis']) d.layers.set(n, { name: n, color: '#000', visible: true, style: 'visible' });
    expect(sortedLayers(d).map((l) => l.name)).toEqual(['0', 'axis', 'CENTER', 'Layer2', 'Layer10']);
  });

  it('edits color, visibility and style as one undo step each, and skips no-op edits', () => {
    const { d, undo } = setup();
    undo.commit(editLayer(d, 'CENTER', { visible: false })!);
    expect(d.layers.get('CENTER')?.visible).toBe(false);
    undo.undo();
    expect(d.layers.get('CENTER')?.visible).toBe(true);
    expect(editLayer(d, 'CENTER', { style: 'center' })).toBeUndefined();
  });

  it('rename moves the layer’s objects with it, and undo moves them back', () => {
    const { d, undo } = setup();
    undo.commit(ok(renameLayer(d, 'CENTER', '  CL ')).tx);
    expect(d.layers.has('CENTER')).toBe(false);
    expect(d.layers.get('CL')?.style).toBe('center');
    expect(layerUsage(d)).toEqual(new Map([['CL', 2], ['0', 1]]));
    undo.undo();
    expect(d.layers.has('CL')).toBe(false);
    expect(layerUsage(d)).toEqual(new Map([['CENTER', 2], ['0', 1]]));
  });

  it('rename refuses layer 0, empty names and clashes, but allows a change of case', () => {
    const { d } = setup();
    expect(renameLayer(d, '0', 'Base')).toEqual({ ok: false, error: 'Layer 0 cannot be renamed.' });
    expect(renameLayer(d, 'CENTER', ' ')).toEqual({ ok: false, error: 'A layer needs a name.' });
    d.layers.set('Hidden', { name: 'Hidden', color: '#000', visible: true, style: 'hidden' });
    expect(renameLayer(d, 'CENTER', 'HIDDEN')).toEqual({ ok: false, error: 'There is already a layer named HIDDEN.' });
    expect(renameLayer(d, 'CENTER', 'center').ok).toBe(true);
  });

  it('delete refuses layer 0, the current layer and a layer with objects', () => {
    const { d, undo } = setup();
    expect(deleteLayer(d, '0')).toEqual({ ok: false, error: 'Layer 0 cannot be deleted.' });
    expect(deleteLayer(d, 'CENTER')).toEqual({ ok: false, error: 'CENTER still has 2 objects on it.' });
    d.layers.set('Spare', { name: 'Spare', color: '#000', visible: true, style: 'visible' });
    d.currentLayer = 'Spare';
    expect(deleteLayer(d, 'Spare')).toEqual({ ok: false, error: 'Spare is the current layer; make another layer current first.' });
    d.currentLayer = '0';
    undo.commit(ok(deleteLayer(d, 'Spare')).tx);
    expect(d.layers.has('Spare')).toBe(false);
    undo.undo();
    expect(d.layers.has('Spare')).toBe(true);
  });

  it('the current layer follows a rename, and falls back to 0 when its layer is undone away', () => {
    const { d, undo } = setup();
    d.currentLayer = 'CENTER';
    undo.commit(ok(renameLayer(d, 'CENTER', 'CL')).tx);
    ensureCurrentLayer(d, 'CENTER', 'CL');
    expect(d.currentLayer).toBe('CL');

    const { tx, name } = addLayer(d);
    undo.commit(tx);
    d.currentLayer = name;
    undo.undo();
    ensureCurrentLayer(d);
    expect(d.currentLayer).toBe('0');
  });
});
