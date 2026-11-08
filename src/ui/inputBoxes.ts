import {
  type EntryMode,
  type FieldKey,
  type Locks,
  type Tracking,
  fieldValue,
  fieldsFor,
  resolvePoint,
} from '../commands/pointInput';
import type { PointRequest } from '../commands/tool';
import { type ParseResult, parseAngle, parseLength } from '../commands/valueExpr';
import type { Vec2 } from '../geometry/vec';
import type { Units } from '../model/drawing';
import { formatNumber } from './statusBar';

const LABELS: Record<FieldKey, string> = { x: 'X', y: 'Y', dx: 'ΔX', dy: 'ΔY', length: 'L', angle: '∠' };
const MODE_LABELS: Record<EntryMode, string> = { polar: 'L∠', delta: 'ΔXY', absolute: 'XY' };
const NEXT_MODE: Record<EntryMode, EntryMode> = { polar: 'delta', delta: 'absolute', absolute: 'polar' };

/** Offset of the boxes from the cursor, CSS pixels. */
const OFFSET_PX = 18;

/** What Enter means after the boxes have taken their turn. */
export type EnterAction = 'place' | 'finish' | 'none';

export type InputBoxesHost = {
  units(): Units;
  precision(): number;
  /** Called after any change that moves the resolved point (typing, locking, mode). */
  changed(): void;
  enter(action: EnterAction): void;
  escape(): void;
};

type Field = { key: FieldKey; input: HTMLInputElement; dirty: boolean };

/**
 * The input boxes that follow the cursor while a tool asks for a point. Typing
 * a value and pressing Tab locks it; locked values constrain the point.
 */
export class InputBoxes {
  private readonly root: HTMLElement;
  private readonly modeButton: HTMLButtonElement;
  private fields: Field[] = [];
  private request: PointRequest | undefined;
  private locks: Locks = {};
  private mode: EntryMode = 'polar';

  constructor(
    container: HTMLElement,
    private readonly host: InputBoxesHost,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'input-boxes';
    this.root.hidden = true;
    this.modeButton = document.createElement('button');
    this.modeButton.className = 'input-mode';
    this.modeButton.type = 'button';
    this.modeButton.tabIndex = -1;
    this.modeButton.title = 'Switch between length/angle, ΔX/ΔY and absolute X/Y';
    this.modeButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.modeButton.addEventListener('click', () => this.setMode(NEXT_MODE[this.mode]));
    container.append(this.root);
  }

  get hasLocks(): boolean {
    return Object.keys(this.locks).length > 0;
  }

  get focused(): boolean {
    return this.root.contains(document.activeElement);
  }

  /** Shows the boxes for a new step, or hides them. A new step clears locks. */
  setRequest(req: PointRequest | undefined): void {
    if (req === this.request) return;
    this.request = req;
    this.locks = {};
    this.rebuild();
  }

  clearLocks(): void {
    this.locks = {};
    for (const f of this.fields) f.dirty = false;
    this.blur();
    this.host.changed();
  }

  /** The point a click or Enter would place now, counting valid text still being typed. */
  resolve(cursor: Vec2, tracking: Tracking): Vec2 {
    return resolvePoint(cursor, this.request?.base, this.effectiveMode(), this.provisionalLocks(), tracking);
  }

  /** Moves the boxes next to the cursor and refreshes the live values. */
  update(cursorScreen: Vec2 | undefined, point: Vec2 | undefined): void {
    if (!this.request || !cursorScreen || !point) {
      this.root.hidden = !this.request || !this.focused;
      if (!this.request) return;
    } else {
      this.root.hidden = false;
      this.root.style.transform = `translate(${cursorScreen.x + OFFSET_PX}px, ${cursorScreen.y + OFFSET_PX}px)`;
    }
    for (const f of this.fields) {
      const locked = this.locks[f.key];
      f.input.classList.toggle('locked', locked !== undefined);
      if (f.dirty) continue; // never overwrite what the user is typing
      const value = locked ?? (point ? fieldValue(f.key, point, this.request.base) : undefined);
      if (value === undefined) continue;
      const text = formatNumber(value, this.host.precision());
      if (f.input.value === text) continue;
      f.input.value = text;
      // A focused box keeps its text selected, so typing replaces the live value.
      if (document.activeElement === f.input) f.input.select();
    }
  }

  /**
   * Starts typing into the first unlocked box with `ch`, for a key pressed
   * while the canvas has focus. Returns false when there are no boxes.
   */
  startTyping(ch: string): boolean {
    const target = this.fields.find((f) => this.locks[f.key] === undefined) ?? this.fields[0];
    if (!target) return false;
    this.root.hidden = false; // a hidden input can't take focus
    target.input.focus();
    target.input.value = ch;
    target.dirty = true;
    this.host.changed();
    return true;
  }

  focusFirst(): boolean {
    const f = this.fields[0];
    if (!f) return false;
    this.root.hidden = false;
    f.input.focus();
    f.input.select();
    return true;
  }

  /** What Enter should do, after locking any value still being typed. */
  enterAction(): EnterAction {
    for (const f of this.fields) {
      if (f.dirty && !this.lockField(f)) return 'none';
    }
    if (this.hasLocks) return 'place';
    return this.request?.canFinish ? 'finish' : 'none';
  }

  private effectiveMode(): EntryMode {
    return this.request?.base ? this.mode : 'absolute';
  }

  private setMode(mode: EntryMode): void {
    this.mode = mode;
    this.locks = {};
    this.rebuild();
    this.host.changed();
  }

  private provisionalLocks(): Locks {
    const locks: Locks = { ...this.locks };
    for (const f of this.fields) {
      if (!f.dirty) continue;
      const r = this.parse(f);
      if (r.ok) locks[f.key] = r.value;
    }
    return locks;
  }

  private parse(f: Field): ParseResult {
    return f.key === 'angle' ? parseAngle(f.input.value) : parseLength(f.input.value, this.host.units());
  }

  /** Locks a typed value, or unlocks the field when it was emptied. False if the text is invalid. */
  private lockField(f: Field): boolean {
    if (f.input.value.trim() === '') {
      delete this.locks[f.key];
      f.dirty = false;
      f.input.classList.remove('invalid');
      return true;
    }
    const r = this.parse(f);
    if (!r.ok) {
      f.input.classList.add('invalid');
      f.input.title = r.error;
      return false;
    }
    this.locks[f.key] = r.value;
    f.dirty = false;
    f.input.classList.remove('invalid');
    f.input.title = '';
    return true;
  }

  private blur(): void {
    if (this.focused && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private rebuild(): void {
    this.blur();
    this.root.replaceChildren();
    this.fields = [];
    if (!this.request) {
      this.root.hidden = true;
      return;
    }
    for (const key of fieldsFor(this.request.base, this.effectiveMode())) {
      const label = document.createElement('label');
      label.className = 'input-field';
      const name = document.createElement('span');
      name.textContent = LABELS[key];
      const input = document.createElement('input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.field = key;
      const field: Field = { key, input, dirty: false };
      input.addEventListener('input', () => {
        field.dirty = true;
        input.classList.remove('invalid');
        this.host.changed();
      });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => this.onKey(e, field));
      label.append(name, input);
      this.root.append(label);
      this.fields.push(field);
    }
    if (this.request.base) {
      this.modeButton.textContent = MODE_LABELS[this.mode];
      this.root.append(this.modeButton);
    }
  }

  private onKey(e: KeyboardEvent, f: Field): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (f.dirty && !this.lockField(f)) return;
      const i = this.fields.indexOf(f);
      const next = this.fields[(i + (e.shiftKey ? this.fields.length - 1 : 1)) % this.fields.length];
      next?.input.focus();
      this.host.changed();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const action = this.enterAction();
      if (action !== 'none') this.blur();
      this.host.enter(action);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.host.escape();
    }
  }
}
