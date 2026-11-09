import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { Anchor } from '../model/anchor';
import type { DimensionEntity, EntityId } from '../model/entity';
import { axisNames, axisView } from '../model/latheView';
import type { ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID, addEntity } from './toolSteps';

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

/**
 * Ordinate (Shift+Z) (spec, "Ordinate"): feature after feature, each
 * followed by where its text goes, until Enter. Each measures from the
 * drawing's origin (marked on the drawing; Set origin moves it, and the
 * ordinates on it, as one undo step). Z or X in lathe mode, X or Y
 * otherwise, by drag direction or forced in the options bar; the choice is
 * kept for the session. With Ø on in lathe mode, X reads as a diameter.
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
        const input = yield { kind: 'point', prompt: 'Ordinate: pick a feature (Enter to finish)', options: options(true), canFinish: true };
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
        if (input.kind !== 'point') continue;
        const p1 = input.at;
        const anchor: Anchor | undefined = input.anchor;
        const make = (id: EntityId, at: Vec2): DimensionEntity => ({
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
