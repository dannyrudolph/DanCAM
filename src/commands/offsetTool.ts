import { offsetCurve, offsetThrough } from '../geometry/offset';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, entityCurve, entityFromCurve } from '../model/entity';
import type { ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID } from './toolSteps';

/**
 * Offset (O): a parallel copy of a line, ray or xline, or a concentric one of
 * an arc or circle, at a typed distance toward a picked side, or through a
 * picked point. Object after object until Enter; each copy is its own undo
 * step. Distance and mode are remembered.
 */
export function createOffsetTool(): ToolDef {
  let dist: number | undefined;
  let through = false;
  const options = (): ToolOption[] => [
    { key: 'distance', label: dist === undefined ? 'Distance…' : `Distance ${dist}…`, enabled: true, active: !through },
    { key: 'through', label: 'Through point', enabled: true, active: through },
  ];
  return {
    id: 'offset',
    label: 'Offset',
    shortcut: 'o',
    repeat: false,
    *run(ctx): ToolGen {
      let askDistance = !through && dist === undefined;
      for (;;) {
        if (askDistance) {
          const input = yield { kind: 'value', prompt: 'Offset: type the distance', label: 'D', quantity: 'length', options: options() };
          if (input.kind === 'finish') return;
          if (input.kind === 'option' && input.key === 'through') {
            through = true;
            askDistance = false;
          }
          if (input.kind === 'value') {
            if (input.value > 0) {
              dist = input.value;
              through = false;
              askDistance = false;
            } else ctx.message('The offset distance must be more than zero.');
          }
          continue;
        }
        const mode = through ? 'through a point' : `distance ${dist}`;
        const pick = yield { kind: 'entity', prompt: `Offset (${mode}): pick the object to offset, Enter to finish`, accepts: (e) => entityCurve(e) !== undefined, options: options(), canFinish: true };
        if (pick.kind === 'finish') return;
        if (pick.kind === 'option') {
          if (pick.key === 'through') through = true;
          else askDistance = true;
          continue;
        }
        if (pick.kind !== 'entity') continue;
        const e = ctx.drawing.entities.get(pick.id);
        const c = e && entityCurve(e);
        if (!e || !c) continue;
        const made = (p: Vec2): Entity | undefined => {
          const o = through ? offsetThrough(c, p) : offsetCurve(c, dist!, p);
          return o && entityFromCurve({ ...e, id: PREVIEW_ID }, o);
        };
        for (;;) {
          const side = yield {
            kind: 'point',
            prompt: through ? 'Offset: pick the point to pass through' : 'Offset: pick the side to offset to',
            preview: (p) => {
              const m = made(p);
              return m ? [m] : [];
            },
          };
          if (side.kind === 'finish') return;
          if (side.kind !== 'point') continue;
          const m = made(side.at);
          if (!m) {
            ctx.message(through ? 'That point is on the object; pick one off it.' : 'Pick a point off the object, on the side to offset to (an arc can only shrink to more than zero).');
            continue;
          }
          ctx.undo.commit({ label: 'Offset', changes: [{ op: 'add', entity: { ...m, id: newEntityId(ctx.drawing) } }] });
          break;
        }
      }
    },
  };
}
