import { type Curve, intersectCurves } from '../geometry/curve';
import { extendCurve } from '../geometry/extend';
import { trimCurve } from '../geometry/trim';
import type { Vec2 } from '../geometry/vec';
import { instanceEntities } from '../model/block';
import { newEntityId } from '../model/drawing';
import { type Entity, type EntityId, entityCurve, entityFromCurve } from '../model/entity';
import type { Change } from '../model/undo';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption } from './tool';
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
    // A block instance is an edge with each of its parts; it is never trimmed itself.
    for (const part of e.kind === 'insert' ? instanceEntities(d, e) : [e]) {
      const c = entityCurve(part);
      if (c) out.push(c);
    }
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

type EdgeMethod = 'all' | 'select';
const METHOD_PREFIX = 'method:';
const EDGE_METHODS: readonly { key: EdgeMethod; label: string }[] = [
  { key: 'all', label: 'All objects' },
  { key: 'select', label: 'Select edges' },
];

/**
 * Trim and Extend. By default every visible object is an edge, so the tool
 * goes straight to picking: the piece under the cursor, up to the nearest
 * crossings either way, is highlighted, and a click removes it (Extend: the
 * end nearer the cursor runs to the next edge). "Select edges" in the options
 * bar asks for the edges first (Enter alone: all objects); objects selected
 * when the tool starts are the edges without asking. Picks go on until
 * Enter. Shift-pick does the other one. Each pick is its own undo step; the
 * edge method is remembered for the session.
 */
function trimExtendTool(mode: Mode): ToolDef {
  const label = LABEL[mode];
  const other: Mode = mode === 'trim' ? 'extend' : 'trim';
  const noun = mode === 'trim' ? 'cutting edges' : 'boundaries';
  let method: EdgeMethod = 'all';
  const options = (): ToolOption[] => EDGE_METHODS.map((m) => ({ key: METHOD_PREFIX + m.key, label: m.label, enabled: true, active: m.key === method }));
  const chosen = (key: string): EdgeMethod | undefined => EDGE_METHODS.find((m) => METHOD_PREFIX + m.key === key)?.key;
  return {
    id: mode,
    label,
    shortcut: mode === 'trim' ? 't' : 'shift+t',
    repeat: false,
    *run(ctx): ToolGen {
      let edges: readonly EntityId[] | undefined = ctx.selection().length > 0 ? ctx.selection() : undefined;
      const selectEdges = function* (): Generator<Request, void, ToolInput> {
        for (;;) {
          const input = yield { kind: 'selection', prompt: `${label}: select ${noun}, then Enter (Enter alone: all objects)`, canFinish: true, options: options() };
          if (input.kind === 'option' && chosen(input.key) === 'all') {
            method = 'all';
            return;
          }
          if (input.kind === 'finish') return;
          if (input.kind === 'selection') {
            edges = input.ids;
            return;
          }
        }
      };
      if (!edges && method === 'select') yield* selectEdges();
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
          options: options(),
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') {
          const m = chosen(input.key);
          if (m === 'all') {
            method = 'all';
            edges = undefined;
          } else if (m === 'select') {
            method = 'select';
            edges = undefined;
            yield* selectEdges();
          }
          continue;
        }
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
