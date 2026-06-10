/* entities.js — entity model: plain serializable objects + operations keyed by type.
   Types: line {a,b} | circle {c,r} | arc {c,r,a0,a1} (CCW) | polyline {pts,closed}
          point {p} | text {p,text,height,rotation}
          dim {dtype,p1,p2,p3[,p4]}  dtype: linear-h | linear-v | aligned |
                                            radius | diameter | angular
          hatch {boundary:{kind:'poly',pts}|{kind:'circle',c,r}, pattern, spacing, angle}
          insert {name, p, scale, rotation}  (block reference)
          ellipse {c, rx, ry, rot} | leader {pts, text, height}
          mtext {p (top-left), width, text, height}  (word-wrapped multiline)
          viewport {p (bottom-left, paper in), w, h, center (model), scale (paper/model)}
            — paper-space only; renders a window into model space */
'use strict';

let _entSeq = 1;

function makeEntity(type, props) {
  return Object.assign({ id: _entSeq++, type, layer: '0', color: null }, props);
}
function setEntitySeq(n) { _entSeq = Math.max(_entSeq, n); }
function nextEntityId() { return _entSeq++; }

const ENT = {

  clone(e) { return JSON.parse(JSON.stringify(e)); },

  // Set by the app to look up block definitions: (name) => {name, base, entities}
  blockResolver: null,

  // Parametric point on an ellipse at angle t (relative to its own axes).
  ellipsePt(e, t) {
    const co = Math.cos(e.rot || 0), si = Math.sin(e.rot || 0);
    const x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
    return { x: e.c.x + x * co - y * si, y: e.c.y + x * si + y * co };
  },
  ellipseSample(e, n) {
    const pts = [];
    const N = n || 64;
    for (let i = 0; i < N; i++) pts.push(ENT.ellipsePt(e, i * 2 * Math.PI / N));
    return pts;
  },

  // Children of a block reference, transformed into world space.
  resolvedChildren(e) {
    const blk = ENT.blockResolver && ENT.blockResolver(e.name);
    if (!blk) return [];
    const base = blk.base;
    const sc = ENT.xfScale(base, e.scale == null ? 1 : e.scale);
    const ro = ENT.xfRotate(base, e.rotation || 0);
    const tr = ENT.xfTranslate(GEO.sub(e.p, base));
    return blk.entities.map(ch => {
      const c = ENT.clone(ch);
      ENT.transform(c, sc);
      ENT.transform(c, ro);
      ENT.transform(c, tr);
      return c;
    });
  },

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
        for (const a of g.arcs) out.arcs.push(a);
        break;
      }
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') out.circles.push({ c: b.c, r: b.r });
        else {
          const n = b.pts.length;
          for (let i = 0; i < n; i++) out.segs.push([b.pts[i], b.pts[(i + 1) % n]]);
        }
        break;
      }
      case 'insert': {
        for (const ch of ENT.resolvedChildren(e)) {
          const pr = ENT.prims(ch);
          out.segs.push(...pr.segs);
          out.arcs.push(...pr.arcs);
          out.circles.push(...pr.circles);
        }
        break;
      }
      case 'ellipse': {
        const pts = ENT.ellipseSample(e);
        for (let i = 0; i < pts.length; i++) out.segs.push([pts[i], pts[(i + 1) % pts.length]]);
        break;
      }
      case 'leader': {
        for (let i = 0; i + 1 < e.pts.length; i++) out.segs.push([e.pts[i], e.pts[i + 1]]);
        break;
      }
      case 'viewport': {
        const c = ENT.viewportCorners(e);
        for (let i = 0; i < 4; i++) out.segs.push([c[i], c[(i + 1) % 4]]);
        break;
      }
    }
    return out;
  },

  viewportCorners(e) {
    return [
      { x: e.p.x, y: e.p.y }, { x: e.p.x + e.w, y: e.p.y },
      { x: e.p.x + e.w, y: e.p.y + e.h }, { x: e.p.x, y: e.p.y + e.h },
    ];
  },
  viewportPaperCenter(e) { return { x: e.p.x + e.w / 2, y: e.p.y + e.h / 2 }; },
  // transform that maps model coords into this viewport's paper coords
  viewportXf(e) {
    const pc = ENT.viewportPaperCenter(e);
    return {
      pt: (m) => ({ x: pc.x + (m.x - e.center.x) * e.scale, y: pc.y + (m.y - e.center.y) * e.scale }),
      ang: (a) => a,
      scl: e.scale,
      flip: false,
    };
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
        const x0 = e.align === 'center' ? -w / 2 : (e.align === 'right' ? -w : 0);
        const cs = [{ x: x0, y: 0 }, { x: x0 + w, y: 0 }, { x: x0 + w, y: e.height }, { x: x0, y: e.height }];
        for (const c of cs) GEO.bbAddPt(b, GEO.rotPt(GEO.add(e.p, c), e.p, e.rotation || 0));
        break;
      }
      case 'dim': {
        const g = ENT.dimGeometry(e);
        for (const l of g.lines) { GEO.bbAddPt(b, l.a); GEO.bbAddPt(b, l.b); }
        for (const t of g.texts) GEO.bbAddPt(b, t.p);
        for (const a of g.arcs) {
          GEO.bbAddPt(b, { x: a.c.x - a.r, y: a.c.y - a.r });
          GEO.bbAddPt(b, { x: a.c.x + a.r, y: a.c.y + a.r });
        }
        break;
      }
      case 'hatch': {
        const bd = e.boundary;
        if (bd.kind === 'circle') {
          GEO.bbAddPt(b, { x: bd.c.x - bd.r, y: bd.c.y - bd.r });
          GEO.bbAddPt(b, { x: bd.c.x + bd.r, y: bd.c.y + bd.r });
        } else for (const p of bd.pts) GEO.bbAddPt(b, p);
        break;
      }
      case 'insert': {
        for (const ch of ENT.resolvedChildren(e)) {
          const cb = ENT.bbox(ch);
          if (GEO.bbValid(cb)) { GEO.bbAddPt(b, { x: cb.x1, y: cb.y1 }); GEO.bbAddPt(b, { x: cb.x2, y: cb.y2 }); }
        }
        if (!GEO.bbValid(b)) GEO.bbAddPt(b, e.p);
        break;
      }
      case 'ellipse': {
        const co = Math.cos(e.rot || 0), si = Math.sin(e.rot || 0);
        const hw = Math.hypot(e.rx * co, e.ry * si);
        const hh = Math.hypot(e.rx * si, e.ry * co);
        GEO.bbAddPt(b, { x: e.c.x - hw, y: e.c.y - hh });
        GEO.bbAddPt(b, { x: e.c.x + hw, y: e.c.y + hh });
        break;
      }
      case 'leader': {
        for (const p of e.pts) GEO.bbAddPt(b, p);
        const w = (e.text ? e.text.length : 1) * e.height * 0.62;
        const last = e.pts[e.pts.length - 1];
        GEO.bbAddPt(b, { x: last.x + w + e.height, y: last.y + e.height });
        GEO.bbAddPt(b, { x: last.x - w - e.height, y: last.y - e.height });
        break;
      }
      case 'mtext': {
        const lines = ENT.mtextLines(e);
        GEO.bbAddPt(b, e.p);
        GEO.bbAddPt(b, { x: e.p.x + e.width, y: e.p.y - lines.length * ENT.MTEXT_LS * e.height });
        break;
      }
      case 'viewport':
        GEO.bbAddPt(b, e.p);
        GEO.bbAddPt(b, { x: e.p.x + e.w, y: e.p.y + e.h });
        break;
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
          g.arcs.some(a => GEO.angIn(GEO.ang(a.c, p), a.a0, a.a1) && Math.abs(GEO.dist(p, a.c) - a.r) <= tol) ||
          g.texts.some(t => GEO.dist(p, t.p) <= Math.max(tol, t.height));
      }
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') return GEO.dist(p, b.c) <= b.r + tol;
        return GEO.ptInPoly(p, b.pts) ||
          b.pts.some((q, i) => GEO.distPtSeg(p, q, b.pts[(i + 1) % b.pts.length]) <= tol);
      }
      case 'insert':
        return ENT.resolvedChildren(e).some(ch => ENT.hitTest(ch, p, tol));
      case 'ellipse': {
        const pr = ENT.prims(e);
        return pr.segs.some(sg => GEO.distPtSeg(p, sg[0], sg[1]) <= tol);
      }
      case 'leader': {
        for (let i = 0; i + 1 < e.pts.length; i++) {
          if (GEO.distPtSeg(p, e.pts[i], e.pts[i + 1]) <= tol) return true;
        }
        const last = e.pts[e.pts.length - 1];
        return GEO.dist(p, last) <= Math.max(tol, (e.text ? e.text.length : 1) * e.height * 0.4);
      }
      case 'mtext':
        return GEO.ptInRect(p, GEO.bbPad(ENT.bbox(e), tol));
      case 'viewport': {
        // frame-only hit so clicks inside the window don't grab the viewport
        const c = ENT.viewportCorners(e);
        for (let i = 0; i < 4; i++) {
          if (GEO.distPtSeg(p, c[i], c[(i + 1) % 4]) <= tol) return true;
        }
        return false;
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
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') {
          push(b.c, 'center');
          for (let q = 0; q < 4; q++) push(GEO.polar(b.c, q * Math.PI / 2, b.r), 'quad');
        } else for (const p of b.pts) push(p, 'end');
        break;
      }
      case 'insert':
        push(e.p, 'end');
        for (const ch of ENT.resolvedChildren(e)) out.push(...ENT.snapPoints(ch));
        break;
      case 'ellipse':
        push(e.c, 'center');
        for (let q = 0; q < 4; q++) push(ENT.ellipsePt(e, q * Math.PI / 2), 'quad');
        break;
      case 'leader':
        for (const p of e.pts) push(p, 'end');
        break;
      case 'mtext':
        push(e.p, 'end');
        push({ x: e.p.x + e.width, y: e.p.y }, 'end');
        break;
      case 'viewport':
        for (const c of ENT.viewportCorners(e)) push(c, 'end');
        push(ENT.viewportPaperCenter(e), 'center');
        break;
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
      case 'dim':
        e.p1 = xf.pt(e.p1); e.p2 = xf.pt(e.p2); e.p3 = xf.pt(e.p3);
        if (e.p4) e.p4 = xf.pt(e.p4);
        break;
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') { b.c = xf.pt(b.c); b.r *= xf.scl; }
        else b.pts = b.pts.map(xf.pt);
        e.spacing *= xf.scl;
        e.angle = xf.ang(e.angle || 0);
        break;
      }
      case 'insert':
        // mirroring a block reference is approximated (position/rotation only)
        e.p = xf.pt(e.p);
        e.scale = (e.scale == null ? 1 : e.scale) * xf.scl;
        e.rotation = xf.ang(e.rotation || 0);
        break;
      case 'ellipse':
        e.c = xf.pt(e.c);
        e.rx *= xf.scl;
        e.ry *= xf.scl;
        e.rot = xf.ang(e.rot || 0);
        break;
      case 'leader':
        e.pts = e.pts.map(xf.pt);
        e.height *= xf.scl;
        break;
      case 'mtext': // rotation is not supported; box stays axis-aligned
        e.p = xf.pt(e.p);
        e.width *= xf.scl;
        e.height *= xf.scl;
        break;
      case 'viewport': // axis-aligned; rotation ignored
        e.p = xf.pt(e.p);
        e.w *= xf.scl;
        e.h *= xf.scl;
        break;
    }
    return e;
  },
  transformed(e, xf) { return ENT.transform(ENT.clone(e), xf); },

  /* ---- grips: draggable defining points. apply() sets from an absolute point ---- */

  grips(e) {
    const g = [];
    const add = (pt, apply) => g.push({ pt: { ...pt }, apply });
    switch (e.type) {
      case 'line':
        add(e.a, p => { e.a = { ...p }; });
        add(e.b, p => { e.b = { ...p }; });
        add(GEO.mid(e.a, e.b), p => {
          const d = GEO.sub(p, GEO.mid(e.a, e.b));
          e.a = GEO.add(e.a, d); e.b = GEO.add(e.b, d);
        });
        break;
      case 'circle':
        add(e.c, p => { e.c = { ...p }; });
        for (let q = 0; q < 4; q++) {
          add(GEO.polar(e.c, q * Math.PI / 2, e.r), p => {
            const r = GEO.dist(e.c, p);
            if (r > 1e-9) e.r = r;
          });
        }
        break;
      case 'arc':
        add(e.c, p => { e.c = { ...p }; });
        add(GEO.polar(e.c, e.a0, e.r), p => { e.a0 = GEO.normAng(GEO.ang(e.c, p)); });
        add(GEO.polar(e.c, e.a1, e.r), p => { e.a1 = GEO.normAng(GEO.ang(e.c, p)); });
        add(GEO.polar(e.c, e.a0 + GEO.sweep(e.a0, e.a1) / 2, e.r), p => {
          const r = GEO.dist(e.c, p);
          if (r > 1e-9) e.r = r;
        });
        break;
      case 'polyline':
        e.pts.forEach((pt, i) => add(pt, p => { e.pts[i] = { ...p }; }));
        break;
      case 'point': add(e.p, p => { e.p = { ...p }; }); break;
      case 'text': add(e.p, p => { e.p = { ...p }; }); break;
      case 'dim':
        add(e.p1, p => { e.p1 = { ...p }; });
        add(e.p2, p => { e.p2 = { ...p }; });
        add(e.p3, p => { e.p3 = { ...p }; });
        if (e.p4) add(e.p4, p => { e.p4 = { ...p }; });
        break;
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') add(b.c, p => { b.c = { ...p }; });
        else b.pts.forEach((pt, i) => add(pt, p => { b.pts[i] = { ...p }; }));
        break;
      }
      case 'insert': add(e.p, p => { e.p = { ...p }; }); break;
      case 'ellipse':
        add(e.c, p => { e.c = { ...p }; });
        add(ENT.ellipsePt(e, 0), p => { const r = GEO.dist(e.c, p); if (r > 1e-9) e.rx = r; });
        add(ENT.ellipsePt(e, Math.PI / 2), p => { const r = GEO.dist(e.c, p); if (r > 1e-9) e.ry = r; });
        break;
      case 'leader':
        e.pts.forEach((pt, i) => add(pt, p => { e.pts[i] = { ...p }; }));
        break;
      case 'mtext':
        add(e.p, p => { e.p = { ...p }; });
        add({ x: e.p.x + e.width, y: e.p.y }, p => {
          const w = p.x - e.p.x;
          if (w > e.height) e.width = w;
        });
        break;
      case 'viewport': {
        const c = ENT.viewportCorners(e);
        add(c[0], p => { const x2 = e.p.x + e.w, y2 = e.p.y + e.h; e.p = { ...p }; e.w = Math.max(0.1, x2 - p.x); e.h = Math.max(0.1, y2 - p.y); });
        add(c[2], p => { e.w = Math.max(0.1, p.x - e.p.x); e.h = Math.max(0.1, p.y - e.p.y); });
        add(ENT.viewportPaperCenter(e), p => { e.p = { x: p.x - e.w / 2, y: p.y - e.h / 2 }; });
        break;
      }
    }
    return g;
  },

  /* ---- stretch: move only the defining points inside the crossing rect ---- */

  stretch(e, rect, d) {
    const mv = (p) => (GEO.ptInRect(p, rect) ? GEO.add(p, d) : p);
    switch (e.type) {
      case 'line': e.a = mv(e.a); e.b = mv(e.b); break;
      case 'circle': case 'arc': e.c = mv(e.c); break;
      case 'ellipse': e.c = mv(e.c); break;
      case 'polyline': e.pts = e.pts.map(mv); break;
      case 'leader': e.pts = e.pts.map(mv); break;
      case 'point': e.p = mv(e.p); break;
      case 'text': e.p = mv(e.p); break;
      case 'mtext': e.p = mv(e.p); break;
      case 'viewport': e.p = mv(e.p); break;
      case 'insert': e.p = mv(e.p); break;
      case 'dim':
        e.p1 = mv(e.p1); e.p2 = mv(e.p2); e.p3 = mv(e.p3);
        if (e.p4) e.p4 = mv(e.p4);
        break;
      case 'hatch': {
        const b = e.boundary;
        if (b.kind === 'circle') b.c = mv(b.c);
        else b.pts = b.pts.map(mv);
        break;
      }
    }
    return e;
  },

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
    if (e.type === 'point' || e.type === 'text' || e.type === 'mtext') return GEO.bbOverlap(rect, b);
    return false;
  },

  /* ---- dimension geometry ----
     dim: { dtype: 'linear-h' | 'linear-v' | 'aligned', p1, p2, p3 }
     p1/p2 = definition points, p3 = dimension line placement point. */

  // dimension style (synced from doc.settings.dimStyle by the app)
  DIM_TEXT: 2.5,
  DIM_ARROW: 2.5,
  DIM_EXT_GAP: 1.0,
  DIM_EXT_OVER: 1.2,
  dimPrecision: 2,

  dimValue(e) {
    switch (e.dtype) {
      case 'linear-h': return Math.abs(e.p2.x - e.p1.x);
      case 'linear-v': return Math.abs(e.p2.y - e.p1.y);
      case 'radius': return GEO.dist(e.p1, e.p2);
      case 'diameter': return 2 * GEO.dist(e.p1, e.p2);
      case 'angular': return ENT._angularSweep(e) * 180 / Math.PI;
      default: return GEO.dist(e.p1, e.p2);
    }
  },

  // angular dim: CCW arc between rays p1->p2 and p1->p3, on the side of p4
  _angularSpan(e) {
    const aA = GEO.ang(e.p1, e.p2), aB = GEO.ang(e.p1, e.p3), aP = GEO.ang(e.p1, e.p4);
    return GEO.angIn(aP, aA, aB) ? [aA, aB] : [aB, aA];
  },
  _angularSweep(e) {
    const [a0, a1] = ENT._angularSpan(e);
    return GEO.sweep(a0, a1);
  },

  // display units for dimension text: 'decimal' | 'architectural' (synced from doc settings)
  units: 'decimal',

  formatNum(v, prec) {
    let s = (+v).toFixed(prec == null ? 2 : prec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  },

  formatDim(v) {
    if (ENT.units === 'architectural' && typeof UNITS !== 'undefined') {
      return UNITS.formatLength(v, 'architectural');
    }
    return ENT.formatNum(v, ENT.dimPrecision);
  },

  // -> { lines:[{a,b}], arcs:[{c,r,a0,a1}], texts:[{p,text,height,rotation}], arrows:[{p,ang}] }
  // arrow `ang` = world direction from tip toward barbs
  // e.$text (transient, set on viewport plot clones) overrides the measured text
  dimGeometry(e) {
    const g = { lines: [], arcs: [], texts: [], arrows: [] };

    if (e.dtype === 'radius' || e.dtype === 'diameter') {
      const c = e.p1, rim = e.p2;
      const lead = GEO.ang(e.p3, rim);
      g.lines.push({ a: e.p3, b: rim });
      g.arrows.push({ p: rim, ang: lead + Math.PI });
      if (e.dtype === 'diameter') {
        const rim2 = { x: 2 * c.x - rim.x, y: 2 * c.y - rim.y };
        g.lines.push({ a: rim, b: rim2 });
        g.arrows.push({ p: rim2, ang: lead });
      }
      const prefix = e.dtype === 'radius' ? 'R' : 'Ø';
      const side = e.p3.x >= rim.x ? 1 : -1;
      g.texts.push({
        p: GEO.add(e.p3, { x: side * ENT.DIM_TEXT * 0.4, y: -ENT.DIM_TEXT * 0.35 }),
        text: e.$text != null ? e.$text : prefix + ENT.formatDim(ENT.dimValue(e)),
        height: ENT.DIM_TEXT,
        rotation: 0,
        align: side >= 0 ? 'left' : 'right',
      });
      return g;
    }

    if (e.dtype === 'angular') {
      const [a0, a1] = ENT._angularSpan(e);
      const r = Math.max(GEO.dist(e.p1, e.p4), ENT.DIM_TEXT);
      g.arcs.push({ c: e.p1, r, a0: GEO.normAng(a0), a1: GEO.normAng(a1) });
      // extension lines from vertex out to the arc along each ray
      for (const a of [a0, a1]) {
        g.lines.push({ a: GEO.polar(e.p1, a, Math.max(r * 0.25, ENT.DIM_EXT_GAP)), b: GEO.polar(e.p1, a, r + ENT.DIM_EXT_OVER) });
      }
      // arrows tangent to the arc at its ends, barbs pointing into the arc
      g.arrows.push({ p: GEO.polar(e.p1, a0, r), ang: a0 + Math.PI / 2 });
      g.arrows.push({ p: GEO.polar(e.p1, a1, r), ang: a1 - Math.PI / 2 });
      const amid = a0 + GEO.sweep(a0, a1) / 2;
      g.texts.push({
        p: GEO.polar(e.p1, amid, r + ENT.DIM_TEXT * 1.2),
        text: e.$text != null ? e.$text : ENT.formatNum(ENT.dimValue(e)) + '°', // angles stay decimal degrees
        height: ENT.DIM_TEXT,
        rotation: 0,
        align: 'center',
      });
      return g;
    }

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
      text: e.$text != null ? e.$text : ENT.formatDim(ENT.dimValue(e)),
      height: ENT.DIM_TEXT,
      rotation: ta,
      align: 'center',
    });
    return g;
  },

  /* ---- leader geometry: arrow + text placement ---- */

  leaderGeometry(e) {
    const g = { lines: [], arrows: [], texts: [] };
    for (let i = 0; i + 1 < e.pts.length; i++) g.lines.push({ a: e.pts[i], b: e.pts[i + 1] });
    if (e.pts.length >= 2) g.arrows.push({ p: e.pts[0], ang: GEO.ang(e.pts[0], e.pts[1]) });
    const last = e.pts[e.pts.length - 1];
    const prev = e.pts.length >= 2 ? e.pts[e.pts.length - 2] : last;
    const goingRight = last.x >= prev.x - 1e-9;
    g.texts.push({
      p: { x: last.x + (goingRight ? 1 : -1) * e.height * 0.5, y: last.y - e.height * 0.35 },
      text: e.text || '',
      height: e.height,
      rotation: 0,
      align: goingRight ? 'left' : 'right',
    });
    return g;
  },

  /* ---- mtext: deterministic word wrap (approx char width, headless-safe) ---- */

  MTEXT_LS: 1.6, // line spacing factor

  mtextLines(e) {
    const charW = Math.max(e.height * 0.6, 1e-9);
    const maxChars = Math.max(1, Math.floor(e.width / charW));
    const out = [];
    for (const para of String(e.text || '').split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let cur = '';
      for (let w of words) {
        if ((cur ? cur.length + 1 + w.length : w.length) <= maxChars) {
          cur = cur ? cur + ' ' + w : w;
        } else {
          if (cur) out.push(cur);
          while (w.length > maxChars) { out.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
          cur = w;
        }
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [''];
  },

  /* ---- explode: returns array of replacement entities, or null ---- */

  explode(e) {
    if (e.type === 'polyline') {
      const pr = ENT.prims(e);
      return pr.segs.map(s => makeEntity('line', { a: s[0], b: s[1], layer: e.layer, color: e.color }));
    }
    if (e.type === 'hatch') {
      const b = e.boundary;
      if (b.kind === 'circle') return [makeEntity('circle', { c: { ...b.c }, r: b.r, layer: e.layer, color: e.color })];
      return [makeEntity('polyline', { pts: b.pts.map(p => ({ ...p })), closed: true, layer: e.layer, color: e.color })];
    }
    if (e.type === 'insert') {
      return ENT.resolvedChildren(e).map(ch => {
        ch.id = nextEntityId();
        return ch;
      });
    }
    if (e.type === 'ellipse') {
      return [makeEntity('polyline', { pts: ENT.ellipseSample(e, 96), closed: true, layer: e.layer, color: e.color })];
    }
    if (e.type === 'mtext') {
      const lines = ENT.mtextLines(e);
      return lines.filter(t => t).map((t, i) => makeEntity('text', {
        p: { x: e.p.x, y: e.p.y - (i + 1) * ENT.MTEXT_LS * e.height + e.height * 0.45 },
        text: t, height: e.height, rotation: 0, layer: e.layer, color: e.color,
      }));
    }
    if (e.type === 'leader') {
      const g = ENT.leaderGeometry(e);
      const out = g.lines.map(l => makeEntity('line', { a: { ...l.a }, b: { ...l.b }, layer: e.layer, color: e.color }));
      for (const ar of g.arrows) {
        out.push(makeEntity('line', { a: { ...ar.p }, b: GEO.polar(ar.p, ar.ang + 0.16, ENT.DIM_ARROW), layer: e.layer, color: e.color }));
        out.push(makeEntity('line', { a: { ...ar.p }, b: GEO.polar(ar.p, ar.ang - 0.16, ENT.DIM_ARROW), layer: e.layer, color: e.color }));
      }
      for (const t of g.texts) {
        if (t.text) out.push(makeEntity('text', { p: t.p, text: t.text, height: t.height, rotation: 0, layer: e.layer, color: e.color }));
      }
      return out;
    }
    if (e.type === 'dim') {
      const g = ENT.dimGeometry(e);
      const out = g.lines.map(l => makeEntity('line', { a: l.a, b: l.b, layer: e.layer, color: e.color }));
      for (const a of g.arcs) {
        out.push(makeEntity('arc', { c: { ...a.c }, r: a.r, a0: a.a0, a1: a.a1, layer: e.layer, color: e.color }));
      }
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
      case 'hatch': return `Hatch (${e.pattern})`;
      case 'insert': return `Block "${e.name}"`;
      case 'ellipse': return 'Ellipse';
      case 'leader': return 'Leader';
      case 'mtext': return 'MText';
      case 'viewport': return `Viewport (${typeof UNITS !== 'undefined' ? UNITS.scaleLabel(1 / e.scale) : e.scale})`;
    }
    return e.type;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { ENT, makeEntity, setEntitySeq, nextEntityId };
