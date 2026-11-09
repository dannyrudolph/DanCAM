/**
 * Dimension text: a measured value turned into what the print shows. Pure
 * string formatting; stored values are never changed (CAD-5).
 *
 * Rounding is decimal, not binary: a stored .1245 (really 0.12449999…) shows
 * as .125 at three places, as a person reading the print expects. Halves
 * round away from zero.
 */

/** ASME Y14.5 defaults: inch drops the leading zero and keeps trailing ones; mm the reverse. */
export type ZeroRules = { readonly leading: boolean; readonly trailing: boolean };

export const INCH_ZEROS: ZeroRules = { leading: false, trailing: true };
export const MM_ZEROS: ZeroRules = { leading: true, trailing: false };

/**
 * Tolerances, in drawing units. Deviations are signed offsets from the value
 * (`upper` +.002, `lower` -.001); limits show value + upper over value + lower.
 */
export type Tolerance =
  | { readonly kind: 'none' }
  | { readonly kind: 'symmetric'; readonly value: number }
  | { readonly kind: 'deviation'; readonly upper: number; readonly lower: number }
  | { readonly kind: 'limits'; readonly upper: number; readonly lower: number };

export type DimFormat = {
  /** Decimal places, 0–8 (for D°M'S: 0 = degrees, 1 = minutes, 2 = seconds, more = decimal seconds). */
  readonly precision: number;
  readonly zeros: ZeroRules;
  readonly tolerance: Tolerance;
  readonly tolPrecision: number;
  /** Alternate units in brackets: the value times `factor` (25.4 from inch, 1/25.4 from mm). */
  readonly dual?: { readonly factor: number; readonly precision: number; readonly zeros: ZeroRules };
  readonly prefix?: string;
  readonly suffix?: string;
  /** Replaces the value text; `<>` in it stands for the measured value (with prefix and suffix). */
  readonly override?: string;
  /** Angles only: decimal degrees, or degrees, minutes and seconds. */
  readonly angle?: 'decimal' | 'dms';
};

/**
 * The text of a dimension, in the pieces a layout places: the main text, a
 * tolerance (on the line for ±, stacked for deviations and limits), and the
 * alternate units. For limits, `main` is empty and the stack holds the limits.
 */
export type DimText = {
  readonly main: string;
  readonly tol?: { readonly kind: 'inline'; readonly text: string } | { readonly kind: 'stack'; readonly upper: string; readonly lower: string };
  readonly alt?: string;
};

/**
 * `value` rounded to `places` decimals, as a plain decimal string with
 * exactly that many places ("-0.125", "3.000"). Never "-0": a value that
 * rounds to zero has no sign.
 */
export function roundDecimal(value: number, places: number): string {
  if (!Number.isFinite(value)) return String(value);
  const neg = value < 0;
  // 15 significant digits is the shortest decimal that reads back the stored double's intent.
  const [mant, expPart] = Math.abs(value).toExponential(14).split('e');
  const exp = Number(expPart);
  const digits = mant!.replace('.', '');
  // digits d0 d1 d2 … stand for d0.d1d2… × 10^exp; place the point.
  let intPart: string;
  let fracPart: string;
  if (exp >= 0) {
    const padded = digits.padEnd(exp + 1, '0');
    intPart = padded.slice(0, exp + 1);
    fracPart = padded.slice(exp + 1);
  } else {
    intPart = '0';
    fracPart = '0'.repeat(-exp - 1) + digits;
  }
  fracPart = fracPart.padEnd(places + 1, '0');
  let kept = intPart + fracPart.slice(0, places);
  if (fracPart[places]! >= '5') kept = increment(kept);
  const i = kept.length - places;
  const whole = (kept.slice(0, i) || '0').replace(/^0+(?=\d)/, '');
  const text = places > 0 ? `${whole}.${kept.slice(i)}` : whole;
  return neg && /[1-9]/.test(text) ? `-${text}` : text;
}

/** Adds one to a string of decimal digits ("0999" → "1000"). */
function increment(digits: string): string {
  const d = digits.split('');
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i] === '9') d[i] = '0';
    else {
      d[i] = String(Number(d[i]) + 1);
      return d.join('');
    }
  }
  return `1${d.join('')}`;
}

/** Applies zero rules to a decimal string from `roundDecimal`. */
function applyZeros(text: string, zeros: ZeroRules): string {
  let t = text;
  if (!zeros.trailing && t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  if (!zeros.leading) t = t.replace(/^(-?)0\./, '$1.');
  return t;
}

/** A number as the print shows it: rounded, then the zero rules. */
export function formatDecimal(value: number, places: number, zeros: ZeroRules): string {
  return applyZeros(roundDecimal(value, places), zeros);
}

/**
 * A signed deviation: "+.002", "-0.01". A zero deviation keeps the sign of
 * its slot ("+.000" / "-.000") when the style keeps trailing zeros (inch),
 * and is a bare "0" when it drops them (mm, ASME unilateral style).
 */
function formatDeviation(value: number, places: number, zeros: ZeroRules, styleTrailing: boolean, sign: '+' | '-'): string {
  const text = formatDecimal(Math.abs(value), places, zeros);
  if (!/[1-9]/.test(text)) return styleTrailing ? `${sign}${text}` : '0';
  return `${value < 0 ? '-' : '+'}${text}`;
}

/** Degrees as D°M'S" at `precision` (0: D°, 1: D°M', 2: D°M'S", more: decimal seconds). */
export function formatDms(deg: number, precision: number): string {
  const neg = deg < 0;
  const unit = precision <= 0 ? 3600 : precision === 1 ? 60 : 1;
  const secPlaces = Math.max(0, precision - 2);
  // Round the whole angle once, in its smallest shown unit, so carries ripple up (59.9995" → 1').
  const total = Number(roundDecimal(Math.abs(deg) * (3600 / unit), secPlaces)) * unit;
  const scale = 10 ** secPlaces;
  const totalScaled = Math.round(total * scale);
  const d = Math.floor(totalScaled / (3600 * scale));
  const m = Math.floor((totalScaled - d * 3600 * scale) / (60 * scale));
  const sScaled = totalScaled - d * 3600 * scale - m * 60 * scale;
  let text = `${d}°`;
  if (precision >= 1) text += `${m}'`;
  if (precision >= 2) text += `${secPlaces > 0 ? (sScaled / scale).toFixed(secPlaces) : String(sScaled)}"`;
  return neg && totalScaled > 0 ? `-${text}` : text;
}

function formatValue(value: number, f: DimFormat, places: number, zeros: ZeroRules): string {
  if (f.angle === 'dms') return formatDms(value, places);
  const text = formatDecimal(value, places, zeros);
  return f.angle === 'decimal' ? `${text}°` : text;
}

/**
 * The text for a measured `value` (drawing units, or degrees for an angle).
 * With a tolerance, trailing zeros are kept even where the zero rules drop
 * them, so a value and its tolerance show their stated places (ASME).
 */
export function formatDimension(value: number, f: DimFormat): DimText {
  const tol = f.tolerance;
  const zeros: ZeroRules = tol.kind === 'none' ? f.zeros : { ...f.zeros, trailing: true };
  const measured = `${f.prefix ?? ''}${formatValue(value, f, f.precision, zeros)}${f.suffix ?? ''}`;
  let main = f.override === undefined ? measured : f.override.split('<>').join(measured);
  let tolText: DimText['tol'];
  const tp = f.tolPrecision;
  switch (tol.kind) {
    case 'none':
      break;
    case 'symmetric':
      tolText = { kind: 'inline', text: `±${formatValue(Math.abs(tol.value), f, tp, zeros)}` };
      break;
    case 'deviation':
      tolText = { kind: 'stack', upper: formatDeviation(tol.upper, tp, zeros, f.zeros.trailing, '+'), lower: formatDeviation(tol.lower, tp, zeros, f.zeros.trailing, '-') };
      break;
    case 'limits':
      main = f.override === undefined ? '' : main;
      tolText = { kind: 'stack', upper: formatValue(value + tol.upper, f, tp, zeros), lower: formatValue(value + tol.lower, f, tp, zeros) };
      break;
  }
  const alt = f.dual && f.angle === undefined ? `[${formatDecimal(value * f.dual.factor, f.dual.precision, f.dual.zeros)}]` : undefined;
  return { main, ...(tolText ? { tol: tolText } : {}), ...(alt ? { alt } : {}) };
}

/** The text on one line, as the properties panel and tests read it: ".250 ±.001", ".250 +.002/-.000", ".251/.249", ".250 [6.35]". */
export function flatText(t: DimText): string {
  const parts: string[] = [];
  if (t.main) parts.push(t.main);
  if (t.tol?.kind === 'inline') parts.push(t.tol.text);
  if (t.tol?.kind === 'stack') parts.push(`${t.tol.upper}/${t.tol.lower}`);
  if (t.alt) parts.push(t.alt);
  return parts.join(' ');
}
