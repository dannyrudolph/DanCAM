import { angleDeg, ccwDeg } from '../geometry/angle';
import { type Vec2, sub } from '../geometry/vec';
import { KIND_LABEL, rowsFor } from '../model/properties';
import type { PointRequest, Request, ToolDef, ToolGen, ToolInput } from './tool';

/**
 * Inquiry tools read the drawing and never change it. Each result goes to
 * the results panel at full precision. They repeat, like the drawing
 * tools, so you can keep measuring until Esc.
 */

function* point(req: Omit<PointRequest, 'kind'>): Generator<Request, Vec2 | undefined, ToolInput> {
  for (;;) {
    const input = yield { ...req, kind: 'point' };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'point') return input.at;
  }
}

export const distTool: ToolDef = {
  id: 'dist',
  label: 'Dist',
  shortcut: 'd',
  *run(ctx): ToolGen {
    const a = yield* point({ prompt: 'Dist: pick the first point' });
    if (!a) return;
    const b = yield* point({ prompt: 'Dist: pick the second point', base: a });
    if (!b) return;
    const d = sub(b, a);
    ctx.report({
      title: 'Dist',
      rows: [
        { label: 'Distance', value: Math.hypot(d.x, d.y) },
        { label: 'ΔX', value: d.x },
        { label: 'ΔY', value: d.y },
        { label: 'Angle', value: angleDeg(d), unit: '°' },
      ],
    });
  },
};

export const idTool: ToolDef = {
  id: 'id',
  label: 'ID',
  shortcut: '',
  *run(ctx): ToolGen {
    const p = yield* point({ prompt: 'ID: pick a point' });
    if (!p) return;
    ctx.report({ title: 'ID', rows: [{ label: 'X', value: p.x }, { label: 'Y', value: p.y }] });
  },
};

export const listTool: ToolDef = {
  id: 'list',
  label: 'List',
  shortcut: '',
  *run(ctx): ToolGen {
    const input = yield { kind: 'entity', prompt: 'List: pick an object', accepts: () => true };
    if (input.kind !== 'entity') return;
    const e = ctx.drawing.entities.get(input.id);
    if (!e) return;
    ctx.report({ title: `List: ${KIND_LABEL[e.kind]} ${e.id}`, rows: rowsFor(ctx.drawing, e) });
  },
};

/**
 * Angle: a vertex and a point on each arm. Reports the included angle
 * (0–180°) and the counter-clockwise angle from the first arm to the second.
 */
export const angleTool: ToolDef = {
  id: 'angle',
  label: 'Angle',
  shortcut: '',
  *run(ctx): ToolGen {
    const v = yield* point({ prompt: 'Angle: pick the vertex' });
    if (!v) return;
    const a = yield* point({ prompt: 'Angle: pick a point on the first arm', base: v });
    if (!a) return;
    const b = yield* point({ prompt: 'Angle: pick a point on the second arm', base: v });
    if (!b) return;
    if ((a.x === v.x && a.y === v.y) || (b.x === v.x && b.y === v.y)) {
      ctx.message('Each arm needs a point away from the vertex.');
      return;
    }
    const ccw = ccwDeg(angleDeg(sub(a, v)), angleDeg(sub(b, v)));
    ctx.report({
      title: 'Angle',
      rows: [
        { label: 'Included', value: Math.min(ccw, 360 - ccw), unit: '°' },
        { label: 'Counter-clockwise', value: ccw, unit: '°' },
      ],
    });
  },
};
