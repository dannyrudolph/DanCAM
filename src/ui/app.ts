import { createArcTool } from '../commands/arcTool';
import { createCircleTool } from '../commands/circleTool';
import { lineTool } from '../commands/lineTool';
import type { Tracking } from '../commands/pointInput';
import { pointTool } from '../commands/pointTool';
import { type ToolContext, type ToolDef, type ToolInput, ToolRunner } from '../commands/tool';
import { rayTool } from '../commands/rayTool';
import { createXlineTool } from '../commands/xlineTool';
import type { Vec2 } from '../geometry/vec';
import { parseDrawing, serializeDrawing } from '../io/nativeFile';
import { type Drawing, type Units, createDrawing, drawingBBox } from '../model/drawing';
import type { Entity, EntityId, EntityProps } from '../model/entity';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import { pickEntity } from '../model/pick';
import { type Transaction, UndoStack } from '../model/undo';
import { ensureCurrentLayer } from '../model/layers';
import { MM_PER_INCH, UNIT_LABEL, convertUnits, relabelUnits } from '../model/units';
import { render } from '../render/renderer';
import * as vp from '../render/viewport';
import { ContextMenu, type MenuItem } from './contextMenu';
import { DrawingFile } from './fileAccess';
import { ICONS } from './icons';
import { type EnterAction, InputBoxes } from './inputBoxes';
import { type ScrollMode, bindCanvasInput } from './input';
import { LayersPanel } from './layersPanel';
import { PropertiesPanel } from './propertiesPanel';
import { DEFAULT_PRECISION, StatusBar, type StatusSettings } from './statusBar';

/** Pick radius around the cursor, CSS pixels. */
const PICK_RADIUS_PX = 6;
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

export const TOOLS: readonly ToolDef[] = [lineTool, createCircleTool(), createArcTool(), createXlineTool(), rayTool, pointTool];

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

/** "shift+x" → "Shift+X", for tooltips. */
export function shortcutLabel(shortcut: string): string {
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
  private readonly properties = new PropertiesPanel(el('properties'));
  private readonly layers = new LayersPanel(el('layers'), {
    commit: (tx, renamed) => this.commitLayerEdit(tx, renamed),
    setCurrent: (name) => {
      this.drawing.currentLayer = name;
      this.status.showMessage(`Current layer: ${name}`);
      this.refresh();
    },
    message: (m) => this.status.showMessage(m),
  });
  private readonly menu = new ContextMenu(document.body);
  private readonly optionsBar = el('options');
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly unitsButton = document.createElement('button');
  private readonly sidePanelButton = document.createElement('button');
  private readonly settings: StatusSettings = {
    scrollMode: loadScrollMode(),
    ortho: false,
    polar: true,
    polarIncrementDeg: 15,
    precision: DEFAULT_PRECISION,
  };

  private view: vp.Viewport;
  private cursorScreen: Vec2 | undefined;
  private lastCursorWorld: Vec2 = { x: 0, y: 0 };
  private selected: EntityId | undefined;
  private currentStyle: LineStyleName | undefined;
  private frameRequested = false;
  /** Space held: left-drag pans. */
  private spaceHeld = false;
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

    this.status = new StatusBar(el('status'), this.settings, () => {
      saveScrollMode(this.settings.scrollMode);
      this.refresh();
    });
    this.boxes = new InputBoxes(el('canvas-wrap'), {
      units: () => this.drawing.units,
      precision: () => this.settings.precision,
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
    this.selected = undefined;
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

  private commitLayerEdit(tx: Transaction, renamed?: { from: string; to: string }): void {
    // A tool mid-step (a line chain's "Undo last segment") must not undo a layer edit.
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
   * Esc: close the menu, else leave Pan, else clear locked values, else leave
   * the tool, else clear the selection.
   */
  private escape(): void {
    if (this.menu.isOpen) this.menu.close();
    else if (this.panMode) this.setPanMode(false);
    else if (this.boxes.hasLocks || this.boxes.focused) this.boxes.clearLocks();
    else if (this.runner.tool) this.runner.stop();
    else this.selected = undefined;
    this.refresh();
  }

  private enter(action: EnterAction): void {
    if (action === 'place') this.place();
    else if (action === 'finish') this.send({ kind: 'finish' });
    else this.requestRedraw();
  }

  /** A click, or Enter with values locked: answers the waiting step from the cursor and the boxes. */
  private place(): void {
    const req = this.runner.request;
    if (!req) return;
    const cursor = this.cursorWorld();
    if (req.kind === 'point') {
      this.send({ kind: 'point', at: this.nextPoint() });
    } else if (req.kind === 'value') {
      const value = this.boxes.resolveValue(cursor);
      if (value === undefined) this.status.showMessage(`Type a value for ${req.label}, then press Enter.`);
      else this.send({ kind: 'value', value, at: cursor });
    } else {
      const id = this.pickAt(cursor, req.accepts);
      if (id) this.send({ kind: 'entity', id, at: cursor });
      else this.status.showMessage('Nothing there that this step can use.');
    }
  }

  private pickAt(world: Vec2, accepts?: (e: Entity) => boolean): EntityId | undefined {
    return pickEntity(this.drawing, world, PICK_RADIUS_PX / this.view.scale, accepts);
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
    this.updateCanvasCursor(false);
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
  private nextPoint(): Vec2 {
    return this.boxes.resolve(this.cursorWorld(), this.tracking());
  }

  // ---- UI sync ---------------------------------------------------------------

  /** Brings every panel in line with the runner, selection and settings, then redraws. */
  private refresh(): void {
    if (this.drawing.units !== this.shownUnits) {
      this.shownUnits = this.drawing.units;
      this.zoomExtents();
    }
    this.unitsButton.textContent = this.drawing.units;
    document.title = `${this.undo.dirty ? '• ' : ''}${this.file.name} — DanCAM`;
    ensureCurrentLayer(this.drawing); // an undo may have removed it
    this.layers.show(this.drawing);
    const req = this.runner.request;
    this.boxes.setRequest(req);
    this.status.setPrompt(req?.prompt ?? 'Pick an object to see its properties, or choose a tool');
    this.status.refreshToggles();
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', this.runner.tool?.id === id);
    this.renderOptions();
    if (this.selected && !this.drawing.entities.has(this.selected)) this.selected = undefined;
    this.properties.show(this.drawing, this.selected ? this.drawing.entities.get(this.selected) : undefined, this.settings.precision);
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
    if (req && cursor) {
      if (req.kind === 'point') {
        next = this.nextPoint();
        preview = req.preview?.(next) ?? [];
      } else if (req.kind === 'value') {
        const value = this.boxes.resolveValue(cursor);
        if (value !== undefined) preview = req.preview?.(value, cursor) ?? [];
      } else {
        // Highlight what a click would pick.
        const hit = this.pickAt(cursor, req.accepts);
        const e = hit && this.drawing.entities.get(hit);
        if (e) preview = [e];
      }
    }
    render(this.g, this.view, this.drawing, { preview, selected: this.selected, nextPoint: next }, window.devicePixelRatio || 1);
    this.status.setCursor(next ?? cursor, req?.base);
    this.boxes.update(this.cursorScreen, req?.kind === 'point' ? next : cursor);
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
    for (const def of TOOLS) {
      const icon = ICONS[def.id as keyof typeof ICONS];
      const b = button(icon, `${def.label} (${shortcutLabel(def.shortcut)})`, () => this.startTool(def), `tool-${def.id}`);
      this.toolButtons.set(def.id, b);
      bar.append(b);
    }
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

  private contextItems(): MenuItem[] {
    const req = this.runner.request;
    if (!req) {
      return [
        { label: 'Zoom Extents', enabled: true, run: () => this.zoomExtents() },
        { label: 'Undo', enabled: this.undo.undoLabel !== undefined, run: () => this.doUndo() },
        { label: 'Redo', enabled: this.undo.redoLabel !== undefined, run: () => this.doRedo() },
      ];
    }
    return [
      { label: 'Enter', enabled: this.boxes.hasLocks || req.canFinish === true, run: () => this.enter(this.boxes.enterAction()) },
      { label: 'Cancel', enabled: true, run: () => this.escape() },
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
      click: (screen) => {
        this.cursorScreen = screen;
        if (this.runner.request) {
          this.place();
        } else {
          this.selected = this.pickAt(this.cursorWorld());
          this.refresh();
        }
      },
      contextMenu: (x, y) => this.menu.open(x, y, this.contextItems()),
      leftDragPans: () => this.panMode || this.spaceHeld,
      panningChanged: (panning) => this.updateCanvasCursor(panning),
      scrollMode: () => this.settings.scrollMode,
    });

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.undo.dirty) e.preventDefault(); // the browser asks before leaving
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceHeld = false;
        this.updateCanvasCursor(false);
      }
    });
    window.addEventListener('blur', () => {
      this.spaceHeld = false;
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

    if (e.key === ' ') {
      e.preventDefault(); // no page scroll
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.updateCanvasCursor(false);
      }
    } else if (e.key === 'F8' || e.key === 'F10') {
      e.preventDefault();
      if (e.key === 'F8') this.settings.ortho = !this.settings.ortho;
      else this.settings.polar = !this.settings.polar;
      this.refresh();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.escape();
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
