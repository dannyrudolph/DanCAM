# Browser 2D CAD — Claude Code Project Plan

Nov 8, 2026 · @Dan Rudolph

## How to use this doc

This spec lives at `docs/SPEC.md`; its project rules are in `AGENTS.md` ("Project context").

```text
Read docs/SPEC.md in full. We are building a browser-based 2D drafting
application in the style of AutoCAD LT (late 1990s): explicit geometry,
a mouse-driven toolbar (no command line), object snaps, trim/extend/fillet, and
print-quality dimensioning. It is for sketching CNC turning and live-tool
milling geometry for small medical device parts.

Hard rules:
- No parametric constraint solver. Geometry is edited by commands and by
  typing exact values, never by solving relationships.
- The geometry kernel is pure TypeScript with no DOM access and full unit
  test coverage.
- Every operation that changes the drawing is undoable.

Start with Phase 0 from the roadmap. Before writing code, propose the
folder structure, the core data types (entities, document, commands), and
the list of npm dependencies, and wait for my approval. Then implement
Phase 0, run the tests, and stop for my review. Do one phase at a time and
never start the next phase without my go-ahead. Also create CLAUDE.md
from the last section of the spec.
```

For each later phase, a short prompt is enough: "Implement Phase 2 from docs/SPEC.md. Propose the plan first, then build it, run all tests, and summarize what to try by hand."

## Overview and principles

The goal is a self-owned 2D drafting tool that replaces Solid Edge 2D Drafting for turning profiles and live-tool features. It runs in the browser from local files, works offline, and has no accounts or licenses.

- **Drafting, not modeling.** Like AutoCAD LT: you place lines, arcs and circles at exact values, then trim, fillet and dimension them. Changing a dimension's value never moves geometry.
- **Mouse first, no command line.** Tools are picked from a toolbar and points are placed by clicking, with snaps. Exact values are typed only into input boxes that appear at the cursor while a tool is active, and into the properties panel. A tool's options (such as circle method or fillet radius) are buttons and fields in an options bar for the active tool. There is no typed-command entry. A status line shows the active tool's instruction ("Pick the first point").
- **Exactness.** Coordinates are stored as 64-bit floats in drawing units. Display rounding never changes stored values. Geometric comparisons use one shared tolerance (default 1e-9 drawing units).
- **Lathe-aware.** An optional lathe mode labels axes Z (horizontal) and X (vertical). It treats the X axis as a centerline and allows diameter entry for X values. Milling sketches use a normal X/Y view.
- **Micro-part friendly.** Smooth zoom from a 0.0005" feature to a 2" overall part. Prints at enlarged scales such as 5:1, 10:1 and 20:1, with dimension text sized for the sheet, not the part.
- **Single user, local data.** Drawings are saved as files on your machine. Nothing is sent to a server.

## Tech stack and architecture

TypeScript, built with Vite, drawn on an HTML Canvas 2D context. The result is a folder of static files you can open locally or host anywhere. Keep dependencies minimal so the project still builds years from now.

| Layer | Choice | Notes |
| --- | --- | --- |
| Language / build | TypeScript (strict), Vite | Static output; optional PWA manifest for offline install |
| Rendering | Canvas 2D, redrawn on change | Screen-space line widths; world-to-screen transform for pan/zoom |
| UI | Plain TypeScript + DOM, or a light framework | Toolbar, tool options bar, input boxes at the cursor, properties panel, status bar |
| Tests | Vitest; Playwright later | Unit tests for geometry; screenshots for dimension rendering |
| DXF | Hand-written R12 writer; evaluate an npm DXF parser for import | Writing DXF is simple; reading it is where a library helps |
| PDF | jsPDF or browser print of an SVG render | Must keep true scale on paper |

Modules, with dependencies pointing downward only:

1. `geometry/`: pure math. Vectors, lines, arcs, circles, intersections, tangents, offsets, fillets, projections. No DOM.
2. `model/`: the drawing document. Entities with stable ids, layers, dimension styles, units, and an undo/redo stack built on reversible change records.
3. `snap/`: finds snap candidates near the cursor and ranks them.
4. `commands/`: each tool is a small state machine that asks for points, values, selections and options one step at a time, fed by mouse clicks and the input boxes at the cursor.
5. `render/`: draws entities, dimensions, snap markers, grips and rubber-band previews.
6. `ui/`: input handling, toolbar, tool options bar, input boxes at the cursor, panels, and file dialogs.
7. `io/`: native JSON, DXF, SVG and PDF.

## Units, precision and dimension resolution

Each drawing has one unit, inch or mm, chosen at creation. Typed values may override it with a suffix, and dimensions can show the other unit alongside.

- **Drawing units:** inch or mm, stored in the file. A `UNITS` command converts the drawing (scale by 25.4) or just relabels it, and asks which.
- **Value entry:** accepts decimals (`.250`), fractions (`3/8`), unit suffixes (`6.35mm`, `0.25in`) and simple arithmetic (`1.5/2`, `0.375+0.010`).
- **Display precision** for coordinates and the properties panel is set separately from dimension precision. It is 0–8 decimals and never rounds stored values.
- **Dimension precision** is set per dimension style, 0–8 decimals for linear and decimal degrees or D°M'S for angles, with a per-dimension override.
- **Zero rules by unit, per ASME Y14.5 defaults (editable):**
  - Inch: no leading zero (`.250`); trailing zeros kept to the stated precision.
  - Millimetre: leading zero kept (`0.25`); trailing zeros suppressed unless a tolerance needs them.
- **Tolerances** per dimension: none, symmetric (`.250 ±.001`), deviation (`+.002/-.000`) or limits (`.251/.249`), each with its own precision.
- **Dual units:** optional alternate value in brackets, such as `.250 [6.35]`, with its own precision.
- **Dimension scale:** text height, arrow size and gaps are set in sheet units and multiplied by the print scale, like AutoCAD's DIMSCALE. A 10:1 detail still prints 0.12" text.

## Drawing entities, input and snaps

The entity set stays small: point, line, construction line (xline), ray, circle, arc and single-line text. Centerlines and center marks are line or annotation entities on their own layer. Polylines can come later if needed.

**Creation methods**

| Command | Methods |
| --- | --- |
| Line | Point to point, chained; Close; Undo last segment |
| Circle | Center + radius, Center + diameter, 2-point, 3-point, Tangent-Tangent-Radius, Tangent-Tangent-Tangent |
| Arc | 3-point, Start-Center-End, Start-End-Radius, Start-Center-Angle, Continue tangent from last |
| Construction line | Horizontal, Vertical, Angle, Through two points, Offset from a line |

**Point entry: click, or lock exact values in the input boxes at the cursor**

- Click to place a point, with snaps guiding the cursor.
- While a tool is placing something, small input boxes follow the cursor, showing the values for that step: X and Y for a first point (lathe mode Z and X, with X shown as a diameter when diameter mode is on); length and angle for the next segment; radius or diameter for a circle. Typing a value and pressing Tab locks it, so the cursor is constrained to it. Enter places the point. Angles are counter-clockwise from +X.
- A toggle on the boxes switches between absolute coordinates and values relative to the last point.
- Ortho and polar tracking at a set increment (15° by default), toggled by buttons in the status bar.
- The status bar shows live cursor coordinates, plus length and angle from the last point.

**Object snaps** (running snaps toggled from the status bar; a one-time snap can be picked from the right-click menu while placing a point)

- Endpoint, Midpoint, Center, Quadrant, Intersection, Perpendicular, Tangent, Nearest, Node
- Extension and object snap tracking, which line up with a point's X or Y, added in a later phase
- Each snap has a distinct marker glyph, with a tooltip naming the snap

**Selection and grips**

- Click to pick; drag left-to-right for a window, right-to-left for a crossing; Shift-click removes.
- A selected entity shows grips. Dragging an endpoint grip stretches it and respects snaps; dragging a center grip moves it.
- The properties panel lists exact values (endpoints, center, radius, start and end angles, length) and accepts typed edits. This is how you change a drawn size without a solver.
- Inquiry commands: `DIST`, `ID` (point coordinates), `LIST` and angle measure.

## Modify commands

Trim, extend and fillet are the core of the tool and get the most tests. Every command below is undoable, and each works on lines, arcs and circles unless noted.

| Command | Short name (toolbar tooltip) | Behavior |
| --- | --- | --- |
| Trim | TR | Select cutting edges (Enter = all), then pick the pieces to remove. Shift-pick extends instead. Trimming a circle turns it into an arc. |
| Extend | EX | Select boundaries (Enter = all), then pick near the end to extend. Arcs extend along their circle. Shift-pick trims instead. |
| Fillet | F | Radius option; picks two entities and keeps the picked sides. Radius 0 makes a sharp corner. Trim mode on/off. |
| Chamfer | CHA | Distance-distance or distance-angle, for edge breaks like .010 x 45° |
| Offset | O | By distance or through a point; arcs and circles offset concentrically |
| Break | BR | At a point, or between two points |
| Join | J | Collinear lines into one line; arcs on the same circle into one arc |
| Lengthen | LEN | Delta, total length or percent, for lines and arcs |
| Move / Copy | M / CO | Base point and second point, with full snap and typed entry |
| Rotate | RO | Base point and angle, or a reference angle |
| Mirror | MI | Two-point mirror line; option to keep or erase the source |
| Scale | SC | Base point and factor, or a reference length |
| Array | AR | Rectangular, or polar (count + angle), for bolt circles and flats |
| Stretch | S | Crossing selection moves the endpoints inside the window |
| Erase | E / Del | Removes the selection |

Edge cases to handle on purpose: tangent intersections, endpoints that land within tolerance of an edge, arcs crossing 0°, and trims that would leave zero-length pieces.

## Dimensioning

Dimensions are annotation entities linked to the geometry they measure. When a modify command moves that geometry, the dimension re-measures. Its value is only ever a readout, never an input.

**Dimension types**

| Type | Picks | Shows |
| --- | --- | --- |
| Linear | Objects first: a line or arc (end to end), or two objects (line ends nearest the picks, arc and circle centers); or two points with snaps. Horizontal or vertical decided by drag direction, or forced | Distance along the axis |
| Aligned | As Linear; between a line and a parallel line or a center, square to the line | True length |
| Radius | Arc or circle | `R.015` |
| Diameter | Circle or arc | `Ø.125` |
| Angular | Two lines (or an arc picked first), an arc, or vertex + two points | Angle, with quadrant chosen by cursor |
| Symmetric diameter | Centerline (axis), then one or more feature points or edges | `Ø` + twice the distance from the axis |
| Ordinate | Origin set once, then feature points | X or Z (Y) coordinate from the origin |
| Baseline / Continue | Starts from an existing linear dimension | Stacked or chained linear dimensions |
| Leader / note | Arrow point, then text | Free text, such as `.010 X 45°` or `2X` callouts |
| Center mark / centerline | Circle or arc; two lines | Annotation lines; a centerline takes object snaps at its ends, middle and crossings, so a hole can be dimensioned to it |

**Symmetric diameter (lathe)**

- Pick the part centerline once. Each later pick places a diameter dimension for a feature on one side of the axis. The value is twice the perpendicular distance.
- The command stays active for consecutive picks, like Solid Edge, so a full turned profile can be dimensioned in one pass.
- Two display styles, set per dimension style:
  - Half style: arrow and extension line at the feature only, with the dimension line running past the centerline.
  - Full style: mirrored extension lines on both sides of the axis.
- Diameter mode in lathe view also applies `Ø` automatically to linear dimensions measured across the centerline.

**Ordinate**

- `DIMORIGIN` sets the datum, usually the part face and centerline. It is stored in the drawing and shown with a marker.
- Each pick creates an X or Z ordinate, chosen by drag direction or forced. Leaders jog automatically when text would overlap.
- Ordinate text lines up on a common baseline, and an "align ordinates" command restacks a set evenly.
- Option to show ordinate X values as diameters in lathe mode.
- The ordinate at the origin reads a bare `0` (ASME), whatever the zero rules.

**Dimension styles**

- Named styles (for example `INCH-3PL`, `INCH-4PL`, `MM-2PL`) control text height, font, arrow type and size, extension line offset and overshoot, text placement, precision, zero rules, tolerance format, dual units, and prefix or suffix.
- Any single dimension can override precision, tolerance or text. Text overrides use `<>` to stand for the measured value, as in `<> THRU` or `2X <>`.
- Text and dimension-line position can be dragged by grips after placement, and snap to sensible offsets from the geometry.

## Blocks

A block is a named, reusable piece of drawing, such as a cutting tool sketch (insert and holder) that is moved, rotated and copied against a part profile to check reach and clearance. Blocks are fixed geometry. A block never resizes from a dimension or parameter (CAD-1); a feature that comes in many sizes is drawn, not inserted.

- **Definition:** a name, a base point (the insertion point, for example the tool tip or nose-radius center), its entities, the units it was drawn in, and a **description**. The description is a free text field saved with the block for detail such as holder and insert numbers, grade, or notes. It shows in the Blocks panel and the properties panel and is not drawn. A definition holds lines, circles, arcs and points. Xlines, rays and dimensions are not part of the first version. No nesting: a block cannot contain another block.
- **Create block:** select geometry, choose Create block, click the base point, then type the name and, optionally, the description. Option buttons choose what happens to the selected geometry: convert it to an instance (default), keep it, or delete it.
- **Insert:** pick a block in the Blocks panel (name, preview, description), then click to place it. Rotation and scale come from the input boxes at the cursor. Insert is sticky, so several copies can be placed. A block drawn in the other unit is scaled to the drawing's unit automatically.
- **An instance is one object.** One click selects it. Move, Copy, Rotate, Mirror, Scale, Array, Stretch (moves it when its insertion point is in the window) and Erase work on it whole. Mirror gives a mirrored instance, for left-hand and right-hand tools. It has one grip at its insertion point. The properties panel shows block name, description, insertion point (Z/X in lathe mode), rotation, scale and mirrored, and edits them.
- **Snaps and associativity reach inside.** All object snaps work on an instance's geometry, so a tool tip can be snapped to the part and a dimension measured from it to the part. Dimensions anchored to an instance's geometry follow when the instance moves, and are deleted when it is erased or exploded. Instance geometry can be a Trim and Extend boundary but cannot itself be trimmed.
- **Layers:** geometry on layer 0 in a definition takes the instance's layer; geometry on other layers keeps its own layer (AutoCAD's convention).
- **Edit block:** opens the definition by itself with Save and Cancel buttons. Saving updates every instance in the drawing in one undo step. Rename, Explode (an instance back to plain geometry, on the layers it shows on) and Purge (remove unused definitions) are also offered.
- **Library:** saved blocks are available to every drawing. Save to library copies a definition into the browser's library (IndexedDB). Inserting a library block copies its definition into the drawing, so the drawing file stands alone and opens anywhere. Changing a library block does not change drawings until Update from library is chosen. Export library and Import library write and read a `.cad2d-blocks.json` file, for backup and for moving to another machine. A name already in the drawing or library is never silently overwritten.

## STEP import (turned parts)

A turned part modelled in Solid Edge comes in as its lathe profile: the half-section through its axis, laid along Z, ready to dimension. The model is never kept or linked; the import is plain geometry, edited like anything drawn (CAD-1).

- **What it reads:** a STEP file (`.step`, `.stp`, AP203/AP214/AP242 B-rep). The reader is part of DanCAM, with no CAD kernel: it reads points, directions, axis placements, the faces of a turned part (planes, cylinders, cones, tori and spheres) and their edges, and the file's length unit, converting to the drawing's units.
- **The axis:** the line most of the cylinders, cones and tori share. The part is turned so the axis lies on Z (X = 0, the lathe centerline) with radius on X, the way lathe mode draws.
- **The profile:** each face of revolution about the axis becomes its exact generating curve. A cylinder is a line at its radius, a cone an angled line (to its apex when it closes on the axis, as a drill point does), a flat face square to the axis a vertical line (down to the axis when it's a full disk), a torus an arc, and a sphere on the axis an arc. Faces split in two by the exporter come out as one line. Bores, internal grooves and undercuts come through, since they are part of the half-section.
- **Edges across the part:** as in a side view, each circular edge on the outside of the part gets a vertical line from the centerline out to it (across both halves with Full): at every diameter change, chamfer and shoulder. Where a radius runs smoothly into a diameter the line is drawn in the tangent line style.
- **Inside the part, hidden:** what lies within the part's outside at that Z (bores, drill points, inner shoulders, grooves and radii) comes in in the hidden line style, with a hidden line across the part at each of its edges unless a visible one already crosses there, so the import keeps as much of the model as a side view can show.
- **Left out, and said so:** features that aren't round about the axis (cross holes, flats, slots, hex, knurls) and faces the reader can't take exactly (freeform B-spline surfaces). The import reports how many faces it left out and why.
- **Placing it:** Import STEP turns lathe mode on and shows the profile with option buttons. **Z0 at** the right end (the default; the part runs into −Z) or the left end. **Flip** turns it end for end, since a STEP file's axis direction is arbitrary. **Half** profile (the default, above the centerline) or **Full** (mirrored below). Place puts it on a new layer named after the file, as one undo step.
- **Three views:** so cross holes, slots and flats aren't lost while sketching, **3 views** places the part's front, top and right-end views instead of the profile, laid out third-angle: the front view along Z with Z0 at the end chosen, the top view above it, the end view to its right, a gap apart (the front view's height, or an eighth of the part's length when that is more). Every edge of the model and the outline of every curved face is projected: lines exactly, circles exactly when seen face-on or edge-on, and a curve on a cylinder seen end-on (where a cross hole breaks out) as that cylinder's arc. Anything else (ellipses, splines, circles at a slant) is fitted with arcs and lines and put on its own layer, so it is never mistaken for exact geometry. Edges with material between them and the viewer come in hidden; smooth edges (where a radius runs into a face) in the tangent style, except where they are part of the outline: an outside edge, such as a shoulder or end face seen edge-on beside its radius, is always in the visible style. **Turn 90°** turns the part a quarter turn about its axis before the views are taken, and **Flip** and **Z0 at** work as for the profile; Half and Full are for the profile only. Place puts each view on its own layer (`<name> front`, `<name> top`, `<name> end`, `<name> fitted`), as one undo step.

## Files, saving and printing

The native format is a versioned JSON file that you own and that stays readable without the app. DXF is the bridge to Solid Edge, CAM and customers.

- **Native file:** `.cad2d.json` with a `schemaVersion` field and migration functions, so old drawings always open.
- **Saving:** Save and Save As use the browser's File System Access API where supported (Chrome, Edge), with a download fallback. Autosave keeps a crash-recovery copy in IndexedDB.
- **DXF export:** ASCII DXF with units set in the header and layers kept. LINE, CIRCLE, ARC, POINT and TEXT are written natively, and blocks as BLOCK definitions with INSERT instances (the description kept in the definition). Dimensions export as exploded lines and text by default, with native DIMENSION entities as an option.
- **DXF import:** lines, arcs, circles, polylines (split into lines and arcs), text, and blocks with their inserts (nested blocks exploded), so existing Solid Edge drawings can be brought in. Imported dimensions come in as plain geometry.
- **Print / PDF:** paper sizes Letter, Tabloid, A4 and A3. Plot scale is 1:1, 2:1, 5:1, 10:1, 20:1 or custom. A simple title block template holds part number, revision, material, units, scale and date. Line weights are set by layer.
- **SVG export** for quick sharing or pasting into documents.

## Phased roadmap

Each phase ends with something you can use and check by hand. Phases 1–3 already give a working sketcher; Phases 4–5 make it a drafting tool.

1. **Phase 0: Canvas and shell**
   - Vite + TypeScript project, test runner, canvas with grid, wheel zoom at the cursor, middle-drag pan, Zoom Extents, live coordinate readout, empty undo stack. (Built with a temporary command line, replaced by the toolbar at the start of Phase 1.)
   - Done when: zooming from 2" to 0.001" across the screen stays smooth and lines stay crisp.
2. **Phase 1: Toolbar, drawing and exact input**
   - Toolbar, tool options bar and status line replacing the Phase 0 command line; line, circle, arc, xline and point with all creation methods; input boxes at the cursor for absolute and relative values, length and angle; ortho and polar tracking; inch/mm; layers; JSON save and load.
   - Done when: a turned profile entered from a print with the mouse and the input boxes matches its coordinates exactly in the properties panel.
3. **Phase 2: Snaps, selection, grips, basic edits**
   - All object snaps with markers; window and crossing selection; grips; properties panel editing; erase, move, copy, rotate, mirror, scale; DIST, ID, LIST.
   - Done when: tangent and intersection snaps land exactly, checked with ID, on line-arc and arc-arc cases.
4. **Phase 3: Trim, extend, fillet and friends**
   - Trim, extend, fillet, chamfer, offset, break, join, lengthen, array, stretch.
   - Done when: a full turned profile with corner radii and chamfers can be built from construction lines by trimming alone.
5. **Phase 4: Core dimensions**
   - Linear, aligned, radius, diameter, angular, leader; dimension styles; precision, zero rules, tolerances, dual units; text overrides; dimension grips.
   - Done when: a dimensioned drawing matches a Solid Edge print value for value at 3 and 4 places.
6. **Phase 5: Lathe dimensioning**
   - Symmetric diameter (both styles), ordinate with origin and auto-jog, baseline and continue, center marks and centerlines, associativity with geometry edits, lathe mode and diameter entry.
   - Done when: one of your real lathe parts can be dimensioned the way you do it in Solid Edge today.
7. **Phase 6: Blocks** (moved ahead of output, user decision 2026-11-09)
   - Block definitions with a description, Create block, Insert, instances edited as one object, snaps and associativity into instances, Edit block, Explode, Purge, and a library shared by all drawings with export and import. No nesting.
   - Done when: a cutting tool sketch saved to the library from one drawing is inserted into another beside a lathe profile, moved, rotated and mirrored onto the part with snaps, dimensioned from its tip to the part, redefined, and the drawing saves and reopens the same.
8. **Phase 7: STEP import for turned parts** (ahead of output, user decision 2026-11-09)
   - A STEP reader with no new package, the turned profile from a part's faces of revolution, and Import STEP with Z0 at either end, Flip, and half or full profile, or the part's three views with hidden lines (see "STEP import").
   - Done when: one of your real Solid Edge STEP files of a lathe part imports with every diameter, length, chamfer and radius matching the model, checked with List and dimensions, and its cross holes and flats reported as left out.
9. **Phase 8: Output**
   - DXF export and import (with blocks), PDF and SVG at scale, title block, autosave, PWA offline install.
   - Done when: an exported DXF opens in Solid Edge with correct units and sizes, and a 10:1 PDF measures true with calipers.
10. **Later, optional**
   - Lathe G-code export from a selected profile, nested blocks, per-instance text fields (attributes), hatching, more linetypes, multiple views or sheets.

## Testing and CLAUDE.md

The geometry kernel is where silent errors would cost you parts, so it carries the heaviest tests. Your own drawings are the final check.

- **Unit tests** for every geometry function, using known answers: line-arc intersections, tangent-tangent-radius circles, fillet centers, offsets, and trim results.
- **Property tests** (for example with fast-check) on random geometry. Trim never lengthens an entity, offset distance always holds, and intersection points lie on both entities.
- **Round-trip tests:** save then load, and DXF export then import, return identical geometry within tolerance.
- **Screenshot tests** (Playwright) for dimension rendering in each style, so layout changes are seen.
- **Reference parts:** put 3–5 of your real drawings, exported from Solid Edge as DXF and PDF, in `reference/`. Each phase is checked against them.

Contents for `CLAUDE.md` at the project root:

```markdown
# 2D CAD project rules

Spec: docs/SPEC.md. Re-read the relevant section before each phase.

- AutoCAD LT-style drafting. NEVER add a constraint solver or
  dimension-driven geometry. Dimensions only read geometry.
- geometry/ is pure TypeScript: no DOM, no imports from model/ or ui/.
- Every drawing change goes through the undo stack as a reversible record.
- One shared tolerance constant for comparisons; never hard-code epsilons.
- Stored coordinates are never rounded. Rounding happens only at display.
- Add or update unit tests with every geometry or command change.
  Run `npm test` and `npm run typecheck` before saying a task is done.
- Work one roadmap phase at a time; propose a plan and wait for approval.
- Keep dependencies minimal; ask before adding any npm package.
- Commit in small steps with clear messages.
```
