import { type Curve, intersectCurves } from '../geometry/curve';
import { extendCurve } from '../geometry/extend';
import { trimCurve } from '../geometry/trim';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, type EntityId, entityCurve, entityFromCurve } from '../model/entity';
import type { Change } from '../model/undo';
import type { ToolContext, ToolDef, ToolGen } from './tool';
import { PREVIEW_ID } from './toolSteps';

type Mode = 'trim' | 'extend';

const LABEL: Record<Mode, string> = { trim: 'Trim', extend: 'Extend' };

/**
 * The edges a pick is cut by or extended to: the chosen ones, or every
 * visible curve when the user pressed Enter (`undefined`), read fresh at each
 * pick so edges already trimmed count as they are now. Never the picked
 * object itself.
 */
function edgeCurves(ctx: ToolContext, edges: readonly EntityId[] | undefined, except: EntityId): Curve[] {
  const d = ctx.drawing;
  const es = edges ? edges.map((id) => d.entities.get(id)) : [...d.entities.values()].filter((e) => d.layers.get(e.layer)?.visible !== false);
  const out: Curve[] = [];
  for (const e of es) {
    if (!e || e.id === except) continue;
    const c = entityCurve(e);
    if (c) out.push(c);
  }
  return out;
}

/** What a pick would change: the changes to commit, and what to draw as its preview. */
type Outcome = { readonly changes: readonly Change[]; readonly preview: readonly Entity[] };

/** `newId` names pieces split off; a preview passes one that allocates nothing. */
function trimOutcome(e: Entity, edges: readonly Curve[], at: Vec2, newId: () => EntityId): Outcome | undefined {
  const c = entityCurve(e);
  if (!c) return undefined;
  const cuts = edges.flatMap((edge) => intersectCurves(c, edge));
  const r = trimCurve(c, cuts, at);
  if (!r) return undefined;
  const [first, ...rest] = r.kept;
  const changes: Change[] = first ? [{ op: 'modify', before: e, after: entityFromCurve(e, first) }] : [{ op: 'remove', entity: e }];
  for (const k of rest) changes.push({ op: 'add', entity: entityFromCurve({ ...e, id: newId() }, k) });
  return { changes, preview: [entityFromCurve({ ...e, id: PREVIEW_ID }, r.removed)] };
}

function extendOutcome(e: Entity, edges: readonly Curve[], at: Vec2): Outcome | undefined {
  const c = entityCurve(e);
  const r = c && extendCurve(c, edges, at);
  if (!r) return undefined;
  return { changes: [{ op: 'modify', before: e, after: entityFromCurve(e, r) }], preview: [entityFromCurve({ ...e, id: PREVIEW_ID }, r)] };
}

/**
 * Trim and Extend: choose the edges (the selection, picked objects, or
 * Enter for all), then pick objects one after another until Enter. Trim
 * removes the piece picked, up to the nearest edges; Extend runs the end
 * nearer the pick to the next edge. Shift-pick does the other one. Each
 * pick is its own undo step.
 */
function trimExtendTool(mode: Mode): ToolDef {
  const label = LABEL[mode];
  const other: Mode = mode === 'trim' ? 'extend' : 'trim';
  const noun = mode === 'trim' ? 'cutting edges' : 'boundaries';
  return {
    id: mode,
    label,
    shortcut: mode === 'trim' ? 't' : 'shift+t',
    repeat: false,
    *run(ctx): ToolGen {
      let edges: readonly EntityId[] | undefined = ctx.selection().length > 0 ? ctx.selection() : undefined;
      if (!edges) {
        for (;;) {
          const input = yield { kind: 'selection', prompt: `${label}: select ${noun}, then Enter (Enter alone: all objects)`, canFinish: true };
          if (input.kind === 'finish') break;
          if (input.kind === 'selection') {
            edges = input.ids;
            break;
          }
        }
      }
      const outcome = (id: EntityId, at: Vec2, shift: boolean, newId: () => EntityId): Outcome | undefined => {
        const e = ctx.drawing.entities.get(id);
        if (!e) return undefined;
        const m = shift ? other : mode;
        const curves = edgeCurves(ctx, edges, id);
        return m === 'trim' ? trimOutcome(e, curves, at, newId) : extendOutcome(e, curves, at);
      };
      for (;;) {
        const input = yield {
          kind: 'entity',
          prompt: `${label}: pick the part to ${mode === 'trim' ? 'remove' : 'extend'} (Shift: ${other}), Enter to finish`,
          accepts: (e) => entityCurve(e) !== undefined,
          preview: (id, at, shift) => outcome(id, at, shift, () => PREVIEW_ID)?.preview ?? [],
          canFinish: true,
        };
        if (input.kind === 'finish') return;
        if (input.kind !== 'entity') continue;
        const m = input.shift ? other : mode;
        const o = outcome(input.id, input.at, input.shift === true, () => newEntityId(ctx.drawing));
        if (o) ctx.undo.commit({ label: LABEL[m], changes: o.changes });
        else ctx.message(m === 'trim' ? 'Nothing to trim there: no edge crosses that part.' : 'No boundary ahead of that end.');
      }
    },
  };
}

export const trimTool = trimExtendTool('trim');
export const extendTool = trimExtendTool('extend');
