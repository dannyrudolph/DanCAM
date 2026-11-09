import { createArcTool } from '../commands/arcTool';
import { createCircleTool } from '../commands/circleTool';
import {
  createAlignedDimTool,
  createAngularDimTool,
  createDiameterDimTool,
  createLeaderTool,
  createLinearDimTool,
  createRadiusDimTool,
} from '../commands/dimTools';
import { lineTool } from '../commands/lineTool';
import { type ToolContext, type ToolDef, ToolRunner } from '../commands/tool';
import type { Vec2 } from '../geometry/vec';
import { withPrecision, withText, withToleranceKind } from '../model/dimOverride';
import { addDimStyle, editDimStyle, renameDimStyle } from '../model/dimStyles';
import type { Drawing } from '../model/drawing';
import type { DimensionEntity, Entity, EntityId } from '../model/entity';
import { MM_ZEROS } from '../model/dimFormat';
import { UndoStack } from '../model/undo';

/**
 * The Phase 4 reference drawing (loaded with `?reference`): a turned pin,
 * upper half on its centerline, .500 long, Ø.125 then Ø.188 with a .010 ×
 * 45° chamfer at the front, and an end view with the outside diameter, a
 * Ø.060 bore and a 120° bolt arc. Printed at 10:1, so dimension text is
 * .012 in the drawing and .12 on paper.
 *
 * It is built the way a user builds it: the Line, Circle, Arc and
 * dimension tools fed with clicks, picks and typed text, then the
 * per-dimension overrides, a dual-units style and the sheet scale, all
 * through the undo stack. The done-when test checks every dimension's text.
 * Like the demo, the result is loaded as initial state, not as undo history.
 */

/** Profile corners, front face first. */
export const PIN = {
  axis: { x: 0, y: 0 },
  chamferStart: { x: 0, y: 0.0525 },
  chamferEnd: { x: 0.01, y: 0.0625 },
  shoulder: { x: 0.2, y: 0.0625 },
  shoulderTop: { x: 0.2, y: 0.094 },
  backTop: { x: 0.5, y: 0.094 },
  back: { x: 0.5, y: 0 },
} as const;

export const END_VIEW = { x: -0.3, y: 0 };

/** What each reference dimension reads, in the order they are made. */
export const REFERENCE_TEXTS = [
  '.500 [12.7]', // overall length, a dual-units style (mm drops trailing zeros)
  '.200 REF', // front length, text override
  '.0940 ±.0005', // back face height above the axis: precision and tolerance overrides
  '.014', // the chamfer's true length, aligned
  '45°', // the chamfer against the Ø.125 diameter
  'Ø.188 +.000/-.001', // outside diameter in the end view, deviation tolerance
  'R.030', // bore
  '120°', // bolt arc
  '.010 X 45°', // the chamfer note on a leader
] as const;

/** Builds the reference drawing into `d` (an empty inch drawing). */
export function loadReference(d: Drawing): void {
  const undo = new UndoStack(d);
  const ctx: ToolContext = {
    drawing: d,
    undo,
    newProps: () => ({ layer: '0' }),
    message: (m) => {
      throw new Error(`Reference drawing: unexpected message "${m}"`);
    },
    report: () => undefined,
    selection: () => [],
    continuation: undefined,
  };
  const runner = new ToolRunner(ctx);
  const use = (tool: ToolDef): void => runner.start(tool);
  const click = (p: Vec2): void => runner.send({ kind: 'point', at: p });
  const pick = (id: EntityId, at: Vec2): void => runner.send({ kind: 'entity', id, at });
  const option = (key: string): void => runner.send({ kind: 'option', key });
  const last = (): Entity => [...d.entities.values()].at(-1)!;
  const lastDim = (): DimensionEntity => last() as DimensionEntity;
  const modify = (label: string, before: Entity, after: Entity): void => undo.commit({ label, changes: [{ op: 'modify', before, after }] });

  // A copy of the inch style with mm in brackets, for the overall length.
  const copy = addDimStyle(d, d.currentDimStyle);
  undo.commit(copy.tx);
  const dual = editDimStyle(d, copy.name, { dual: { precision: 2, zeros: MM_ZEROS } });
  if (dual.ok) undo.commit(dual.tx);
  const renamed = renameDimStyle(d, copy.name, 'INCH-DUAL');
  if (renamed.ok) undo.commit(renamed.tx);

  // Profile and centerline.
  use(lineTool);
  for (const p of Object.values(PIN)) click(p);
  runner.send({ kind: 'finish' });
  const ids = [...d.entities.keys()];
  const [, chamfer, top] = ids;
  click({ x: -0.03, y: 0 });
  click({ x: 0.53, y: 0 });
  runner.send({ kind: 'finish' });
  undo.commit({ label: 'New layer CENTER', changes: [{ op: 'layer', after: { name: 'CENTER', color: '#000000', visible: true, style: 'center' } }] });
  modify('Change layer', last(), { ...last(), layer: 'CENTER' });

  // End view: outside diameter, bore, and a bolt arc from 30° to 150°.
  use(createCircleTool());
  click(END_VIEW);
  runner.send({ kind: 'value', value: 0.094, at: END_VIEW });
  const od = last().id;
  click(END_VIEW);
  runner.send({ kind: 'value', value: 0.03, at: END_VIEW });
  const bore = last().id;
  use(createArcTool());
  option('method:sce');
  const c30 = 0.06 * Math.cos(Math.PI / 6);
  click({ x: END_VIEW.x + c30, y: 0.03 });
  click(END_VIEW);
  click({ x: END_VIEW.x - c30, y: 0.03 });
  const bolt = last().id;

  // Spacing at 10:1: the first line .0375 from the part, then every .025.
  d.currentDimStyle = 'INCH-DUAL';
  use(createLinearDimTool());
  click(PIN.axis);
  click(PIN.back);
  click({ x: 0.25, y: -0.0375 });
  d.currentDimStyle = 'INCH-3PL';
  click(PIN.chamferStart);
  click(PIN.shoulderTop);
  click({ x: 0.1, y: 0.094 + 0.0375 });
  modify('Edit dimension text', lastDim(), withText(lastDim(), '<> REF')!);
  click(PIN.back);
  click(PIN.backTop);
  option('orient:v');
  click({ x: 0.5 + 0.0375 + 2 * 0.025, y: 0.047 }); // third spacing out: the horizontal text clears the back face
  modify('Change precision', lastDim(), withPrecision(lastDim(), 4));
  const plusMinus = withToleranceKind(d, lastDim(), 'symmetric');
  modify('Change tolerance', lastDim(), { ...plusMinus, tolerance: { kind: 'symmetric', value: 0.0005 } });

  use(createAlignedDimTool());
  click(PIN.chamferStart);
  click(PIN.chamferEnd);
  click({ x: -0.012, y: 0.07 });

  use(createAngularDimTool());
  pick(chamfer!, { x: 0.005, y: 0.0575 });
  pick(top!, { x: 0.1, y: 0.0625 });
  // Between the top line and the chamfer carried on, .07 out: room for the arrows inside the arc,
  // and the chamfer-side extension line still stops short of the .200 REF text.
  click({ x: PIN.chamferEnd.x + 0.07 * Math.cos(Math.PI / 9), y: PIN.chamferEnd.y + 0.07 * Math.sin(Math.PI / 9) });

  use(createDiameterDimTool());
  pick(od, { x: END_VIEW.x, y: -0.094 });
  click({ x: END_VIEW.x - 0.16, y: -0.13 });
  modify('Change tolerance', lastDim(), { ...lastDim(), tolerance: { kind: 'deviation', upper: 0, lower: -0.001 } });

  use(createRadiusDimTool());
  pick(bore, { x: END_VIEW.x + 0.03, y: 0 });
  click({ x: END_VIEW.x + 0.12, y: -0.12 });

  use(createAngularDimTool());
  option('method:arc');
  pick(bolt, { x: END_VIEW.x, y: 0.06 });
  click({ x: END_VIEW.x, y: 0.15 });

  use(createLeaderTool());
  click({ x: 0.005, y: 0.0575 }); // the chamfer's middle
  click({ x: -0.08, y: 0.2 }); // to the left, clear of the 45° text
  runner.send({ kind: 'text', text: '.010 X 45%%d' });
  runner.stop();

  undo.commit({ label: 'Sheet scale', changes: [{ op: 'sheetScale', before: 1, after: 10 }] });
}
