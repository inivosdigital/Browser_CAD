/* entities.js — entity model: plain serializable objects + operations keyed by type.
   Types: line {a,b} | circle {c,r} | arc {c,r,a0,a1} (CCW) | polyline {pts,closed}
          point {p} | text {p,text,height,rotation} | dim {dtype,p1,p2,p3} */
'use strict';

let _entSeq = 1;

function makeEntity(type, props) {
  return Object.assign({ id: _entSeq++, type, layer: '0', color: null }, props);
}
function setEntitySeq(n) { _entSeq = Math.max(_entSeq, n); }

const ENT = {

  clone(e) { return JSON.parse(JSON.stringify(e)); },

  /* ---- decomposition: every entity reduces to segments / arcs / circles ---- */

  // Returns { segs:[[a,b],...], arcs:[{c,r,a0,a1}], circles:[{c,r}] }
  prims(e) {
    const out = { segs: [], arcs: [], circles: [] };
    switch (e.type) {
      case 'line': out.segs.push([e.a, e.b]); break;
      case 'circle': out.circles.push({ c: e.c, r: e.r }); break;
      case 'arc': out.arcs.push({ c: e.c, r: e.r, a0: e.a0, a1: e.a1 }); break;
      case 'polyline': {
        const n = e.pts.length;
        for (let i = 0; i + 1 < n; i++) out.segs.push([e.pts[i], e.pts[i + 1]]);
        if (e.closed && n > 2) out.segs.push([e.pts[n - 1], e.pts[0]]);
        break;
      }
      case 'dim': {
        const g = ENT.dimGeometry(e);
        for (const l of g.lines) out.segs.push([l.a, l.b]);
        break;
      }
    }
    return out;
  },

  /* ---- bounding box ---- */

  bbox(e) {
    const b = GEO.bbEmpty();
    switch (e.type) {
      case 'line': GEO.bbAddPt(b, e.a); GEO.bbAddPt(b, e.b); break;
      case 'circle':
        GEO.bbAddPt(b, { x: e.c.x - e.r, y: e.c.y - e.r });
        GEO.bbAddPt(b, { x: e.c.x + e.r, y: e.c.y + e.r });
        break;
      case 'arc': {
        GEO.bbAddPt(b, GEO.polar(e.c, e.a0, e.r));
        GEO.bbAddPt(b, GEO.polar(e.c, e.a1, e.r));
        for (let q = 0; q < 4; q++) {
          const a = q * Math.PI / 2;
          if (GEO.angIn(a, e.a0, e.a1)) GEO.bbAddPt(b, GEO.polar(e.c, a, e.r));
        }
        break;
      }
      case 'polyline': for (const p of e.pts) GEO.bbAddPt(b, p); break;
      case 'point': GEO.bbAddPt(b, e.p); break;
      case 'text': {
        const w = (e.text ? e.text.length : 1) * e.height * 0.62;
        const cs = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: e.height }, { x: 0, y: e.height }];
        for (const c of cs) GEO.bbAddPt(b, GEO.rotPt(GEO.add(e.p, c), e.p, e.rotation || 0));
        break;
      }
      case 'dim': {
        const g = ENT.dimGeometry(e);
        for (const l of g.lines) { GEO.bbAddPt(b, l.a); GEO.bbAddPt(b, l.b); }
        for (const t of g.texts) GEO.bbAddPt(b, t.p);
        break;
      }
    }
    return b;
  },

  /* ---- hit test: distance from point to entity <= tol ---- */

  hitTest(e, p, tol) {
    switch (e.type) {
      case 'line': return GEO.distPtSeg(p, e.a, e.b) <= tol;
      case 'circle': return Math.abs(GEO.dist(p, e.c) - e.r) <= tol;
      case 'arc': {
        const a = GEO.ang(e.c, p);
        if (GEO.angIn(a, e.a0, e.a1)) return Math.abs(GEO.dist(p, e.c) - e.r) <= tol;
        return GEO.dist(p, GEO.polar(e.c, e.a0, e.r)) <= tol || GEO.dist(p, GEO.polar(e.c, e.a1, e.r)) <= tol;
      }
      case 'polyline': {
        const pr = ENT.prims(e);
        return pr.segs.some(s => GEO.distPtSeg(p, s[0], s[1]) <= tol);
      }
      case 'point': return GEO.dist(p, e.p) <= tol * 1.5;
      case 'text': {
        const b = GEO.bbPad(ENT.bbox(e), tol);
        return GEO.ptInRect(p, b);
      }
      case 'dim': {
        const g = ENT.dimGeometry(e);
        return g.lines.some(l => GEO.distPtSeg(p, l.a, l.b) <= tol) ||
          g.texts.some(t => GEO.dist(p, t.p) <= Math.max(tol, t.height));
      }
    }
    return false;
  },

  /* ---- object snap points ---- */

  snapPoints(e) {
    const out = [];
    const push = (pt, kind) => out.push({ pt, kind });
    switch (e.type) {
      case 'line':
        push(e.a, 'end'); push(e.b, 'end'); push(GEO.mid(e.a, e.b), 'mid');
        break;
      case 'circle':
        push(e.c, 'center');
        for (let q = 0; q < 4; q++) push(GEO.polar(e.c, q * Math.PI / 2, e.r), 'quad');
        break;
      case 'arc': {
        push(e.c, 'center');
        const p0 = GEO.polar(e.c, e.a0, e.r), p1 = GEO.polar(e.c, e.a1, e.r);
        push(p0, 'end'); push(p1, 'end');
        push(GEO.polar(e.c, e.a0 + GEO.sweep(e.a0, e.a1) / 2, e.r), 'mid');
        break;
      }
      case 'polyline': {
        for (const p of e.pts) push(p, 'end');
        const pr = ENT.prims(e);
        for (const s of pr.segs) push(GEO.mid(s[0], s[1]), 'mid');
        break;
      }
      case 'point': push(e.p, 'end'); break;
      case 'text': push(e.p, 'end'); break;
      case 'dim': {
        const g = ENT.dimGeometry(e);
        for (const l of g.lines) { push(l.a, 'end'); push(l.b, 'end'); }
        break;
      }
    }
    return out;
  },

  /* ---- intersections between two entities ---- */

  intersections(e1, e2) {
    const a = ENT.prims(e1), b = ENT.prims(e2);
    const out = [];
    const add = (p) => { if (p && !out.some(q => GEO.eq(q, p, 1e-6))) out.push(p); };
    const arcFilter = (arc, pts) => pts.filter(p => GEO.angIn(GEO.ang(arc.c, p), arc.a0, arc.a1, 1e-6));

    for (const s1 of a.segs) {
      for (const s2 of b.segs) add(GEO.segSeg(s1[0], s1[1], s2[0], s2[1]));
      for (const c of b.circles) GEO.segCircle(s1[0], s1[1], c.c, c.r).forEach(add);
      for (const ar of b.arcs) arcFilter(ar, GEO.segCircle(s1[0], s1[1], ar.c, ar.r)).forEach(add);
    }
    for (const c1 of a.circles) {
      for (const s2 of b.segs) GEO.segCircle(s2[0], s2[1], c1.c, c1.r).forEach(add);
      for (const c2 of b.circles) GEO.circleCircle(c1.c, c1.r, c2.c, c2.r).forEach(add);
      for (const ar of b.arcs) arcFilter(ar, GEO.circleCircle(c1.c, c1.r, ar.c, ar.r)).forEach(add);
    }
    for (const ar1 of a.arcs) {
      for (const s2 of b.segs) arcFilter(ar1, GEO.segCircle(s2[0], s2[1], ar1.c, ar1.r)).forEach(add);
      for (const c2 of b.circles) arcFilter(ar1, GEO.circleCircle(ar1.c, ar1.r, c2.c, c2.r)).forEach(add);
      for (const ar2 of b.arcs) arcFilter(ar1, arcFilter(ar2, GEO.circleCircle(ar1.c, ar1.r, ar2.c, ar2.r))).forEach(add);
    }
    return out;
  },

  /* ---- transforms ----
     xf = { pt(p)->p', ang(a)->a', scl: number, flip: bool } */

  xfTranslate(d) {
    return { pt: p => GEO.add(p, d), ang: a => a, scl: 1, flip: false };
  },
  xfRotate(c, ang) {
    return { pt: p => GEO.rotPt(p, c, ang), ang: a => GEO.normAng(a + ang), scl: 1, flip: false };
  },
  xfScale(c, f) {
    return { pt: p => GEO.scalePt(p, c, f), ang: a => a, scl: f, flip: false };
  },
  xfMirror(m1, m2) {
    return { pt: p => GEO.mirrorPt(p, m1, m2), ang: a => GEO.mirrorAng(a, m1, m2), scl: 1, flip: true };
  },

  transform(e, xf) {
    switch (e.type) {
      case 'line': e.a = xf.pt(e.a); e.b = xf.pt(e.b); break;
      case 'circle': e.c = xf.pt(e.c); e.r *= xf.scl; break;
      case 'arc': {
        e.c = xf.pt(e.c); e.r *= xf.scl;
        if (xf.flip) {
          const na0 = xf.ang(e.a1), na1 = xf.ang(e.a0);
          e.a0 = na0; e.a1 = na1;
        } else {
          e.a0 = xf.ang(e.a0); e.a1 = xf.ang(e.a1);
        }
        break;
      }
      case 'polyline': e.pts = e.pts.map(xf.pt); break;
      case 'point': e.p = xf.pt(e.p); break;
      case 'text':
        e.p = xf.pt(e.p);
        e.height *= xf.scl;
        if (!xf.flip) e.rotation = xf.ang(e.rotation || 0);
        break;
      case 'dim': e.p1 = xf.pt(e.p1); e.p2 = xf.pt(e.p2); e.p3 = xf.pt(e.p3); break;
    }
    return e;
  },
  transformed(e, xf) { return ENT.transform(ENT.clone(e), xf); },

  /* ---- selection rectangle test ---- */

  inRect(e, rect, crossing) {
    const b = ENT.bbox(e);
    if (!GEO.bbValid(b)) return false;
    if (!crossing) return GEO.bbContains(rect, b);
    if (!GEO.bbOverlap(rect, b)) return false;
    if (GEO.bbContains(rect, b)) return true;
    const pr = ENT.prims(e);
    for (const s of pr.segs) if (GEO.segTouchesRect(s[0], s[1], rect)) return true;
    const edges = GEO.rectCorners(rect);
    for (const c of pr.circles) {
      for (let i = 0; i < 4; i++) {
        if (GEO.segCircle(edges[i], edges[(i + 1) % 4], c.c, c.r).length) return true;
      }
    }
    for (const ar of pr.arcs) {
      for (let i = 0; i < 4; i++) {
        const pts = GEO.segCircle(edges[i], edges[(i + 1) % 4], ar.c, ar.r);
        if (pts.some(p => GEO.angIn(GEO.ang(ar.c, p), ar.a0, ar.a1, 1e-6))) return true;
      }
    }
    if (e.type === 'point' || e.type === 'text') return GEO.bbOverlap(rect, b);
    return false;
  },

  /* ---- dimension geometry ----
     dim: { dtype: 'linear-h' | 'linear-v' | 'aligned', p1, p2, p3 }
     p1/p2 = definition points, p3 = dimension line placement point. */

  DIM_TEXT: 2.5,
  DIM_ARROW: 2.5,
  DIM_EXT_GAP: 1.0,
  DIM_EXT_OVER: 1.2,

  dimValue(e) {
    if (e.dtype === 'linear-h') return Math.abs(e.p2.x - e.p1.x);
    if (e.dtype === 'linear-v') return Math.abs(e.p2.y - e.p1.y);
    return GEO.dist(e.p1, e.p2);
  },

  formatDim(v) {
    let s = v.toFixed(2);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  },

  // -> { lines:[{a,b}], texts:[{p,text,height,rotation}], arrows:[{p,ang}] }
  dimGeometry(e) {
    const g = { lines: [], texts: [], arrows: [] };
    let d1, d2; // ends of the dimension line
    if (e.dtype === 'linear-h') {
      d1 = { x: e.p1.x, y: e.p3.y }; d2 = { x: e.p2.x, y: e.p3.y };
    } else if (e.dtype === 'linear-v') {
      d1 = { x: e.p3.x, y: e.p1.y }; d2 = { x: e.p3.x, y: e.p2.y };
    } else {
      const dir = GEO.norm(GEO.sub(e.p2, e.p1));
      const n = GEO.perp(dir);
      const off = GEO.dot(GEO.sub(e.p3, e.p1), n);
      d1 = GEO.add(e.p1, GEO.mul(n, off));
      d2 = GEO.add(e.p2, GEO.mul(n, off));
    }
    // extension lines (with gap at definition point, overshoot past dim line)
    for (const [defPt, dimPt] of [[e.p1, d1], [e.p2, d2]]) {
      const L = GEO.dist(defPt, dimPt);
      if (L > ENT.DIM_EXT_GAP + 1e-9) {
        const u = GEO.norm(GEO.sub(dimPt, defPt));
        g.lines.push({ a: GEO.add(defPt, GEO.mul(u, ENT.DIM_EXT_GAP)), b: GEO.add(dimPt, GEO.mul(u, ENT.DIM_EXT_OVER)) });
      }
    }
    g.lines.push({ a: d1, b: d2 });
    const lineAng = GEO.ang(d1, d2);
    // arrow `ang` = world direction from tip toward barbs (i.e. inward along the dim line)
    g.arrows.push({ p: d1, ang: lineAng });
    g.arrows.push({ p: d2, ang: lineAng + Math.PI });
    let ta = lineAng;
    if (ta > Math.PI / 2 + 1e-9 || ta < -Math.PI / 2 - 1e-9) ta += Math.PI; // keep text readable
    const mid = GEO.mid(d1, d2);
    const up = { x: Math.cos(ta + Math.PI / 2), y: Math.sin(ta + Math.PI / 2) };
    g.texts.push({
      p: GEO.add(mid, GEO.mul(up, ENT.DIM_TEXT * 0.45)),
      text: ENT.formatDim(ENT.dimValue(e)),
      height: ENT.DIM_TEXT,
      rotation: ta,
      align: 'center',
    });
    return g;
  },

  /* ---- explode: returns array of replacement entities, or null ---- */

  explode(e) {
    if (e.type === 'polyline') {
      const pr = ENT.prims(e);
      return pr.segs.map(s => makeEntity('line', { a: s[0], b: s[1], layer: e.layer, color: e.color }));
    }
    if (e.type === 'dim') {
      const g = ENT.dimGeometry(e);
      const out = g.lines.map(l => makeEntity('line', { a: l.a, b: l.b, layer: e.layer, color: e.color }));
      for (const ar of g.arrows) {
        const tip = ar.p;
        const b1 = GEO.polar(tip, ar.ang + 0.16, ENT.DIM_ARROW);
        const b2 = GEO.polar(tip, ar.ang - 0.16, ENT.DIM_ARROW);
        out.push(makeEntity('line', { a: tip, b: b1, layer: e.layer, color: e.color }));
        out.push(makeEntity('line', { a: tip, b: b2, layer: e.layer, color: e.color }));
      }
      for (const t of g.texts) {
        out.push(makeEntity('text', { p: t.p, text: t.text, height: t.height, rotation: t.rotation, layer: e.layer, color: e.color }));
      }
      return out;
    }
    return null;
  },

  /* ---- summary line for the properties panel / status ---- */

  describe(e) {
    switch (e.type) {
      case 'line': return 'Line';
      case 'circle': return 'Circle';
      case 'arc': return 'Arc';
      case 'polyline': return e.closed ? 'Polyline (closed)' : 'Polyline';
      case 'point': return 'Point';
      case 'text': return 'Text';
      case 'dim': return 'Dimension';
    }
    return e.type;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { ENT, makeEntity, setEntitySeq };
