import { nearlyEqual } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';
import { type Drawing, type Layer, type Units, createDrawing } from '../model/drawing';
import type { Entity } from '../model/entity';
import { ensureCurrentLayer } from '../model/layers';
import { LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';

/**
 * The native `.cad2d.json` format: plain, indented JSON that stays readable
 * without the app. Numbers are written with JavaScript's shortest exact
 * representation, so saving and opening returns every coordinate bit for bit.
 */
export const FILE_EXTENSION = '.cad2d.json';
export const FORMAT = 'DanCAM drawing';
export const SCHEMA_VERSION = 1;

type FileV1 = {
  format: typeof FORMAT;
  schemaVersion: 1;
  units: Units;
  nextId: number;
  /** Optional: files from before layers had a current layer open on "0". */
  currentLayer?: string;
  layers: Layer[];
  entities: Entity[];
};

export function serializeDrawing(d: Drawing): string {
  const file: FileV1 = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    units: d.units,
    nextId: d.nextId,
    currentLayer: d.currentLayer,
    layers: [...d.layers.values()],
    entities: [...d.entities.values()],
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ParseResult = { readonly ok: true; readonly drawing: Drawing } | { readonly ok: false; readonly error: string };

/** Thrown inside the parser; turned into a ParseResult error at the top. */
class FileError extends Error {}

/**
 * Upgrades from version n to n + 1, run in order until the file is current,
 * so old drawings always open. None yet: version 1 is the first.
 */
const MIGRATIONS: Readonly<Record<number, (file: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Reads a `.cad2d.json` file, checking every field, or explains why it can't. */
export function parseDrawing(text: string): ParseResult {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new FileError('This file is not valid JSON.');
    }
    let file = obj(raw, 'file');
    if (file.format !== FORMAT) throw new FileError('This is not a DanCAM drawing.');
    let version = num(file.schemaVersion, 'schemaVersion');
    if (version > SCHEMA_VERSION) {
      throw new FileError(`This drawing was saved by a newer DanCAM (file version ${version}); update DanCAM to open it.`);
    }
    while (version < SCHEMA_VERSION) {
      const migrate = MIGRATIONS[version];
      if (!migrate) throw new FileError(`Unknown file version ${version}.`);
      file = migrate(file);
      version += 1;
    }
    return { ok: true, drawing: readV1(file) };
  } catch (err) {
    if (err instanceof FileError) return { ok: false, error: err.message };
    throw err;
  }
}

function readV1(file: Record<string, unknown>): Drawing {
  const units = file.units;
  if (units !== 'in' && units !== 'mm') throw new FileError('units must be "in" or "mm".');
  const d = createDrawing(units);
  d.layers.clear();

  arr(file.layers, 'layers').forEach((v, i) => {
    const at = `layers[${i}]`;
    const o = obj(v, at);
    const layer: Layer = {
      name: str(o.name, `${at}.name`),
      color: str(o.color, `${at}.color`),
      visible: bool(o.visible, `${at}.visible`),
      style: style(o.style, `${at}.style`),
    };
    if (d.layers.has(layer.name)) throw new FileError(`${at}: layer "${layer.name}" appears twice.`);
    d.layers.set(layer.name, layer);
  });
  if (d.layers.size === 0) throw new FileError('The drawing has no layers.');

  let maxId = 0;
  arr(file.entities, 'entities').forEach((v, i) => {
    const e = readEntity(obj(v, `entities[${i}]`), `entities[${i}]`);
    if (d.entities.has(e.id)) throw new FileError(`entities[${i}]: id "${e.id}" appears twice.`);
    if (!d.layers.has(e.layer)) throw new FileError(`entities[${i}]: layer "${e.layer}" is not defined.`);
    d.entities.set(e.id, e);
    const n = /^e(\d+)$/.exec(e.id);
    if (n) maxId = Math.max(maxId, Number(n[1]));
  });

  if (file.currentLayer === undefined) {
    ensureCurrentLayer(d);
  } else {
    const current = str(file.currentLayer, 'currentLayer');
    if (!d.layers.has(current)) throw new FileError(`currentLayer: layer "${current}" is not defined.`);
    d.currentLayer = current;
  }

  // Never hand out an id that is already in use, even if nextId was edited by hand.
  const nextId = file.nextId === undefined ? 1 : num(file.nextId, 'nextId');
  d.nextId = Math.max(Math.floor(nextId), maxId + 1);
  return d;
}

function readEntity(o: Record<string, unknown>, at: string): Entity {
  const base = {
    id: str(o.id, `${at}.id`),
    layer: str(o.layer, `${at}.layer`),
    ...(o.style === undefined ? {} : { style: style(o.style, `${at}.style`) }),
  };
  switch (o.kind) {
    case 'point':
      return { kind: 'point', ...base, at: vec(o.at, `${at}.at`) };
    case 'line':
      return { kind: 'line', ...base, start: vec(o.start, `${at}.start`), end: vec(o.end, `${at}.end`) };
    case 'circle':
      return { kind: 'circle', ...base, center: vec(o.center, `${at}.center`), radius: radius(o.radius, `${at}.radius`) };
    case 'arc':
      return {
        kind: 'arc',
        ...base,
        center: vec(o.center, `${at}.center`),
        radius: radius(o.radius, `${at}.radius`),
        startDeg: degrees(o.startDeg, `${at}.startDeg`),
        endDeg: degrees(o.endDeg, `${at}.endDeg`),
      };
    case 'xline':
    case 'ray': {
      const dir = vec(o.dir, `${at}.dir`);
      if (!nearlyEqual(Math.hypot(dir.x, dir.y), 1)) throw new FileError(`${at}.dir must be a unit vector.`);
      return { kind: o.kind, ...base, base: vec(o.base, `${at}.base`), dir };
    }
    default:
      throw new FileError(`${at}: unknown kind ${JSON.stringify(o.kind)}.`);
  }
}

function obj(v: unknown, at: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new FileError(`${at} must be an object.`);
  return v as Record<string, unknown>;
}

function arr(v: unknown, at: string): unknown[] {
  if (!Array.isArray(v)) throw new FileError(`${at} must be a list.`);
  return v;
}

function str(v: unknown, at: string): string {
  if (typeof v !== 'string') throw new FileError(`${at} must be text.`);
  return v;
}

function bool(v: unknown, at: string): boolean {
  if (typeof v !== 'boolean') throw new FileError(`${at} must be true or false.`);
  return v;
}

function num(v: unknown, at: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new FileError(`${at} must be a number.`);
  return v;
}

function vec(v: unknown, at: string): Vec2 {
  const o = obj(v, at);
  return { x: num(o.x, `${at}.x`), y: num(o.y, `${at}.y`) };
}

function radius(v: unknown, at: string): number {
  const r = num(v, at);
  if (!(r > 0)) throw new FileError(`${at} must be more than zero.`);
  return r;
}

function degrees(v: unknown, at: string): number {
  const d = num(v, at);
  if (d < 0 || d >= 360) throw new FileError(`${at} must be at least 0 and below 360.`);
  return d;
}

function style(v: unknown, at: string): LineStyleName {
  if (!LINE_STYLE_NAMES.includes(v as LineStyleName)) {
    throw new FileError(`${at} must be one of ${LINE_STYLE_NAMES.join(', ')}.`);
  }
  return v as LineStyleName;
}
