import { centerlineBetween } from '../model/associate';
import type { DimensionEntity, LineEntity } from '../model/entity';
import type { ToolDef, ToolGen } from './tool';
import { MethodChoice, addEntity } from './toolSteps';

/**
 * Center mark (Shift+E) (spec, "Dimensioning"): pick a circle or arc and it
 * gets a center mark; or, with Two lines, pick two lines for a centerline
 * midway between them. Both are anchored, so they follow their geometry
 * and go when it does. One undo step each; sticky; the method is kept for
 * the session.
 */
export function createCenterMarkTool(): ToolDef {
  const method = new MethodChoice<'curve' | 'lines'>(
    [
      { key: 'curve', label: 'Circle or arc' },
      { key: 'lines', label: 'Two lines' },
    ],
    'curve',
  );
  return {
    id: 'centerMark',
    label: 'Center mark / centerline',
    shortcut: 'shift+e',
    *run(ctx): ToolGen {
      const d = ctx.drawing;
      const base = { kind: 'dimension' as const, layer: ctx.newProps().layer, dimStyle: d.currentDimStyle };
      if (method.current === 'curve') {
        const pick = yield* method.entity(ctx, { prompt: 'Center mark: pick a circle or arc', accepts: (e) => e.kind === 'circle' || e.kind === 'arc' });
        if (!pick) return;
        const c = pick.entity;
        if (c.kind !== 'circle' && c.kind !== 'arc') return;
        const marked = [...d.entities.values()].some((e) => e.kind === 'dimension' && e.type === 'centerMark' && e.anchors?.curve === c.id);
        if (marked) {
          ctx.message(`That ${c.kind} already has a center mark.`);
          return;
        }
        addEntity(ctx, 'Center mark', (id): DimensionEntity => ({ ...base, id, type: 'centerMark', center: c.center, radius: c.radius, at: c.center, anchors: { curve: c.id } }));
        return;
      }
      const isLine = (e: { kind: string }): boolean => e.kind === 'line';
      const first = yield* method.entity(ctx, { prompt: 'Centerline: pick the first line', accepts: isLine });
      if (!first) return;
      const second = yield* method.entity(ctx, { prompt: 'Centerline: pick the second line', accepts: (e) => isLine(e) && e.id !== first.entity.id });
      if (!second) return;
      const l1 = first.entity as LineEntity;
      const l2 = second.entity as LineEntity;
      const ends = centerlineBetween(l1, l2);
      if (!ends) {
        ctx.message('Those lines give a centerline of no length.');
        return;
      }
      const at = { x: (ends.p1.x + ends.p2.x) / 2, y: (ends.p1.y + ends.p2.y) / 2 };
      addEntity(ctx, 'Centerline', (id): DimensionEntity => ({ ...base, id, type: 'centerline', ...ends, at, anchors: { lines: [l1.id, l2.id] } }));
    },
  };
}
