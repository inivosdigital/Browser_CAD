/* dxf.js — DXF R12 export and a tolerant DXF reader (R12 + LWPOLYLINE).
   Angles in DXF are degrees CCW; coordinates match our world (Y-up). */
'use strict';

const DXF = {

  /* ---- color mapping: hex <-> AutoCAD Color Index (basic palette) ---- */

  ACI: [
    [1, '#ff4444'], [2, '#ffdd44'], [3, '#44dd44'], [4, '#44dddd'],
    [5, '#5588ff'], [6, '#dd66dd'], [7, '#ffffff'], [8, '#999999'], [9, '#c0c0c0'],
    [30, '#ff8800'],
  ],

  hexToAci(hex) {
    if (!hex) return 7;
    const rgb = DXF._rgb(hex);
    if (!rgb) return 7;
    let best = 7, bestD = Infinity;
    for (const [aci, h] of DXF.ACI) {
      const c = DXF._rgb(h);
      const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
      if (d < bestD) { bestD = d; best = aci; }
    }
    return best;
  },

  aciToHex(aci) {
    const m = DXF.ACI.find(x => x[0] === aci);
    if (m) return m[1];
    if (aci >= 250 && aci <= 255) {
      const v = 60 + (aci - 250) * 39;
      return '#' + ((1 << 24) + (v << 16) + (v << 8) + v).toString(16).slice(1);
    }
    return '#ffffff';
  },

  _rgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  },

  /* ---- export ---- */

  exportDoc(doc) {
    const L = [];
    const w = (code, val) => { L.push(String(code), String(val)); };
    const num = (v) => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(8));
    const deg = (rad) => num(GEO.normAng(rad) * 180 / Math.PI);

    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSUNITS'); w(70, 4); // millimeters
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'TABLES');
    // linetype definitions for the types we use
    const LTYPES = {
      CONTINUOUS: [],
      DASHED: [0.5, -0.25],
      HIDDEN: [0.25, -0.125],
      CENTER: [1.25, -0.25, 0.25, -0.25],
      DOT: [0, -0.25],
    };
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, Object.keys(LTYPES).length);
    for (const [lname, pat] of Object.entries(LTYPES)) {
      w(0, 'LTYPE'); w(2, lname); w(70, 0);
      w(3, lname.toLowerCase()); w(72, 65);
      w(73, pat.length);
      w(40, num(pat.reduce((a, v) => a + Math.abs(v), 0)));
      for (const seg of pat) w(49, num(seg));
    }
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, doc.layers.length);
    for (const ly of doc.layers) {
      w(0, 'LAYER'); w(2, ly.name); w(70, ly.locked ? 4 : 0);
      w(62, (ly.visible ? 1 : -1) * DXF.hexToAci(ly.color));
      w(6, (ly.ltype || 'continuous').toUpperCase());
    }
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'ENTITIES');

    const common = (e) => {
      w(8, e.layer || '0');
      if (e.color) w(62, DXF.hexToAci(e.color));
    };

    const writeEnt = (e) => {
      switch (e.type) {
        case 'line':
          w(0, 'LINE'); common(e);
          w(10, num(e.a.x)); w(20, num(e.a.y)); w(30, 0);
          w(11, num(e.b.x)); w(21, num(e.b.y)); w(31, 0);
          break;
        case 'circle':
          w(0, 'CIRCLE'); common(e);
          w(10, num(e.c.x)); w(20, num(e.c.y)); w(30, 0);
          w(40, num(e.r));
          break;
        case 'arc':
          w(0, 'ARC'); common(e);
          w(10, num(e.c.x)); w(20, num(e.c.y)); w(30, 0);
          w(40, num(e.r));
          w(50, deg(e.a0)); w(51, deg(e.a1));
          break;
        case 'polyline':
          w(0, 'POLYLINE'); common(e);
          w(66, 1); w(70, e.closed ? 1 : 0);
          w(10, 0); w(20, 0); w(30, 0);
          for (const p of e.pts) {
            w(0, 'VERTEX'); w(8, e.layer || '0');
            w(10, num(p.x)); w(20, num(p.y)); w(30, 0);
          }
          w(0, 'SEQEND');
          break;
        case 'point':
          w(0, 'POINT'); common(e);
          w(10, num(e.p.x)); w(20, num(e.p.y)); w(30, 0);
          break;
        case 'text':
          w(0, 'TEXT'); common(e);
          w(10, num(e.p.x)); w(20, num(e.p.y)); w(30, 0);
          w(40, num(e.height));
          w(1, e.text || '');
          if (e.rotation) w(50, deg(e.rotation));
          break;
        case 'dim': // exploded for maximum compatibility
        case 'leader':
        case 'ellipse':
          for (const part of (ENT.explode(e) || [])) writeEnt(part);
          break;
      }
    };

    for (const e of doc.entities) writeEnt(e);

    w(0, 'ENDSEC');
    w(0, 'EOF');
    return L.join('\r\n') + '\r\n';
  },

  /* ---- import ---- */

  importText(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      if (Number.isNaN(code)) continue;
      pairs.push([code, lines[i + 1].trim()]);
    }

    const layers = [];
    const entities = [];
    const rad = (d) => GEO.normAng(parseFloat(d) * Math.PI / 180);

    let i = 0;
    let section = '';
    while (i < pairs.length) {
      const [code, val] = pairs[i];
      if (code === 0 && val === 'SECTION' && i + 1 < pairs.length && pairs[i + 1][0] === 2) {
        section = pairs[i + 1][1];
        i += 2;
        continue;
      }
      if (code === 0 && val === 'ENDSEC') { section = ''; i++; continue; }

      if (section === 'TABLES' && code === 0 && val === 'LAYER') {
        const ly = { name: null, color: '#ffffff', visible: true, locked: false, ltype: 'continuous', lweight: 1 };
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 2) ly.name = v;
          else if (c === 62) {
            const n = parseInt(v, 10);
            ly.visible = n >= 0;
            ly.color = DXF.aciToHex(Math.abs(n));
          } else if (c === 70) ly.locked = !!(parseInt(v, 10) & 4);
          else if (c === 6) {
            const lt = v.toLowerCase();
            if (['dashed', 'hidden', 'center', 'dot'].includes(lt)) ly.ltype = lt;
          }
          i++;
        }
        if (ly.name && !layers.some(l => l.name === ly.name)) layers.push(ly);
        continue;
      }

      if (section === 'ENTITIES' && code === 0) {
        const type = val;
        const d = { pts: [] };
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          const f = parseFloat(v);
          switch (c) {
            case 8: d.layer = v; break;
            case 62: d.aci = parseInt(v, 10); break;
            case 10: d.x = f; d.pts.push({ x: f, y: 0 }); break;
            case 20: d.y = f; if (d.pts.length) d.pts[d.pts.length - 1].y = f; break;
            case 11: d.x2 = f; break;
            case 21: d.y2 = f; break;
            case 40: d.r = f; break;
            case 50: d.a0 = v; break;
            case 51: d.a1 = v; break;
            case 70: d.flags = parseInt(v, 10); break;
            case 1: d.text = v; break;
          }
          i++;
        }
        const props = { layer: d.layer || '0' };
        if (d.aci && d.aci > 0 && d.aci !== 256) props.color = DXF.aciToHex(d.aci);

        switch (type) {
          case 'LINE':
            if (d.x !== undefined && d.x2 !== undefined) {
              entities.push(makeEntity('line', Object.assign(props, {
                a: { x: d.x, y: d.y || 0 }, b: { x: d.x2, y: d.y2 || 0 },
              })));
            }
            break;
          case 'CIRCLE':
            if (d.x !== undefined && d.r) {
              entities.push(makeEntity('circle', Object.assign(props, { c: { x: d.x, y: d.y || 0 }, r: d.r })));
            }
            break;
          case 'ARC':
            if (d.x !== undefined && d.r) {
              entities.push(makeEntity('arc', Object.assign(props, {
                c: { x: d.x, y: d.y || 0 }, r: d.r,
                a0: rad(d.a0 || 0), a1: rad(d.a1 || 0),
              })));
            }
            break;
          case 'POINT':
            if (d.x !== undefined) entities.push(makeEntity('point', Object.assign(props, { p: { x: d.x, y: d.y || 0 } })));
            break;
          case 'TEXT':
          case 'MTEXT':
            if (d.x !== undefined && d.text) {
              entities.push(makeEntity('text', Object.assign(props, {
                p: { x: d.x, y: d.y || 0 },
                text: d.text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, ''),
                height: d.r || 2.5,
                rotation: d.a0 ? rad(d.a0) : 0,
              })));
            }
            break;
          case 'LWPOLYLINE':
            if (d.pts.length >= 2) {
              entities.push(makeEntity('polyline', Object.assign(props, {
                pts: d.pts, closed: !!(d.flags & 1),
              })));
            }
            break;
          case 'POLYLINE': {
            // collect following VERTEX entities until SEQEND
            const pl = { pts: [], closed: !!(d.flags & 1) };
            while (i < pairs.length) {
              if (pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') {
                const v = { x: 0, y: 0 };
                i++;
                while (i < pairs.length && pairs[i][0] !== 0) {
                  if (pairs[i][0] === 10) v.x = parseFloat(pairs[i][1]);
                  if (pairs[i][0] === 20) v.y = parseFloat(pairs[i][1]);
                  i++;
                }
                pl.pts.push(v);
              } else if (pairs[i][0] === 0 && pairs[i][1] === 'SEQEND') {
                i++;
                while (i < pairs.length && pairs[i][0] !== 0) i++;
                break;
              } else break;
            }
            if (pl.pts.length >= 2) entities.push(makeEntity('polyline', Object.assign(props, pl)));
            break;
          }
        }
        continue;
      }
      i++;
    }

    return { entities, layers };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { DXF };
