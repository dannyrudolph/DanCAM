"""Writes the STEP fixtures for the STEP import tests (spec, "STEP import").

Made with CadQuery (OpenCascade), so the files are what a real B-rep
exporter writes, not hand-typed. Not a project dependency: run it from a
throwaway virtual environment (`pip install cadquery`) and commit the
.step files. Every dimension here is checked by src/io/step tests.

    python make_fixtures.py   # from this folder
"""
import math
import re

import cadquery as cq
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Controller, STEPControl_Writer


def export(shape, name, unit="MM"):
    """Writes AP214 with OpenCascade's own writer, lengths in `unit` (MM or IN)."""
    STEPControl_Controller.Init_s()
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    Interface_Static.SetCVal_s("write.step.unit", unit)
    writer = STEPControl_Writer()
    # OpenCascade 7.7+: the unit lengths are written in, as millimetres per unit.
    writer.Model(True).SetWriteLengthUnit({"MM": 1.0, "IN": 25.4}[unit])
    writer.Transfer(shape.val().wrapped, STEPControl_AsIs)
    assert writer.Write(name) == IFSelect_RetDone
    if unit == "IN":
        label_inch(name)


def label_inch(name):
    """OpenCascade writes the numbers in inches but still labels the unit
    millimetres; relabel it the way Solid Edge and others write an inch unit."""
    text = open(name).read()
    mm = "( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );"
    assert text.count(mm) == 1
    top = max(int(n) for n in re.findall(r"^#(\d+) =", text, re.M))
    a, b, c = top + 1, top + 2, top + 3
    text = text.replace(mm, f"( CONVERSION_BASED_UNIT('INCH',#{a}) LENGTH_UNIT() NAMED_UNIT(#{b}) );")
    extra = (
        f"#{a} = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#{c});\n"
        f"#{b} = DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
        f"#{c} = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );\n"
    )
    text = text.replace("ENDSEC;\nEND-ISO-10303-21;", extra + "ENDSEC;\nEND-ISO-10303-21;")
    open(name, "w").write(text)


def pin():
    """Along +Z from 0 to 40 (mm): Ø10 body to Z30 with a 1x45° chamfer at Z0,
    an R0.5 fillet into the Ø6 shoulder, the Ø6 end chamfered 0.5x45° at Z40,
    and a Ø3 bore 8 deep from Z40 with a 118° drill point."""
    body = cq.Workplane("XY").circle(5).extrude(30)
    body = body.faces(">Z").workplane().circle(3).extrude(10)
    # The shoulder's inside corner: the only edge whose whole box fits in R3.1 at Z30.
    body = body.edges(cq.selectors.BoxSelector((-3.1, -3.1, 29.9), (3.1, 3.1, 30.1), boundingbox=True)).fillet(0.5)
    body = body.edges(cq.selectors.NearestToPointSelector((5, 0, 0))).chamfer(1)
    body = body.edges(cq.selectors.NearestToPointSelector((3, 0, 40))).chamfer(0.5)
    tip = 1.5 / math.tan(math.radians(59))
    bore = cq.Solid.makeCylinder(1.5, 8, cq.Vector(0, 0, 32), cq.Vector(0, 0, 1))
    point = cq.Solid.makeCone(1.5, 0, tip, cq.Vector(0, 0, 32), cq.Vector(0, 0, -1))
    return body.cut(cq.Workplane().add(bore.fuse(point)))


def ball_end():
    """Along +X from 0 to 1.125 (inch): Ø.25 rod 1 long ending in a ball of R.125."""
    rod = cq.Solid.makeCylinder(3.175, 25.4, cq.Vector(0, 0, 0), cq.Vector(1, 0, 0))
    ball = cq.Solid.makeSphere(3.175, cq.Vector(25.4, 0, 0), angleDegrees1=-90, angleDegrees2=90)
    return cq.Workplane().add(rod.fuse(ball).clean())


def features():
    """Along +Z from 0 to 20 (mm): Ø10 bar with a Ø2 cross hole along X at Z10
    and a flat 1 deep (to Y4) from Z2 to Z8."""
    bar = cq.Workplane("XY").circle(5).extrude(20)
    hole = cq.Solid.makeCylinder(1, 12, cq.Vector(-6, 0, 10), cq.Vector(1, 0, 0))
    flat = cq.Solid.makeBox(12, 2, 6, cq.Vector(-6, 4, 2))
    return bar.cut(cq.Workplane().add(hole)).cut(cq.Workplane().add(flat))


if __name__ == "__main__":
    export(pin(), "pin-mm.step")
    export(ball_end(), "ball-end-inch.step", unit="IN")
    tilted = pin().rotate((0, 0, 0), (1, 2, 3), 37).translate((10, -20, 5))
    export(tilted, "pin-tilted-mm.step")
    export(features(), "cross-hole-flat-mm.step")
