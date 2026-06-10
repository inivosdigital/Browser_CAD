/* pdf.js — minimal vector PDF writer for plotting drawings. Pure ASCII output
   (non-ASCII text chars are emitted as WinAnsi octal escapes), so the result
   can be downloaded as a Blob of the returned string byte-for-byte. */
'use strict';

const PDF = {

  PAPER: {
    a4: [595.28, 841.89],
    a3: [841.89, 1190.55],
    letter: [612, 792],
  },
  MARGIN: 28, // pt

  // dash patterns (pt) per layer linetype
  LTYPES: {
    continuous: [],
    dashed: [6, 3],
    hidden: [3, 2],
    center: [12, 3, 3, 3],
    dot: [0.5, 3],
  },

  /* Generate a PDF (string of bytes <= 0x7F) plotting `rect` of the document.
     fixedScale: paper-inches per drawing-inch (e.g. 1/48 for 1/4" = 1'-0"), or null = fit. */
  generate(doc, rect, paper, fixedScale) {
    let [pw, ph] = PDF.PAPER[paper] || PDF.PAPER.a4;
    const bw = Math.max(rect.x2 - rect.x1, 1e-9);
    const bh = Math.max(rect.y2 - rect.y1, 1e-9);
    if ((bw > bh) !== (pw > ph)) { const t = pw; pw = ph; ph = t; } // auto-orient

    const m = PDF.MARGIN;
    const scale = fixedScale ? fixedScale * 72 : Math.min((pw - 2 * m) / bw, (ph - 2 * m) / bh);
    const ox = (pw - bw * scale) / 2 - rect.x1 * scale;
    const oy = (ph - bh * scale) / 2 - rect.y1 * scale;
    const X = (x) => +(x * scale + ox).toFixed(2);
    const Y = (y) => +(y * scale + oy).toFixed(2);

    const out = [];
    const w = (s) => out.push(s);
    const color = (hex) => {
      const mm = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
      let r = 0, g = 0, b = 0;
      if (mm) {
        const v = parseInt(mm[1], 16);
        r = (v >> 16) & 255; g = (v >> 8) & 255; b = v & 255;
      }
      if (r > 235 && g > 235 && b > 235) { r = g = b = 0; } // white ink -> black on paper
      return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
    };

    w('0.6 w 1 J 1 j');

    const moveTo = (p) => w(`${X(p.x)} ${Y(p.y)} m`);
    const lineTo = (p) => w(`${X(p.x)} ${Y(p.y)} l`);
    const seg = (a, b) => { moveTo(a); lineTo(b); };

    // arc as cubic beziers, CCW from a0 through `sweep`
    const arcPath = (c, r, a0, sweep, startWithMove) => {
      const nseg = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
      const d = sweep / nseg;
      const k = (4 / 3) * Math.tan(d / 4);
      let a = a0;
      let p0 = GEO.polar(c, a, r);
      if (startWithMove) moveTo(p0);
      for (let i = 0; i < nseg; i++) {
        const a1 = a + d;
        const p3 = GEO.polar(c, a1, r);
        const t0 = { x: -Math.sin(a), y: Math.cos(a) };
        const t1 = { x: -Math.sin(a1), y: Math.cos(a1) };
        const c1 = { x: p0.x + t0.x * k * r, y: p0.y + t0.y * k * r };
        const c2 = { x: p3.x - t1.x * k * r, y: p3.y - t1.y * k * r };
        w(`${X(c1.x)} ${Y(c1.y)} ${X(c2.x)} ${Y(c2.y)} ${X(p3.x)} ${Y(p3.y)} c`);
        a = a1;
        p0 = p3;
      }
    };

    // common Unicode punctuation -> WinAnsi byte codes
    const WINANSI = {
      0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92,
      0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2026: 0x85, 0x20AC: 0x80,
    };
    const escText = (s) => {
      let r = '';
      for (const ch of String(s)) {
        let code = ch.charCodeAt(0);
        if (WINANSI[code]) code = WINANSI[code];
        if (ch === '(' || ch === ')' || ch === '\\') r += '\\' + ch;
        else if (code >= 32 && code < 127) r += String.fromCharCode(code);
        else if (code <= 255) r += '\\' + code.toString(8).padStart(3, '0'); // WinAnsi range
        else r += '?';
      }
      return r;
    };

    const text = (p, str, height, rotation, align) => {
      const size = Math.max(height * scale, 1);
      const cos = Math.cos(rotation || 0), sin = Math.sin(rotation || 0);
      let anchor = p;
      const width = String(str).length * size * 0.5; // Helvetica approx
      if (align === 'center') anchor = GEO.add(p, GEO.polar({ x: 0, y: 0 }, (rotation || 0) + Math.PI, width / 2 / scale));
      else if (align === 'right') anchor = GEO.add(p, GEO.polar({ x: 0, y: 0 }, (rotation || 0) + Math.PI, width / scale));
      w('BT');
      w(`/F1 ${size.toFixed(2)} Tf`);
      w(`${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ${X(anchor.x)} ${Y(anchor.y)} Tm`);
      w(`(${escText(str)}) Tj`);
      w('ET');
    };

    const arrow = (tip, ang) => {
      const L = ENT.DIM_ARROW;
      const b1 = GEO.polar(tip, ang + 0.16, L);
      const b2 = GEO.polar(tip, ang - 0.16, L);
      w(`${X(tip.x)} ${Y(tip.y)} m ${X(b1.x)} ${Y(b1.y)} l ${X(b2.x)} ${Y(b2.y)} l h f`);
    };

    const drawEntity = (e, inkOverride) => {
      const ink = inkOverride || color(PDF._entityColor(doc, e));
      const ly = doc.layer(e.layer);
      const dash = (ly && PDF.LTYPES[ly.ltype]) || [];
      const lw = 0.6 * (ly && ly.lweight ? ly.lweight : 1);
      w(`${ink} RG ${ink} rg`);
      w(`${lw.toFixed(2)} w [${dash.join(' ')}] 0 d`);
      switch (e.type) {
        case 'line': seg(e.a, e.b); w('S'); break;
        case 'circle': arcPath(e.c, e.r, 0, Math.PI * 2, true); w('h S'); break;
        case 'arc': arcPath(e.c, e.r, e.a0, GEO.sweep(e.a0, e.a1), true); w('S'); break;
        case 'polyline': {
          if (e.pts.length < 2) break;
          moveTo(e.pts[0]);
          for (let i = 1; i < e.pts.length; i++) lineTo(e.pts[i]);
          if (e.closed) w('h');
          w('S');
          break;
        }
        case 'point': {
          const d = 1.5 / scale;
          seg({ x: e.p.x - d, y: e.p.y }, { x: e.p.x + d, y: e.p.y });
          seg({ x: e.p.x, y: e.p.y - d }, { x: e.p.x, y: e.p.y + d });
          w('S');
          break;
        }
        case 'text': text(e.p, e.text, e.height, e.rotation || 0, 'left'); break;
        case 'mtext': {
          const mls = ENT.mtextLines(e);
          for (let i = 0; i < mls.length; i++) {
            text({ x: e.p.x, y: e.p.y - (i + 1) * ENT.MTEXT_LS * e.height + e.height * 0.45 }, mls[i], e.height, 0, 'left');
          }
          break;
        }
        case 'dim': {
          const g = ENT.dimGeometry(e);
          for (const l of g.lines) seg(l.a, l.b);
          for (const a of g.arcs) arcPath(a.c, a.r, a.a0, GEO.sweep(a.a0, a.a1), true);
          w('S');
          for (const ar of g.arrows) arrow(ar.p, ar.ang);
          for (const t of g.texts) text(t.p, t.text, t.height, t.rotation, t.align || 'center');
          break;
        }
        case 'hatch': {
          const b = e.boundary;
          const boundaryPath = () => {
            if (b.kind === 'circle') { arcPath(b.c, b.r, 0, Math.PI * 2, true); w('h'); }
            else {
              moveTo(b.pts[0]);
              for (let i = 1; i < b.pts.length; i++) lineTo(b.pts[i]);
              w('h');
            }
          };
          if (e.pattern === 'solid') {
            boundaryPath(); w('f');
            boundaryPath(); w('S');
          } else {
            w('q');
            boundaryPath(); w('W n');
            const bb = ENT.bbox(e);
            const ang = e.angle == null ? Math.PI / 4 : e.angle;
            const spacing = Math.max(e.spacing || 5, 1e-6);
            const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
            const half = GEO.dist({ x: bb.x1, y: bb.y1 }, { x: bb.x2, y: bb.y2 }) / 2 + spacing;
            const dirs = e.pattern === 'cross' ? [ang, ang + Math.PI / 2] : [ang];
            w('0.35 w');
            for (const dd of dirs) {
              const u = { x: Math.cos(dd), y: Math.sin(dd) };
              const n = { x: -u.y, y: u.x };
              const count = Math.ceil(half / spacing);
              for (let i = -count; i <= count; i++) {
                const base = { x: cx + n.x * i * spacing, y: cy + n.y * i * spacing };
                seg({ x: base.x - u.x * half, y: base.y - u.y * half }, { x: base.x + u.x * half, y: base.y + u.y * half });
              }
            }
            w('S Q');
            boundaryPath(); w('S');
          }
          break;
        }
        case 'ellipse': {
          const pts = ENT.ellipseSample(e, 96);
          moveTo(pts[0]);
          for (let i = 1; i < pts.length; i++) lineTo(pts[i]);
          w('h S');
          break;
        }
        case 'leader': {
          const g = ENT.leaderGeometry(e);
          for (const l of g.lines) seg(l.a, l.b);
          w('S');
          for (const ar of g.arrows) arrow(ar.p, ar.ang);
          for (const t of g.texts) text(t.p, t.text, t.height, 0, t.align);
          break;
        }
        case 'insert':
          for (const ch of ENT.resolvedChildren(e)) drawEntity(ch, ink);
          break;
      }
    };

    for (const e of doc.entities) {
      if (!doc.visible(e)) continue;
      const bb = ENT.bbox(e);
      if (GEO.bbValid(bb) && !GEO.bbOverlap(bb, rect)) continue;
      drawEntity(e);
    }

    return PDF._wrap(out.join('\n'), pw, ph);
  },

  _entityColor(doc, e) {
    if (e.color) return e.color;
    const l = doc.layer(e.layer);
    return l ? l.color : '#000000';
  },

  /* Assemble the PDF file around a content stream. */
  _wrap(content, pw, ph) {
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
    objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

    let body = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = body.length;
      body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xrefPos = body.length;
    body += `xref\n0 ${objs.length}\n`;
    body += '0000000000 65535 f \n';
    for (let i = 1; i < objs.length; i++) {
      body += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
    }
    body += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return body;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { PDF };
