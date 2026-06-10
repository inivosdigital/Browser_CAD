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
| Circle | center-r, center-d, 2P, **3P, TTR** | 🟡 center-r, 2P | P2 3P |
| Arc | 11 entry methods | 🟡 3-point, center-start-end | OK for MVP |
| Rectangle | corner-corner + **dimensions, rotation, fillet/chamfer corners** | 🟡 corner-corner | P3 |
| Polygon | inscribed/circumscribed/edge | 🟡 inscribed | P3 |
| Ellipse / elliptical arc | center or axis-end | ❌ | **P1** |
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
| Move / Copy (multiple) / Rotate (+Reference) / Scale (+Reference) | ✅ | ✅ (no Reference option) | P2 Reference |
| Mirror (MIRRTEXT) | ✅ | ✅ | — |
| Offset (+Through, Erase, Layer opts) | ✅ | ✅ basic | — |
| Trim / Extend (select edges or all; shift-swap) | ✅ | ✅ all-edges mode | P2 shift-swap |
| Fillet (+polyline mode) / Chamfer | ✅ | 🟡 fillet lines only | **P1 chamfer**, P2 arcs/plines |
| Array: rectangular, polar, **path**; associative | ✅ | 🟡 rect + polar, non-assoc. | OK for MVP |
| Break / Break at point | ✅ | ❌ | **P1** |
| Join (lines→pline, arcs→arc/circle) | ✅ | ❌ | **P1** |
| Stretch (crossing-window vertex move) | ✅ | ❌ | **P1** |
| Lengthen | delta/percent/total | ❌ | P3 |
| Explode | ✅ | ✅ | — |
| PEDIT (join, close, vertex edit, width) | ✅ | 🟡 closed flag + grips | P2 join |
| Align | move+rotate+scale by point pairs | ❌ | P3 |
| Grips: multifunctional (stretch/move/rotate/scale/mirror cycling, multi-grip) | ✅ | 🟡 stretch-style grips | OK for MVP |

## 3. Annotation

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Single-line text (TEXT/DTEXT) | ✅ | ✅ | — |
| Multiline text (MTEXT) w/ formatting | ✅ | ❌ | P2 (basic word-wrap box) |
| Dim: linear, aligned, radius, diameter, angular | ✅ | ✅ | — |
| Dim: arc length, ordinate, jogged | ✅ | ❌ | P3 |
| Continue / Baseline dimensioning (DIMCONT/DIMBASE) | ✅ | ❌ | **P1** |
| Quick dimension (QDIM) | ✅ | ❌ | P3 |
| **Dimension styles** (DIMSTYLE: arrows, text height, units, precision) | ✅ | 🟡 fixed style; units global toggle | P2 (per-doc style settings) |
| **Imperial/architectural dim display X'-Y"** | via DIMSTYLE units | ✅ **default** | done |
| Leaders / Multileaders (MLEADER) | ✅ | ❌ | **P1** (simple leader: arrow + segments + text) |
| Tables | ✅ | ❌ | — |
| Annotative scaling | ✅ | ❌ | — |
| Centerlines / center marks | ✅ | ❌ | P3 |

## 4. Precision & Input Mechanics

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Object snaps | 14 modes; running + override | 🟡 end/mid/center/quad/int/perp | P2 tangent, nearest, extension |
| Polar tracking (F10) + increments | ✅ | ✅ 45° (setting) | P2 increment UI |
| **Object snap tracking (F11)** | track along osnap alignment paths | ❌ | P2 |
| Ortho (F8) | ✅ | ✅ | — |
| Grid + snap (F7/F9), polar snap | ✅ | ✅ | — |
| **Dynamic input (F12, DYNMODE)** — pointer + dimensional tooltips at cursor; distance/angle shown **before the 2nd click**; typed input feeds the active field | ✅ | ✅ distance<angle readout + direct entry | done |
| Coordinate entry: abs/rel/polar, direct distance | ✅ | ✅ | — |
| Architectural units input (3'6", fractions) | ✅ (UNITS) | ✅ | — |
| Angle override (`<30` locks angle) | ✅ | ❌ | P2 |
| Selection: window/crossing, fence, lasso, similar | ✅ | 🟡 window/crossing | OK |
| Selection cycling (overlapping objects) | ✅ | ❌ | P3 |
| QuickCalc | ✅ | ❌ | — |

## 5. Organization

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Layers: on/off, freeze, lock, color, linetype, lineweight, plot flag | ✅ | 🟡 visible/lock/color | **P1 linetype + lineweight** |
| Layer states, filters | ✅ | ❌ | — |
| Blocks: define, insert, redefine | ✅ | ✅ | — |
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
| Hatch scale + angle per instance | ✅ | 🟡 spacing only | **P1 angle prompt** |

## 7. Views, Layouts & Output

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Pan/zoom, zoom extents/window/previous | ✅ | 🟡 no zoom previous | P3 |
| Named views | ✅ | ❌ | — |
| **Paper-space layouts + viewports, viewport scale** | ✅ | ❌ | P2 (single layout, scaled viewport, title block) |
| Plot to printer/**PDF**, plot styles (CTB), lineweights | ✅ | 🟡 vector PDF, no styles | P2 lineweight in plot |
| Plot scale (1/4" = 1'-0" etc.) | ✅ | 🟡 fit-to-paper only | **P1 fixed scales** |
| Page setups | ✅ | ❌ | P3 |

## 8. Files & Interop

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| DWG native | ✅ | ❌ (proprietary JSON) | — (DWG is closed; DXF is our interchange) |
| DXF in/out | ✅ | ✅ R12 | P2 R2000+ (LWPOLYLINE, splines) |
| Drawing compare (DWG Compare) | ✅ | ❌ | — |
| Count (objects/blocks) | ✅ | ❌ | P3 (easy: count selection by type) |
| Autosave/recovery | ✅ | ✅ localStorage | — |
| Templates (DWT) | ✅ | ❌ | P3 |

## 9. UI & Automation

| Feature | LT behavior | BrowserCAD | Priority |
|---|---|---|---|
| Command line w/ **autocomplete + synonym suggestions** | ✅ | 🟡 aliases, history | P2 autocomplete dropdown |
| Contextual ribbon | ✅ | 🟡 fixed toolbar | — |
| Tool palettes | ✅ | ❌ | — |
| Shortcut keys (F-keys, Ctrl) | ✅ | ✅ core set | — |
| Right-click context menus | ✅ (Enter or menu) | 🟡 right-click = Enter | OK |
| AutoLISP (LT 2024+) | ✅ | ❌ | — (a JS scripting console is the natural analog, P3)

## MVP implementation order (the agreed plan)

1. **P1 batch — "daily drafting parity"**: Ellipse · Break · Join · Stretch ·
   Chamfer · Continue/Baseline dimensioning · simple Leader · hatch angle prompt ·
   layer linetype (dashed/center/hidden) + lineweight · fixed plot scales
2. **P2 batch — "feel like LT"**: osnap tangent/nearest + object snap tracking ·
   angle override `<30` · polyline arc segments + PEDIT Join · circle 3P ·
   rotate/scale Reference · MTEXT basics · dimension style settings panel ·
   hatch pattern library · command autocomplete · DXF R2000 · paper-space layout
3. **P3 / later**: everything else marked P3 above.

### Sources

- Autodesk, *AutoCAD LT Features* (autodesk.com/products/autocad-lt/features)
- Autodesk Knowledge Network, *Dynamic Input Tab (Drafting Settings)* — DYNMODE/F12 mechanics
- Autodesk, *How to enable or disable dynamic input* (support article)
- Autodesk, *AutoCAD vs AutoCAD LT comparison* (autodesk.com/products/autocad/compare)
- Land F/X, *Measurements within the drawing space (Dynamic Input)*
- ONLC / Tesla Outsourcing / CAD3DHouse LT-vs-AutoCAD comparisons (command-level differences, DLINE, Express Tools, API limits)
