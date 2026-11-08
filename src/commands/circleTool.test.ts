import { describe, expect, it } from 'vitest';
import type { CircleEntity, Entity } from '../model/entity';
import { createCircleTool } from './circleTool';
import { setup } from './toolHarness';

function start(t: ReturnType<typeof setup>) {
  t.runner.start(createCircleTool());
}

const circle = (e: Entity | undefined): CircleEntity => {
  if (e?.kind !== 'circle') throw new Error(`expected a circle, got ${e?.kind}`);
  return e;
};

const activeMethod = (t: ReturnType<typeof setup>) => t.runner.request?.options?.find((o) => o.active)?.key;

describe('Circle tool', () => {
  it('Center, Radius stores the typed radius exactly and repeats', () => {
    const t = setup();
    start(t);
    expect(t.runner.request?.prompt).toBe('Circle: pick the center');
    t.click(1, 2);
    expect(t.runner.request).toMatchObject({ kind: 'value', label: 'R', base: { x: 1, y: 2 } });
    t.value(0.1);
    expect(circle(t.last())).toMatchObject({ center: { x: 1, y: 2 }, radius: 0.1 });
    expect(t.runner.request?.prompt).toBe('Circle: pick the center');
    t.undo.undo();
    expect(t.entities()).toEqual([]);
  });

  it('Center, Radius takes the radius from the cursor distance', () => {
    const t = setup();
    start(t);
    t.click(0, 0);
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.fromCursor?.({ x: 3, y: 4 })).toBe(5);
  });

  it('Center, Diameter halves the value', () => {
    const t = setup();
    start(t);
    t.option('method:cd');
    expect(activeMethod(t)).toBe('method:cd');
    t.click(0, 0);
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.label).toBe('Ø');
    expect(req?.kind === 'value' && req.fromCursor?.({ x: 3, y: 4 })).toBe(10);
    t.value(0.501);
    expect(circle(t.last()).radius).toBe(0.2505);
  });

  it('refuses a zero radius and keeps asking', () => {
    const t = setup();
    start(t);
    t.click(0, 0);
    t.value(0);
    expect(t.entities()).toEqual([]);
    expect(t.messages).toEqual(['The radius must be more than zero.']);
    expect(t.runner.request?.kind).toBe('value');
  });

  it('keeps the chosen method for the next circle', () => {
    const t = setup();
    start(t);
    t.option('method:2p');
    t.click(0, 0);
    t.click(2, 0);
    expect(circle(t.last())).toMatchObject({ center: { x: 1, y: 0 }, radius: 1 });
    expect(activeMethod(t)).toBe('method:2p');
    expect(t.runner.request?.prompt).toBe('Circle: pick the first end of a diameter');
  });

  it('2-Point previews the circle through the cursor', () => {
    const t = setup();
    start(t);
    t.option('method:2p');
    t.click(0, 0);
    expect(t.preview({ x: 0, y: 4 })[0]).toMatchObject({ kind: 'circle', center: { x: 0, y: 2 }, radius: 2 });
  });

  it('3-Point passes through the three points, and refuses collinear ones', () => {
    const t = setup();
    start(t);
    t.option('method:3p');
    t.click(1, 0);
    t.click(0, 1);
    t.click(2, 0); // collinear? no: (1,0), (0,1), (2,0) make a circle
    const c = circle(t.last());
    expect(c.center.x).toBeCloseTo(1.5, 12);
    expect(c.center.y).toBeCloseTo(1.5, 12);
    t.click(0, 0);
    t.click(1, 1);
    t.click(2, 2);
    expect(t.entities()).toHaveLength(1);
    expect(t.messages).toEqual(['The three points are in a line or repeat; pick another.']);
  });

  it('Tan, Tan, Radius picks the solution nearest the clicks', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'h', layer: '0', start: { x: -5, y: 0 }, end: { x: 5, y: 0 } });
    t.add({ kind: 'line', id: 'v', layer: '0', start: { x: 0, y: -5 }, end: { x: 0, y: 5 } });
    start(t);
    t.option('method:ttr');
    t.pick('h', 1, 0);
    t.pick('v', 0, -1);
    t.value(0.5);
    expect(circle(t.last())).toMatchObject({ center: { x: 0.5, y: -0.5 }, radius: 0.5 });
  });

  it('Tan, Tan, Radius treats an arc as its full circle', () => {
    const t = setup();
    // Upper half only; the tangent circle touches the missing lower half.
    t.add({ kind: 'arc', id: 'a', layer: '0', center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 180 });
    t.add({ kind: 'line', id: 'l', layer: '0', start: { x: -5, y: -3 }, end: { x: 5, y: -3 } });
    start(t);
    t.option('method:ttr');
    t.pick('a', 0.5, 0.8);
    t.pick('l', 0, -3);
    t.value(1);
    const c = circle(t.last());
    expect(c.center.x).toBeCloseTo(0, 9);
    expect(c.center.y).toBeCloseTo(-2, 9);
    expect(c.radius).toBe(1);
  });

  it('Tan, Tan, Radius asks again when no circle of that radius fits', () => {
    const t = setup();
    t.add({ kind: 'circle', id: 'a', layer: '0', center: { x: 0, y: 0 }, radius: 1 });
    t.add({ kind: 'circle', id: 'b', layer: '0', center: { x: 10, y: 0 }, radius: 1 });
    start(t);
    t.option('method:ttr');
    t.pick('a', 1, 0);
    t.pick('b', 9, 0);
    t.value(0.5); // far too small to reach across the 8-unit gap
    expect(t.messages).toEqual(['No circle of that radius touches both; type another radius.']);
    expect(t.runner.request?.kind).toBe('value');
    t.value(5);
    expect(circle(t.last()).radius).toBe(5);
  });

  it('Tan, Tan, Tan finds the inscribed circle of a 3-4-5 triangle', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'a', layer: '0', start: { x: 0, y: 0 }, end: { x: 4, y: 0 } });
    t.add({ kind: 'line', id: 'b', layer: '0', start: { x: 0, y: 0 }, end: { x: 0, y: 3 } });
    t.add({ kind: 'xline', id: 'c', layer: '0', base: { x: 4, y: 0 }, dir: { x: -0.8, y: 0.6 } });
    start(t);
    t.option('method:ttt');
    expect(t.runner.request).toMatchObject({ kind: 'entity', prompt: 'Circle: pick the first line, circle or arc to touch' });
    t.pick('a', 1, 0);
    t.pick('b', 0, 1);
    t.pick('c', 1.6, 1.8);
    const c = circle(t.last());
    expect(c.center.x).toBeCloseTo(1, 9);
    expect(c.center.y).toBeCloseTo(1, 9);
    expect(c.radius).toBeCloseTo(1, 9);
  });

  it('tangent picks accept lines, xlines, circles and arcs but not points', () => {
    const t = setup();
    start(t);
    t.option('method:ttt');
    const req = t.runner.request;
    if (req?.kind !== 'entity') throw new Error('expected an entity step');
    const base = { id: 'x', layer: '0' };
    expect(req.accepts({ ...base, kind: 'point', at: { x: 0, y: 0 } })).toBe(false);
    expect(req.accepts({ ...base, kind: 'circle', center: { x: 0, y: 0 }, radius: 1 })).toBe(true);
    expect(req.accepts({ ...base, kind: 'xline', base: { x: 0, y: 0 }, dir: { x: 1, y: 0 } })).toBe(true);
  });
});
