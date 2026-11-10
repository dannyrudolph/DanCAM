import { type Drawing, type Layer, newEntityId } from '../model/drawing';
import type { Entity, EntityId } from '../model/entity';
import { freeLayerName } from '../model/layers';
import { type ProfileCurve, type ProfilePlacement, type TurnedProfile, curvesBox, placeProfile, shiftCurve } from '../model/profilePlacement';
import type { Change } from '../model/undo';
import type { ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID } from './toolSteps';

/** A part's front, top and right-end views, each in its own coordinates with the axis through (0, 0) (io/step's `threeViews`). */
export type PartViews = {
  readonly front: readonly ProfileCurve[];
  readonly top: readonly ProfileCurve[];
  readonly end: readonly ProfileCurve[];
  /** Faces drawn by their edges only: they hide nothing. */
  readonly freeform: number;
};

/** The part's views turned end for end and a number of quarter turns about its axis, or undefined when they can't be taken. */
export type ViewsFor = (flip: boolean, turn: number) => PartViews | undefined;

/**
 * Import STEP's placing step (spec, "STEP import"): the turned profile
 * read from the file, or the part's three views, shown in place with Z0 at
 * its right or left end, Flip, Half/Full for the profile and Turn 90° for
 * the views, in the options bar (kept for the session). A click or Enter
 * places it on new layers named after the file, as one undo step; Esc
 * leaves without importing.
 */
export type StepImportTool = ToolDef & {
  /** The file to place next: its name (for the layers), its profile, and its views when they can be taken. */
  load(fileName: string, profile: TurnedProfile, views?: ViewsFor): void;
  /** How the profile is placed now. */
  readonly placement: ProfilePlacement;
  /** Profile or three views, and the views' quarter turns about the axis. */
  readonly mode: 'profile' | 'views';
  readonly turn: number;
  /** Every curve the options can place now (both Z0 ends, the full profile and the views), to fit the screen to. */
  reach(): ProfileCurve[];
};

type Laid = { readonly front: ProfileCurve[]; readonly top: ProfileCurve[]; readonly end: ProfileCurve[] };

/**
 * The views laid out third-angle: the front view with Z0 at its right or
 * left end and the axis on the centerline, the top view above it, the end
 * view to its right, each a gap away (the front view's height, or an eighth
 * of the part's length when that is more).
 */
export function layoutViews(v: PartViews, zeroAt: 'left' | 'right'): Laid {
  if (v.front.length === 0) return { front: [], top: [], end: [] };
  const [x0, y0, x1, y1] = curvesBox(v.front);
  const dx = zeroAt === 'right' ? -x1 : -x0;
  const gap = Math.max(y1 - y0, (x1 - x0) / 8);
  const shift = (cs: readonly ProfileCurve[], sx: number, sy: number): ProfileCurve[] => cs.map((c) => shiftCurve(c, sx, sy));
  const [, topLow] = curvesBox(v.top);
  const [endLeft] = curvesBox(v.end);
  return {
    front: shift(v.front, dx, 0),
    top: v.top.length === 0 ? [] : shift(v.top, dx, y1 + gap - topLow),
    end: v.end.length === 0 ? [] : shift(v.end, x1 + dx + gap - endLeft, 0),
  };
}

/** The file name without folders or its .step/.stp extension, for the layer. */
export function layerNameFor(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = base.replace(/\.(step|stp)$/i, '').trim();
  return name === '' ? 'STEP' : name;
}

/** The placed profile as drawing entities on `layer`. */
export function profileEntities(curves: readonly ProfileCurve[], layer: string, id: () => EntityId): Entity[] {
  return curves.map((c): Entity => {
    const props = { id: id(), layer, ...(c.style ? { style: c.style } : {}) };
    if (c.kind === 'line') return { kind: 'line', ...props, start: c.start, end: c.end };
    if (c.kind === 'circle') return { kind: 'circle', ...props, center: c.center, radius: c.radius };
    const deg = (d: number): number => ((d % 360) + 360) % 360;
    return { kind: 'arc', ...props, center: c.center, radius: c.radius, startDeg: deg(c.startDeg), endDeg: deg(c.endDeg) };
  });
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What was left out, as a sentence, or '' when nothing was. */
export function leftOutMessage(p: TurnedProfile): string {
  const parts: string[] = [];
  if (p.left.notRound > 0) parts.push(`${plural(p.left.notRound, 'face')} not round about the axis (cross holes, flats, slots)`);
  if (p.left.freeform > 0) parts.push(`${plural(p.left.freeform, 'freeform face')}`);
  if (p.left.unreadable > 0) parts.push(`${plural(p.left.unreadable, 'unreadable face')}`);
  return parts.length === 0 ? '' : ` Left out: ${parts.join(', ')}.`;
}

export function createStepImportTool(): StepImportTool {
  let file: { name: string; profile: TurnedProfile; views?: ViewsFor } | undefined;
  let placement: ProfilePlacement = { zeroAt: 'right', flip: false, full: false };
  let mode: 'profile' | 'views' = 'profile';
  let turn = 0;

  const canView = (): boolean => file?.views?.(placement.flip, turn) !== undefined;
  const showing = (): 'profile' | 'views' => (mode === 'views' && canView() ? 'views' : 'profile');

  const options = (): ToolOption[] => {
    const views = showing() === 'views';
    return [
      { key: 'mode:profile', label: 'Profile', enabled: true, active: !views },
      { key: 'mode:views', label: '3 views', enabled: canView(), active: views },
      { key: 'zero:right', label: 'Z0 at right end', enabled: true, active: placement.zeroAt === 'right' },
      { key: 'zero:left', label: 'Z0 at left end', enabled: true, active: placement.zeroAt === 'left' },
      { key: 'flip', label: 'Flip', enabled: true, active: placement.flip },
      { key: 'turn', label: 'Turn 90°', enabled: views },
      { key: 'half', label: 'Half', enabled: !views, active: !views && !placement.full },
      { key: 'full', label: 'Full', enabled: !views, active: !views && placement.full },
    ];
  };

  /** The curves to place, each with the layer name it goes on (before the next free name is taken). */
  function curves(f: NonNullable<typeof file>, zeroAt = placement.zeroAt): { curve: ProfileCurve; layer: string }[] {
    const base = layerNameFor(f.name);
    const views = showing() === 'views' ? f.views?.(placement.flip, turn) : undefined;
    if (!views) return placeProfile(f.profile, { ...placement, zeroAt }).map((curve) => ({ curve, layer: base }));
    const laid = layoutViews(views, zeroAt);
    return (['front', 'top', 'end'] as const).flatMap((k) => laid[k].map((curve) => ({ curve, layer: `${base} ${curve.fitted ? 'fitted' : k}` })));
  }

  function place(d: Drawing, f: NonNullable<typeof file>): { changes: Change[]; layers: string[]; count: number } {
    const picked = curves(f);
    const names = new Map<string, string>();
    const changes: Change[] = [];
    for (const { layer } of picked) {
      if (names.has(layer)) continue;
      const free = freeLayerName(d, layer);
      names.set(layer, free);
      changes.push({ op: 'layer', after: { name: free, color: '#000000', visible: true, style: 'visible' } satisfies Layer });
    }
    for (const { curve, layer } of picked) for (const entity of profileEntities([curve], names.get(layer)!, () => newEntityId(d))) changes.push({ op: 'add', entity });
    return { changes, layers: [...names.values()], count: picked.length };
  }

  function placedMessage(f: NonNullable<typeof file>, layers: readonly string[], count: number): string {
    const what = `${count} ${count === 1 ? 'line or arc' : 'lines and arcs'}`;
    if (showing() === 'profile') return `Imported ${f.name}: ${what} on layer ${layers[0]}.${leftOutMessage(f.profile)}`;
    const freeform = f.views?.(placement.flip, turn)?.freeform ?? 0;
    const fitted = layers.find((l) => l.startsWith(`${layerNameFor(f.name)} fitted`));
    return (
      `Imported ${f.name} as three views: ${what} on layers ${layers.join(', ')}.` +
      (fitted ? ` Curves on ${fitted} are fitted with arcs and lines.` : '') +
      (freeform > 0 ? ` ${plural(freeform, 'freeform face')} drawn by its edges only.` : '')
    );
  }

  return {
    id: 'importStep',
    label: 'Import STEP',
    shortcut: '',
    repeat: false,
    load(fileName, profile, views) {
      const memo = new Map<string, PartViews | undefined>();
      const cached: ViewsFor | undefined = views
        ? (flip, t) => {
            const key = `${flip}:${t}`;
            if (!memo.has(key)) memo.set(key, views(flip, t));
            return memo.get(key);
          }
        : undefined;
      file = { name: fileName.split(/[\\/]/).pop() ?? fileName, profile, ...(cached ? { views: cached } : {}) };
    },
    get placement() {
      return placement;
    },
    get mode() {
      return mode;
    },
    get turn() {
      return turn;
    },
    reach() {
      const f = file;
      if (!f) return [];
      const full = (['left', 'right'] as const).flatMap((zeroAt) => placeProfile(f.profile, { zeroAt, flip: placement.flip, full: true }));
      const views = f.views?.(placement.flip, turn);
      const laid = views ? (['left', 'right'] as const).flatMap((zeroAt) => Object.values(layoutViews(views, zeroAt)).flat()) : [];
      return [...full, ...laid];
    },
    *run(ctx): ToolGen {
      const f = file;
      if (!f) return;
      for (;;) {
        const input = yield {
          kind: 'point',
          prompt: `Import ${f.name}: choose the profile or three views, where Z0 goes and how it turns, then click or press Enter to place it`,
          shown: () => curves(f).flatMap(({ curve }) => profileEntities([curve], '0', () => PREVIEW_ID)),
          options: options(),
          canFinish: true,
        };
        if (input.kind === 'option') {
          if (input.key === 'mode:profile' || input.key === 'mode:views') mode = input.key === 'mode:views' ? 'views' : 'profile';
          else if (input.key === 'zero:right' || input.key === 'zero:left') placement = { ...placement, zeroAt: input.key === 'zero:right' ? 'right' : 'left' };
          else if (input.key === 'flip') placement = { ...placement, flip: !placement.flip };
          else if (input.key === 'turn') turn = (turn + 1) % 4;
          else if (input.key === 'half' || input.key === 'full') placement = { ...placement, full: input.key === 'full' };
          continue;
        }
        if (input.kind !== 'point' && input.kind !== 'finish') continue;
        const { changes, layers, count } = place(ctx.drawing, f);
        ctx.undo.commit({ label: `Import ${f.name}`, changes });
        ctx.message(placedMessage(f, layers, count));
        file = undefined;
        return;
      }
    },
  };
}
