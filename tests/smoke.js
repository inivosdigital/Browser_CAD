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
