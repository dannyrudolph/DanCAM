import { describe, expect, it } from 'vitest';
import { rotation } from '../geometry/transform';
import type { Vec2 } from '../geometry/vec';
import { MM_ZEROS } from './dimFormat';
import { distanceToLayout, layoutDimension, layoutTouchesBox } from './dimLayout';
import { type DimStyle, defaultDimStyle } from './dimStyle';
import { type DimensionEntity, transformEntity } from './entity';
import { CAP_HEIGHT_EM, textWidth } from './textMetrics';

const v = (x: number, y: number): Vec2 => ({ x, y });
const H = v(1, 0);
const V = v(0, 1);
const INCH = defaultDimStyle('in'); // text .12, arrows .12, offset .0625, extend .125, gap .0625
const linear = (p1: Vec2, p2: Vec2, at: Vec2, dir = H): DimensionEntity => ({ kind: 'dimension', id: 'd', layer: '0', dimStyle: INCH.name, type: 'linear', dir, p1, p2, at });
const layout = (e: DimensionEntity, style: DimStyle = INCH) => layoutDimension(e, style, 25.4);

/** Rounds every number to 12 places so float noise in the projections doesn't hide a real difference. */
const r = (x: unknown): unknown =>
  typeof x === 'number' ? Math.round(x * 1e12) / 1e12 : Array.isArray(x) ? x.map(r) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, r(y)])) : x;

describe('textWidth', () => {
  it('is Helvetica advance widths scaled so capitals are the text height', () => {
    // ".250": 278 + 3 × 556 thousandths of an em; the em is .12 / .718.
    expect(textWidth('.250', 0.12)).toBeCloseTo((1.946 * 0.12) / CAP_HEIGHT_EM, 15);
    expect(textWidth('R', 1)).toBeCloseTo(0.722 / CAP_HEIGHT_EM, 15);
  });
});

describe('layoutDimension, linear', () => {
  it('a horizontal dimension: exact value, extension lines off the object and past the line, text breaking the line', () => {
    const l = layout(linear(v(0, 0.125), v(2, 0.1875), v(1, 0.65)));
    expect(l.value).toBe(2);
    expect(l.text.main).toBe('2.000');
    expect(l.fit).toBe('inside');
    const half = textWidth('2.000', 0.12) / 2 + 0.0625;
    expect(r(l.lines)).toEqual(
      r([
        [v(0, 0.1875), v(0, 0.775)],
        [v(2, 0.25), v(2, 0.775)],
        [v(0, 0.65), v(1 - half, 0.65)],
        [v(1 + half, 0.65), v(2, 0.65)],
      ]),
    );
    // Arrows point out at the extension lines, .12 long and .04 wide.
    expect(r(l.arrows)).toEqual(
      r([
        [v(0, 0.65), v(0.12, 0.63), v(0.12, 0.67)],
        [v(2, 0.65), v(1.88, 0.67), v(1.88, 0.63)],
      ]),
    );
    expect(r(l.runs)).toEqual(r([{ text: '2.000', at: v(1 - textWidth('2.000', 0.12) / 2, 0.59), height: 0.12 }]));
  });

  it('a vertical dimension keeps its text upright, so the line breaks by the text height', () => {
    const l = layout(linear(v(2, 0), v(2, 1), v(2.3, 0.5), V));
    expect(l.value).toBe(1);
    // Text .12 tall plus a .0625 gap above and below: .1225 of line hidden each side of the middle.
    expect(r(l.lines.slice(2))).toEqual(
      r([
        [v(2.3, 0), v(2.3, 0.3775)],
        [v(2.3, 0.6225), v(2.3, 1)],
      ]),
    );
    expect(r(l.textBox)).toEqual(r({ minX: 2.3 - textWidth('1.000', 0.12) / 2, maxX: 2.3 + textWidth('1.000', 0.12) / 2, minY: 0.44, maxY: 0.56 }));
  });

  describe('fit', () => {
    // ".nnn" is the same width for every digit; the text needs 2 × half of the line, each arrow .12.
    const half = textWidth('.500', 0.12) / 2 + 0.0625;
    const at = (len: number) => layout(linear(v(0, 0), v(len, 0), v(len / 2, 0.5)));

    it('room for both: text and arrows inside', () => {
      expect(at(1).fit).toBe('inside');
      expect(2 * half + 0.24).toBeLessThan(1);
    });

    it('room for the text only: arrows outside, pointing in, with .24 tails', () => {
      const l = at(0.5);
      expect(l.fit).toBe('arrowsOutside');
      expect(r(l.arrows[0])).toEqual(r([v(0, 0.5), v(-0.12, 0.52), v(-0.12, 0.48)]));
      expect(r(l.lines)).toContainEqual(r([v(-0.24, 0.5), v(0, 0.5)]));
      expect(r(l.lines)).toContainEqual(r([v(0.5, 0.5), v(0.74, 0.5)]));
      expect(r(l.runs[0]!.at.x + textWidth('.500', 0.12) / 2)).toBe(0.25);
    });

    it('room for the arrows only: text outside past the second point, the line running out to it', () => {
      const l = at(0.3);
      expect(l.fit).toBe('textOutside');
      expect(r(l.arrows[1]![0])).toEqual(r(v(0.3, 0.5)));
      expect(r(l.lines)).toContainEqual(r([v(0, 0.5), v(0.42, 0.5)]));
      expect(r((l.textBox.minX + l.textBox.maxX) / 2)).toBe(r(0.3 + 0.12 + half));
    });

    it('room for neither: both outside', () => {
      const l = at(0.1);
      expect(l.fit).toBe('outside');
      expect(r((l.textBox.minX + l.textBox.maxX) / 2)).toBe(r(0.1 + 0.24 + half));
      expect(r(l.lines)).toContainEqual(r([v(0.1, 0.5), v(0.34, 0.5)]));
    });
  });

  it('stacks a deviation tolerance beside the value, the block 2.5 text heights tall', () => {
    const style: DimStyle = { ...INCH, tolerance: { kind: 'deviation', upper: 0.002, lower: -0.001 } };
    const l = layout(linear(v(0, 0), v(0.5, 0), v(0.25, 1)), style);
    expect(l.runs.map((run) => run.text)).toEqual(['.500', '+.002', '-.001']);
    expect(r(l.runs.map((run) => run.at.y))).toEqual(r([0.94, 1.03, 0.85]));
    expect(r(l.textBox.maxY - l.textBox.minY)).toBe(0.3);
  });

  it('puts the alternate units after the value', () => {
    const style: DimStyle = { ...INCH, dual: { precision: 2, zeros: MM_ZEROS } };
    expect(layout(linear(v(0, 0), v(0.5, 0), v(0.25, 1)), style).runs.map((run) => run.text)).toEqual(['.500', '[12.7]']);
  });

  it('measures only along its direction, and keeps measuring the same after a 90° rotate', () => {
    const e = linear(v(0, 0), v(3, 4), v(0, 6));
    expect(layout(e).value).toBe(3);
    const turned = transformEntity(e, rotation(v(0, 0), 90)) as DimensionEntity;
    expect(turned).toMatchObject({ type: 'linear', dir: { x: 0, y: 1 } });
    expect(layout(turned).value).toBe(3);
  });
});

describe('layoutDimension, aligned', () => {
  const aligned = (at: Vec2): DimensionEntity => ({ kind: 'dimension', id: 'd', layer: '0', dimStyle: INCH.name, type: 'aligned', p1: v(0, 0), p2: v(3, 4), at });

  it('reads the true length, with the dimension line parallel to the points', () => {
    const l = layout(aligned(v(-0.8, 0.6)));
    expect(l.value).toBe(5);
    expect(l.text.main).toBe('5.000');
    // Offset 1 along the normal (-.8, .6): extension lines from .0625 off each point to .125 past the line.
    expect(r(l.lines[0])).toEqual(r([v(-0.05, 0.0375), v(-0.9, 0.675)]));
    expect(r(l.arrows[0]![0])).toEqual(r(v(-0.8, 0.6)));
    expect(r(l.arrows[1]![0])).toEqual(r(v(2.2, 4.6)));
  });

  it('draws no extension lines when the dimension line runs along the object', () => {
    const l = layout(aligned(v(1.5, 2)));
    expect(l.lines).toHaveLength(2); // just the two halves of the dimension line
  });
});

describe('picking a layout', () => {
  const l = layout(linear(v(0, 0), v(2, 0), v(1, 1)));
  const box = l.textBox;
  const mid = v((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);

  it('the text is solid: zero distance anywhere on it, though no line passes there', () => {
    expect(distanceToLayout(mid, l)).toBe(0);
    expect(distanceToLayout(v(1, 0.5), l)).toBeCloseTo(0.44, 12); // straight below it: the text's bottom edge is nearest
  });

  it('a crossing box touching only the text takes it; one clear of everything does not', () => {
    expect(layoutTouchesBox(l, { minX: mid.x - 0.01, maxX: mid.x + 0.01, minY: mid.y - 0.01, maxY: mid.y + 0.01 })).toBe(true);
    expect(layoutTouchesBox(l, { minX: 0.5, maxX: 0.6, minY: 0.3, maxY: 0.4 })).toBe(false);
  });
});
