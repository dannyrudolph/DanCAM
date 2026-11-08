import { registerBuiltins } from '../commands/builtins';
import type { CommandContext } from '../commands/command';
import { CommandRegistry } from '../commands/registry';
import { CommandRunner } from '../commands/runner';
import type { Vec2 } from '../geometry/vec';
import { createDrawing, drawingBBox } from '../model/drawing';
import { UndoStack } from '../model/undo';
import { render } from '../render/renderer';
import * as vp from '../render/viewport';
import { CommandLine } from './commandLine';
import { loadDemo } from './demo';
import { bindCanvasInput } from './input';
import { StatusBar } from './statusBar';
import './style.css';

/** Initial view: about 4 drawing units across a 1000px canvas, origin near the lower left. */
const INITIAL_SCALE = 250;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in index.html`);
  return found as T;
}

const canvas = el<HTMLCanvasElement>('canvas');
const ctx2d = canvas.getContext('2d');
if (!ctx2d) throw new Error('Canvas 2D is not available');
const g = ctx2d;

const drawing = createDrawing('in');
if (new URLSearchParams(location.search).has('demo')) loadDemo(drawing);
const undo = new UndoStack(drawing);

let view: vp.Viewport = { center: { x: 1.5, y: 1 }, scale: INITIAL_SCALE, widthPx: 1, heightPx: 1 };
let cursorScreen: Vec2 | undefined;
let frameRequested = false;

const statusBar = new StatusBar(el('status'));
const commandLine = new CommandLine(el('cmdline'), requestRedraw);

function requestRedraw(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    render(g, view, drawing, window.devicePixelRatio || 1);
    statusBar.setCursor(cursorScreen && vp.screenToWorld(view, cursorScreen));
    statusBar.setView(drawing.units, view.widthPx / view.scale);
  });
}

function zoomExtents(): void {
  view = vp.zoomExtents(view, drawingBBox(drawing));
  requestRedraw();
}

const commandCtx: CommandContext = {
  drawing,
  undo,
  view: { zoomExtents },
  print: (m) => commandLine.print(m),
};
const registry = new CommandRegistry();
registerBuiltins(registry);
commandLine.attach(new CommandRunner(registry, commandCtx));

function fitCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  view = vp.resize(view, r.width, r.height);
  requestRedraw();
}
new ResizeObserver(fitCanvas).observe(canvas);
fitCanvas();

bindCanvasInput(canvas, {
  zoomAt(screen, factor) {
    view = vp.zoomAt(view, screen, factor);
    requestRedraw();
  },
  pan(dx, dy) {
    view = vp.pan(view, dx, dy);
    requestRedraw();
  },
  zoomExtents,
  cursor(screen) {
    cursorScreen = screen;
    requestRedraw();
  },
});

// Keyboard-first: typing anywhere goes to the command line.
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    commandLine.run('U');
  } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault();
    commandLine.run('REDO');
  } else if (document.activeElement !== commandLine.input && !mod) {
    commandLine.input.focus();
  }
});
canvas.addEventListener('pointerup', () => commandLine.input.focus());

if (drawing.entities.size > 0) {
  // Wait one frame so the canvas has its real size before fitting.
  requestAnimationFrame(zoomExtents);
}
commandLine.print('DanCAM — type Z then E for Zoom Extents, U to undo. Wheel zooms, middle-drag pans.');
commandLine.input.focus();
