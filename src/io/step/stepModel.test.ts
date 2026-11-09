import { describe, expect, it } from 'vitest';
import ballInch from '../../../test-fixtures/step/ball-end-inch.step?raw';
import pinMm from '../../../test-fixtures/step/pin-mm.step?raw';
import { parsePart21 } from './part21';
import { type StepModel, type StepSurface, readStep } from './stepModel';

function model(text: string): StepModel {
  const r = readStep(text);
  if (!r.ok) throw new Error(r.error);
  return r.model;
}
const kinds = (m: StepModel) => m.faces.map((f) => f.surface.kind).sort();
const of = <K extends StepSurface['kind']>(m: StepModel, kind: K) =>
  m.faces.map((f) => f.surface).filter((s): s is Extract<StepSurface, { kind: K }> => s.kind === kind);

/** A tiny file around `data` (instances, one per line). */
const file = (data: string) => `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n${data}\nENDSEC;\nEND-ISO-10303-21;\n`;

describe('Part 21 syntax', () => {
  it('reads simple and complex instances, strings with quotes, enums, typed values, $ and *', () => {
    const r = parsePart21(
      file(`#1=CARTESIAN_POINT('it''s /* not a comment */',(1.,-2.5E-1,3));\n/* a comment */\n#2=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n#3=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#2,'distance_accuracy_value',$);`),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.file.header).toEqual([{ type: 'FILE_SCHEMA', args: [['AUTOMOTIVE_DESIGN']] }]);
    expect(r.file.instances.get(1)?.records).toEqual([{ type: 'CARTESIAN_POINT', args: ["it's /* not a comment */", [1, -0.25, 3]] }]);
    expect(r.file.instances.get(2)?.records.map((x) => x.type)).toEqual(['LENGTH_UNIT', 'NAMED_UNIT', 'SI_UNIT']);
    expect(r.file.instances.get(2)?.records[1]?.args).toEqual(['*']);
    expect(r.file.instances.get(2)?.records[2]?.args).toEqual([{ enum: 'MILLI' }, { enum: 'METRE' }]);
    expect(r.file.instances.get(3)?.records[0]?.args).toEqual([{ type: 'LENGTH_MEASURE', args: [1e-7] }, { ref: 2 }, 'distance_accuracy_value', null]);
  });

  it('refuses what isn\'t a STEP file, and says where the syntax breaks', () => {
    const error = (text: string) => {
      const r = parsePart21(text);
      return r.ok ? 'read' : r.error;
    };
    expect(error('solid part\nfacet normal 0 0 1')).toBe('This is not a STEP file (it should start with ISO-10303-21;).');
    expect(error(file("#1=CARTESIAN_POINT('open,(0.,0.,0.));"))).toMatch(/^line \d+: a string is never closed\.$/);
    expect(error(file('#1=CARTESIAN_POINT(\'\',(0.,0.,0.));\n#1=DIRECTION(\'\',(0.,0.,1.));'))).toBe('line 7: #1 is defined twice.');
    expect(error('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=LINE(')).toMatch(/the file ends inside a value|expected/);
  });
});

describe('STEP model', () => {
  it('reads every face of the pin (written by OpenCascade) with its exact surface, in mm', () => {
    const m = model(pinMm);
    expect(m.mmPerUnit).toBe(1);
    expect(m.uncertainty).toBe(1e-7);
    expect(m.unreadable).toEqual([]);
    expect(kinds(m)).toEqual(['cone', 'cone', 'cone', 'cylinder', 'cylinder', 'cylinder', 'plane', 'plane', 'plane', 'torus']);
    expect(of(m, 'cylinder').map((c) => c.radius).sort()).toEqual([1.5, 3, 5]);
    const torus = of(m, 'torus')[0]!;
    expect([torus.major, torus.minor]).toEqual([3.5, 0.5]);
    const deg = of(m, 'cone').map((c) => Math.round((c.semiAngle * 180) / Math.PI * 1e9) / 1e9).sort();
    expect(deg).toEqual([45, 45, 59]);
    for (const c of of(m, 'cylinder')) expect(Math.abs(c.at.axis.z)).toBe(1); // all on the Z axis
    const edges = m.faces.flatMap((f) => f.loops.flatMap((l) => l.edges));
    expect(edges.filter((e) => e.curve.kind === 'circle').length).toBeGreaterThan(0);
    expect(edges.every((e) => typeof e.sameSense === 'boolean')).toBe(true);
  });

  it('reads an inch file: 25.4 mm per unit, lengths left in inches', () => {
    const m = model(ballInch);
    expect(m.mmPerUnit).toBe(25.4);
    expect(kinds(m)).toEqual(['cylinder', 'plane', 'sphere']);
    expect(of(m, 'sphere')[0]!.radius).toBe(0.125);
    expect(of(m, 'cylinder')[0]!.at.axis).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('takes angles in degrees when the file says so', () => {
    const m = model(
      file(`#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=AXIS2_PLACEMENT_3D('',#1,$,$);
#3=CONICAL_SURFACE('',#2,2.,45.);
#4=ADVANCED_FACE('',(),#3,.T.);
#5=(CONVERSION_BASED_UNIT('DEGREE',#6)NAMED_UNIT(#7)PLANE_ANGLE_UNIT());
#6=PLANE_ANGLE_MEASURE_WITH_UNIT(PLANE_ANGLE_MEASURE(0.0174532925),#8);
#7=DIMENSIONAL_EXPONENTS(0.,0.,0.,0.,0.,0.,0.);
#8=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));`),
    );
    expect(of(m, 'cone')[0]!.semiAngle).toBe(Math.PI / 4);
    expect(m.mmPerUnit).toBe(1); // no length unit: millimetres
  });

  it('a face with a broken reference is listed as unreadable with the reason; other surfaces are named', () => {
    const m = model(
      file(`#1=ADVANCED_FACE('',(),#9,.T.);
#2=ADVANCED_FACE('',(),#3,.T.);
#3=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,(),.UNSPECIFIED.,.F.,.F.,.F.,(),(),(),(),.UNSPECIFIED.);`),
    );
    expect(m.unreadable).toEqual([{ id: 1, reason: '#9 is referenced but not defined.' }]);
    expect(m.faces.map((f) => f.surface)).toEqual([{ kind: 'other', type: 'B_SPLINE_SURFACE_WITH_KNOTS' }]);
  });

  it('a file without solid faces is refused', () => {
    const r = readStep(file("#1=CARTESIAN_POINT('',(0.,0.,0.));"));
    expect(r.ok ? 'read' : r.error).toBe('There are no solid faces in this file (it may hold only a mesh, wireframe or assembly structure).');
  });
});
