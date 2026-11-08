import { type ChamferSpec, type Corner, chamferLines, filletCurves } from '../geometry/corner';
import type { Curve } from '../geometry/curve';
import type { Vec2 } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, type EntityId, type EntityProps, entityCurve, entityFromCurve } from '../model/entity';
import type { Change } from '../model/undo';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption, ValueRequest } from './tool';
import { PREVIEW_ID } from './toolSteps';

/**
 * The joint (fillet arc or chamfer line) takes the layer and style of the two
 * objects when they share them, and the current ones otherwise.
 */
function jointProps(ctx: ToolContext, a: Entity, b: Entity): EntityProps {
  if (a.layer === b.layer && a.style === b.style) return { layer: a.layer, ...(a.style ? { style: a.style } : {}) };
  return ctx.newProps();
}

/**
 * What a corner does to the drawing: the joint added, and, in trim mode,
 * each object reshaped (circles never are). `jointId` names the joint; a
 * preview passes one that allocates nothing.
 */
function cornerChanges(ctx: ToolContext, a: Entity, b: Entity, corner: Corner, trim: boolean, jointId: EntityId): Change[] {
  const changes: Change[] = [];
  if (trim && corner.first) changes.push({ op: 'modify', before: a, after: entityFromCurve(a, corner.first) });
  if (trim && corner.second) changes.push({ op: 'modify', before: b, after: entityFromCurve(b, corner.second) });
  if (corner.joint) changes.push({ op: 'add', entity: entityFromCurve({ id: jointId, ...jointProps(ctx, a, b) }, corner.joint) });
  return changes;
}

function previewOf(changes: readonly Change[]): Entity[] {
  return changes.flatMap((c) => (c.op === 'modify' ? [{ ...c.after, id: PREVIEW_ID }] : c.op === 'add' ? [c.entity] : []));
}

const num = (n: number): string => String(n);

/** Asks for one typed value; undefined if the user finishes instead. */
function* typed(req: Omit<ValueRequest, 'kind'>): Generator<Request, number | undefined, ToolInput> {
  for (;;) {
    const input = yield { ...req, kind: 'value' };
    if (input.kind === 'finish') return undefined;
    if (input.kind === 'value') return input.value;
  }
}

type CornerTool = {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  /** Which objects it works on. */
  accepts(e: Entity): boolean;
  /** Prompt suffix naming the current sizes, e.g. "R 0.02". */
  sizes(): string;
  /** Options besides Trim / No trim. */
  options(): ToolOption[];
  /** Handles one of `options()`; may ask for values. */
  option(key: string): Generator<Request, void, ToolInput>;
  make(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2): Corner | undefined;
  /** Message when no corner fits. */
  readonly fails: string;
};

/**
 * The shared run of Fillet and Chamfer: pick two objects, the second
 * previewing the corner, then commit it as one undo step. Sticky, so corner
 * after corner can be made; sizes and the trim mode are remembered.
 */
function cornerTool(t: CornerTool): ToolDef {
  let trim = true;
  const allOptions = (): ToolOption[] => [
    ...t.options(),
    { key: 'trim', label: 'Trim', enabled: true, active: trim },
    { key: 'notrim', label: 'No trim', enabled: true, active: !trim },
  ];
  /** Handles an option input; true when it was one. */
  function* handled(input: ToolInput): Generator<Request, boolean, ToolInput> {
    if (input.kind !== 'option') return false;
    if (input.key === 'trim' || input.key === 'notrim') trim = input.key === 'trim';
    else yield* t.option(input.key);
    return true;
  }
  return {
    id: t.id,
    label: t.label,
    shortcut: t.shortcut,
    *run(ctx): ToolGen {
      let first: { e: Entity; at: Vec2 } | undefined;
      for (;;) {
        const input = yield { kind: 'entity', prompt: `${t.label} (${t.sizes()}): pick the first object`, accepts: t.accepts, options: allOptions() };
        if (input.kind === 'finish') return;
        if (yield* handled(input)) continue;
        const e = input.kind === 'entity' ? ctx.drawing.entities.get(input.id) : undefined;
        if (e && input.kind === 'entity') {
          first = { e, at: input.at };
          break;
        }
      }
      const a = first.e;
      const c1 = entityCurve(a)!;
      const corner = (b: Entity, at: Vec2): Corner | undefined => t.make(c1, first.at, entityCurve(b)!, at);
      for (;;) {
        const input = yield {
          kind: 'entity',
          prompt: `${t.label} (${t.sizes()}): pick the second object`,
          accepts: (e) => e.id !== a.id && t.accepts(e),
          options: allOptions(),
          preview: (id, at) => {
            const b = ctx.drawing.entities.get(id);
            const k = b && corner(b, at);
            return b && k ? previewOf(cornerChanges(ctx, a, b, k, trim, PREVIEW_ID)) : [];
          },
        };
        if (input.kind === 'finish') return;
        if (yield* handled(input)) continue;
        if (input.kind !== 'entity') continue;
        const b = ctx.drawing.entities.get(input.id);
        const k = b && corner(b, input.at);
        if (!b || !k) {
          ctx.message(t.fails);
          continue;
        }
        const changes = cornerChanges(ctx, a, b, k, trim, k.joint ? newEntityId(ctx.drawing) : PREVIEW_ID);
        if (changes.length > 0) ctx.undo.commit({ label: t.label, changes });
        return;
      }
    },
  };
}

const isCurve = (e: Entity): boolean => entityCurve(e) !== undefined;
const isStraight = (e: Entity): boolean => e.kind === 'line' || e.kind === 'ray' || e.kind === 'xline';

/** Fillet (F): Radius… option (0 makes a sharp corner), Trim / No trim. */
export function createFilletTool(): ToolDef {
  let radius = 0;
  return cornerTool({
    id: 'fillet',
    label: 'Fillet',
    shortcut: 'f',
    accepts: isCurve,
    sizes: () => `R ${num(radius)}`,
    options: () => [{ key: 'radius', label: `Radius ${num(radius)}…`, enabled: true }],
    *option(key) {
      if (key !== 'radius') return;
      const r = yield* typed({ prompt: 'Fillet: type the radius', label: 'R', quantity: 'length' });
      if (r !== undefined && r >= 0) radius = r;
    },
    make: (c1, p1, c2, p2) => filletCurves(c1, p1, c2, p2, radius),
    fails: 'No fillet of that radius fits there.',
  });
}

/** Chamfer (Shift+F): two distances, or a distance and an angle from the first line; Trim / No trim. */
export function createChamferTool(): ToolDef {
  let mode: 'distances' | 'angle' = 'distances';
  let d1 = 0;
  let d2 = 0;
  let deg = 45;
  const spec = (): ChamferSpec => (mode === 'distances' ? { kind: 'distances', d1, d2 } : { kind: 'angle', d1, deg });
  return cornerTool({
    id: 'chamfer',
    label: 'Chamfer',
    shortcut: 'shift+f',
    accepts: isStraight,
    sizes: () => (mode === 'distances' ? `${num(d1)} × ${num(d2)}` : `${num(d1)} × ${num(deg)}°`),
    options: () => [
      { key: 'distances', label: 'Distances', enabled: true, active: mode === 'distances' },
      { key: 'angle', label: 'Distance, Angle', enabled: true, active: mode === 'angle' },
      { key: 'sizes', label: 'Sizes…', enabled: true },
    ],
    *option(key) {
      if (key === 'distances' || key === 'angle') {
        mode = key;
        return;
      }
      if (key !== 'sizes') return;
      const a = yield* typed({ prompt: 'Chamfer: type the distance on the first line', label: 'D1', quantity: 'length' });
      if (a === undefined || a < 0) return;
      if (mode === 'distances') {
        const b = yield* typed({ prompt: 'Chamfer: type the distance on the second line', label: 'D2', quantity: 'length' });
        if (b === undefined || b < 0) return;
        d1 = a;
        d2 = b;
      } else {
        const g = yield* typed({ prompt: 'Chamfer: type the angle from the first line', label: '∠', quantity: 'angle' });
        if (g === undefined || g <= 0 || g >= 180) return;
        d1 = a;
        deg = g;
      }
    },
    make: (c1, p1, c2, p2) => chamferLines(c1, p1, c2, p2, spec()),
    fails: 'No chamfer of that size fits there.',
  });
}
