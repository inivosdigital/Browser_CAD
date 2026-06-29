# AutoCAD LT Feature Parity — MVP Specification

This document inventories AutoCAD LT's feature set (the 2D drafting product — no 3D
modeling, no rendering, no Express Tools) and tracks BrowserCAD's parity against it.
It is the working spec for the MVP: **everything marked P1/P2 below is in scope.**

Status: ✅ done · 🟡 partial · ❌ missing  
Priority: **P1** core drafting parity · **P2** strong want · P3 later · — out of MVP scope

## 1. Draw / Create

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Line | chained segments, Close/Undo options | ✅ | — |
| Polyline | line + **arc segments**, width, Close/Undo | 🟡 line segments only | P2 arc segments |
| Circle | center-r, center-d, 2P, **3P, TTR** | ✅ center-r, 2P, 3P | TTR P3 |
| Arc | 11 entry methods | 🟡 3-point, center-start-end | OK for MVP |
| Rectangle | corner-corner + **dimensions, rotation, fillet/chamfer corners** | 🟡 corner-corner | P3 |
| Polygon | inscribed/circumscribed/edge | 🟡 inscribed | P3 |
| Ellipse / elliptical arc | center or axis-end | ✅ ellipse (`EL`) | arcs P3 |
| Spline | fit-point smooth curves | ❌ | P2 |
| Point + point styles (DDPTYPE) | ✅ basic | 🟡 | P3 |
| Construction line (XLINE) / Ray | infinite reference lines | ❌ | P2 |
| Double line (DLINE — LT's MLINE) | two parallel lines w/ cleanup | ❌ | P3 |
| Revision cloud | ✅ in LT | ❌ | P3 |
| Wipeout | masking object | ❌ | — |
| Region/Boundary (BPOLY) | boundary detection from enclosed area | ❌ | P2 (would improve HATCH picking) |

## 2. Modify

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Move / Copy (multiple) / Rotate (+Reference) / Scale (+Reference) | ✅ | ✅ incl. Reference | — |
| Mirror (MIRRTEXT) | ✅ | ✅ | — |
| Offset (+Through, Erase, Layer opts) | ✅ | ✅ basic | — |
| Trim / Extend (select edges or all; shift-swap) | ✅ | ✅ all-edges mode | P2 shift-swap |
| Fillet (+polyline mode) / Chamfer | ✅ | ✅ fillet + chamfer (`CHA`) for lines | P2 arcs/plines |
| Array: rectangular, polar, **path**; associative | ✅ | 🟡 rect + polar, non-assoc. | OK for MVP |
| Break / Break at point | ✅ | ✅ `BR` (incl. `@` split-at-point) | — |
| Join (lines→pline, arcs→arc/circle) | ✅ | ✅ `J` | — |
| Stretch (crossing-window vertex move) | ✅ | ✅ `S` | — |
| Lengthen | delta/percent/total | ❌ | P3 |
| Explode | ✅ | ✅ | — |
| PEDIT (join, close, vertex edit, width) | ✅ | 🟡 closed flag + grips | P2 join |
| Align | move+rotate+scale by point pairs | ❌ | P3 |
| Grips: multifunctional (stretch/move/rotate/scale/mirror cycling, multi-grip) | ✅ | 🟡 stretch-style grips | OK for MVP |

## 3. Annotation

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Single-line text (TEXT/DTEXT) | ✅ | ✅ | — |
| Multiline text (MTEXT) w/ formatting | ✅ | ✅ word-wrap box, in-canvas editor, dbl-click edit | rich formatting P3 |
| Dim: linear, aligned, radius, diameter, angular | ✅ | ✅ | — |
| Dim: arc length, ordinate, jogged | ✅ | ❌ | P3 |
| Continue / Baseline dimensioning (DIMCONT/DIMBASE) | ✅ | ✅ `DCO` / `DBA` | — |
| Quick dimension (QDIM) | ✅ | ❌ | P3 |
| **Dimension styles** (DIMSTYLE: arrows, text height, units, precision) | ✅ | ✅ `DIMSTYLE`/`D` dialog (text, arrows, ext lines, precision) | named styles P3 |
| **Imperial/architectural dim display X'-Y"** | via DIMSTYLE units | ✅ **default** | done |
| Leaders / Multileaders (MLEADER) | ✅ | ✅ simple leader (`LE`) | mleader styles P3 |
| Tables | ✅ | ❌ | — |
| Annotative scaling | ✅ | ✅ ANNOSCALE: dims/leaders size by scale; viewports compensate | named per-object scales P3 |
| Centerlines / center marks | ✅ | ❌ | P3 |

## 4. Precision & Input Mechanics

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Object snaps | 14 modes; running + override | ✅ end/mid/center/quad/int/perp/**tan/near** | extension P3 |
| Polar tracking (F10) + increments | ✅ | ✅ 45° (setting) | P2 increment UI |
| **Object snap tracking (F11)** | track along osnap alignment paths | ✅ hover-acquire + H/V alignment rays | polar-angle rays P3 |
| Ortho (F8) | ✅ | ✅ incl. **Shift momentary override** while drawing | — |
| Grid + snap (F7/F9), polar snap | ✅ | ✅ | — |
| **Dynamic input (F12, DYNMODE)** — pointer + dimensional tooltips at cursor; distance/angle shown **before the 2nd click**; typed input feeds the active field | ✅ | ✅ distance<angle readout + direct entry | done |
| Coordinate entry: abs/rel/polar, direct distance | ✅ | ✅ | — |
| Architectural units input (3'6", fractions) | ✅ (UNITS) | ✅ | — |
| Angle override (`<30` locks angle) | ✅ | ✅ | — |
| Selection: window/crossing, fence, lasso, similar | ✅ | 🟡 window/crossing | OK |
| Selection cycling (overlapping objects) | ✅ | ❌ | P3 |
| QuickCalc | ✅ | ❌ | — |

## 5. Organization

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Layers: on/off, freeze, lock, color, linetype, lineweight, plot flag | ✅ | ✅ visible/lock/color/linetype/lineweight | freeze P3 |
| Layer states, filters | ✅ | ❌ | — |
| Blocks: define, insert, redefine, **BEDIT in-place editing** | ✅ | ✅ B redefines; BE / double-click edits in place, BC closes | — |
| Block attributes (ATTDEF), Smart Blocks | ✅ | ❌ | P3 |
| Groups | ✅ | ❌ | P3 |
| External references (XREF) | ✅ | ❌ | — |
| Properties palette / Quick Properties | ✅ | ✅ panel | — |
| Match properties (MATCHPROP) | ✅ | ❌ | P2 |

## 6. Hatching & Boundaries

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Hatch patterns (ANSI/ISO library), solid, **gradient** | ✅ | 🟡 lines/cross/solid | P2 more patterns (ANSI31-38 style) |
| Pick internal point (boundary detection) | ✅ | ❌ (pick object only) | P2 |
| Associative hatch, hatch editing | ✅ | ❌ | P3 |
| Hatch scale + angle per instance | ✅ | ✅ spacing + angle | — |

## 7. Views, Layouts & Output

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Pan/zoom, zoom extents/window/previous | ✅ | 🟡 no zoom previous | P3 |
| Named views | ✅ | ❌ | — |
| **Paper-space layouts + viewports, viewport scale** | ✅ | ✅ layout tabs, MVIEW viewports w/ standard scales, paper sizes incl. ANSI-B/ARCH-D | per-viewport layer freeze P3 |
| Plot to printer/**PDF**, plot styles (CTB), lineweights | ✅ | 🟡 vector PDF, no styles | P2 lineweight in plot |
| Plot scale (1/4" = 1'-0" etc.) | ✅ | ✅ Fit, 1:n, x/y"=1'-0" | — |
| Page setups | ✅ | ❌ | P3 |

## 8. Files & Interop

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| DWG native | ✅ | ❌ (proprietary JSON) | — (DWG is closed; DXF is our interchange) |
| DXF in/out | ✅ | ✅ R12 out; reader handles R12-R2018 text DXF: LWPOLYLINE, INSERT, SOLID, BLOCKS section, paper space (67) | splines P3 |
| Drawing compare (DWG Compare) | ✅ | ❌ | — |
| Count (objects/blocks) | ✅ | ❌ | P3 (easy: count selection by type) |
| Autosave/recovery | ✅ | ✅ localStorage | — |
| Templates (DWT) | ✅ | ✅ via DXF: each template layout → its own tab at its declared sheet size (LAYOUT objects), custom sizes supported | native DWG is closed |

## 9. UI & Automation

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Command line w/ **autocomplete + synonym suggestions** | ✅ | ✅ dropdown w/ aliases + help, Tab/↑↓/Enter | — |
| Contextual ribbon | ✅ | 🟡 fixed toolbar | — |
| Tool palettes | ✅ | ❌ | — |
| Shortcut keys (F-keys, Ctrl) | ✅ | ✅ core set | — |
| Right-click context menus | ✅ (Enter or menu) | 🟡 right-click = Enter | OK |
| AutoLISP (LT 2024+) | ✅ | ❌ | — (a JS scripting console is the natural analog, P3)

## MVP implementation order (the agreed plan)

1. ~~**P1 batch — "daily drafting parity"**~~ ✅ **shipped**: Ellipse · Break · Join ·
   Stretch · Chamfer · Continue/Baseline dimensioning · simple Leader · hatch angle ·
   layer linetypes (dashed/hidden/center/dot) + lineweights · fixed plot scales
2. ~~**P2 batch — "feel like LT"**~~ ✅ **shipped**: osnap tangent/nearest ·
   object snap tracking (F11) · angle override `<30` · circle 3P ·
   rotate/scale Reference · MTEXT (in-canvas editor) · dimension style dialog ·
   command autocomplete
3. ~~**P2b: paper space**~~ ✅ **shipped**: layout tabs · MVIEW viewports ·
   annotation scale (ANNOSCALE) · template import via DXF · 1:1 layout plotting
4. **Remaining big rocks**: polyline arc segments + PEDIT Join · hatch pattern
   library · DXF splines
5. **P3 / later**: everything else marked P3 above.

### Sources

- Autodesk, *AutoCAD LT Features* (autodesk.com/products/autocad-lt/features)
- Autodesk Knowledge Network, *Dynamic Input Tab (Drafting Settings)* — DYNMODE/F12 mechanics
- Autodesk, *How to enable or disable dynamic input* (support article)
- Autodesk, *AutoCAD vs AutoCAD LT comparison* (autodesk.com/products/autocad/compare)
- Land F/X, *Measurements within the drawing space (Dynamic Input)*
- ONLC / Tesla Outsourcing / CAD3DHouse LT-vs-AutoCAD comparisons (command-level differences, DLINE, Express Tools, API limits)
