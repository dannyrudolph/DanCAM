import { arcSweepDeg } from '../geometry/arc';
import { breakAt, breakBetween } from '../geometry/breakCurve';
import type { Curve } from '../geometry/curve';
import { joinCurves } from '../geometry/join';
import { type LengthenSpec, lengthenCurve } from '../geometry/lengthen';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, entityCurve, entityFromCurve } from '../model/entity';
import type { Change } from '../model/undo';
import { objects } from './editTools';
import type { ToolContext, ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID } from './toolSteps';

const isCurve = (e: Entity): boolean => entityCurve(e) !== undefined;

/** The first piece replaces the object (same id); any others are added with new ids. */
function replaceWith(ctx: ToolContext, e: Entity, pieces: readonly Curve[]): Change[] {
  const [first, ...rest] = pieces;
  return [
    { op: 'modify', before: e, after: entityFromCurve(e, first!) },
    ...rest.map((p): Change => ({ op: 'add', entity: entityFromCurve({ ...e, id: newEntityId(ctx.drawing) }, p) })),
  ];
}

/**
 * Break (B): Two points removes the part between them (counter-clockwise on a
 * circle); At point splits the object in two there. Points come from clicks
 * with snaps and land on the object at the nearest point. Sticky; the method
 * is remembered.
 */
export function createBreakTool(): ToolDef {
  let at = false;
  const options = (): ToolOption[] => [
    { key: 'two', label: 'Two points', enabled: true, active: !at },
    { key: 'at', label: 'At point', enabled: true, active: at },
  ];
  return {
    id: 'break',
    label: 'Break',
    shortcut: 'b',
    *run(ctx): ToolGen {
      let e: Entity | undefined;
      while (!e) {
        const input = yield { kind: 'entity', prompt: `Break (${at ? 'at point' : 'two points'}): pick the object`, accepts: isCurve, options: options() };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') at = input.key === 'at';
        if (input.kind === 'entity') e = ctx.drawing.entities.get(input.id);
      }
      const target = e;
      const c = entityCurve(target)!;
      if (at) {
        for (;;) {
          const input = yield { kind: 'point', prompt: 'Break: pick the point to break at' };
          if (input.kind === 'finish') return;
          if (input.kind !== 'point') continue;
          const pieces = breakAt(c, input.at);
          if (pieces) {
            ctx.undo.commit({ label: 'Break', changes: replaceWith(ctx, target, pieces) });
            return;
          }
          ctx.message(c.kind === 'circle' ? 'A circle needs two break points: use Two points.' : 'That is an end; pick a point between the ends.');
        }
      }
      let first: Vec2 | undefined;
      while (!first) {
        const input = yield { kind: 'point', prompt: 'Break: pick the first break point' };
        if (input.kind === 'finish') return;
        if (input.kind === 'point') first = input.at;
      }
      const p1 = first;
      for (;;) {
        const input = yield {
          kind: 'point',
          prompt: 'Break: pick the second break point',
          base: p1,
          preview: (p) => (breakBetween(c, p1, p) ?? []).map((k) => entityFromCurve({ ...target, id: PREVIEW_ID }, k)),
        };
        if (input.kind === 'finish') return;
        if (input.kind !== 'point') continue;
        const kept = breakBetween(c, p1, input.at);
        if (kept && kept.length > 0) {
          ctx.undo.commit({ label: 'Break', changes: replaceWith(ctx, target, kept) });
          return;
        }
        ctx.message('Pick a second point apart from the first.');
      }
    },
  };
}

/**
 * Join (J): of the objects given (selection first), joins every pair that can
 * be: collinear lines, across gaps; arcs on one circle, bridging the smaller
 * gap (a circle when they close it). One arc on its own closes into its
 * circle. One undo step.
 */
export const joinTool: ToolDef = {
  id: 'join',
  label: 'Join',
  shortcut: 'j',
  repeat: false,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Join');
    if (!es) return;
    // One arc on its own closes into its circle, as AutoCAD's Join does.
    const only = es.length === 1 ? es[0]! : undefined;
    if (only?.kind === 'arc') {
      ctx.undo.commit({ label: 'Join', changes: [{ op: 'modify', before: only, after: entityFromCurve(only, { kind: 'circle', center: only.center, radius: only.radius }) }] });
      ctx.message('Closed the arc into a circle.');
      return;
    }
    const pool = es.flatMap((e) => {
      const c = entityCurve(e);
      return c ? [{ e, c, gone: false, grew: false }] : [];
    });
    let merged = false;
    for (let changed = true; changed; ) {
      changed = false;
      for (const a of pool) {
        for (const b of pool) {
          if (a === b || a.gone || b.gone) continue;
          const j = shorter(joinCurves(a.c, b.c), joinCurves(b.c, a.c));
          if (!j) continue;
          a.c = j;
          a.grew = true;
          b.gone = true;
          changed = merged = true;
        }
      }
    }
    if (!merged) {
      ctx.message('Nothing to join: give collinear lines or arcs on one circle.');
      return;
    }
    const changes: Change[] = [];
    for (const p of pool) {
      if (p.gone) changes.push({ op: 'remove', entity: p.e });
      else if (p.grew) changes.push({ op: 'modify', before: p.e, after: entityFromCurve(p.e, p.c) });
    }
    ctx.undo.commit({ label: 'Join', changes });
    const left = pool.filter((p) => !p.gone).length;
    ctx.message(`Joined ${pool.length} objects into ${left}.`);
  },
};

/** Of two joins of the same pair, the one bridging less (arcs joined either way round). */
function shorter(a: Curve | undefined, b: Curve | undefined): Curve | undefined {
  if (!a || !b) return a ?? b;
  return curveSpan(a) <= curveSpan(b) ? a : b;
}

function curveSpan(c: Curve): number {
  if (c.kind === 'arc') return arcSweepDeg(c);
  if (c.kind === 'segment') return Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  return Infinity;
}

const LENGTHEN_LABEL: Record<LengthenSpec['kind'], string> = { delta: 'Delta', total: 'Total', percent: 'Percent' };

/**
 * Lengthen (Shift+L): lines and arcs, at the end nearer the pick, by a
 * delta, to a total length, or by a percent. The value is typed once and
 * kept; object after object until Enter, each its own undo step.
 */
export function createLengthenTool(): ToolDef {
  let kind: LengthenSpec['kind'] = 'delta';
  const values: Partial<Record<LengthenSpec['kind'], number>> = {};
  const options = (): ToolOption[] =>
    (['delta', 'total', 'percent'] as const).map((k) => ({ key: k, label: values[k] === undefined ? LENGTHEN_LABEL[k] : `${LENGTHEN_LABEL[k]} ${values[k]}${k === 'percent' ? '%' : ''}`, enabled: true, active: k === kind }));
  return {
    id: 'lengthen',
    label: 'Lengthen',
    shortcut: 'shift+l',
    repeat: false,
    *run(ctx): ToolGen {
      let ask = values[kind] === undefined;
      for (;;) {
        if (ask) {
          const input = yield {
            kind: 'value',
            prompt: kind === 'delta' ? 'Lengthen: type the length to add (negative shortens)' : kind === 'total' ? 'Lengthen: type the total length' : 'Lengthen: type the percent of the current length',
            label: kind === 'delta' ? 'Δ' : kind === 'total' ? 'L' : '%',
            quantity: kind === 'percent' ? 'factor' : 'length',
            options: options(),
          };
          if (input.kind === 'finish') return;
          if (input.kind === 'option') kind = input.key as LengthenSpec['kind'];
          if (input.kind === 'value') {
            if (kind !== 'delta' && input.value <= 0) ctx.message('The value must be more than zero.');
            else {
              values[kind] = input.value;
              ask = false;
            }
          }
          continue;
        }
        const spec: LengthenSpec = { kind, value: values[kind]! };
        const result = (e: Entity, p: Vec2): Entity | undefined => {
          const c = entityCurve(e);
          const r = c && lengthenCurve(c, p, spec);
          return r && entityFromCurve(e, r);
        };
        const input = yield {
          kind: 'entity',
          prompt: `Lengthen (${options().find((o) => o.active)!.label}): pick near the end to change, Enter to finish`,
          accepts: (e) => e.kind === 'line' || e.kind === 'arc',
          options: options(),
          canFinish: true,
          preview: (id, p) => {
            const e = ctx.drawing.entities.get(id);
            const r = e && result(e, p);
            return r ? [{ ...r, id: PREVIEW_ID }] : [];
          },
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') {
          kind = input.key as LengthenSpec['kind'];
          ask = true;
          continue;
        }
        if (input.kind !== 'entity') continue;
        const e = ctx.drawing.entities.get(input.id);
        const r = e && result(e, input.at);
        if (e && r) ctx.undo.commit({ label: 'Lengthen', changes: [{ op: 'modify', before: e, after: r }] });
        else ctx.message('That would leave it with no length (or an arc a full turn or more).');
      }
    },
  };
}
