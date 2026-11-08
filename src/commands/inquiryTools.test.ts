import { describe, expect, it } from 'vitest';
import type { CircleEntity } from '../model/entity';
import { angleTool, distTool, idTool, listTool } from './inquiryTools';
import { setup } from './toolHarness';

const values = (rows: readonly { label: string; value: number | string }[]) => Object.fromEntries(rows.map((r) => [r.label, r.value]));

describe('inquiry tools', () => {
  it('Dist reports distance, deltas and angle between two points, then repeats', () => {
    const t = setup();
    t.runner.start(distTool);
    t.click(1, 1);
    t.click(4, 5);
    expect(t.reports).toEqual([
      { title: 'Dist', rows: [{ label: 'Distance', value: 5 }, { label: 'ΔX', value: 3 }, { label: 'ΔY', value: 4 }, { label: 'Angle', value: expect.closeTo(53.130102354, 8), unit: '°' }] },
    ]);
    expect(t.runner.request?.prompt).toBe('Dist: pick the first point');
    expect(t.drawing.entities.size).toBe(0);
  });

  it('ID reports the exact coordinates it was given', () => {
    const t = setup();
    t.runner.start(idTool);
    t.click(0.1 + 0.2, Math.SQRT1_2);
    expect(values(t.reports[0]!.rows)).toEqual({ X: 0.1 + 0.2, Y: Math.SQRT1_2 });
  });

  it('List reports the same rows as the properties panel', () => {
    const t = setup();
    const c: CircleEntity = { kind: 'circle', id: 'e7', layer: '0', center: { x: 1, y: 2 }, radius: 0.25 };
    t.add(c);
    t.runner.start(listTool);
    t.pick('e7', 1.25, 2);
    expect(t.reports[0]!.title).toBe('List: Circle e7');
    expect(values(t.reports[0]!.rows)).toMatchObject({ Layer: '0', 'Center X': 1, 'Center Y': 2, Radius: 0.25, Diameter: 0.5 });
  });

  it('Angle reports the included angle and the counter-clockwise angle between the arms', () => {
    const t = setup();
    t.runner.start(angleTool);
    t.click(0, 0);
    t.click(1, 0);
    t.click(-1, -1); // 225° counter-clockwise from the first arm
    expect(values(t.reports[0]!.rows)).toEqual({ Included: 135, 'Counter-clockwise': 225 });
  });

  it('Angle refuses an arm point on the vertex', () => {
    const t = setup();
    t.runner.start(angleTool);
    t.click(0, 0);
    t.click(0, 0);
    t.click(1, 1);
    expect(t.reports).toEqual([]);
    expect(t.messages.at(-1)).toBe('Each arm needs a point away from the vertex.');
  });
});
