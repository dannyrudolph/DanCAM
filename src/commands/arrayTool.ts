import { polarArray, rectangularArray } from '../geometry/array';
import { withNewIds } from '../model/anchor';
import { EMPTY_BBOX, union } from '../geometry/bbox';
import type { Transform } from '../geometry/transform';
import type { Vec2 } from '../geometry/vec';
import { type Entity, entityBBox, transformEntity } from '../model/entity';
import { objects, value } from './editTools';
import type { ToolDef, ToolGen, ToolOption } from './tool';

const copies = (es: readonly Entity[], ts: readonly Transform[]): Entity[] => ts.flatMap((t) => es.map((e) => transformEntity(e, t)));

const isCount = (n: number, min: number): boolean => Number.isInteger(n) && n >= min;

/**
 * Array (Shift+A): copies of the objects (selection first) in a grid of rows
 * and columns, or round a center (count, fill angle, items turned or not).
 * Values are typed; the last one previews the result. One undo step.
 */
export function createArrayTool(): ToolDef {
  let polar = false;
  let rotateItems = true;
  const methodOptions = (): ToolOption[] => [
    { key: 'rect', label: 'Rectangular', enabled: true, active: !polar },
    { key: 'polar', label: 'Polar', enabled: true, active: polar },
  ];
  return {
    id: 'array',
    label: 'Array',
    shortcut: 'shift+a',
    repeat: false,
    *run(ctx): ToolGen {
      const es = yield* objects(ctx, 'Array');
      if (!es) return;
      const commit = (ts: readonly Transform[]): void => {
        const adds = ts.flatMap((t) => withNewIds(ctx.drawing, copies(es, [t])));
        ctx.undo.commit({ label: 'Array', changes: adds.map((entity) => ({ op: 'add', entity })) });
      };
      // The first step carries the Rectangular / Polar choice.
      let center: Vec2 | undefined;
      let rows: number | undefined;
      while (center === undefined && rows === undefined) {
        const input = polar
          ? yield { kind: 'point', prompt: 'Array (polar): pick the center', options: methodOptions() }
          : yield { kind: 'value', prompt: 'Array (rectangular): type the number of rows', label: 'Rows', quantity: 'factor', options: methodOptions() };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') polar = input.key === 'polar';
        else if (input.kind === 'point' && polar) center = input.at;
        else if (input.kind === 'value' && !polar) {
          if (isCount(input.value, 1)) rows = input.value;
          else ctx.message('Rows must be a whole number, 1 or more.');
        }
      }
      if (center) {
        const c = center;
        let count: number | undefined;
        while (count === undefined) {
          const n = yield* value({ prompt: 'Array (polar): type the number of items, including the original', label: 'N', quantity: 'factor' });
          if (n === undefined) return;
          if (isCount(n, 2)) count = n;
          else ctx.message('The number of items must be a whole number, 2 or more.');
        }
        const n = count;
        const box = es.reduce((b, e) => union(b, entityBBox(e)), EMPTY_BBOX);
        const ref = Number.isFinite(box.minX) ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } : c;
        for (;;) {
          const input = yield {
            kind: 'value',
            prompt: 'Array (polar): type the angle to fill (360 for a full circle, negative for clockwise)',
            label: '∠',
            quantity: 'angle',
            options: [
              { key: 'rotate', label: 'Rotate items', enabled: true, active: rotateItems },
              { key: 'norotate', label: "Don't rotate", enabled: true, active: !rotateItems },
            ],
            preview: (deg) => (deg === 0 ? [] : copies(es, polarArray(c, n, deg, rotateItems, ref))),
          };
          if (input.kind === 'finish') return;
          if (input.kind === 'option') rotateItems = input.key === 'rotate';
          if (input.kind !== 'value') continue;
          if (input.value === 0 || Math.abs(input.value) > 360) {
            ctx.message('The fill angle must be between -360° and 360°, and not 0.');
            continue;
          }
          commit(polarArray(c, n, input.value, rotateItems, ref));
          return;
        }
      }
      const r = rows!;
      let cols: number | undefined;
      while (cols === undefined) {
        const n = yield* value({ prompt: 'Array (rectangular): type the number of columns', label: 'Cols', quantity: 'factor' });
        if (n === undefined) return;
        if (isCount(n, 1) && r * n >= 2) cols = n;
        else ctx.message('Columns must be a whole number, and rows × columns at least 2.');
      }
      const k = cols;
      let rowSpacing = 0;
      if (r > 1) {
        const d = yield* value({ prompt: 'Array (rectangular): type the distance between rows (negative: downward)', label: 'ΔY', quantity: 'length' });
        if (d === undefined) return;
        rowSpacing = d;
      }
      let colSpacing = 0;
      if (k > 1) {
        const rs = rowSpacing;
        const d = yield* value({
          prompt: 'Array (rectangular): type the distance between columns (negative: to the left)',
          label: 'ΔX',
          quantity: 'length',
          preview: (dx) => copies(es, rectangularArray(r, k, rs, dx)),
        });
        if (d === undefined) return;
        colSpacing = d;
      }
      commit(rectangularArray(r, k, rowSpacing, colSpacing));
    },
  };
}
