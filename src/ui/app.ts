import { createArcTool } from '../commands/arcTool';
import { createArrayTool } from '../commands/arrayTool';
import { createCircleTool } from '../commands/circleTool';
import { createChamferTool, createFilletTool } from '../commands/cornerTools';
import { createBaselineDimTool, createContinueDimTool } from '../commands/chainDimTools';
import { alignOrdinatesTool, createOrdinateDimTool } from '../commands/ordinateTool';
import { createAlignedDimTool, createAngularDimTool, createDiameterDimTool, createLeaderTool, createLinearDimTool, createRadiusDimTool, createSymmetricDimTool } from '../commands/dimTools';
import { copyTool, createMirrorTool, eraseTool, moveTool, rotateTool, scaleTool } from '../commands/editTools';
import { gripTool } from '../commands/gripTool';
import { angleTool, distTool, idTool, listTool } from '../commands/inquiryTools';
import { createBreakTool, createLengthenTool, joinTool } from '../commands/lengthTools';
import { lineTool } from '../commands/lineTool';
import { createOffsetTool } from '../commands/offsetTool';
import type { Tracking } from '../commands/pointInput';
import { pointTool } from '../commands/pointTool';
import { type ToolContext, type ToolDef, type ToolInput, ToolRunner } from '../commands/tool';
import { rayTool } from '../commands/rayTool';
import { stretchTool } from '../commands/stretchTool';
import { extendTool, trimTool } from '../commands/trimTools';
import { createXlineTool } from '../commands/xlineTool';
import { type Vec2, vecNearlyEqual } from '../geometry/vec';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { type Drawing, type Units, createDrawing, drawingBBox } from '../model/drawing';
import type { Entity, EntityId, EntityProps } from '../model/entity';
import { type Grip, gripsFor } from '../model/grips';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import { pickEntity } from '../model/pick';
import { type BoxMode, boxModeFor, selectInBox } from '../model/selection';
import { type Transaction, UndoStack } from '../model/undo';
import { ensureCurrentLayer } from '../model/layers';
import { ensureCurrentDimStyle } from '../model/dimStyles';
import { axisView } from '../model/latheView';
import { MM_PER_INCH, UNIT_LABEL, convertUnits, relabelUnits } from '../model/units';
import { GRIP_PX, render } from '../render/renderer';
import * as vp from '../render/viewport';
import { DEFAULT_SNAP_KINDS, NEEDS_BASE, SNAP_KINDS, SNAP_LABEL, type Snap, type SnapKind, findSnap } from '../snap/snap';
import { ContextMenu, type MenuItem } from './contextMenu';
import { DrawingFile } from './fileAccess';
import { ICONS } from './icons';
import { type EnterAction, InputBoxes } from './inputBoxes';
import { type ScrollMode, bindCanvasInput } from './input';
import { InquiryPanel } from './inquiryPanel';
import { DimStylesPanel } from './dimStylesPanel';
import { LayersPanel } from './layersPanel';
import { PropertiesPanel } from './propertiesPanel';
import { DEFAULT_PRECISION, StatusBar, type StatusSettings } from './statusBar';

/** Pick radius around the cursor, CSS pixels. */
const PICK_RADIUS_PX = 6;
/** Object snap aperture around the cursor, CSS pixels. */
const SNAP_APERTURE_PX = 10;
/** Initial view of an inch drawing: about 4" across a 1000px canvas (the same size in mm). */
const INITIAL_SCALE_PER_INCH = 250;
const INITIAL_CENTER_INCH = { x: 1.5, y: 1 };

function initialView(units: Units, widthPx: number, heightPx: number): vp.Viewport {
  const k = units === 'mm' ? MM_PER_INCH : 1;
  return {
    center: { x: INITIAL_CENTER_INCH.x * k, y: INITIAL_CENTER_INCH.y * k },
    scale: INITIAL_SCALE_PER_INCH / k,
    widthPx,
    heightPx,
  };
}

export const DRAW_TOOLS: readonly ToolDef[] = [lineTool, createCircleTool(), createArcTool(), createXlineTool(), rayTool, pointTool];
export const EDIT_TOOLS: readonly ToolDef[] = [eraseTool, moveTool, copyTool, rotateTool, createMirrorTool(), scaleTool];
export const MODIFY_TOOLS: readonly ToolDef[] = [trimTool, extendTool, createFilletTool(), createChamferTool(), createOffsetTool(), createBreakTool(), joinTool, createLengthenTool(), createArrayTool(), stretchTool];
export const DIMENSION_TOOLS: readonly ToolDef[] = [createLinearDimTool(), createAlignedDimTool(), createRadiusDimTool(), createDiameterDimTool(), createAngularDimTool(), createSymmetricDimTool(), createBaselineDimTool(), createContinueDimTool(), createOrdinateDimTool(), alignOrdinatesTool, createLeaderTool()];
export const INQUIRY_TOOLS: readonly ToolDef[] = [distTool, idTool, listTool, angleTool];
export const TOOLS: readonly ToolDef[] = [...DRAW_TOOLS, ...EDIT_TOOLS, ...MODIFY_TOOLS, ...DIMENSION_TOOLS, ...INQUIRY_TOOLS];

/** Keys that start typing a value into the input boxes. */
const VALUE_START = /^[0-9.+\-(]$/;

const SCROLL_MODE_KEY = 'dancam.scrollMode';
const SIDE_PANEL_KEY = 'dancam.sidePanel';

/** The viewer's scroll preference; a convenience, so storage failures just fall back to Pan. */
function loadScrollMode(): ScrollMode {
  try {
    return localStorage.getItem(SCROLL_MODE_KEY) === 'zoom' ? 'zoom' : 'pan';
  } catch {
    return 'pan';
  }
}

function saveScrollMode(mode: ScrollMode): void {
  try {
    localStorage.setItem(SCROLL_MODE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the setting just won't persist.
  }
}

/** Whether the layers/properties sidebar is shown; remembered per browser, shown by default. */
function loadSidePanel(): boolean {
  try {
    return localStorage.getItem(SIDE_PANEL_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

function saveSidePanel(shown: boolean): void {
  try {
    localStorage.setItem(SIDE_PANEL_KEY, shown ? 'shown' : 'hidden');
  } catch {
    // Not persisted; fine.
  }
}

/** "shift+x" → "Shift+X", for tooltips; "" for a tool with no key. */
export function shortcutLabel(shortcut: string): string {
  if (shortcut === '') return '';
  return shortcut.startsWith('shift+') ? `Shift+${shortcut.slice(6).toUpperCase()}` : shortcut.toUpperCase();
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

function button(icon: string, title: string, onClick: () => void, testId: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool-button';
  b.innerHTML = icon;
  b.title = title;
  b.tabIndex = -1;
  b.dataset.testid = testId;
  b.addEventListener('click', onClick);
  return b;
}

/** The whole editor: owns the drawing, the view and the UI pieces, and routes input between them. */
export class App {
  private drawing: Drawing;
  private undo: UndoStack;
  private runner: ToolRunner;
  private readonly file = new DrawingFile();
  /** Units the status bar and view were last set up for; a change (convert, relabel, undo) refits the view. */
  private shownUnits: Units;
  private readonly canvas = el<HTMLCanvasElement>('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly boxes: InputBoxes;
  private readonly status: StatusBar;
  private readonly properties = new PropertiesPanel(el('properties'), {
    units: () => this.drawing.units,
    commit: (tx) => this.commitLayerEdit(tx),
    message: (m) => this.status.showMessage(m),
  });
  private readonly layers = new LayersPanel(el('layers'), {
    commit: (tx, renamed) => this.commitLayerEdit(tx, renamed),
    setCurrent: (name) => {
      this.drawing.currentLayer = name;
      this.status.showMessage(`Current layer: ${name}`);
      this.refresh();
    },
    message: (m) => this.status.showMessage(m),
  });
  private readonly dimStylesPanel = new DimStylesPanel(el('dimstyles'), {
    commit: (tx, renamed) => {
      this.runner.stop(); // as for a layer edit: a tool mid-step must not undo it
      this.undo.commit(tx);
      // Follow a rename before refresh's fallback could pick another style.
      if (renamed) ensureCurrentDimStyle(this.drawing, renamed.from, renamed.to);
      this.status.showMessage(tx.label);
      this.refresh();
    },
    setCurrent: (name) => {
      this.drawing.currentDimStyle = name;
      this.status.showMessage(`Current dimension style: ${name}`);
      this.refresh();
    },
    message: (m) => this.status.showMessage(m),
  });
  private readonly inquiry = new InquiryPanel(el('inquiry'));
  private readonly menu = new ContextMenu(document.body);
  private readonly optionsBar = el('options');
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private selectButton: HTMLButtonElement | undefined;
  private readonly unitsButton = document.createElement('button');
  private readonly sidePanelButton = document.createElement('button');
  private readonly settings: StatusSettings = {
    scrollMode: loadScrollMode(),
    ortho: false,
    polar: true,
    polarIncrementDeg: 15,
    precision: DEFAULT_PRECISION,
    osnap: true,
    snapKinds: new Set(DEFAULT_SNAP_KINDS),
  };
  /** A snap picked from the right-click menu for the next point only; it replaces the running snaps. */
  private onceSnap: SnapKind | undefined;

  private view: vp.Viewport;
  private cursorScreen: Vec2 | undefined;
  private lastCursorWorld: Vec2 = { x: 0, y: 0 };
  /** Selected entities, in the order they were picked. Not undoable. */
  private readonly selected = new Set<EntityId>();
  /** The grip being dragged (the grip tool is running). */
  private hotGrip: { id: EntityId; grip: Grip } | undefined;
  /** A selection box being dragged, screen pixels. */
  private selectBox: { from: Vec2; to: Vec2; mode: BoxMode } | undefined;
  private currentStyle: LineStyleName | undefined;
  private frameRequested = false;
  /** Space held: left-drag pans. */
  private spaceHeld = false;
  /** Shift held: Trim and Extend preview the other mode. */
  private shiftHeld = false;
  /** Pan button on: left-drag pans until it is turned off or Esc. */
  private panMode = false;
  private panButton: HTMLButtonElement | undefined;

  constructor(drawing: Drawing) {
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D is not available');
    this.g = g;
    this.drawing = drawing;
    this.undo = new UndoStack(drawing);
    this.runner = this.makeRunner();
    this.view = initialView(drawing.units, 1, 1);
    this.shownUnits = drawing.units;

    this.status = new StatusBar(
      el('status'),
      this.settings,
      () => {
        saveScrollMode(this.settings.scrollMode);
        this.refresh();
      },
      (anchor) => this.openSnapMenu(anchor),
      (scale) => this.setSheetScale(scale),
      (lathe, diameter) => {
        // Settings like the current layer: saved with the drawing, not undoable.
        this.drawing.lathe = lathe;
        this.drawing.diameterMode = diameter;
        this.status.showMessage(lathe ? `Lathe mode: Z and X${diameter ? ', X as diameter' : ''}` : 'Lathe mode off');
        this.boxes.relabel();
        this.refresh();
      },
    );
    this.boxes = new InputBoxes(el('canvas-wrap'), {
      units: () => this.drawing.units,
      precision: () => this.settings.precision,
      axisView: () => axisView(this.drawing),
      changed: () => this.requestRedraw(),
      enter: (action) => this.enter(action),
      escape: () => this.escape(),
    });

    this.buildToolbar();
    this.buildTopBar();
    this.bindInput();
    new ResizeObserver(() => this.fitCanvas()).observe(this.canvas);
    this.fitCanvas();
    this.refresh();
    if (drawing.entities.size > 0) requestAnimationFrame(() => this.zoomExtents());
  }

  // ---- the document ----------------------------------------------------------

  private makeRunner(): ToolRunner {
    const ctx: ToolContext = {
      drawing: this.drawing,
      undo: this.undo,
      newProps: () => this.newProps(),
      message: (m) => this.status.showMessage(m),
      selection: () => [...this.selected],
      report: (r) => this.inquiry.add(r, this.settings.precision, axisView(this.drawing)),
      continuation: undefined,
    };
    return new ToolRunner(ctx);
  }

  /** Replaces the open drawing (New, Open): fresh undo history, nothing selected, view fitted. */
  private setDrawing(d: Drawing): void {
    this.runner.stop();
    this.menu.close();
    this.drawing = d;
    this.undo = new UndoStack(d);
    this.runner = this.makeRunner();
    this.selected.clear();
    this.shownUnits = d.units;
    this.view = initialView(d.units, this.view.widthPx, this.view.heightPx);
    if (d.entities.size > 0) this.zoomExtents();
    this.refresh();
  }

  /** True when the open drawing can be dropped: nothing unsaved, or the user agrees. */
  private canDiscard(): boolean {
    return !this.undo.dirty || window.confirm(`Discard unsaved changes to ${this.file.name}?`);
  }

  private newDrawing(units: Units): void {
    if (!this.canDiscard()) return;
    this.file.reset();
    this.setDrawing(createDrawing(units));
    this.status.showMessage(`New ${UNIT_LABEL[units]} drawing`);
  }

  private async openDrawing(): Promise<void> {
    if (!this.canDiscard()) return;
    try {
      const picked = await this.file.open();
      if (!picked) return;
      const result = parseDrawing(picked.text);
      if (!result.ok) {
        this.status.showMessage(`Can't open ${picked.name}: ${result.error}`);
        return;
      }
      this.file.adopt(picked);
      this.setDrawing(result.drawing);
      this.status.showMessage(`Opened ${picked.name}`);
    } catch (err) {
      this.status.showMessage(`Open failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async saveDrawing(saveAs: boolean): Promise<void> {
    try {
      if (!(await this.file.save(serializeDrawing(this.drawing), saveAs))) return;
      this.undo.markSaved();
      this.status.showMessage(`Saved ${this.file.name}`);
      this.refresh();
    } catch (err) {
      this.status.showMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private openUnitsMenu(anchor: DOMRect): void {
    const other: Units = this.drawing.units === 'in' ? 'mm' : 'in';
    const op = other === 'mm' ? '×' : '÷';
    this.menu.open(anchor.left, anchor.bottom, [
      {
        label: `Convert to ${UNIT_LABEL[other]} (same size, numbers ${op} 25.4)`,
        enabled: true,
        run: () => this.changeUnits(convertUnits(this.drawing, other)),
      },
      {
        label: `Relabel as ${UNIT_LABEL[other]} (same numbers)`,
        enabled: true,
        run: () => this.changeUnits(relabelUnits(this.drawing, other)),
      },
    ]);
  }

  /** Commits an edit from a panel (layers, properties) as one undo step. */
  private commitLayerEdit(tx: Transaction, renamed?: { from: string; to: string }): void {
    // A tool mid-step (a line chain's "Undo last segment") must not undo a panel edit.
    this.runner.stop();
    this.undo.commit(tx);
    if (renamed) ensureCurrentLayer(this.drawing, renamed.from, renamed.to);
    this.status.showMessage(tx.label);
    this.refresh();
  }

  private changeUnits(tx: Transaction | undefined): void {
    if (!tx) return;
    this.runner.stop();
    this.undo.commit(tx);
    this.status.showMessage(tx.label);
    this.refresh();
  }

  // ---- actions ---------------------------------------------------------------

  startTool(def: ToolDef): void {
    this.menu.close();
    this.runner.start(def);
    this.refresh();
  }

  private send(input: ToolInput): void {
    this.runner.send(input);
    this.refresh();
  }

  /**
   * Esc: close the menu, else leave Pan, else drop a one-time snap, else clear
   * locked values, else leave the tool, else clear the selection.
   */
  private escape(): void {
    if (this.menu.isOpen) this.menu.close();
    else if (this.panMode) this.setPanMode(false);
    else if (this.onceSnap) this.onceSnap = undefined;
    else if ((this.boxes.hasLocks || this.boxes.focused) && this.runner.request?.kind !== 'text') this.boxes.clearLocks();
    else if (this.runner.tool) this.runner.stop();
    else this.selected.clear();
    this.refresh();
  }

  private enter(action: EnterAction): void {
    const req = this.runner.request;
    if (req?.kind === 'selection' && this.selected.size === 0 && req.canFinish) this.send({ kind: 'finish' });
    else if (req?.kind === 'selection') this.submitSelection();
    else if (action === 'place') this.place();
    else if (action === 'finish') this.send({ kind: 'finish' });
    else this.requestRedraw();
  }

  /** A click, or Enter with values locked: answers the waiting step from the cursor and the boxes. */
  private place(shift = false): void {
    const req = this.runner.request;
    if (!req) return;
    const cursor = this.cursorWorld();
    if (req.kind === 'point' || req.kind === 'value') {
      const snap = this.currentSnap();
      if (this.onceSnap && !snap) {
        this.status.showMessage(`No ${SNAP_LABEL[this.onceSnap]} point here. Esc drops the one-time snap.`);
        return;
      }
      if (req.kind === 'point') {
        this.onceSnap = undefined;
        if (snap?.deferred) this.send({ kind: 'point', at: snap.at, deferred: snap.deferred });
        else {
          const at = this.nextPoint(snap);
          // A point placed on a snap (not moved off it by a typed value) keeps the feature it is on.
          const anchor = snap?.on && vecNearlyEqual(at, snap.at) ? snap.on : undefined;
          this.send(anchor ? { kind: 'point', at, anchor } : { kind: 'point', at });
        }
        return;
      }
      const at = snap?.at ?? cursor;
      const value = this.boxes.resolveValue(at);
      if (value === undefined) {
        this.status.showMessage(`Type a value for ${req.label}, then press Enter.`);
        return;
      }
      this.onceSnap = undefined;
      this.send({ kind: 'value', value, at });
    } else if (req.kind === 'text') {
      this.send({ kind: 'text', text: this.boxes.textValue() });
    } else if (req.kind === 'entity') {
      const id = this.pickAt(cursor, req.accepts);
      if (id) this.send({ kind: 'entity', id, at: cursor, shift });
      else this.status.showMessage('Nothing there that this step can use.');
    }
  }

  /** Enter at a `selection` step: hands the tool what is selected. */
  private submitSelection(): void {
    if (this.selected.size === 0) {
      this.status.showMessage('Select objects first: click them or drag a window.');
      return;
    }
    this.send({ kind: 'selection', ids: [...this.selected] });
  }

  private pickAt(world: Vec2, accepts?: (e: Entity) => boolean): EntityId | undefined {
    return pickEntity(this.drawing, world, PICK_RADIUS_PX / this.view.scale, accepts);
  }

  /** Grips of the selected objects, shown with no tool active or while one is dragged. */
  private shownGrips(): { id: EntityId; grip: Grip }[] {
    if (this.runner.tool && this.runner.tool.id !== 'grip') return [];
    const out: { id: EntityId; grip: Grip }[] = [];
    for (const id of this.selected) {
      const e = this.drawing.entities.get(id);
      if (e) for (const grip of gripsFor(e, this.drawing)) out.push({ id, grip });
    }
    return out;
  }

  /** The grip under the screen point, if any (the last drawn wins, as it's on top). */
  private gripAt(screen: Vec2): { id: EntityId; grip: Grip } | undefined {
    let found: { id: EntityId; grip: Grip } | undefined;
    for (const g of this.shownGrips()) {
      const s = vp.worldToScreen(this.view, g.grip.at);
      if (Math.abs(s.x - screen.x) <= GRIP_PX + 1 && Math.abs(s.y - screen.y) <= GRIP_PX + 1) found = g;
    }
    return found;
  }

  /**
   * A click with no tool: adds the object to the selection, or with Shift
   * removes it. A plain click on empty space clears the selection.
   */
  private clickSelect(id: EntityId | undefined, shift: boolean): void {
    if (id && shift) this.selected.delete(id);
    else if (id) this.selected.add(id);
    else if (!shift) this.selected.clear();
    this.refresh();
  }

  private doUndo(): void {
    const req = this.runner.request;
    if (req?.options?.some((o) => o.key === 'undo' && o.enabled)) {
      this.send({ kind: 'option', key: 'undo' });
      return;
    }
    this.runner.stop();
    const label = this.undo.undoLabel;
    this.status.showMessage(this.undo.undo() ? `Undo: ${label}` : 'Nothing to undo');
    this.refresh();
  }

  private doRedo(): void {
    this.runner.stop();
    const label = this.undo.redoLabel;
    this.status.showMessage(this.undo.redo() ? `Redo: ${label}` : 'Nothing to redo');
    this.refresh();
  }

  private setPanMode(on: boolean): void {
    this.panMode = on;
    this.panButton?.classList.toggle('active', on);
    this.selectButton?.classList.toggle('active', !on && !this.runner.tool);
    this.updateCanvasCursor(false);
  }

  /** The Select button: leaves the active tool and Pan, keeping the selection. */
  private selectMode(): void {
    this.menu.close();
    this.runner.stop();
    this.setPanMode(false);
    this.refresh();
  }

  private updateCanvasCursor(dragging: boolean): void {
    const pans = this.panMode || this.spaceHeld;
    this.canvas.classList.toggle('pan-ready', pans && !dragging);
    this.canvas.classList.toggle('panning', dragging);
  }

  private zoomExtents(): void {
    this.view = vp.zoomExtents(this.view, drawingBBox(this.drawing));
    this.requestRedraw();
  }

  private newProps(): EntityProps {
    const layer = this.drawing.currentLayer;
    return this.currentStyle ? { layer, style: this.currentStyle } : { layer };
  }

  // ---- point resolution ------------------------------------------------------

  private tracking(): Tracking {
    return { ortho: this.settings.ortho, polar: this.settings.polar, polarIncrementDeg: this.settings.polarIncrementDeg };
  }

  private cursorWorld(): Vec2 {
    if (this.cursorScreen) this.lastCursorWorld = vp.screenToWorld(this.view, this.cursorScreen);
    return this.lastCursorWorld;
  }

  /** Where a click or Enter places the point now. */
  private nextPoint(snap: Snap | undefined): Vec2 {
    return this.boxes.resolve(this.cursorWorld(), this.tracking(), snap?.at);
  }

  /** The object snap under the cursor for the waiting point or value step, if any. */
  private currentSnap(): Snap | undefined {
    const req = this.runner.request;
    if (!req || (req.kind !== 'point' && req.kind !== 'value') || !this.cursorScreen) return undefined;
    const kinds = this.onceSnap ? new Set([this.onceSnap]) : this.settings.osnap ? this.settings.snapKinds : undefined;
    if (!kinds) return undefined;
    // Typed values pin the point, so a sliding (deferred) end can't apply.
    const deferOk = req.kind === 'point' && req.acceptsDeferred === true && !this.boxes.hasLocks;
    return findSnap(this.drawing, this.cursorWorld(), SNAP_APERTURE_PX / this.view.scale, kinds, req.base, deferOk);
  }

  /** The status bar's snap list; stays open while kinds are switched on and off. */
  private openSnapMenu(anchor: DOMRect): void {
    const kinds = this.settings.snapKinds;
    this.menu.open(
      anchor.left,
      anchor.top,
      SNAP_KINDS.map((k) => ({
        label: SNAP_LABEL[k],
        enabled: true,
        checked: kinds.has(k),
        run: () => {
          if (kinds.has(k)) kinds.delete(k);
          else kinds.add(k);
          this.refresh();
          this.openSnapMenu(anchor);
        },
      })),
    );
  }

  /**
   * Right-click "Snap once…": the snap kinds for the next point. Perpendicular
   * and Tangent need a base point, or a step that takes a deferred pick.
   */
  private openSnapOnceMenu(x: number, y: number): void {
    const req = this.runner.request;
    const fromSomething = req?.base !== undefined || (req?.kind === 'point' && req.acceptsDeferred === true);
    this.menu.open(
      x,
      y,
      SNAP_KINDS.map((k) => ({
        label: SNAP_LABEL[k],
        enabled: fromSomething || !NEEDS_BASE.has(k),
        checked: this.onceSnap === k,
        run: () => {
          this.onceSnap = k;
          this.status.showMessage(`${SNAP_LABEL[k]} for the next point`);
          this.refresh();
        },
      })),
    );
  }

  /** Sizes every dimension for printing at `scale`, as one undo step. */
  private setSheetScale(scale: number): void {
    const before = this.drawing.sheetScale;
    if (scale !== before) this.undo.commit({ label: 'Sheet scale', changes: [{ op: 'sheetScale', before, after: scale }] });
    this.refresh();
  }

  // ---- UI sync ---------------------------------------------------------------

  /** Brings every panel in line with the runner, selection and settings, then redraws. */
  private refresh(): void {
    if (this.drawing.units !== this.shownUnits) {
      this.shownUnits = this.drawing.units;
      this.zoomExtents();
    }
    this.unitsButton.textContent = this.drawing.units;
    this.status.showSheetScale(this.drawing.sheetScale);
    this.status.showAxisView(this.drawing.lathe, this.drawing.diameterMode);
    document.title = `${this.undo.dirty ? '• ' : ''}${this.file.name} — DanCAM`;
    ensureCurrentLayer(this.drawing); // an undo may have removed it
    ensureCurrentDimStyle(this.drawing);
    this.layers.show(this.drawing);
    this.dimStylesPanel.show(this.drawing);
    const req = this.runner.request;
    if (!req || (req.kind !== 'point' && req.kind !== 'value')) this.onceSnap = undefined;
    this.boxes.setRequest(req);
    this.status.setPrompt(req?.prompt ?? 'Pick an object to see its properties, or choose a tool');
    this.status.refreshToggles();
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', this.runner.tool?.id === id);
    if (this.runner.tool?.id !== 'grip') this.hotGrip = undefined;
    const selecting = !this.runner.tool || req?.kind === 'selection';
    this.selectButton?.classList.toggle('active', !this.runner.tool && !this.panMode);
    this.canvas.classList.toggle('selecting', selecting);
    this.renderOptions();
    // Undo may have removed a selected entity, or its layer may now be hidden.
    const picked: Entity[] = [];
    for (const id of this.selected) {
      const e = this.drawing.entities.get(id);
      if (e && this.drawing.layers.get(e.layer)?.visible !== false) picked.push(e);
      else this.selected.delete(id);
    }
    this.properties.show(this.drawing, picked, this.settings.precision);
    this.inquiry.show(this.settings.precision, axisView(this.drawing));
    this.requestRedraw();
  }

  private renderOptions(): void {
    const tool = this.runner.tool;
    const req = this.runner.request;
    const items: HTMLElement[] = [];
    const name = document.createElement('span');
    name.className = 'options-tool';
    name.textContent = tool ? tool.label : 'Select';
    items.push(name);
    for (const o of req?.options ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = o.active ? 'option-button active' : 'option-button';
      b.textContent = o.label;
      b.disabled = !o.enabled;
      b.tabIndex = -1;
      b.dataset.option = o.key;
      b.addEventListener('click', () => this.send({ kind: 'option', key: o.key }));
      items.push(b);
    }
    this.optionsBar.replaceChildren(...items);
  }

  private requestRedraw(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.draw();
    });
  }

  private draw(): void {
    const req = this.runner.request;
    const cursor = this.cursorScreen ? this.cursorWorld() : undefined;
    let next: Vec2 | undefined;
    let preview: readonly Entity[] = [];
    let snap = this.currentSnap();
    if (req && cursor) {
      if (req.kind === 'point') {
        next = snap?.deferred ? snap.at : this.nextPoint(snap);
        preview = req.preview?.(next, snap?.deferred) ?? [];
        // Locked values moved the point off the snap, so the snap isn't what a click gives.
        if (snap && !vecNearlyEqual(next, snap.at)) snap = undefined;
      } else if (req.kind === 'value') {
        if (this.boxes.hasLocks) snap = undefined;
        const at = snap?.at ?? cursor;
        const value = this.boxes.resolveValue(at);
        if (value !== undefined) preview = req.preview?.(value, at) ?? [];
      } else if (req.kind === 'entity') {
        // Highlight what a click would pick.
        const hit = this.pickAt(cursor, req.accepts);
        const e = hit && this.drawing.entities.get(hit);
        if (e) preview = req.preview ? req.preview(e.id, cursor, this.shiftHeld) : [e];
      }
    }
    if (req?.kind === 'text') {
      snap = undefined;
      preview = req.preview?.(this.boxes.textValue()) ?? [];
    }
    render(this.g, this.view, this.drawing, {
        preview,
        selected: this.selected,
        grips: this.shownGrips()
          .filter((g) => g.grip !== this.hotGrip?.grip)
          .map((g) => g.grip.at),
        hotGrip: this.hotGrip?.grip.at,
        selectBox: this.selectBox,
        nextPoint: next,
        snap,
      }, window.devicePixelRatio || 1);
    this.canvas.dataset.snap = snap?.kind ?? '';
    this.status.setCursor(next ?? snap?.at ?? cursor, req?.base);
    if (req?.kind === 'text') this.boxes.update(vp.worldToScreen(this.view, req.at), req.at);
    else this.boxes.update(this.cursorScreen, req?.kind === 'point' ? next : (snap?.at ?? cursor));
  }

  private fitCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.view = vp.resize(this.view, r.width, r.height);
    this.requestRedraw();
  }

  // ---- building the chrome ---------------------------------------------------

  /** Drawing tools in a row under the top bar, ending with the drawing's units. */
  private buildToolbar(): void {
    const bar = el('toolbar');
    this.selectButton = button(ICONS.select, 'Select (Esc): pick objects, or drag a window', () => this.selectMode(), 'tool-select');
    bar.append(this.selectButton);
    const addTools = (defs: readonly ToolDef[]): void => {
      for (const def of defs) {
        const icon = ICONS[def.id as keyof typeof ICONS];
        const keys = def.id === 'erase' ? 'E or Delete' : shortcutLabel(def.shortcut);
        const tip = keys ? `${def.label} (${keys})` : def.label;
        const b = button(icon, tip, () => this.startTool(def), `tool-${def.id}`);
        this.toolButtons.set(def.id, b);
        bar.append(b);
      }
    };
    addTools(DRAW_TOOLS);
    const gap = document.createElement('span');
    gap.className = 'toolbar-separator';
    bar.append(gap);
    addTools(EDIT_TOOLS);
    const gapModify = document.createElement('span');
    gapModify.className = 'toolbar-separator';
    bar.append(gapModify);
    addTools(MODIFY_TOOLS);
    const gapDim = document.createElement('span');
    gapDim.className = 'toolbar-separator';
    bar.append(gapDim);
    addTools(DIMENSION_TOOLS);
    const gap2 = document.createElement('span');
    gap2.className = 'toolbar-separator';
    bar.append(gap2);
    addTools(INQUIRY_TOOLS);
    const u = this.unitsButton;
    u.type = 'button';
    u.className = 'units-button';
    u.title = 'Drawing units: convert or relabel';
    u.tabIndex = -1;
    u.dataset.testid = 'units';
    u.textContent = this.drawing.units;
    u.addEventListener('click', () => this.openUnitsMenu(u.getBoundingClientRect()));
    bar.append(u);
  }

  private setSidePanel(shown: boolean): void {
    el('main').classList.toggle('side-hidden', !shown);
    this.sidePanelButton.classList.toggle('active', shown);
    this.sidePanelButton.setAttribute('aria-pressed', String(shown));
    this.sidePanelButton.title = shown ? 'Hide the layers and properties panel' : 'Show the layers and properties panel';
    saveSidePanel(shown);
  }

  private buildTopBar(): void {
    const bar = el('topbar');
    const style = document.createElement('select');
    style.title = 'Line style for new objects';
    style.tabIndex = -1;
    style.dataset.testid = 'style';
    const byLayer = document.createElement('option');
    byLayer.value = '';
    byLayer.textContent = 'Style: by layer';
    style.append(byLayer);
    for (const name of LINE_STYLE_NAMES) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = `Style: ${LINE_STYLES[name].label}`;
      style.append(o);
    }
    style.addEventListener('change', () => {
      this.currentStyle = style.value === '' ? undefined : (style.value as LineStyleName);
      style.blur();
    });
    this.panButton = button(
      ICONS.pan,
      'Pan (H): drag with the left button. You can also hold Space and drag, or drag with the middle button',
      () => this.setPanMode(!this.panMode),
      'pan',
    );
    const newButton = button(
      ICONS.new,
      'New drawing',
      () => {
        const r = newButton.getBoundingClientRect();
        this.menu.open(r.left, r.bottom, [
          { label: 'New inch drawing', enabled: true, run: () => this.newDrawing('in') },
          { label: 'New mm drawing', enabled: true, run: () => this.newDrawing('mm') },
        ]);
      },
      'new',
    );
    bar.append(
      newButton,
      button(ICONS.open, 'Open (Ctrl+O)', () => void this.openDrawing(), 'open'),
      button(ICONS.save, 'Save (Ctrl+S)', () => void this.saveDrawing(false), 'save'),
      button(ICONS.saveAs, 'Save As (Ctrl+Shift+S)', () => void this.saveDrawing(true), 'save-as'),
      button(ICONS.undo, 'Undo (Ctrl+Z)', () => this.doUndo(), 'undo'),
      button(ICONS.redo, 'Redo (Ctrl+Y)', () => this.doRedo(), 'redo'),
      this.panButton,
      button(ICONS.extents, 'Zoom Extents (double-click middle button)', () => this.zoomExtents(), 'zoom-extents'),
      style,
    );

    const side = this.sidePanelButton;
    side.type = 'button';
    side.className = 'tool-button side-panel-toggle';
    side.innerHTML = ICONS.sidebar;
    side.tabIndex = -1;
    side.dataset.testid = 'side-panel';
    side.addEventListener('click', () => this.setSidePanel(el('main').classList.contains('side-hidden')));
    bar.append(side);
    this.setSidePanel(loadSidePanel());
  }

  private contextItems(x: number, y: number): MenuItem[] {
    const req = this.runner.request;
    if (!req) {
      return [
        { label: 'Zoom Extents', enabled: true, run: () => this.zoomExtents() },
        { label: 'Undo', enabled: this.undo.undoLabel !== undefined, run: () => this.doUndo() },
        { label: 'Redo', enabled: this.undo.redoLabel !== undefined, run: () => this.doRedo() },
      ];
    }
    return [
      {
        label: 'Enter',
        enabled:
          req.kind === 'selection'
            ? this.selected.size > 0
            : req.kind === 'text'
              ? this.boxes.textValue().trim() !== ''
              : this.boxes.hasLocks || req.canFinish === true,
        run: () => this.enter(this.boxes.enterAction()),
      },
      { label: 'Cancel', enabled: true, run: () => this.escape() },
      ...(req.kind === 'entity' || req.kind === 'selection' || req.kind === 'text' ? [] : [{ label: 'Snap once…', enabled: true, run: () => this.openSnapOnceMenu(x, y) }]),
      ...(req.options ?? []).map((o) => ({ label: o.label, enabled: o.enabled, run: () => this.send({ kind: 'option', key: o.key }) })),
    ];
  }

  private bindInput(): void {
    bindCanvasInput(this.canvas, {
      zoomAt: (screen, factor) => {
        this.view = vp.zoomAt(this.view, screen, factor);
        this.requestRedraw();
      },
      pan: (dx, dy) => {
        this.view = vp.pan(this.view, dx, dy);
        this.requestRedraw();
      },
      zoomExtents: () => this.zoomExtents(),
      cursor: (screen) => {
        this.cursorScreen = screen;
        this.requestRedraw();
      },
      click: (screen, shift) => {
        this.cursorScreen = screen;
        if (this.runner.request?.kind === 'text') {
          this.boxes.focusFirst(); // a click doesn't end the note; Enter does
        } else if (this.runner.request && this.runner.request.kind !== 'selection') {
          this.place(shift);
        } else {
          this.clickSelect(this.pickAt(this.cursorWorld()), shift);
        }
      },
      pressStartsDrag: (screen, shift) => {
        // Shift-click removes from the selection, even on a grip.
        if (shift || this.runner.request || this.panMode || this.spaceHeld) return false;
        const hit = this.gripAt(screen);
        if (!hit) return false;
        this.cursorScreen = screen;
        this.startTool(gripTool(hit.id, hit.grip));
        this.hotGrip = hit;
        this.requestRedraw();
        return true;
      },
      dragEnd: (screen) => {
        this.cursorScreen = screen;
        if (this.runner.tool?.id === 'grip') this.place();
      },
      leftDragSelects: () => !this.runner.request || this.runner.request.kind === 'selection',
      box: (from, to, done, shift) => {
        const mode = boxModeFor(from.x, to.x);
        if (!done) {
          this.selectBox = { from, to, mode };
          this.requestRedraw();
          return;
        }
        this.selectBox = undefined;
        const a = vp.screenToWorld(this.view, from);
        const b = vp.screenToWorld(this.view, to);
        const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
        for (const id of selectInBox(this.drawing, box, mode)) {
          if (shift) this.selected.delete(id);
          else this.selected.add(id);
        }
        this.refresh();
      },
      contextMenu: (x, y) => this.menu.open(x, y, this.contextItems(x, y)),
      leftDragPans: () => this.panMode || this.spaceHeld,
      panningChanged: (panning) => this.updateCanvasCursor(panning),
      scrollMode: () => this.settings.scrollMode,
    });

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.undo.dirty) e.preventDefault(); // the browser asks before leaving
    });
    const trackShift = (e: KeyboardEvent): void => {
      if (e.shiftKey === this.shiftHeld) return;
      this.shiftHeld = e.shiftKey;
      if (this.runner.request?.kind === 'entity') this.requestRedraw();
    };
    window.addEventListener('keydown', trackShift);
    window.addEventListener('keyup', trackShift);
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceHeld = false;
        this.updateCanvasCursor(false);
      }
    });
    window.addEventListener('blur', () => {
      this.spaceHeld = false;
      this.shiftHeld = false;
      this.updateCanvasCursor(false);
    });
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const inField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 's') {
      e.preventDefault();
      void this.saveDrawing(e.shiftKey);
      return;
    }
    if (mod && key === 'o') {
      e.preventDefault();
      void this.openDrawing();
      return;
    }
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.doUndo();
      return;
    }
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.doRedo();
      return;
    }
    if (inField) return; // the input boxes handle their own Tab, Enter and Esc
    if (this.runner.request?.kind === 'text' && !mod && !e.altKey && e.key.length === 1) {
      e.preventDefault(); // the note's box lost the focus: the key goes into it, not to a tool
      this.boxes.startTyping(e.key);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault(); // no page scroll
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.updateCanvasCursor(false);
      }
    } else if (e.key === 'F3' || e.key === 'F8' || e.key === 'F10') {
      e.preventDefault();
      if (e.key === 'F3') this.settings.osnap = !this.settings.osnap;
      else if (e.key === 'F8') this.settings.ortho = !this.settings.ortho;
      else this.settings.polar = !this.settings.polar;
      this.refresh();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.escape();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !this.runner.tool && this.selected.size > 0) {
      e.preventDefault();
      this.startTool(eraseTool);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.enter(this.boxes.enterAction());
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (this.runner.request) this.boxes.focusFirst();
    } else if (!mod && !e.altKey && this.runner.request && VALUE_START.test(e.key)) {
      e.preventDefault();
      this.boxes.startTyping(e.key);
    } else if (!mod && !e.altKey && key === 'h') {
      e.preventDefault();
      this.setPanMode(!this.panMode);
    } else if (!mod && !e.altKey) {
      const combo = e.shiftKey ? `shift+${key}` : key;
      const def = TOOLS.find((t) => t.shortcut === combo);
      if (def) {
        e.preventDefault();
        this.startTool(def);
      }
    }
  }
}
