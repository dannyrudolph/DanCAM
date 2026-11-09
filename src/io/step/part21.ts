/**
 * ISO 10303-21, the text form of a STEP file: a HEADER section and a DATA
 * section of numbered instances, `#12=CIRCLE('',#11,5.);`, some of them
 * complex, `#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));`. This
 * reads the syntax only; `stepModel` gives the instances meaning.
 */

/** A parameter: a number, a string, a reference `#n`, an enumeration `.X.`, a list, a typed value `LENGTH_MEASURE(1.)`, unset `$`, or derived `*`. */
export type StepValue =
  | number
  | string
  | { readonly ref: number }
  | { readonly enum: string }
  | { readonly type: string; readonly args: readonly StepValue[] }
  | readonly StepValue[]
  | null
  | '*';

/** One record of an instance: its entity type and parameters. A complex instance has several. */
export type StepRecord = { readonly type: string; readonly args: readonly StepValue[] };

export type StepInstance = { readonly id: number; readonly records: readonly StepRecord[] };

export type Part21 = { readonly header: readonly StepRecord[]; readonly instances: ReadonlyMap<number, StepInstance> };

export type Part21Result = { readonly ok: true; readonly file: Part21 } | { readonly ok: false; readonly error: string };

class SyntaxError21 extends Error {}

type Token =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'ref'; readonly v: number }
  | { readonly t: 'enum'; readonly v: string }
  | { readonly t: 'word'; readonly v: string }
  | { readonly t: 'punct'; readonly v: '(' | ')' | ',' | ';' | '=' | '$' | '*' };

/** Splits the file into tokens, dropping comments; `line` gives each token's line for messages. */
function tokenize(text: string): { tokens: Token[]; lines: number[] } {
  const tokens: Token[] = [];
  const lines: number[] = [];
  let line = 1;
  let i = 0;
  const push = (tok: Token): void => {
    tokens.push(tok);
    lines.push(line);
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError21(`line ${line}: a comment is never closed.`);
      for (let k = i; k < end; k++) if (text[k] === '\n') line++;
      i = end + 2;
    } else if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= text.length) throw new SyntaxError21(`line ${line}: a string is never closed.`);
        const d = text[i]!;
        if (d === "'") {
          if (text[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (d === '\n') line++;
        s += d;
        i++;
      }
      push({ t: 'str', v: s });
    } else if (c === '#') {
      const m = /^#(\d+)/.exec(text.slice(i, i + 24));
      if (!m) throw new SyntaxError21(`line ${line}: "#" must be followed by a number.`);
      push({ t: 'ref', v: Number(m[1]) });
      i += m[0].length;
    } else if (c === '.' && /[A-Za-z_]/.test(text[i + 1] ?? '')) {
      const m = /^\.([A-Za-z_][A-Za-z0-9_]*)\./.exec(text.slice(i, i + 80));
      if (!m) throw new SyntaxError21(`line ${line}: an enumeration must look like .NAME.`);
      push({ t: 'enum', v: m[1]!.toUpperCase() });
      i += m[0].length;
    } else if (/[0-9+\-.]/.test(c)) {
      const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
      if (!m) throw new SyntaxError21(`line ${line}: "${c}" is not a number.`);
      push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i, i + 128))!;
      push({ t: 'word', v: m[0].toUpperCase() });
      i += m[0].length;
    } else if ('(),;=$*'.includes(c)) {
      push({ t: 'punct', v: c as '(' | ')' | ',' | ';' | '=' | '$' | '*' });
      i++;
    } else if (c === '"') {
      // A binary value: kept as its hex text; nothing turned-part related uses one.
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new SyntaxError21(`line ${line}: a binary value is never closed.`);
      push({ t: 'str', v: text.slice(i + 1, end) });
      i = end + 1;
    } else {
      throw new SyntaxError21(`line ${line}: unexpected "${c}".`);
    }
  }
  return { tokens, lines };
}

/** Reads a STEP file's text, or says where its syntax goes wrong. */
export function parsePart21(text: string): Part21Result {
  try {
    return { ok: true, file: parse(text) };
  } catch (err) {
    if (err instanceof SyntaxError21) return { ok: false, error: err.message };
    throw err;
  }
}

function parse(text: string): Part21 {
  const { tokens, lines } = tokenize(text);
  let i = 0;
  const where = (): string => `line ${lines[Math.min(i, lines.length - 1)] ?? 1}`;
  const peek = (): Token | undefined => tokens[i];
  const isPunct = (v: string): boolean => {
    const tok = peek();
    return tok?.t === 'punct' && tok.v === v;
  };
  const expect = (v: string): void => {
    if (!isPunct(v)) throw new SyntaxError21(`${where()}: expected "${v}".`);
    i++;
  };
  const word = (): string => {
    const tok = peek();
    if (tok?.t !== 'word') throw new SyntaxError21(`${where()}: expected a keyword.`);
    i++;
    return tok.v;
  };

  const value = (): StepValue => {
    const tok = peek();
    if (!tok) throw new SyntaxError21(`${where()}: the file ends inside a value.`);
    i++;
    switch (tok.t) {
      case 'num':
      case 'str':
        return tok.v;
      case 'ref':
        return { ref: tok.v };
      case 'enum':
        return { enum: tok.v };
      case 'word':
        return { type: tok.v, args: argList() };
      case 'punct':
        if (tok.v === '$') return null;
        if (tok.v === '*') return '*';
        if (tok.v === '(') {
          i--;
          return argList();
        }
        throw new SyntaxError21(`${where()}: unexpected "${tok.v}".`);
    }
  };
  const argList = (): StepValue[] => {
    expect('(');
    const out: StepValue[] = [];
    if (isPunct(')')) {
      i++;
      return out;
    }
    for (;;) {
      out.push(value());
      if (isPunct(',')) {
        i++;
        continue;
      }
      expect(')');
      return out;
    }
  };
  const record = (): StepRecord => {
    const type = word();
    return { type, args: argList() };
  };

  const magic = word();
  if (magic !== 'ISO-10303-21') throw new SyntaxError21('This is not a STEP file (it should start with ISO-10303-21;).');
  expect(';');
  const header: StepRecord[] = [];
  const instances = new Map<number, StepInstance>();
  for (;;) {
    const tok = peek();
    if (!tok) throw new SyntaxError21('The file ends before END-ISO-10303-21.');
    const section = word();
    if (section === 'END-ISO-10303-21') break;
    if (section !== 'HEADER' && section !== 'DATA') throw new SyntaxError21(`${where()}: unknown section ${section}.`);
    if (section === 'DATA' && isPunct('(')) argList(); // AP242's DATA(name, schema)
    expect(';');
    for (;;) {
      const t = peek();
      if (t?.t === 'word' && t.v === 'ENDSEC') {
        i++;
        expect(';');
        break;
      }
      if (section === 'HEADER') {
        header.push(record());
        expect(';');
        continue;
      }
      if (t?.t !== 'ref') throw new SyntaxError21(`${where()}: expected an instance like #12=…;`);
      const startLine = lines[i];
      i++;
      expect('=');
      const records: StepRecord[] = [];
      if (isPunct('(')) {
        i++;
        while (!isPunct(')')) records.push(record());
        i++;
      } else {
        records.push(record());
      }
      expect(';');
      if (instances.has(t.v)) throw new SyntaxError21(`line ${startLine}: #${t.v} is defined twice.`);
      instances.set(t.v, { id: t.v, records });
    }
  }
  return { header, instances };
}
