import { type ChamferSpec, type Corner, chamferLines, filletCurves } from '../geometry/corner';
import { type Curve, intersectCurves } from '../geometry/curve';
import { TOL } from '../geometry/tolerance';
import { type Vec2, distance } from '../geometry/vec';
import { newEntityId } from '../model/drawing';
import { type Entity, type EntityId, type EntityProps, entityCurve, entityFromCurve } from '../model/entity';
import type { Change } from '../model/undo';
import { value } from './editTools';
import type { Request, ToolContext, ToolDef, ToolGen, ToolInput, ToolOption } from './tool';
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

/**
 * The first two objects a dragged path crosses, in the order it crosses them,
 * each with where it crosses (that side is kept). Undefined until it has
 * crossed two.
 */
export function firstTwoCrossed(ctx: ToolContext, path: readonly Vec2[], accepts: (e: Entity) => boolean): [{ e: Entity; at: Vec2 }, { e: Entity; at: Vec2 }] | undefined {
  const d = ctx.drawing;
  const found: { e: Entity; at: Vec2 }[] = [];
  for (let i = 1; i < path.length && found.length < 2; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (distance(a, b) <= TOL) continue;
    const hits: { e: Entity; at: Vec2 }[] = [];
    for (const e of d.entities.values()) {
      if (d.layers.get(e.layer)?.visible === false || !accepts(e)) continue;
      const c = entityCurve(e);
      if (c) for (const at of intersectCurves({ kind: 'segment', a, b }, c)) hits.push({ e, at });
    }
    hits.sort((h, k) => distance(a, h.at) - distance(a, k.at));
    for (const h of hits) if (found.length < 2 && !found.some((f) => f.e.id === h.e.id)) found.push(h);
  }
  return found.length === 2 ? [found[0]!, found[1]!] : undefined;
}

type CornerTool = {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string;
  /** Which objects it works on. */
  accepts(e: Entity): boolean;
  /** Prompt suffix naming the current sizes, e.g. "R 0.02". */
  sizes(): string;
  /** False until the size has been typed once this session; the tool then asks for it first. */
  hasSize(): boolean;
  /** Asks for the size (radius, or chamfer distances / angle) in the input box at the cursor. */
  askSize(ctx: ToolContext): Generator<Request, void, ToolInput>;
  /** Options besides Change size and Trim / No trim. */
  options(): ToolOption[];
  /** Handles one of `options()`. */
  option(key: string): void;
  make(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2): Corner | undefined;
  /** Message when no corner fits. */
  readonly fails: string;
};

/**
 * The shared run of Fillet and Chamfer: the size is asked for first (until it
 * has been typed once this session), then two objects are picked, the second
 * previewing the corner, and the corner is committed as one undo step.
 * Instead of the two picks, a path dragged across two objects makes the
 * corner between the first two it crosses, keeping the sides it crosses.
 * Sticky, so corner after corner can be made; the size and the trim mode are
 * remembered, and the "Change size" button asks again.
 */
function cornerTool(t: CornerTool): ToolDef {
  let trim = true;
  const allOptions = (): ToolOption[] => [
    { key: 'size', label: `Change size (${t.sizes()})…`, enabled: true },
    ...t.options(),
    { key: 'trim', label: 'Trim', enabled: true, active: trim },
    { key: 'notrim', label: 'No trim', enabled: true, active: !trim },
  ];
  /** Handles an option input; true when it was one. */
  function* handled(ctx: ToolContext, input: ToolInput): Generator<Request, boolean, ToolInput> {
    if (input.kind !== 'option') return false;
    if (input.key === 'trim' || input.key === 'notrim') trim = input.key === 'trim';
    else if (input.key === 'size') yield* t.askSize(ctx);
    else t.option(input.key);
    return true;
  }
  return {
    id: t.id,
    label: t.label,
    shortcut: t.shortcut,
    *run(ctx): ToolGen {
      if (!t.hasSize()) {
        yield* t.askSize(ctx);
        if (!t.hasSize()) return;
      }
      /** The corner a path makes: the first two objects it crosses, kept on the sides it crosses. */
      const strokeChanges = (path: readonly Vec2[], jointId: () => EntityId): Change[] | undefined => {
        const two = firstTwoCrossed(ctx, path, t.accepts);
        if (!two) return undefined;
        const [p, q] = two;
        const k = t.make(entityCurve(p.e)!, p.at, entityCurve(q.e)!, q.at);
        return k && cornerChanges(ctx, p.e, q.e, k, trim, k.joint ? jointId() : PREVIEW_ID);
      };
      let first: { e: Entity; at: Vec2 } | undefined;
      for (;;) {
        const input = yield {
          kind: 'entity',
          prompt: `${t.label} ${t.sizes()}: pick the first object, or drag across two`,
          accepts: t.accepts,
          options: allOptions(),
          stroke: (path) => previewOf(strokeChanges(path, () => PREVIEW_ID) ?? []),
        };
        if (input.kind === 'finish') return;
        if (yield* handled(ctx, input)) continue;
        if (input.kind === 'stroke') {
          const changes = strokeChanges(input.points, () => newEntityId(ctx.drawing));
          if (!changes) {
            ctx.message(firstTwoCrossed(ctx, input.points, t.accepts) ? t.fails : `Drag across two objects to ${t.label.toLowerCase()} the corner between them.`);
            continue;
          }
          if (changes.length > 0) ctx.undo.commit({ label: t.label, changes });
          return;
        }
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
          prompt: `${t.label} ${t.sizes()}: pick the second object`,
          accepts: (e) => e.id !== a.id && t.accepts(e),
          options: allOptions(),
          preview: (id, at) => {
            const b = ctx.drawing.entities.get(id);
            const k = b && corner(b, at);
            return b && k ? previewOf(cornerChanges(ctx, a, b, k, trim, PREVIEW_ID)) : [];
          },
        };
        if (input.kind === 'finish') return;
        if (yield* handled(ctx, input)) continue;
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

/** Fillet (F): asks the radius first (0 makes a sharp corner); Change size, Trim / No trim. */
export function createFilletTool(): ToolDef {
  let radius: number | undefined;
  return cornerTool({
    id: 'fillet',
    label: 'Fillet',
    shortcut: 'f',
    accepts: isCurve,
    sizes: () => `R ${num(radius ?? 0)}`,
    hasSize: () => radius !== undefined,
    *askSize(ctx) {
      for (;;) {
        const r = yield* value({ prompt: 'Fillet: type the radius, then press Enter (0 makes a sharp corner)', label: 'R', quantity: 'length' });
        if (r === undefined) return;
        if (r >= 0) {
          radius = r;
          return;
        }
        ctx.message('The radius cannot be negative.');
      }
    },
    options: () => [],
    option: () => {},
    make: (c1, p1, c2, p2) => filletCurves(c1, p1, c2, p2, radius ?? 0),
    fails: 'No fillet of that radius fits there.',
  });
}

/**
 * Chamfer (Shift+F): asks the size first: Distances (one along each line) or
 * Distance, Angle (along the first line, angle from it), chosen with buttons
 * while typing the first value; Change size, Trim / No trim.
 */
export function createChamferTool(): ToolDef {
  let mode: 'distances' | 'angle' = 'distances';
  let d1: number | undefined;
  let d2 = 0;
  let deg = 45;
  const spec = (): ChamferSpec => (mode === 'distances' ? { kind: 'distances', d1: d1 ?? 0, d2 } : { kind: 'angle', d1: d1 ?? 0, deg });
  const modeOptions = (): ToolOption[] => [
    { key: 'distances', label: 'Distances', enabled: true, active: mode === 'distances' },
    { key: 'angle', label: 'Distance, Angle', enabled: true, active: mode === 'angle' },
  ];
  return cornerTool({
    id: 'chamfer',
    label: 'Chamfer',
    shortcut: 'shift+f',
    accepts: isStraight,
    sizes: () => (mode === 'distances' ? `${num(d1 ?? 0)} × ${num(d2)}` : `${num(d1 ?? 0)} × ${num(deg)}°`),
    hasSize: () => d1 !== undefined,
    *askSize(ctx) {
      let a: number | undefined;
      while (a === undefined) {
        const input = yield {
          kind: 'value',
          prompt: `Chamfer (${mode === 'distances' ? 'two distances' : 'distance and angle'}): type the distance along the first line you'll pick, then press Enter`,
          label: 'D1',
          quantity: 'length',
          options: modeOptions(),
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option' && (input.key === 'distances' || input.key === 'angle')) mode = input.key;
        if (input.kind !== 'value') continue;
        if (input.value >= 0) a = input.value;
        else ctx.message('The distance cannot be negative.');
      }
      for (;;) {
        const b =
          mode === 'distances'
            ? yield* value({ prompt: 'Chamfer: type the distance along the second line, then press Enter', label: 'D2', quantity: 'length' })
            : yield* value({ prompt: 'Chamfer: type the angle from the first line, then press Enter', label: '∠', quantity: 'angle' });
        if (b === undefined) return;
        if (mode === 'distances' && b >= 0) {
          d1 = a;
          d2 = b;
          return;
        }
        if (mode === 'angle' && b > 0 && b < 180) {
          d1 = a;
          deg = b;
          return;
        }
        ctx.message(mode === 'distances' ? 'The distance cannot be negative.' : 'The angle must be between 0° and 180°.');
      }
    },
    options: modeOptions,
    option(key) {
      if (key === 'distances' || key === 'angle') mode = key;
    },
    make: (c1, p1, c2, p2) => chamferLines(c1, p1, c2, p2, spec()),
    fails: 'No chamfer of that size fits there.',
  });
}
