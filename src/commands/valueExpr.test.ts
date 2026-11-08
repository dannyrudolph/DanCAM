import { describe, expect, it } from 'vitest';
import { parseAngle, parseLength } from './valueExpr';

const value = (text: string, units: 'in' | 'mm' = 'in'): number => {
  const r = parseLength(text, units);
  if (!r.ok) throw new Error(`"${text}" failed: ${r.error}`);
  return r.value;
};
const error = (text: string): string => {
  const r = parseLength(text, 'in');
  if (r.ok) throw new Error(`"${text}" should fail but gave ${r.value}`);
  return r.error;
};

describe('parseLength', () => {
  it('reads decimals with or without a leading zero', () => {
    expect(value('.250')).toBe(0.25);
    expect(value('0.25')).toBe(0.25);
    expect(value('2')).toBe(2);
    expect(value('2.')).toBe(2);
  });

  it('reads fractions as division', () => {
    expect(value('3/8')).toBe(0.375);
    expect(value('1/64')).toBe(0.015625);
  });

  it('does arithmetic with the usual precedence and parentheses', () => {
    expect(value('0.375+0.010')).toBeCloseTo(0.385, 15);
    expect(value('1.5/2')).toBe(0.75);
    expect(value('1+2*3')).toBe(7);
    expect(value('(1+2)*3')).toBe(9);
    expect(value('2-1-0.5')).toBe(0.5);
    expect(value(' 1 + 1 ')).toBe(2);
  });

  it('handles unary minus and plus', () => {
    expect(value('-0.5')).toBe(-0.5);
    expect(value('-(1+1)')).toBe(-2);
    expect(value('+3/4')).toBe(0.75);
    expect(value('2*-3')).toBe(-6);
  });

  it('converts unit suffixes to drawing units, in both directions', () => {
    expect(value('6.35mm', 'in')).toBeCloseTo(0.25, 15);
    expect(value('0.25in', 'mm')).toBeCloseTo(6.35, 13);
    expect(value('0.25"', 'mm')).toBeCloseTo(6.35, 13);
    expect(value('1MM', 'in')).toBeCloseTo(1 / 25.4, 15);
    // a suffix matching the drawing units changes nothing
    expect(value('0.25in', 'in')).toBe(0.25);
    expect(value('6.35mm', 'mm')).toBe(6.35);
  });

  it('applies a suffix only to the number it follows', () => {
    expect(value('1+25.4mm', 'in')).toBeCloseTo(2, 15);
  });

  it('rejects malformed input with a message', () => {
    expect(error('')).toBe('Enter a value');
    expect(error('abc')).toMatch(/Unexpected "a"/);
    expect(error('1..2')).toMatch(/Unexpected "\."/);
    expect(error('1.2.3')).toMatch(/Unexpected "\."/);
    expect(error('1/0')).toBe('Division by zero');
    expect(error('(1+2')).toBe('Missing ")"');
    expect(error('1+')).toBe('Value is incomplete');
    expect(error('1 2')).toBe('Unexpected text after the value');
    expect(error('*2')).toMatch(/Unexpected "\*"/);
  });
});

describe('parseAngle', () => {
  it('reads degrees with an optional ° sign and arithmetic', () => {
    expect(parseAngle('30')).toEqual({ ok: true, value: 30 });
    expect(parseAngle('45°')).toEqual({ ok: true, value: 45 });
    expect(parseAngle('90+45')).toEqual({ ok: true, value: 135 });
    expect(parseAngle('-15')).toEqual({ ok: true, value: -15 });
  });

  it('rejects length units on an angle', () => {
    expect(parseAngle('30mm')).toEqual({ ok: false, error: 'Units are not allowed here' });
  });
});
