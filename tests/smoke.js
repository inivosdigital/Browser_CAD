/* Node smoke test for the headless core (geometry, entities, document, DXF).
   Run: node tests/smoke.js */
'use strict';

const { GEO } = require('../js/geometry.js');
global.GEO = GEO;
const { ENT, makeEntity, setEntitySeq } = require('../js/entities.js');
global.ENT = ENT;
global.makeEntity = makeEntity;
global.setEntitySeq = setEntitySeq;
const { CadDocument } = require('../js/document.js');
const { DXF } = require('../js/dxf.js');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function nearPt(p, q, eps) { return near(p.x, q.x, eps) && near(p.y, q.y, eps); }

console.log('geometry');
check('dist', near(GEO.dist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5));
check('segSeg crossing', nearPt(GEO.segSeg({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), { x: 5, y: 5 }));
check('segSeg miss', GEO.segSeg({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 4 }) === null);
check('lineLine parallel', GEO.lineLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }) === null);
const sc = GEO.segCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5);
check('segCircle two hits', sc.length === 2 && sc.every(p => near(Math.abs(p.x), 5) && near(p.y, 0)));
const cc = GEO.circleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
check('circleCircle two hits', cc.length === 2 && cc.every(p => near(p.x, 4)));
const a3 = GEO.arc3pt({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 });
check('arc3pt center/r', a3 && nearPt(a3.c, { x: 0, y: 0 }) && near(a3.r, 5));
check('arc3pt passes mid', a3 && GEO.angIn(Math.PI / 2, a3.a0, a3.a1));
check('angIn wraparound', GEO.angIn(0.1, GEO.normAng(-0.5), 0.5) && !GEO.angIn(Math.PI, GEO.normAng(-0.5), 0.5));
check('mirrorPt', nearPt(GEO.mirrorPt({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 0, y: 1 }), { x: -2, y: 3 }));

console.log('entities');
const line = makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
check('hitTest line on', ENT.hitTest(line, { x: 5, y: 0.1 }, 0.5));
check('hitTest line off', !ENT.hitTest(line, { x: 5, y: 2 }, 0.5));
const circ = makeEntity('circle', { c: { x: 0, y: 0 }, r: 5 });
check('hitTest circle rim', ENT.hitTest(circ, { x: 5.2, y: 0 }, 0.5));
check('hitTest circle center misses', !ENT.hitTest(circ, { x: 0, y: 0 }, 0.5));
const rot = ENT.transformed(line, ENT.xfRotate({ x: 0, y: 0 }, Math.PI / 2));
check('rotate line', nearPt(rot.b, { x: 0, y: 10 }));
const arc = makeEntity('arc', { c: { x: 0, y: 0 }, r: 5, a0: 0, a1: Math.PI / 2 });
const mirArc = ENT.transformed(arc, ENT.xfMirror({ x: 0, y: 0 }, { x: 0, y: 1 }));
// original arc passes (cos45, sin45)*5; mirrored must pass (-cos45, sin45)*5
const mp = { x: -5 * Math.SQRT1_2, y: 5 * Math.SQRT1_2 };
check('mirror arc keeps points', ENT.hitTest(mirArc, mp, 1e-6));
const ints = ENT.intersections(
  makeEntity('line', { a: { x: -10, y: 0 }, b: { x: 10, y: 0 } }),
  circ
);
check('line/circle intersections', ints.length === 2);
const pl = makeEntity('polyline', { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false });
check('polyline snap points', ENT.snapPoints(pl).filter(s => s.kind === 'mid').length === 2);
check('inRect window', ENT.inRect(line, { x1: -1, y1: -1, x2: 11, y2: 1 }, false));
check('inRect crossing', ENT.inRect(line, { x1: 4, y1: -1, x2: 6, y2: 1 }, true));
check('inRect window excludes partial', !ENT.inRect(line, { x1: 4, y1: -1, x2: 6, y2: 1 }, false));
const dim = makeEntity('dim', { dtype: 'linear-h', p1: { x: 0, y: 0 }, p2: { x: 25, y: 5 }, p3: { x: 12, y: 15 } });
check('dim value', near(ENT.dimValue(dim), 25));
const dg = ENT.dimGeometry(dim);
check('dim geometry parts', dg.lines.length === 3 && dg.texts.length === 1 && dg.arrows.length === 2);
check('explode polyline', ENT.explode(pl).length === 2);

console.log('units');
const { UNITS } = require('../js/units.js');
global.UNITS = UNITS;
const cases = [
  ['42', 42], ['3.5', 3.5], ['-7', -7],
  ["3'6", 42], ["3'6\"", 42], ["3'-6\"", 42], ["3' 6\"", 42],
  ["5'", 60], ["3.5'", 42], ['18"', 18], ['6 1/2', 6.5], ['6-1/2"', 6.5],
  ["3'6 1/2\"", 42.5], ['1/2', 0.5], ["-3'6", -42], ["0'-9\"", 9],
];
for (const [input, want] of cases) {
  const got = UNITS.parseLength(input);
  check(`parse ${JSON.stringify(input)} -> ${want}`, got !== null && near(got, want));
}
for (const bad of ['', 'abc', "'6", "3''", '1/0', '3,5']) {
  check(`reject ${JSON.stringify(bad)}`, UNITS.parseLength(bad) === null);
}
check("format 42 arch", UNITS.formatLength(42, 'architectural') === "3'-6\"");
check("format 42.5 arch", UNITS.formatLength(42.5, 'architectural') === "3'-6 1/2\"");
check("format 9 arch", UNITS.formatLength(9, 'architectural') === "0'-9\"");
check("format -30.25 arch", UNITS.formatLength(-30.25, 'architectural') === "-2'-6 1/4\"");
check("format rounds to 1/16", UNITS.formatLength(10.04, 'architectural') === "0'-10 1/16\"");
check('format decimal', UNITS.formatLength(42.5, 'decimal') === '42.5');
ENT.units = 'architectural';
const archDim = makeEntity('dim', { dtype: 'linear-h', p1: { x: 0, y: 0 }, p2: { x: 42, y: 0 }, p3: { x: 21, y: -10 } });
check('dim text in feet-inches', ENT.dimGeometry(archDim).texts[0].text === "3'-6\"");
const archAng = makeEntity('dim', { dtype: 'angular', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, p3: { x: 0, y: 10 }, p4: { x: 5, y: 5 } });
check('angular text stays degrees', ENT.dimGeometry(archAng).texts[0].text === '90°');
ENT.units = 'decimal';

console.log('new entity types');
// radial / angular dimensions
const rdim = makeEntity('dim', { dtype: 'radius', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, p3: { x: 12, y: 6 } });
check('radius dim value', near(ENT.dimValue(rdim), 5));
check('radius dim text', ENT.dimGeometry(rdim).texts[0].text === 'R5');
const ddim = makeEntity('dim', { dtype: 'diameter', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, p3: { x: 12, y: 6 } });
check('diameter dim value', near(ENT.dimValue(ddim), 10));
check('diameter dim has through-line', ENT.dimGeometry(ddim).lines.length === 2 && ENT.dimGeometry(ddim).arrows.length === 2);
const adim = makeEntity('dim', {
  dtype: 'angular',
  p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, p3: { x: 0, y: 10 }, p4: { x: 5, y: 5 },
});
check('angular dim value 90', near(ENT.dimValue(adim), 90, 1e-6));
check('angular dim has arc', ENT.dimGeometry(adim).arcs.length === 1);
const adimOut = makeEntity('dim', {
  dtype: 'angular',
  p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, p3: { x: 0, y: 10 }, p4: { x: -5, y: -5 },
});
check('angular dim reflex side 270', near(ENT.dimValue(adimOut), 270, 1e-6));

// grips
const gl = makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
let gs = ENT.grips(gl);
check('line has 3 grips', gs.length === 3);
gs[1].apply({ x: 10, y: 5 });
check('endpoint grip moves end', nearPt(gl.b, { x: 10, y: 5 }));
gs = ENT.grips(gl);
gs[2].apply({ x: 20, y: 20 }); // midpoint grip translates whole line
check('mid grip translates line', nearPt(GEO.mid(gl.a, gl.b), { x: 20, y: 20 }));
const gc = makeEntity('circle', { c: { x: 0, y: 0 }, r: 5 });
ENT.grips(gc)[1].apply({ x: 8, y: 0 });
check('quad grip sets radius', near(gc.r, 8));

// hatch
const hatch = makeEntity('hatch', {
  boundary: { kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
  pattern: 'lines', spacing: 2, angle: Math.PI / 4,
});
check('hatch hit inside', ENT.hitTest(hatch, { x: 5, y: 5 }, 0.1));
check('hatch miss outside', !ENT.hitTest(hatch, { x: 15, y: 5 }, 0.1));
const hb = ENT.bbox(hatch);
check('hatch bbox', near(hb.x2, 10) && near(hb.y2, 10));
ENT.transform(hatch, ENT.xfScale({ x: 0, y: 0 }, 2));
check('hatch scales spacing', near(hatch.spacing, 4) && near(ENT.bbox(hatch).x2, 20));
check('hatch explodes to boundary', ENT.explode(hatch)[0].type === 'polyline');
check('ptInPoly', GEO.ptInPoly({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]));
check('lineCircle infinite', GEO.lineCircle({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }, 2).length === 2);

// blocks
const blocks = {
  bolt: {
    name: 'bolt', base: { x: 0, y: 0 },
    entities: [
      makeEntity('circle', { c: { x: 0, y: 0 }, r: 2 }),
      makeEntity('line', { a: { x: -2, y: 0 }, b: { x: 2, y: 0 } }),
    ],
  },
};
ENT.blockResolver = (name) => blocks[name];
const ins = makeEntity('insert', { name: 'bolt', p: { x: 100, y: 50 }, scale: 2, rotation: 0 });
const kids = ENT.resolvedChildren(ins);
check('insert resolves children', kids.length === 2);
check('insert child transformed', nearPt(kids[0].c, { x: 100, y: 50 }) && near(kids[0].r, 4));
const ibb = ENT.bbox(ins);
check('insert bbox', near(ibb.x1, 96) && near(ibb.x2, 104));
check('insert hitTest rim', ENT.hitTest(ins, { x: 104, y: 50 }, 0.3));
const exploded = ENT.explode(ins);
check('insert explodes', exploded.length === 2 && exploded[0].type === 'circle');
const insRot = makeEntity('insert', { name: 'bolt', p: { x: 0, y: 0 }, scale: 1, rotation: Math.PI / 2 });
const rkids = ENT.resolvedChildren(insRot);
check('insert rotation', nearPt(rkids[1].b, { x: 0, y: 2 }));

console.log('p1 batch entities');
// ellipse
const ell = makeEntity('ellipse', { c: { x: 10, y: 5 }, rx: 8, ry: 4, rot: 0 });
check('ellipse pt t=0', nearPt(ENT.ellipsePt(ell, 0), { x: 18, y: 5 }));
check('ellipse pt t=90', nearPt(ENT.ellipsePt(ell, Math.PI / 2), { x: 10, y: 9 }));
const ebb = ENT.bbox(ell);
check('ellipse bbox', near(ebb.x1, 2) && near(ebb.x2, 18) && near(ebb.y1, 1) && near(ebb.y2, 9));
check('ellipse hit on rim', ENT.hitTest(ell, { x: 18, y: 5 }, 0.3));
check('ellipse miss center', !ENT.hitTest(ell, { x: 10, y: 5 }, 0.3));
const rotEll = ENT.transformed(ell, ENT.xfRotate(ell.c, Math.PI / 2));
check('ellipse rotation', nearPt(ENT.ellipsePt(rotEll, 0), { x: 10, y: 13 }));
check('ellipse explode -> closed pline', ENT.explode(ell)[0].closed === true);
const eg = ENT.grips(ell);
eg[1].apply({ x: 22, y: 5 });
check('ellipse rx grip', near(ell.rx, 12));

// leader
const ld = makeEntity('leader', { pts: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }], text: 'NOTE 1', height: 2.5 });
const lg = ENT.leaderGeometry(ld);
check('leader geometry', lg.lines.length === 2 && lg.arrows.length === 1 && lg.texts[0].text === 'NOTE 1');
check('leader arrow at first pt', nearPt(lg.arrows[0].p, { x: 0, y: 0 }));
check('leader hit on segment', ENT.hitTest(ld, { x: 5, y: 5 }, 0.3));
const ldEx = ENT.explode(ld);
check('leader explodes to lines+text', ldEx.filter(e => e.type === 'line').length === 4 && ldEx.some(e => e.type === 'text'));

// stretch
const sl = makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
ENT.stretch(sl, { x1: 8, y1: -2, x2: 12, y2: 2 }, { x: 5, y: 3 });
check('stretch moves inside endpoint only', nearPt(sl.a, { x: 0, y: 0 }) && nearPt(sl.b, { x: 15, y: 3 }));
const sd = makeEntity('dim', { dtype: 'linear-h', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, p3: { x: 5, y: -5 } });
ENT.stretch(sd, { x1: 8, y1: -2, x2: 12, y2: 2 }, { x: 5, y: 0 });
check('stretch updates dim defpoint', near(ENT.dimValue(sd), 15));

console.log('p2 batch');
// mtext wrapping
const mt = makeEntity('mtext', { p: { x: 0, y: 0 }, width: 30, height: 2.5, text: 'THE QUICK BROWN FOX JUMPS' });
const mls = ENT.mtextLines(mt);
check('mtext wraps to multiple lines', mls.length >= 2 && mls.every(l => l.length * 1.5 <= 30 + 10));
check('mtext respects newlines', ENT.mtextLines(makeEntity('mtext', { p: { x: 0, y: 0 }, width: 100, height: 2.5, text: 'A\nB' })).length === 2);
const mbb = ENT.bbox(mt);
check('mtext bbox below insertion', near(mbb.y2, 0) && mbb.y1 < -mls.length * 2.5);
check('mtext hit inside box', ENT.hitTest(mt, { x: 15, y: -3 }, 0.1));
const mex = ENT.explode(mt);
check('mtext explodes to text lines', mex.length === mls.length && mex.every(t => t.type === 'text'));
ENT.stretch(mt, { x1: -1, y1: -1, x2: 1, y2: 1 }, { x: 5, y: 5 });
check('mtext stretches by insertion point', nearPt(mt.p, { x: 5, y: 5 }));
// dim precision
ENT.dimPrecision = 4;
ENT.units = 'decimal';
const pdim = makeEntity('dim', { dtype: 'linear-h', p1: { x: 0, y: 0 }, p2: { x: 10.12345, y: 0 }, p3: { x: 5, y: -5 } });
check('dim precision 4', ENT.dimGeometry(pdim).texts[0].text === '10.1235' || ENT.dimGeometry(pdim).texts[0].text === '10.1234');
ENT.dimPrecision = 2;

console.log('pdf');
const { PDF } = require('../js/pdf.js');
const pdoc = new (require('../js/document.js').CadDocument)();
pdoc.add(makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 100, y: 50 } }));
pdoc.add(makeEntity('circle', { c: { x: 50, y: 25 }, r: 20 }));
pdoc.add(makeEntity('text', { p: { x: 0, y: 60 }, text: 'Ø45° test (ok)', height: 5, rotation: 0 }));
pdoc.add(hatch);
pdoc.add(rdim);
const pdfStr = PDF.generate(pdoc, pdoc.bbox(), 'a4');
check('pdf header', pdfStr.startsWith('%PDF-1.4'));
check('pdf has stream + EOF', pdfStr.includes('stream') && pdfStr.trimEnd().endsWith('%%EOF'));
check('pdf is pure ASCII', [...pdfStr].every(ch => ch.charCodeAt(0) <= 127));
check('pdf escapes non-ascii text', pdfStr.includes('\\330')); // Ø in WinAnsi octal
const lenM = /\/Length (\d+)/.exec(pdfStr);
const sStart = pdfStr.indexOf('stream\n') + 'stream\n'.length;
const sEnd = pdfStr.indexOf('\nendstream');
check('pdf stream length correct', lenM && parseInt(lenM[1], 10) === sEnd - sStart);

console.log('dxf template parsing');
check('cleanText underline toggles', DXF.cleanText('\\LNOTES\\l1. A', true) === 'NOTES1. A');
check('cleanText unicode escape', DXF.cleanText('10\\U+2076', true) === '10\u2076');
check('cleanText fraction', DXF.cleanText('\\S1^2;', true) === '1/2');
check('cleanText font codes + para', DXF.cleanText('{\\fArial|b0;HI}\\PYO', true) === 'HI\nYO');
check('cleanText %% codes', DXF.cleanText('90%%d %%c12', false) === '90° Ø12');
// hatch loop walker: edge-type loop of 3 line edges
const loop = DXF._hatchLoop([
  [91, '1'], [92, '1'], [93, '3'],
  [72, '1'], [10, '0'], [20, '0'], [11, '1'], [21, '0'],
  [72, '1'], [10, '1'], [20, '0'], [11, '1'], [21, '1'],
  [72, '1'], [10, '1'], [20, '1'], [11, '0'], [21, '0'],
]);
check('hatch edge loop -> 3 pts', loop && loop.length === 3 && near(loop[1].x, 1));
// polyline-type loop
const ploop = DXF._hatchLoop([
  [91, '1'], [92, '7'], [72, '0'], [73, '1'], [93, '4'],
  [10, '0'], [20, '0'], [10, '2'], [20, '0'], [10, '2'], [20, '2'], [10, '0'], [20, '2'],
]);
check('hatch polyline loop -> 4 pts', ploop && ploop.length === 4 && near(ploop[2].y, 2));

console.log('document');
const doc = new CadDocument();
doc.add(makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 5, y: 5 } }));
doc.checkpoint();
doc.add(makeEntity('circle', { c: { x: 0, y: 0 }, r: 2 }));
check('two entities', doc.entities.length === 2);
doc.undo();
check('undo removes circle', doc.entities.length === 1);
doc.redo();
check('redo restores circle', doc.entities.length === 2);
doc.addLayer('walls');
check('layer added', !!doc.layer('walls'));
check('cannot delete layer 0', !doc.deleteLayer('0'));
const json = doc.toJSON();
const doc2 = new CadDocument();
doc2.loadJSON(JSON.parse(JSON.stringify(json)));
check('json roundtrip', doc2.entities.length === 2 && !!doc2.layer('walls'));

console.log('dxf');
const d3 = new CadDocument();
d3.addLayer('dims');
d3.add(makeEntity('line', { a: { x: 0, y: 0 }, b: { x: 100, y: 50 } }));
d3.add(makeEntity('circle', { c: { x: 10, y: 20 }, r: 7.5 }));
d3.add(makeEntity('arc', { c: { x: 0, y: 0 }, r: 5, a0: Math.PI / 6, a1: Math.PI } ));
d3.add(makeEntity('polyline', { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true }));
d3.add(makeEntity('point', { p: { x: 1, y: 2 } }));
d3.add(makeEntity('text', { p: { x: 5, y: 5 }, text: 'hello', height: 2.5, rotation: 0, layer: 'dims' }));
d3.add(makeEntity('dim', { dtype: 'aligned', p1: { x: 0, y: 0 }, p2: { x: 30, y: 40 }, p3: { x: 10, y: 30 } }));
const dxfText = DXF.exportDoc(d3);
check('dxf has EOF', /EOF/.test(dxfText));
const imp = DXF.importText(dxfText);
const byType = (t) => imp.entities.filter(e => e.type === t);
check('dxf line roundtrip', byType('line').length >= 1 && nearPt(byType('line')[0].a, { x: 0, y: 0 }));
check('dxf circle roundtrip', byType('circle').length === 1 && near(byType('circle')[0].r, 7.5));
const impArc = byType('arc')[0];
check('dxf arc roundtrip', impArc && near(impArc.a0, Math.PI / 6, 1e-4) && near(impArc.a1, Math.PI, 1e-4));
const impPl = byType('polyline')[0];
check('dxf polyline roundtrip', impPl && impPl.pts.length === 3 && impPl.closed === true);
check('dxf text roundtrip', byType('text').some(t => t.text === 'hello' && t.layer === 'dims'));
check('dxf point roundtrip', byType('point').length === 1);
check('dxf layers table', imp.layers.some(l => l.name === 'dims'));
// dim exported exploded => extra lines + a text with the measured value (50)
check('dxf dim exploded', byType('text').some(t => t.text === '50'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll tests passed.');
process.exit(failures ? 1 : 0);
