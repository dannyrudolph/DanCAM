import { createCenterMarkTool } from '../commands/centerMarkTool';
import { createCircleTool } from '../commands/circleTool';
import { createLeaderTool, createSymmetricDimTool } from '../commands/dimTools';
import { lineTool } from '../commands/lineTool';
import { createOrdinateDimTool } from '../commands/ordinateTool';
import { type ToolContext, type ToolDef, ToolRunner } from '../commands/tool';
import type { Vec2 } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import type { EntityId } from '../model/entity';
import { UndoStack } from '../model/undo';
import { SNAP_KINDS, findSnap } from '../snap/snap';

/**
 * The Phase 5 done-when drawing (loaded with `?lathe`): a turned medical
 * pin in lathe mode, upper half on the centerline at Y = 0, Z from the
 * front face. A .010 × 45° chamfer, a Ø.125 nose to Z .250, a Ø.188 body
 * to Z .600, a Ø.156 neck to Z .750, a Ø.030 cross hole at Z .400, and an
 * end view of the body. Printed at 10:1.
 *
 * Built the way a user builds it: Line, Circle and the Phase 5 tools fed
 * with clicks, every feature point taken on an object snap, so the
 * dimensions are anchored and follow the part when it is edited (the
 * done-when test stretches the back of the pin). Ø on: X values are
 * diameters. Loaded as initial state, not as undo history.
 */

/** Profile corners, front face on the axis first. */
export const PROFILE = [
  { x: 0, y: 0 },
  { x: 0, y: 0.0525 },
  { x: 0.01, y: 0.0625 }, // chamfer end, nose start
  { x: 0.25, y: 0.0625 },
  { x: 0.25, y: 0.094 }, // shoulder
  { x: 0.6, y: 0.094 },
  { x: 0.6, y: 0.078 }, // step down to the neck
  { x: 0.75, y: 0.078 },
  { x: 0.75, y: 0 },
] as const;

/** The cross hole: Ø.030 at Z .400, through. */
export const HOLE = { z: 0.4, r: 0.015 } as const;
export const END_VIEW = { x: -0.35, y: 0 } as const;

/** What each dimension and note reads, in the order they are made. */
export const LATHE_TEXTS = [
  'Ø.125', // symmetric diameter, nose
  'Ø.188', // symmetric diameter, body
  'Ø.156', // X ordinate of the neck, as a diameter
  '0', // Z ordinates from the front face, on one baseline (the origin reads a bare 0)
  '.250',
  '.400',
  '.600',
  '.750',
  '', // cross hole centerline
  '', // end view center mark
  'Ø.030 THRU',
  '.010 X 45°',
] as const;

/** Builds the drawing into `d` (an empty inch drawing). */
export function loadLatheReference(d: Drawing): void {
  d.lathe = true;
  d.diameterMode = true;
  const undo = new UndoStack(d);
  const ctx: ToolContext = {
    drawing: d,
    undo,
    newProps: () => ({ layer: '0' }),
    message: (m) => {
      throw new Error(`Lathe reference: unexpected message "${m}"`);
    },
    report: () => undefined,
    selection: () => [],
    continuation: undefined,
  };
  const runner = new ToolRunner(ctx);
  const use = (tool: ToolDef): void => runner.start(tool);
  const click = (p: Vec2): void => runner.send({ kind: 'point', at: p });
  /** A click on an object snap exactly at `p`, as the app sends it: with the feature it is on. */
  const snapped = (p: Vec2): void => {
    const s = findSnap(d, p, 1e-9, new Set(SNAP_KINDS));
    if (!s?.on) throw new Error(`Lathe reference: nothing to snap to at ${p.x}, ${p.y}`);
    runner.send({ kind: 'point', at: s.at, anchor: s.on });
  };
  const pick = (id: EntityId, at: Vec2): void => runner.send({ kind: 'entity', id, at });
  const option = (key: string): void => runner.send({ kind: 'option', key });
  const last = (): EntityId => [...d.entities.keys()].at(-1)!;
  const P = PROFILE;

  undo.commit({ label: 'Sheet scale', changes: [{ op: 'sheetScale', before: 1, after: 10 }] });

  // Profile, cross hole, end view.
  use(lineTool);
  for (const p of P) click(p);
  runner.send({ kind: 'finish' });
  click({ x: HOLE.z - HOLE.r, y: 0 });
  click({ x: HOLE.z - HOLE.r, y: P[5].y });
  runner.send({ kind: 'finish' });
  const holeLeft = last();
  click({ x: HOLE.z + HOLE.r, y: 0 });
  click({ x: HOLE.z + HOLE.r, y: P[5].y });
  runner.send({ kind: 'finish' });
  const holeRight = last();
  use(createCircleTool());
  click(END_VIEW);
  runner.send({ kind: 'value', value: P[5].y, at: END_VIEW });
  const endView = last();

  // Diameters off the lathe axis: the dimension line through the part to the centerline (Half).
  use(createSymmetricDimTool());
  snapped(P[2]);
  click({ x: 0.14, y: 0.03 });
  snapped(P[5]);
  click({ x: 0.51, y: 0.05 });
  runner.send({ kind: 'finish' });

  // Ordinates from the front face: the neck's X as a diameter, sideways; Z straight up, on one baseline.
  use(createOrdinateDimTool());
  snapped(P[7]);
  click({ x: P[7].x + 0.05, y: P[7].y });
  const above = P[5].y + 0.0375; // the first dimension spacing at 10:1
  for (const p of [P[1], P[4], undefined, P[5], P[7]]) {
    if (p) snapped(p);
    else click({ x: HOLE.z, y: P[5].y }); // the hole's center: typed, it has no snap point
    click({ x: (p ?? { x: HOLE.z }).x, y: above });
  }
  runner.send({ kind: 'finish' });

  // Cross hole centerline, end view center mark.
  use(createCenterMarkTool());
  option('method:lines');
  pick(holeLeft, { x: HOLE.z - HOLE.r, y: 0.04 });
  pick(holeRight, { x: HOLE.z + HOLE.r, y: 0.04 });
  option('method:curve');
  pick(endView, { x: END_VIEW.x, y: P[5].y });

  // Notes, below the axis where the half view leaves room, and off the chamfer.
  use(createLeaderTool());
  click({ x: HOLE.z + HOLE.r, y: 0.02 });
  click({ x: 0.5, y: -0.05 });
  runner.send({ kind: 'text', text: '%%c.030 THRU' });
  click({ x: 0.005, y: 0.0575 });
  click({ x: -0.1, y: 0.09 });
  runner.send({ kind: 'text', text: '.010 X 45%%d' });
  runner.stop();
}
