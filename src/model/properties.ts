import { angleDeg } from '../geometry/angle';
import { arcEnd, arcLength, arcSweepDeg, arcStart } from '../geometry/arc';
import { type Tolerance, flatText } from './dimFormat';
import { dimensionLayout, isAnnotation } from './dimLayout';
import { effectivePrecision, effectiveTolerance, takesTolerance } from './dimOverride';
import { type Drawing, effectiveStyle } from './drawing';
import type { Entity } from './entity';

/** One labelled value; numbers stay unrounded until display. */
export type Row = { label: string; value: number | string; unit?: string };

/** The rows the properties panel shows for `e`, with values unrounded. */
export function rowsFor(d: Drawing, e: Entity): Row[] {
  if (e.kind === 'dimension') {
    const l = dimensionLayout(d, e);
    const head: Row[] = [
      { label: 'Layer', value: e.layer },
      { label: 'Dim style', value: e.dimStyle },
      { label: 'Type', value: DIM_TYPE_LABEL[e.type] },
      ...(isAnnotation(e) ? [] : [{ label: 'Text', value: flatText(l.text) }]),
      ...(l.value === undefined ? [] : [{ label: 'Measured', value: l.value, ...(e.type === 'angular' && { unit: '°' }) }]),
      ...(e.type === 'leader' || isAnnotation(e) ? [] : [{ label: 'Precision', value: String(effectivePrecision(d, e)) }]),
      ...(takesTolerance(e) ? toleranceRows(d, e) : []),
    ];
    switch (e.type) {
      case 'radius':
      case 'diameter':
        return [...head, { label: 'Center X', value: e.center.x }, { label: 'Center Y', value: e.center.y }];
      case 'centerMark':
        return [...head, { label: 'Center X', value: e.center.x }, { label: 'Center Y', value: e.center.y }, { label: 'Radius', value: e.radius }];
      case 'angular':
        return [...head, { label: 'Vertex X', value: e.vertex.x }, { label: 'Vertex Y', value: e.vertex.y }];
      case 'symmetric':
      case 'ordinate':
        return [...head, { label: 'Point X', value: e.p1.x }, { label: 'Point Y', value: e.p1.y }];
      case 'leader':
        return [...head, { label: 'Arrow X', value: e.tip.x }, { label: 'Arrow Y', value: e.tip.y }, { label: 'Landing X', value: e.at.x }, { label: 'Landing Y', value: e.at.y }];
      default:
        return [
          ...head,
          { label: 'Point 1 X', value: e.p1.x },
          { label: 'Point 1 Y', value: e.p1.y },
          { label: 'Point 2 X', value: e.p2.x },
          { label: 'Point 2 Y', value: e.p2.y },
        ];
    }
  }
  const style = effectiveStyle(d, e);
  const common: Row[] = [
    { label: 'Layer', value: e.layer },
    { label: 'Style', value: e.style ? style.label : `${style.label} (by layer)` },
  ];
  switch (e.kind) {
    case 'point':
      return [...common, { label: 'X', value: e.at.x }, { label: 'Y', value: e.at.y }];
    case 'line': {
      const dx = e.end.x - e.start.x;
      const dy = e.end.y - e.start.y;
      return [
        ...common,
        { label: 'Start X', value: e.start.x },
        { label: 'Start Y', value: e.start.y },
        { label: 'End X', value: e.end.x },
        { label: 'End Y', value: e.end.y },
        { label: 'ΔX', value: dx },
        { label: 'ΔY', value: dy },
        { label: 'Length', value: Math.hypot(dx, dy) },
        { label: 'Angle', value: angleDeg({ x: dx, y: dy }), unit: '°' },
      ];
    }
    case 'circle':
      return [
        ...common,
        { label: 'Center X', value: e.center.x },
        { label: 'Center Y', value: e.center.y },
        { label: 'Radius', value: e.radius },
        { label: 'Diameter', value: 2 * e.radius },
        { label: 'Circumference', value: 2 * Math.PI * e.radius },
      ];
    case 'arc': {
      const s = arcStart(e);
      const t = arcEnd(e);
      return [
        ...common,
        { label: 'Center X', value: e.center.x },
        { label: 'Center Y', value: e.center.y },
        { label: 'Radius', value: e.radius },
        { label: 'Start angle', value: e.startDeg, unit: '°' },
        { label: 'End angle', value: e.endDeg, unit: '°' },
        { label: 'Included angle', value: arcSweepDeg(e), unit: '°' },
        { label: 'Arc length', value: arcLength(e) },
        { label: 'Start X', value: s.x },
        { label: 'Start Y', value: s.y },
        { label: 'End X', value: t.x },
        { label: 'End Y', value: t.y },
      ];
    }
    case 'xline':
    case 'ray':
      return [
        ...common,
        { label: 'Base X', value: e.base.x },
        { label: 'Base Y', value: e.base.y },
        { label: 'Angle', value: angleDeg(e.dir), unit: '°' },
      ];
  }
}

export const TOLERANCE_LABEL: Record<Tolerance['kind'], string> = { none: 'None', symmetric: '±', deviation: 'Deviation', limits: 'Limits' };

/** The tolerance a dimension shows, and its values. Strings say whether it is the dimension's own. */
function toleranceRows(d: Drawing, e: Extract<Entity, { kind: 'dimension' }>): Row[] {
  const t = effectiveTolerance(d, e);
  const rows: Row[] = [{ label: 'Tolerance', value: TOLERANCE_LABEL[t.kind] }];
  if (t.kind === 'symmetric') rows.push({ label: 'Tol ±', value: t.value });
  if (t.kind === 'deviation' || t.kind === 'limits') rows.push({ label: 'Tol upper', value: t.upper }, { label: 'Tol lower', value: t.lower });
  return rows;
}

const DIM_TYPE_LABEL: Record<Extract<Entity, { kind: 'dimension' }>['type'], string> = {
  linear: 'Linear',
  aligned: 'Aligned',
  radius: 'Radius',
  diameter: 'Diameter',
  angular: 'Angular',
  symmetric: 'Symmetric diameter',
  ordinate: 'Ordinate',
  centerMark: 'Center mark',
  centerline: 'Centerline',
  leader: 'Leader',
};

export const KIND_LABEL: Record<Entity['kind'], string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
  xline: 'Xline',
  ray: 'Ray',
  dimension: 'Dimension',
};

