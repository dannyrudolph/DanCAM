import { describe, expect, it } from 'vitest';
import type { ProfileCurve, TurnedProfile } from '../model/profilePlacement';
import { type PartViews, createStepImportTool, layerNameFor, layoutViews, leftOutMessage, profileEntities } from './stepImportTool';
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
/** Hand-made views of a part 4 long and Ø2: the front with a hidden line and a fitted arc, the top a line, the end a circle. */
const VIEWS: PartViews = {
  front: [
    { kind: 'line', start: { x: 0, y: 1 }, end: { x: 4, y: 1 } },
    { kind: 'line', start: { x: 0, y: -1 }, end: { x: 4, y: -1 }, style: 'hidden' },
    { kind: 'arc', center: { x: 2, y: 0 }, radius: 0.5, startDeg: 0, endDeg: 90, fitted: true },
  ] satisfies ProfileCurve[],
  top: [{ kind: 'line', start: { x: 0, y: -1 }, end: { x: 4, y: -1 } }],
  end: [{ kind: 'circle', center: { x: 0, y: 0 }, radius: 1 }],
  freeform: 0,
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
    expect(t.runner.request?.options?.filter((o) => o.active).map((o) => o.key)).toEqual(['mode:profile', 'zero:right', 'half']);
    expect(t.runner.request?.options?.find((o) => o.key === 'mode:views')?.enabled).toBe(false); // no views for this file
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
    expect(t.runner.request?.options?.filter((o) => o.active).map((o) => o.key)).toEqual(['mode:profile', 'zero:left', 'flip', 'full']);
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

  it('a tangent edge and what is inside the part come in tangent and hidden; the rest take the layer\'s style', () => {
    let n = 0;
    const made = profileEntities(
      [
        { kind: 'line', start: { x: 1, y: 0 }, end: { x: 1, y: 2 }, style: 'tangent' },
        { kind: 'line', start: { x: 0, y: 2 }, end: { x: 1, y: 2 } },
        { kind: 'arc', center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 90, style: 'hidden' },
      ],
      'pin',
      () => `e${++n}`,
    );
    expect(made.map((e) => [e.layer, e.style])).toEqual([
      ['pin', 'tangent'],
      ['pin', undefined],
      ['pin', 'hidden'],
    ]);
  });

  it('3 views: Turn and Flip reach the views, taken once each; a layer per view and one for fitted curves, one undo step', () => {
    const asked: string[] = [];
    const views = (flip: boolean, turn: number): PartViews => {
      asked.push(`${flip}:${turn}`);
      return VIEWS;
    };
    const t = setup();
    const tool = createStepImportTool();
    tool.load('pin.step', PIN, views);
    t.runner.start(tool);
    t.option('mode:views');
    const opts = () => Object.fromEntries((t.runner.request?.options ?? []).map((o) => [o.key, [o.enabled, o.active ?? false]]));
    expect(opts()).toMatchObject({ 'mode:views': [true, true], turn: [true, false], half: [false, false], full: [false, false] });
    t.option('turn');
    t.option('flip');
    t.option('turn');
    expect([tool.mode, tool.turn, tool.placement.flip]).toEqual(['views', 2, true]);
    const req = t.runner.request;
    expect(req?.kind === 'point' && req.shown?.().length).toBe(5);
    expect(req?.kind === 'point' && req.shown?.().length).toBe(5); // shown again: the views aren't taken again
    expect(asked).toEqual(['false:0', 'false:1', 'true:1', 'true:2']);
    t.click(5, 5);
    expect([...t.drawing.layers.keys()].filter((n) => n.startsWith('pin'))).toEqual(['pin front', 'pin fitted', 'pin top', 'pin end']);
    const on = (layer: string) => t.entities().filter((e) => e.layer === layer).map((e) => [e.kind, e.style]);
    expect(on('pin front')).toEqual([['line', undefined], ['line', 'hidden']]);
    expect(on('pin fitted')).toEqual([['arc', undefined]]);
    expect(on('pin end')).toEqual([['circle', undefined]]);
    expect(t.messages.at(-1)).toBe('Imported pin.step as three views: 5 lines and arcs on layers pin front, pin fitted, pin top, pin end. Curves on pin fitted are fitted with arcs and lines.');
    t.undo.undo();
    expect([t.entities().length, [...t.drawing.layers.keys()].some((n) => n.startsWith('pin'))]).toEqual([0, false]);
  });

  it('the layout, third-angle: Z0 at the front view\'s right end, the top view above, the end view to the right, a gap of the front\'s height or an eighth of its length', () => {
    const laid = layoutViews(VIEWS, 'right');
    // Front 4 long, 2 high (gap 2): its right end at Z0; the top view's bottom 2 above the front's top; the end view's left 2 right of Z0.
    expect(laid.front[0]).toEqual({ kind: 'line', start: { x: -4, y: 1 }, end: { x: 0, y: 1 } });
    expect(laid.top[0]).toEqual({ kind: 'line', start: { x: -4, y: 3 }, end: { x: 0, y: 3 } });
    expect(laid.end[0]).toEqual({ kind: 'circle', center: { x: 3, y: 0 }, radius: 1 });
    const long = layoutViews({ ...VIEWS, front: [{ kind: 'line', start: { x: 0, y: -1 }, end: { x: 40, y: 1 } }] }, 'left');
    expect(long.end[0]).toEqual({ kind: 'circle', center: { x: 46, y: 0 }, radius: 1 }); // gap 40/8 = 5
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
