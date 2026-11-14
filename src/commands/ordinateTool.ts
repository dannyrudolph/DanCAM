import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { Anchor } from '../model/anchor';
import { TOL } from '../geometry/tolerance';
import type { DimensionEntity, EntityId, LineEntity } from '../model/entity';
import { axisNames, axisView } from '../model/latheView';
import { alignOrdinates, placeOrdinate } from '../model/ordinateLayout';
import { objects } from './editTools';
import type { ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID, addEntity, nearerEnd } from './toolSteps';

type Orientation = 'auto' | 'x' | 'y';
const ORIENT = 'orient:';
const ORIGIN = 'origin';

/**
 * Which coordinate an ordinate gives when its leader goes from `p1` to
 * `at`: dragged up or down (a vertical leader) gives X, sideways gives Y,
 * as in AutoCAD, unless forced.
 */
export function ordinateAxis(p1: Vec2, at: Vec2, orientation: Orientation): 'x' | 'y' {
  if (orientation !== 'auto') return orientation;
  return Math.abs(at.y - p1.y) >= Math.abs(at.x - p1.x) ? 'x' : 'y';
}

/** A vertical or horizontal line (a face or a diameter on a turned profile): sloped ones are left to snaps. */
function isSquareEdge(e: LineEntity): boolean {
  const dx = Math.abs(e.end.x - e.start.x);
  const dy = Math.abs(e.end.y - e.start.y);
  return (dx <= TOL) !== (dy <= TOL);
}

/**
 * Ordinate (Shift+Z) (spec, "Ordinate"): feature after feature, each
 * followed by where its text goes, until Enter. Each measures from the
 * drawing's origin (marked on the drawing; Set origin moves it, and the
 * ordinates on it, as one undo step). Z or X in lathe mode, X or Y
 * otherwise, by drag direction or forced in the options bar; the choice is
 * kept for the session. With Ø on in lathe mode, X reads as a diameter.
 * A vertical or horizontal edge under the cursor is picked before snaps,
 * measured at its end nearer the click (anchored); the drag still says
 * which coordinate.
 */
export function createOrdinateDimTool(): ToolDef {
  let orientation: Orientation = 'auto';
  return {
    id: 'dimOrdinate',
    label: 'Ordinate dimension',
    shortcut: 'shift+z',
    *run(ctx): ToolGen {
      const d = ctx.drawing;
      const names = axisNames({ ...axisView(d), diameter: false });
      const options = (withOrigin: boolean): ToolOption[] => [
        ...(['auto', 'x', 'y'] as const).map((o) => ({
          key: ORIENT + o,
          label: o === 'auto' ? 'Auto' : `${o === 'x' ? names.h : names.v} ordinate`,
          enabled: true,
          active: o === orientation,
        })),
        ...(withOrigin ? [{ key: ORIGIN, label: 'Set origin', enabled: true }] : []),
      ];
      const takeOption = (key: string): boolean => {
        if (!key.startsWith(ORIENT)) return false;
        orientation = key.slice(ORIENT.length) as Orientation;
        return true;
      };
      const layer = ctx.newProps().layer;
      for (;;) {
        const input = yield {
          kind: 'point',
          prompt: 'Ordinate: pick an edge or a feature (Enter to finish)',
          pick: (e) => e.kind === 'line' && isSquareEdge(e),
          options: options(true),
          canFinish: true,
        };
        if (input.kind === 'finish') return;
        if (input.kind === 'option') {
          if (input.key === ORIGIN) {
            const o = yield { kind: 'point', prompt: 'Ordinate: pick the origin the ordinates measure from' };
            if (o.kind === 'finish') return;
            if (o.kind === 'point' && !vecNearlyEqual(o.at, d.dimOrigin)) {
              ctx.undo.commit({ label: 'Set ordinate origin', changes: [{ op: 'dimOrigin', before: d.dimOrigin, after: o.at }] });
            }
          } else takeOption(input.key);
          continue;
        }
        let p1: Vec2;
        let anchor: Anchor | undefined;
        if (input.kind === 'entity') {
          const e = d.entities.get(input.id);
          if (e?.kind !== 'line' || !isSquareEdge(e)) continue;
          ({ at: p1, anchor } = nearerEnd(e, input.at));
        } else if (input.kind === 'point') {
          p1 = input.at;
          anchor = input.anchor;
        } else continue;
        // On a common baseline with the others, clear of their texts (spec, "Ordinate").
        const make = (id: EntityId, at: Vec2): DimensionEntity => placeOrdinate(d, {
          kind: 'dimension',
          id,
          layer,
          dimStyle: d.currentDimStyle,
          type: 'ordinate',
          p1,
          origin: d.dimOrigin,
          axis: ordinateAxis(p1, at, orientation),
          at,
          ...(anchor && { anchors: { p1: anchor } }),
        });
        for (;;) {
          const place = yield {
            kind: 'point',
            prompt: 'Ordinate: pick where the text goes',
            base: p1,
            preview: (p) => (vecNearlyEqual(p, p1) ? [] : [make(PREVIEW_ID, p)]),
            options: options(false),
          };
          if (place.kind === 'finish') return;
          if (place.kind === 'option') {
            takeOption(place.key);
            continue;
          }
          if (place.kind !== 'point') continue;
          if (vecNearlyEqual(place.at, p1)) {
            ctx.message('The text needs to go away from the feature.');
            continue;
          }
          const at = place.at;
          addEntity(ctx, 'Ordinate dimension', (id) => make(id, at));
          break;
        }
      }
    },
  };
}

type Ordinate = Extract<DimensionEntity, { type: 'ordinate' }>;

/**
 * Align ordinates (spec, "Ordinate"): the selected ordinates (selection
 * first, or select then Enter), then the level their leaders end at; each
 * set lines up on it, texts packed a gap apart near their features, as one
 * undo step. Other objects in the selection are left alone.
 */
export const alignOrdinatesTool: ToolDef = {
  id: 'dimAlignOrdinates',
  label: 'Align ordinates',
  shortcut: '',
  repeat: false,
  *run(ctx): ToolGen {
    const es = yield* objects(ctx, 'Align ordinates');
    if (!es) return;
    const os = es.filter((e): e is Ordinate => e.kind === 'dimension' && e.type === 'ordinate');
    if (os.length === 0) {
      ctx.message('No ordinate dimensions are selected.');
      return;
    }
    for (;;) {
      const input = yield {
        kind: 'point',
        prompt: 'Align ordinates: pick the level the leaders end at',
        preview: (p) => [...alignOrdinates(ctx.drawing, os, p).values()].map((o) => ({ ...o, id: `${PREVIEW_ID}-${o.id}` })),
      };
      if (input.kind === 'finish') return;
      if (input.kind !== 'point') continue;
      const after = alignOrdinates(ctx.drawing, os, input.at);
      ctx.undo.commit({ label: 'Align ordinates', changes: os.map((before) => ({ op: 'modify' as const, before, after: after.get(before.id)! })) });
      return;
    }
  },
};
