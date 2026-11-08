import { createArcTool } from '../commands/arcTool';
import { createCircleTool } from '../commands/circleTool';
import { lineTool } from '../commands/lineTool';
import type { Tracking } from '../commands/pointInput';
import { pointTool } from '../commands/pointTool';
import { type ToolContext, type ToolDef, type ToolInput, ToolRunner } from '../commands/tool';
import { createXlineTool } from '../commands/xlineTool';
import type { Vec2 } from '../geometry/vec';
import { DEFAULT_LAYER, type Drawing, drawingBBox } from '../model/drawing';
import type { Entity, EntityId, EntityProps } from '../model/entity';
import { LINE_STYLES, LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';
import { pickEntity } from '../model/pick';
import { UndoStack } from '../model/undo';
import { render } from '../render/renderer';
import * as vp from '../render/viewport';
import { ContextMenu, type MenuItem } from './contextMenu';
import { ICONS } from './icons';
import { type EnterAction, InputBoxes } from './inputBoxes';
import { type ScrollMode, bindCanvasInput } from './input';
import { PropertiesPanel } from './propertiesPanel';
import { DEFAULT_PRECISION, StatusBar, type StatusSettings } from './statusBar';

/** Pick radius around the cursor, CSS pixels. */
const PICK_RADIUS_PX = 6;
/** Initial view: about 4 drawing units across a 1000px canvas. */
const INITIAL_SCALE = 250;

export const TOOLS: readonly ToolDef[] = [lineTool, createCircleTool(), createArcTool(), createXlineTool(), pointTool];

/** Keys that start typing a value into the input boxes. */
const VALUE_START = /^[0-9.+\-(]$/;

const SCROLL_MODE_KEY = 'dancam.scrollMode';

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
  private readonly undo: UndoStack;
  private readonly runner: ToolRunner;
  private readonly canvas = el<HTMLCanvasElement>('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly boxes: InputBoxes;
  private readonly status: StatusBar;
  private readonly properties = new PropertiesPanel(el('properties'));
  private readonly menu = new ContextMenu(document.body);
  private readonly optionsBar = el('options');
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly settings: StatusSettings = {
    scrollMode: loadScrollMode(),
    ortho: false,
    polar: true,
    polarIncrementDeg: 15,
    precision: DEFAULT_PRECISION,
  };

  private view: vp.Viewport = { center: { x: 1.5, y: 1 }, scale: INITIAL_SCALE, widthPx: 1, heightPx: 1 };
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

  constructor(private readonly drawing: Drawing) {
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D is not available');
    this.g = g;
    this.undo = new UndoStack(drawing);

    const ctx: ToolContext = {
      drawing,
      undo: this.undo,
      newProps: () => this.newProps(),
      message: (m) => this.status.showMessage(m),
      continuation: undefined,
    };
    this.runner = new ToolRunner(ctx);

    this.status = new StatusBar(el('status'), this.settings, () => {
      saveScrollMode(this.settings.scrollMode);
      this.refresh();
    });
    this.status.setUnits(drawing.units);
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
    return this.currentStyle ? { layer: DEFAULT_LAYER, style: this.currentStyle } : { layer: DEFAULT_LAYER };
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

  private buildToolbar(): void {
    const bar = el('toolbar');
    for (const def of TOOLS) {
      const icon = ICONS[def.id as keyof typeof ICONS];
      const b = button(icon, `${def.label} (${def.shortcut.toUpperCase()})`, () => this.startTool(def), `tool-${def.id}`);
      this.toolButtons.set(def.id, b);
      bar.append(b);
    }
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
    bar.append(
      button(ICONS.undo, 'Undo (Ctrl+Z)', () => this.doUndo(), 'undo'),
      button(ICONS.redo, 'Redo (Ctrl+Y)', () => this.doRedo(), 'redo'),
      this.panButton,
      button(ICONS.extents, 'Zoom Extents (double-click middle button)', () => this.zoomExtents(), 'zoom-extents'),
      style,
    );
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
      const def = TOOLS.find((t) => t.shortcut === key);
      if (def) {
        e.preventDefault();
        this.startTool(def);
      }
    }
  }
}
