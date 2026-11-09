import { nearlyEqual } from '../geometry/tolerance';
import type { Vec2 } from '../geometry/vec';
import type { Tolerance, ZeroRules } from '../model/dimFormat';
import { type DimStyle, defaultDimStyle } from '../model/dimStyle';
import { type Drawing, type Layer, type Units, createDrawing } from '../model/drawing';
import type { DimensionEntity, Entity } from '../model/entity';
import { ensureCurrentLayer } from '../model/layers';
import { LINE_STYLE_NAMES, type LineStyleName } from '../model/lineStyle';

/**
 * The native `.cad2d.json` format: plain, indented JSON that stays readable
 * without the app. Numbers are written with JavaScript's shortest exact
 * representation, so saving and opening returns every coordinate bit for bit.
 */
export const FILE_EXTENSION = '.cad2d.json';
export const FORMAT = 'DanCAM drawing';
export const SCHEMA_VERSION = 2;

/** Version 2 added dimension styles (and dimension entities, which need them). */
type FileV2 = {
  format: typeof FORMAT;
  schemaVersion: 2;
  units: Units;
  nextId: number;
  /** Optional: files from before layers had a current layer open on "0". */
  currentLayer?: string;
  currentDimStyle: string;
  /** Optional: files from before it existed print at 1:1. */
  sheetScale?: number;
  layers: Layer[];
  dimStyles: DimStyle[];
  entities: Entity[];
};

export function serializeDrawing(d: Drawing): string {
  const file: FileV2 = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    units: d.units,
    nextId: d.nextId,
    currentLayer: d.currentLayer,
    currentDimStyle: d.currentDimStyle,
    sheetScale: d.sheetScale,
    layers: [...d.layers.values()],
    dimStyles: [...d.dimStyles.values()],
    entities: [...d.entities.values()],
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ParseResult = { readonly ok: true; readonly drawing: Drawing } | { readonly ok: false; readonly error: string };

/** Thrown inside the parser; turned into a ParseResult error at the top. */
class FileError extends Error {}

/**
 * Upgrades from version n to n + 1, run in order until the file is current,
 * so old drawings always open.
 */
const MIGRATIONS: Readonly<Record<number, (file: Record<string, unknown>) => Record<string, unknown>>> = {
  // 1 → 2: the drawing gets its unit's default dimension style. (Bad units are reported by the reader.)
  1: (file) => {
    const style = defaultDimStyle(file.units === 'mm' ? 'mm' : 'in');
    return { ...file, schemaVersion: 2, dimStyles: [style], currentDimStyle: style.name };
  },
};

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
    return { ok: true, drawing: readCurrent(file) };
  } catch (err) {
    if (err instanceof FileError) return { ok: false, error: err.message };
    throw err;
  }
}

function readCurrent(file: Record<string, unknown>): Drawing {
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

  d.dimStyles.clear();
  arr(file.dimStyles, 'dimStyles').forEach((v, i) => {
    const s = readDimStyle(obj(v, `dimStyles[${i}]`), `dimStyles[${i}]`);
    if (d.dimStyles.has(s.name)) throw new FileError(`dimStyles[${i}]: style "${s.name}" appears twice.`);
    d.dimStyles.set(s.name, s);
  });
  if (d.dimStyles.size === 0) throw new FileError('The drawing has no dimension styles.');
  const dimStyle = str(file.currentDimStyle, 'currentDimStyle');
  if (!d.dimStyles.has(dimStyle)) throw new FileError(`currentDimStyle: style "${dimStyle}" is not defined.`);
  d.currentDimStyle = dimStyle;
  if (file.sheetScale !== undefined) {
    const scale = num(file.sheetScale, 'sheetScale');
    if (!(scale > 0)) throw new FileError('sheetScale must be more than zero.');
    d.sheetScale = scale;
  }

  let maxId = 0;
  arr(file.entities, 'entities').forEach((v, i) => {
    const e = readEntity(obj(v, `entities[${i}]`), `entities[${i}]`);
    if (d.entities.has(e.id)) throw new FileError(`entities[${i}]: id "${e.id}" appears twice.`);
    if (!d.layers.has(e.layer)) throw new FileError(`entities[${i}]: layer "${e.layer}" is not defined.`);
    if (e.kind === 'dimension' && !d.dimStyles.has(e.dimStyle)) {
      throw new FileError(`entities[${i}]: dimension style "${e.dimStyle}" is not defined.`);
    }
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
    case 'ray':
      return { kind: o.kind, ...base, base: vec(o.base, `${at}.base`), dir: unitVec(o.dir, `${at}.dir`) };
    case 'dimension':
      return readDimension(o, base, at);
    default:
      throw new FileError(`${at}: unknown kind ${JSON.stringify(o.kind)}.`);
  }
}

function readDimension(o: Record<string, unknown>, base: Pick<Entity, 'id' | 'layer' | 'style'>, at: string): DimensionEntity {
  const common = {
    kind: 'dimension' as const,
    ...base,
    dimStyle: str(o.dimStyle, `${at}.dimStyle`),
    at: vec(o.at, `${at}.at`),
    ...(o.refs === undefined ? {} : { refs: arr(o.refs, `${at}.refs`).map((r, i) => str(r, `${at}.refs[${i}]`)) }),
    ...(o.precision === undefined ? {} : { precision: places(o.precision, `${at}.precision`) }),
    ...(o.tolerance === undefined ? {} : { tolerance: tolerance(o.tolerance, `${at}.tolerance`) }),
    ...(o.textOverride === undefined ? {} : { textOverride: str(o.textOverride, `${at}.textOverride`) }),
  };
  const ends = (): { p1: Vec2; p2: Vec2 } => ({ p1: vec(o.p1, `${at}.p1`), p2: vec(o.p2, `${at}.p2`) });
  switch (o.type) {
    case 'linear':
      return { ...common, type: 'linear', ...ends(), dir: unitVec(o.dir, `${at}.dir`) };
    case 'aligned':
      return { ...common, type: 'aligned', ...ends() };
    case 'radius':
    case 'diameter':
      return { ...common, type: o.type, center: vec(o.center, `${at}.center`), radius: radius(o.radius, `${at}.radius`) };
    case 'angular':
      return {
        ...common,
        type: 'angular',
        vertex: vec(o.vertex, `${at}.vertex`),
        ...ends(),
        dir1: unitVec(o.dir1, `${at}.dir1`),
        dir2: unitVec(o.dir2, `${at}.dir2`),
      };
    case 'leader':
      return { ...common, type: 'leader', tip: vec(o.tip, `${at}.tip`), text: str(o.text, `${at}.text`) };
    default:
      throw new FileError(`${at}.type must be linear, aligned, radius, diameter, angular or leader.`);
  }
}

/** A whole number of decimal places, 0 to 8. */
function places(v: unknown, at: string): number {
  const n = num(v, at);
  if (!Number.isInteger(n) || n < 0 || n > 8) throw new FileError(`${at} must be a whole number from 0 to 8.`);
  return n;
}

function readDimStyle(o: Record<string, unknown>, at: string): DimStyle {
  const size = (key: string, positive: boolean): number => {
    const v = num(o[key], `${at}.${key}`);
    if (positive ? !(v > 0) : v < 0) throw new FileError(`${at}.${key} must be ${positive ? 'more than zero' : 'zero or more'}.`);
    return v;
  };
  const places = (key: string): number => {
    const v = num(o[key], `${at}.${key}`);
    if (!Number.isInteger(v) || v < 0 || v > 8) throw new FileError(`${at}.${key} must be a whole number from 0 to 8.`);
    return v;
  };
  const zeros = (v: unknown, where: string): ZeroRules => {
    const z = obj(v, where);
    return { leading: bool(z.leading, `${where}.leading`), trailing: bool(z.trailing, `${where}.trailing`) };
  };
  if (o.angleFormat !== 'decimal' && o.angleFormat !== 'dms') throw new FileError(`${at}.angleFormat must be "decimal" or "dms".`);
  let dual: DimStyle['dual'];
  if (o.dual !== undefined) {
    const u = obj(o.dual, `${at}.dual`);
    const precision = num(u.precision, `${at}.dual.precision`);
    if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new FileError(`${at}.dual.precision must be a whole number from 0 to 8.`);
    dual = { precision, zeros: zeros(u.zeros, `${at}.dual.zeros`) };
  }
  return {
    name: str(o.name, `${at}.name`),
    textHeight: size('textHeight', true),
    arrowSize: size('arrowSize', false),
    extOffset: size('extOffset', false),
    extExtend: size('extExtend', false),
    textGap: size('textGap', false),
    precision: places('precision'),
    zeros: zeros(o.zeros, `${at}.zeros`),
    tolerance: tolerance(o.tolerance, `${at}.tolerance`),
    tolPrecision: places('tolPrecision'),
    angleFormat: o.angleFormat,
    anglePrecision: places('anglePrecision'),
    ...(dual && { dual }),
    ...(o.prefix === undefined ? {} : { prefix: str(o.prefix, `${at}.prefix`) }),
    ...(o.suffix === undefined ? {} : { suffix: str(o.suffix, `${at}.suffix`) }),
  };
}

function tolerance(v: unknown, at: string): Tolerance {
  const t = obj(v, at);
  switch (t.kind) {
    case 'none':
      return { kind: 'none' };
    case 'symmetric':
      return { kind: 'symmetric', value: num(t.value, `${at}.value`) };
    case 'deviation':
    case 'limits':
      return { kind: t.kind, upper: num(t.upper, `${at}.upper`), lower: num(t.lower, `${at}.lower`) };
    default:
      throw new FileError(`${at}.kind must be none, symmetric, deviation or limits.`);
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

function unitVec(v: unknown, at: string): Vec2 {
  const dir = vec(v, at);
  if (!nearlyEqual(Math.hypot(dir.x, dir.y), 1)) throw new FileError(`${at} must be a unit vector.`);
  return dir;
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
