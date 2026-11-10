import { createCenterMarkTool } from '../commands/centerMarkTool';
import { createCircleTool } from '../commands/circleTool';
import { createLeaderTool, createSymmetricDimTool } from '../commands/dimTools';
import { lineTool } from '../commands/lineTool';
import { createOrdinateDimTool } from '../commands/ordinateTool';
import { type ToolContext, type ToolDef, ToolRunner } from '../commands/tool';
import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import type { Drawing } from '../model/drawing';
import type { EntityId } from '../model/entity';
import { UndoStack } from '../model/undo';
import { DEFAULT_SNAP_KINDS, findSnap } from '../snap/snap';

/**
 * A second Phase 5 lathe part (loaded with `?shaft`): a turned pin drawn as
 * the upper half on the lathe axis, dimensioned the lathe way. Front face
 * at Z 0 with a .005 × 45° chamfer to Ø.080, a shoulder at Z .150 up to
 * Ø.125, a Ø.030 cross hole at Z .275, a .025 wide groove to Ø.100 at Z
 * .400, the back face at Z .600, and an end view with a center mark.
 * Printed at 10:1.
 *
 * Z positions are ordinates from the front face, diameters are symmetric
 * (Half) on the lathe axis, with Ø entry on. It is built the way a user
 * builds it: the tools fed with clicks that land on object snaps (so the
 * dimensions are anchored, as the app anchors them), picks and typed text,
 * through the undo stack. Loaded as initial state, not as undo history.
 */

/** Profile corners, front face at the axis first. */
export const SHAFT = {
  front: { x: 0, y: 0 },
  frontTop: { x: 0, y: 0.035 },
  chamferEnd: { x: 0.005, y: 0.04 },
  shoulder: { x: 0.15, y: 0.04 },
  shoulderTop: { x: 0.15, y: 0.0625 },
  grooveStart: { x: 0.4, y: 0.0625 },
  grooveBottom: { x: 0.4, y: 0.05 },
  grooveBottomEnd: { x: 0.425, y: 0.05 },
  grooveEnd: { x: 0.425, y: 0.0625 },
  backTop: { x: 0.6, y: 0.0625 },
  back: { x: 0.6, y: 0 },
} as const;

/** The cross hole's two sides (hidden lines), Ø.030 at Z .275. */
export const HOLE = { z: 0.275, radius: 0.015 } as const;

export const SHAFT_END_VIEW = { x: -0.25, y: 0 };

/** What each dimension reads, in the order they are made. */
export const SHAFT_TEXTS = [
  '', // center mark on the end view
  '', // the cross hole's centerline
  '0', // ordinates from the front face (the origin reads a bare 0)
  '.150',
  '.275',
  '.400',
  '.425',
  '.600',
  'Ø.080', // symmetric diameters, Half
  'Ø.100',
  'Ø.125',
  '.005 X 45°', // chamfer note
  'Ø.030 THRU', // cross hole note
] as const;

/** Builds the lathe reference part into `d` (an empty inch drawing). */
export function loadLatheShaft(d: Drawing): void {
  const undo = new UndoStack(d);
  const ctx: ToolContext = {
    drawing: d,
    undo,
    newProps: () => ({ layer: '0' }),
    message: (m) => {
      throw new Error(`Lathe shaft: unexpected message "${m}"`);
    },
    report: () => undefined,
    selection: () => [],
    continuation: undefined,
  };
  d.lathe = true;
  d.diameterMode = true;
  // Scale first: ordinates line up and keep clear by their printed text size.
  undo.commit({ label: 'Sheet scale', changes: [{ op: 'sheetScale', before: 1, after: 10 }] });
  const runner = new ToolRunner(ctx);
  const use = (tool: ToolDef): void => runner.start(tool);
  const click = (p: Vec2): void => runner.send({ kind: 'point', at: p });
  const kinds = new Set(DEFAULT_SNAP_KINDS);
  /** A click on an object snap, carrying its anchor as the app sends it. */
  const snapClick = (p: Vec2): void => {
    const s = findSnap(d, p, 1e-6, kinds);
    if (!s?.on || !vecNearlyEqual(s.at, p)) throw new Error(`Lathe shaft: no snap at ${p.x}, ${p.y}`);
    runner.send({ kind: 'point', at: p, anchor: s.on });
  };
  const pick = (id: EntityId, at: Vec2): void => runner.send({ kind: 'entity', id, at });
  const finish = (): void => runner.send({ kind: 'finish' });
  const lastId = (): EntityId => [...d.entities.keys()].at(-1)!;

  // Profile, then the cross hole's sides as hidden lines.
  use(lineTool);
  for (const p of Object.values(SHAFT)) click(p);
  finish();
  undo.commit({ label: 'New layer HIDDEN', changes: [{ op: 'layer', after: { name: 'HIDDEN', color: '#000000', visible: true, style: 'hidden' } }] });
  const holeSides: EntityId[] = [];
  for (const z of [HOLE.z - HOLE.radius, HOLE.z + HOLE.radius]) {
    click({ x: z, y: 0 });
    click({ x: z, y: SHAFT.shoulderTop.y });
    finish();
    const id = lastId();
    const line = d.entities.get(id)!;
    undo.commit({ label: 'Change layer', changes: [{ op: 'modify', before: line, after: { ...line, layer: 'HIDDEN' } }] });
    holeSides.push(id);
  }

  // End view: the outside diameter.
  use(createCircleTool());
  click(SHAFT_END_VIEW);
  runner.send({ kind: 'value', value: SHAFT.backTop.y, at: SHAFT_END_VIEW });
  const od = lastId();

  // A center mark on the end view, and the hole's centerline, which the
  // hole's ordinate then snaps to.
  use(createCenterMarkTool());
  pick(od, { x: SHAFT_END_VIEW.x + SHAFT.backTop.y, y: 0 });
  use(createCenterMarkTool());
  runner.send({ kind: 'option', key: 'method:lines' });
  pick(holeSides[0]!, { x: HOLE.z - HOLE.radius, y: 0.03 });
  pick(holeSides[1]!, { x: HOLE.z + HOLE.radius, y: 0.03 });

  // At 10:1 the text is .012 here; ordinates end .05 above the part, a little
  // ragged as clicked, and the common baseline lines them up.
  use(createOrdinateDimTool());
  const above = SHAFT.backTop.y + 0.05;
  const ordinate = (feature: Vec2, dy: number): void => {
    snapClick(feature);
    click({ x: feature.x, y: above + dy });
  };
  ordinate(SHAFT.frontTop, 0);
  ordinate(SHAFT.shoulderTop, 0.004);
  ordinate({ x: HOLE.z, y: SHAFT.shoulderTop.y }, -0.003); // the centerline's end
  ordinate(SHAFT.grooveStart, 0.002);
  ordinate(SHAFT.grooveEnd, -0.002); // .025 from .400: the text moves clear and the leader jogs
  ordinate(SHAFT.backTop, 0.001);
  finish();

  // Diameters on the lathe axis: Ø.080 left of the front face, Ø.100 down
  // through the groove, Ø.125 right of the back face.
  use(createSymmetricDimTool());
  snapClick(SHAFT.chamferEnd);
  click({ x: -0.06, y: 0.02 });
  snapClick(SHAFT.grooveBottomEnd);
  click({ x: 0.4125, y: 0.025 });
  snapClick(SHAFT.backTop);
  click({ x: 0.66, y: 0.03 });
  finish();

  use(createLeaderTool());
  snapClick({ x: 0.0025, y: 0.0375 }); // the chamfer's middle
  click({ x: -0.03, y: 0.09 });
  runner.send({ kind: 'text', text: '.005 X 45%%d' });
  snapClick({ x: HOLE.z + HOLE.radius, y: SHAFT.shoulderTop.y / 2 }); // the far side's middle
  click({ x: 0.33, y: -0.04 });
  runner.send({ kind: 'text', text: '%%c.030 THRU' });

  runner.stop();
}
