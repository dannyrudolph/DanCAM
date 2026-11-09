import type { Units } from '../model/drawing';

export type ParseResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string };

const MM_PER_IN = 25.4;

type Token =
  | { kind: 'num'; value: number; unit: Units | undefined; pos: number }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' | '(' | ')'; pos: number };

/** Unit suffixes, longest first so "mm" wins over "m"-prefixed nothing. */
const SUFFIXES: readonly [string, Units][] = [
  ['mm', 'mm'],
  ['in', 'in'],
  ['"', 'in'],
];

function tokenize(text: string, allowUnits: boolean): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch as '+' | '-' | '*' | '/' | '(' | ')', pos: i });
      i++;
      continue;
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i));
    if (m) {
      const start = i;
      i += m[0].length;
      if (text[i] === '.') return `Unexpected "." at ${i + 1}`;
      let unit: Units | undefined;
      const rest = text.slice(i).toLowerCase();
      for (const [suffix, u] of SUFFIXES) {
        if (rest.startsWith(suffix)) {
          if (!allowUnits) return `Units are not allowed here`;
          unit = u;
          i += suffix.length;
          break;
        }
      }
      if (!allowUnits && text[i] === '°') i++;
      tokens.push({ kind: 'num', value: Number(m[0]), unit, pos: start });
      continue;
    }
    return `Unexpected "${ch}" at ${i + 1}`;
  }
  return tokens;
}

/**
 * Recursive-descent evaluator:
 *   expr   = term (('+' | '-') term)*
 *   term   = factor (('*' | '/') factor)*
 *   factor = ('+' | '-') factor | number | '(' expr ')'
 * Numbers carrying a unit are converted to drawing units where they appear.
 */
function evaluate(tokens: Token[], units: Units): ParseResult {
  let pos = 0;
  const fail = (error: string): never => {
    throw new SyntaxError(error);
  };

  const peekOp = (): string | undefined => {
    const t = tokens[pos];
    return t?.kind === 'op' ? t.op : undefined;
  };

  function factor(): number {
    const t = tokens[pos];
    if (!t) return fail('Value is incomplete');
    if (t.kind === 'op') {
      if (t.op === '-' || t.op === '+') {
        pos++;
        const v = factor();
        return t.op === '-' ? -v : v;
      }
      if (t.op === '(') {
        pos++;
        const v = expr();
        if (peekOp() !== ')') fail('Missing ")"');
        pos++;
        return v;
      }
      return fail(`Unexpected "${t.op}"`);
    }
    pos++;
    if (!t.unit || t.unit === units) return t.value;
    return t.unit === 'mm' ? t.value / MM_PER_IN : t.value * MM_PER_IN;
  }

  function term(): number {
    let v = factor();
    for (let op = peekOp(); op === '*' || op === '/'; op = peekOp()) {
      pos++;
      const rhs = factor();
      if (op === '/' && rhs === 0) fail('Division by zero');
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }

  function expr(): number {
    let v = term();
    for (let op = peekOp(); op === '+' || op === '-'; op = peekOp()) {
      pos++;
      const rhs = term();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  try {
    const value = expr();
    if (pos < tokens.length) return { ok: false, error: 'Unexpected text after the value' };
    if (!Number.isFinite(value)) return { ok: false, error: 'Value is not a finite number' };
    return { ok: true, value };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, error: e.message };
    throw e;
  }
}

function parse(text: string, units: Units, allowUnits: boolean): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'Enter a value' };
  const tokens = tokenize(text, allowUnits);
  if (typeof tokens === 'string') return { ok: false, error: tokens };
  return evaluate(tokens, units);
}

/**
 * A length or coordinate typed into an input box: decimals (.250), fractions
 * (3/8), unit suffixes (6.35mm, 0.25in, 0.25") and + - * / with parentheses.
 * The result is in drawing units.
 */
export function parseLength(text: string, units: Units): ParseResult {
  return parse(text, units, true);
}

/** A plain number such as a scale factor: the same arithmetic, no units. */
export function parseFactor(text: string): ParseResult {
  return parse(text, 'in', false);
}

/** An angle in degrees, with the same arithmetic and an optional ° sign. */
export function parseAngle(text: string): ParseResult {
  return parse(text, 'in', false);
}
