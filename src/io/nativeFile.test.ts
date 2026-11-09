import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDrawing } from '../model/drawing';
import { defaultDimStyle } from '../model/dimStyle';
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
    expect([...back.entities.values()].filter((e) => e.kind === 'dimension')).toHaveLength(7);
    expect([...back.dimStyles.values()]).toEqual([...d.dimStyles.values()]);
    expect(back.currentDimStyle).toBe('MM-2PL');
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

  it('round-trips a ray', () => {
    const d = createDrawing('mm');
    const ray: Entity = { kind: 'ray', id: 'e1', layer: '0', base: { x: 0.1, y: -2 }, dir: { x: 0.6, y: 0.8 } };
    d.entities.set('e1', ray);
    expect(reopen(serializeDrawing(d)).entities.get('e1')).toEqual(ray);
  });

  it('opens a version 1 file with its unit\'s default dimension style', () => {
    const inch = reopen(v1());
    expect([...inch.dimStyles.values()]).toEqual([defaultDimStyle('in')]);
    expect(inch.currentDimStyle).toBe('INCH-3PL');
    expect(reopen(v1({ units: 'mm' })).currentDimStyle).toBe('MM-2PL');
  });

  it('round-trips an aligned dimension with geometry refs, and a style with tolerance, dual units and a suffix', () => {
    const d = createDrawing('in');
    const style = { ...defaultDimStyle('in'), name: 'TOL', tolerance: { kind: 'deviation' as const, upper: 0.002, lower: 0 }, dual: { precision: 2, zeros: { leading: true, trailing: false } }, suffix: ' TYP' };
    d.dimStyles.set('TOL', style);
    const e: Entity = { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'TOL', type: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 0.3, y: 0.4 }, at: { x: 0, y: 1 }, refs: ['e7'] };
    d.entities.set('e1', e);
    const back = reopen(serializeDrawing(d));
    expect(back.entities.get('e1')).toEqual(e);
    expect(back.dimStyles.get('TOL')).toEqual(style);
  });

  it('round-trips radius, diameter and angular dimensions', () => {
    const d = createDrawing('in');
    const es: Entity[] = [
      { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'radius', center: { x: 0.1, y: 0.2 }, radius: 0.015, at: { x: 1, y: 1 }, refs: ['e9'] },
      { kind: 'dimension', id: 'e2', layer: '0', dimStyle: 'INCH-3PL', type: 'diameter', center: { x: 0, y: 0 }, radius: 0.0625, at: { x: 0, y: 0 } },
      { kind: 'dimension', id: 'e3', layer: '0', dimStyle: 'INCH-3PL', type: 'angular', vertex: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 0, y: 0 }, dir1: { x: 1, y: 0 }, dir2: { x: 0.6, y: 0.8 }, at: { x: 2, y: 1 } },
    ];
    for (const e of es) d.entities.set(e.id, e);
    expect([...reopen(serializeDrawing(d)).entities.values()]).toEqual(es);
    const bad = { ...es[0], radius: 0 };
    d.entities.set('e1', bad as Entity);
    expect(errorOf(serializeDrawing(d))).toBe('entities[0].radius must be more than zero.');
  });

  it('refuses dimensions and styles it cannot trust', () => {
    const v2 = (over: Record<string, unknown>) => {
      const file = JSON.parse(serializeDrawing(createDrawing('in')));
      return JSON.stringify({ ...file, ...over });
    };
    const dimension = { kind: 'dimension', id: 'e1', layer: '0', dimStyle: 'INCH-3PL', type: 'linear', dir: { x: 1, y: 0 }, p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, at: { x: 0, y: 1 } };
    expect(reopen(v2({ entities: [dimension] })).entities.get('e1')).toEqual(dimension);
    expect(errorOf(v2({ entities: [{ ...dimension, dimStyle: 'NOPE' }] }))).toBe('entities[0]: dimension style "NOPE" is not defined.');
    expect(errorOf(v2({ entities: [{ ...dimension, dir: { x: 2, y: 0 } }] }))).toBe('entities[0].dir must be a unit vector.');
    expect(errorOf(v2({ entities: [{ ...dimension, type: 'radial' }] }))).toBe('entities[0].type must be linear, aligned, radius, diameter or angular.');
    const style = defaultDimStyle('in');
    expect(errorOf(v2({ dimStyles: [{ ...style, precision: 9 }] }))).toBe('dimStyles[0].precision must be a whole number from 0 to 8.');
    expect(errorOf(v2({ dimStyles: [{ ...style, textHeight: 0 }] }))).toBe('dimStyles[0].textHeight must be more than zero.');
    expect(errorOf(v2({ dimStyles: [{ ...style, tolerance: { kind: 'bonus' } }] }))).toBe('dimStyles[0].tolerance.kind must be none, symmetric, deviation or limits.');
    expect(errorOf(v2({ dimStyles: [style, style] }))).toBe('dimStyles[1]: style "INCH-3PL" appears twice.');
    expect(errorOf(v2({ currentDimStyle: 'X' }))).toBe('currentDimStyle: style "X" is not defined.');
  });

  it('writes readable, indented JSON with the format and version first', () => {
    const text = serializeDrawing(createDrawing('in'));
    expect(text.startsWith(`{\n  "format": "DanCAM drawing",\n  "schemaVersion": ${SCHEMA_VERSION},`)).toBe(true);
  });

  it('saves the current layer, and opens a file without one on layer 0', () => {
    const d = createDrawing('in');
    d.layers.set('CL', { name: 'CL', color: '#000000', visible: true, style: 'center' });
    d.currentLayer = 'CL';
    expect(reopen(serializeDrawing(d)).currentLayer).toBe('CL');
    expect(reopen(v1()).currentLayer).toBe('0');
    expect(errorOf(v1({ currentLayer: 'Nope' }))).toBe('currentLayer: layer "Nope" is not defined.');
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
    expect(errorOf(v1({ entities: [{ kind: 'ray', id: 'e1', layer: '0', base: { x: 0, y: 0 }, dir: { x: 0, y: 2 } }] }))).toBe(
      'entities[0].dir must be a unit vector.',
    );
    const twice = { kind: 'point', id: 'e1', layer: '0', at: { x: 0, y: 0 } };
    expect(errorOf(v1({ entities: [twice, twice] }))).toBe('entities[1]: id "e1" appears twice.');
    expect(errorOf(v1({ entities: [{ ...twice, style: 'wavy' }] }))).toBe(
      'entities[0].style must be one of visible, hidden, center, tangent.',
    );
  });
});
