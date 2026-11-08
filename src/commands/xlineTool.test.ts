import { describe, expect, it } from 'vitest';
import type { Entity, XlineEntity } from '../model/entity';
import { setup } from './toolHarness';
import { createXlineTool } from './xlineTool';

const xline = (e: Entity | undefined): XlineEntity => {
  if (e?.kind !== 'xline') throw new Error(`expected an xline, got ${e?.kind}`);
  return e;
};

describe('Xline tool', () => {
  it('Horizontal and Vertical pass through the clicked point with exact directions', () => {
    const t = setup();
    t.runner.start(createXlineTool());
    t.click(1, 2);
    expect(xline(t.last())).toMatchObject({ base: { x: 1, y: 2 }, dir: { x: 1, y: 0 } });
    t.option('method:v');
    t.click(3, 4);
    expect(xline(t.last())).toMatchObject({ base: { x: 3, y: 4 }, dir: { x: 0, y: 1 } });
    expect(t.entities()).toHaveLength(2);
  });

  it('Angle takes the angle from the cursor or a typed value', () => {
    const t = setup();
    t.runner.start(createXlineTool());
    t.option('method:angle');
    t.click(0, 0);
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.fromCursor?.({ x: 1, y: 1 })).toBe(45);
    t.value(30);
    const x = xline(t.last());
    expect(x.dir.x).toBeCloseTo(Math.sqrt(3) / 2, 15);
    expect(x.dir.y).toBeCloseTo(0.5, 15);
  });

  it('Through 2 points keeps a vertical direction exact', () => {
    const t = setup();
    t.runner.start(createXlineTool());
    t.option('method:2p');
    t.click(0.1, 0);
    t.click(0.1, 2);
    expect(xline(t.last())).toMatchObject({ base: { x: 0.1, y: 0 }, dir: { x: 0, y: 1 } });
  });

  it('Offset copies a line at a distance on the cursor side', () => {
    const t = setup();
    t.add({ kind: 'line', id: 'l', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
    t.runner.start(createXlineTool());
    t.option('method:offset');
    t.pick('l', 0.5, 0);
    const req = t.runner.request;
    expect(req?.kind === 'value' && req.fromCursor?.({ x: 5, y: -3 })).toBe(3);
    t.value(0.5, { x: 5, y: -3 });
    expect(xline(t.last())).toMatchObject({ base: { x: 0, y: -0.5 }, dir: { x: 1, y: 0 } });
  });

  it('Offset picks only lines and xlines', () => {
    const t = setup();
    t.runner.start(createXlineTool());
    t.option('method:offset');
    const req = t.runner.request;
    if (req?.kind !== 'entity') throw new Error('expected an entity step');
    expect(req.accepts({ kind: 'circle', id: 'c', layer: '0', center: { x: 0, y: 0 }, radius: 1 })).toBe(false);
    expect(req.accepts({ kind: 'line', id: 'l', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBe(true);
  });
});
