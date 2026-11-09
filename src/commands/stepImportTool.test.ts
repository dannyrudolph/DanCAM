import { describe, expect, it } from 'vitest';
import type { TurnedProfile } from '../model/profilePlacement';
import { createStepImportTool, layerNameFor, leftOutMessage } from './stepImportTool';
import { setup } from './toolHarness';

/** A stepped pin, 3 long: Ø2 for the first 1, then Ø1, with its end faces. */
const PIN: TurnedProfile = {
  curves: [
    { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    { kind: 'line', start: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
    { kind: 'line', start: { x: 1, y: 0.5 }, end: { x: 1, y: 1 } },
    { kind: 'line', start: { x: 1, y: 0.5 }, end: { x: 3, y: 0.5 } },
    { kind: 'line', start: { x: 3, y: 0 }, end: { x: 3, y: 0.5 } },
  ],
  left: { notRound: 2, freeform: 0, unreadable: 0 },
};
const ends = (t: ReturnType<typeof setup>) => t.lines().map((l) => l.map((v) => v + 0));

function started() {
  const t = setup();
  const tool = createStepImportTool();
  tool.load('C:\\parts\\pin.STEP', PIN);
  t.runner.start(tool);
  return { t, tool };
}

describe('Import STEP', () => {
  it('shows the profile with Z0 at its right end first; a click places it on a new layer named after the file, in one undo step', () => {
    const { t } = started();
    expect(t.runner.request?.options?.filter((o) => o.active).map((o) => o.key)).toEqual(['zero:right', 'half']);
    const req = t.runner.request;
    expect(req?.kind === 'point' && req.shown?.().length).toBe(5); // drawn in place, wherever the cursor is
    expect(t.preview({ x: 9, y: 9 })).toEqual([]); // nothing follows the cursor
    t.click(9, 9);
    expect(t.drawing.layers.get('pin')).toEqual({ name: 'pin', color: '#000000', visible: true, style: 'visible' });
    expect(t.entities().every((e) => e.layer === 'pin')).toBe(true);
    expect(ends(t)).toContainEqual([-3, 0, -3, 1]); // the Ø2 end face now at Z-3
    expect(ends(t)).toContainEqual([-2, 0.5, 0, 0.5]); // the Ø1 runs to Z0
    expect(t.messages.at(-1)).toBe('Imported pin.STEP: 5 lines and arcs on layer pin. Left out: 2 faces not round about the axis (cross holes, flats, slots).');
    expect(t.runner.tool).toBeUndefined(); // one placement, then done
    t.undo.undo();
    expect([t.entities().length, t.drawing.layers.has('pin')]).toEqual([0, false]);
  });

  it('Z0 at the left end, Flip and Full change the placement before Enter places it; the choice is kept for the next file', () => {
    const { t, tool } = started();
    t.option('zero:left');
    t.option('flip'); // the Ø1 end first
    t.option('full');
    expect(t.runner.request?.options?.filter((o) => o.active).map((o) => o.key)).toEqual(['zero:left', 'flip', 'full']);
    t.finish();
    expect(ends(t)).toContainEqual([0, -0.5, 0, 0.5]); // the Ø1 end face at Z0, both halves in one line
    expect(ends(t)).toContainEqual([2, -1, 3, -1]); // the Ø2 below the centerline
    expect(tool.placement).toEqual({ zeroAt: 'left', flip: true, full: true });
  });

  it('a layer of that name already there: the next free name; Esc places nothing', () => {
    const { t } = started();
    t.drawing.layers.set('PIN', { name: 'PIN', color: '#ff0000', visible: true, style: 'visible' });
    t.click(0, 0);
    expect(t.drawing.layers.has('pin 2')).toBe(true);

    const again = started();
    again.t.runner.stop();
    expect(again.t.entities()).toEqual([]);
  });

  it('names: the file name without folders or extension; what was left out, in words', () => {
    expect(layerNameFor('/Users/dan/parts/Pin rev B.stp')).toBe('Pin rev B');
    expect(layerNameFor('C:\\parts\\pin.STEP')).toBe('pin');
    expect(layerNameFor('.step')).toBe('STEP');
    expect(leftOutMessage({ curves: [], left: { notRound: 0, freeform: 0, unreadable: 0 } })).toBe('');
    expect(leftOutMessage({ curves: [], left: { notRound: 1, freeform: 2, unreadable: 1 } })).toBe(
      ' Left out: 1 face not round about the axis (cross holes, flats, slots), 2 freeform faces, 1 unreadable face.',
    );
  });
});
