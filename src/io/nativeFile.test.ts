import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model/drawing';
import type { Entity } from '../model/entity';
import { loadDemo } from '../ui/demo';
import { SCHEMA_VERSION, parseDrawing, serializeDrawing } from './nativeFile';

function reopen(text: string) {
  const r = parseDrawing(text);
  if (!r.ok) throw new Error(r.error);
  return r.drawing;
}

const v1 = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'DanCAM drawing',
    schemaVersion: 1,
    units: 'in',
    nextId: 2,
    layers: [{ name: '0', color: '#000000', visible: true, style: 'visible' }],
    entities: [{ kind: 'line', id: 'e1', layer: '0', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
    ...over,
  });

const errorOf = (text: string): string => {
  const r = parseDrawing(text);
  return r.ok ? 'opened' : r.error;
};

describe('native file', () => {
  it('round-trips the demo drawing exactly: units, layers, entities, ids and next id', () => {
    const d = createDrawing('mm');
    loadDemo(d);
    const back = reopen(serializeDrawing(d));
    expect(back.units).toBe('mm');
    expect([...back.layers.values()]).toEqual([...d.layers.values()]);
    expect([...back.entities.values()]).toEqual([...d.entities.values()]);
    expect(back.nextId).toBe(d.nextId);
  });

  it('round-trips any coordinates bit for bit', () => {
    const coord = fc.double({ noNaN: true, noDefaultInfinity: true });
    fc.assert(
      fc.property(coord, coord, coord, coord, (x1, y1, x2, y2) => {
        const d = createDrawing('in');
        d.entities.set('e1', { kind: 'line', id: 'e1', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
        const line = reopen(serializeDrawing(d)).entities.get('e1') as Extract<Entity, { kind: 'line' }>;
        // Object.is: -0 may come back as 0 (JSON has no -0); every other value is identical.
        for (const [a, b] of [
          [line.start.x, x1],
          [line.start.y, y1],
          [line.end.x, x2],
          [line.end.y, y2],
        ] as const) {
          expect(a === b).toBe(true);
        }
      }),
    );
  });

  it('writes readable, indented JSON with the format and version first', () => {
    const text = serializeDrawing(createDrawing('in'));
    expect(text.startsWith(`{\n  "format": "DanCAM drawing",\n  "schemaVersion": ${SCHEMA_VERSION},`)).toBe(true);
  });

  it('keeps the next id ahead of every id in the file, even if it was edited down', () => {
    const d = reopen(v1({ nextId: 1 }));
    expect(d.nextId).toBe(2);
  });

  it('refuses files it cannot trust, saying why', () => {
    expect(errorOf('{not json')).toBe('This file is not valid JSON.');
    expect(errorOf(JSON.stringify({ hello: 1 }))).toBe('This is not a DanCAM drawing.');
    expect(errorOf(v1({ schemaVersion: 99 }))).toBe(
      'This drawing was saved by a newer DanCAM (file version 99); update DanCAM to open it.',
    );
    expect(errorOf(v1({ units: 'cm' }))).toBe('units must be "in" or "mm".');
    expect(errorOf(v1({ entities: [{ kind: 'spline', id: 'e1', layer: '0' }] }))).toBe('entities[0]: unknown kind "spline".');
    expect(errorOf(v1({ entities: [{ kind: 'point', id: 'e1', layer: 'X', at: { x: 0, y: 0 } }] }))).toBe(
      'entities[0]: layer "X" is not defined.',
    );
    expect(errorOf(v1({ entities: [{ kind: 'point', id: 'e1', layer: '0', at: { x: '1', y: 0 } }] }))).toBe(
      'entities[0].at.x must be a number.',
    );
    expect(
      errorOf(v1({ entities: [{ kind: 'circle', id: 'e1', layer: '0', center: { x: 0, y: 0 }, radius: 0 }] })),
    ).toBe('entities[0].radius must be more than zero.');
    expect(
      errorOf(v1({ entities: [{ kind: 'arc', id: 'e1', layer: '0', center: { x: 0, y: 0 }, radius: 1, startDeg: 0, endDeg: 360 }] })),
    ).toBe('entities[0].endDeg must be at least 0 and below 360.');
    expect(errorOf(v1({ entities: [{ kind: 'xline', id: 'e1', layer: '0', base: { x: 0, y: 0 }, dir: { x: 1, y: 1 } }] }))).toBe(
      'entities[0].dir must be a unit vector.',
    );
    const twice = { kind: 'point', id: 'e1', layer: '0', at: { x: 0, y: 0 } };
    expect(errorOf(v1({ entities: [twice, twice] }))).toBe('entities[1]: id "e1" appears twice.');
    expect(errorOf(v1({ entities: [{ ...twice, style: 'wavy' }] }))).toBe(
      'entities[0].style must be one of visible, hidden, center, tangent.',
    );
  });
});
