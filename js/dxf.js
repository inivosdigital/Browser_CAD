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
        case 'mtext':
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
    const src = text.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < src.length; i += 2) {
      const code = parseInt(src[i].trim(), 10);
      if (Number.isNaN(code)) continue;
      pairs.push([code, src[i + 1].trim()]);
    }

    const layers = [];
    const entities = [];       // model space
    const paperEntities = [];  // all paper-space entities merged (back-compat)
    const psBuckets = {};      // '*Paper_Space' suffix -> entities (per source layout)
    const layoutMetas = [];    // OBJECTS section LAYOUT: {name, order, w, h} (inches)
    const blocks = {};         // named block definitions
    const rad = (d) => GEO.normAng(parseFloat(d) * Math.PI / 180);

    let i = 0;
    let section = '';
    let curBlock = null; // { name, base, entities } while inside BLOCK..ENDBLK

    const sink = (paper) => {
      if (curBlock) return curBlock.entities;
      if (paper) {
        psBuckets[''] = psBuckets[''] || [];
        return psBuckets[''];
      }
      return entities;
    };

    // reads groups for one entity; pairs[i] is just past the 0/TYPE pair
    const readEnt = (type) => {
      const d = { pts: [] };
      while (i < pairs.length && pairs[i][0] !== 0) {
        const [c, v] = pairs[i];
        const f = parseFloat(v);
        switch (c) {
          case 8: d.layer = v; break;
          case 2: d.name = v; break;
          case 62: d.aci = parseInt(v, 10); break;
          case 67: d.paper = parseInt(v, 10) === 1; break;
          case 10: d.x = f; d.pts.push({ x: f, y: 0 }); break;
          case 20: d.y = f; if (d.pts.length) d.pts[d.pts.length - 1].y = f; break;
          case 11: d.x2 = f; break;
          case 21: d.y2 = f; break;
          case 40: d.r = f; break;
          case 41: d.xs = f; break;
          case 50: d.a0 = v; break;
          case 51: d.a1 = v; break;
          case 70: d.flags = parseInt(v, 10); break;
          case 1: d.text = v; break;
        }
        i++;
      }
      const props = { layer: d.layer || '0' };
      if (d.aci && d.aci > 0 && d.aci !== 256) props.color = DXF.aciToHex(d.aci);
      const out = sink(d.paper);

      switch (type) {
        case 'LINE':
          if (d.x !== undefined && d.x2 !== undefined) {
            out.push(makeEntity('line', Object.assign(props, {
              a: { x: d.x, y: d.y || 0 }, b: { x: d.x2, y: d.y2 || 0 },
            })));
          }
          break;
        case 'CIRCLE':
          if (d.x !== undefined && d.r) {
            out.push(makeEntity('circle', Object.assign(props, { c: { x: d.x, y: d.y || 0 }, r: d.r })));
          }
          break;
        case 'ARC':
          if (d.x !== undefined && d.r) {
            out.push(makeEntity('arc', Object.assign(props, {
              c: { x: d.x, y: d.y || 0 }, r: d.r,
              a0: rad(d.a0 || 0), a1: rad(d.a1 || 0),
            })));
          }
          break;
        case 'POINT':
          if (d.x !== undefined) out.push(makeEntity('point', Object.assign(props, { p: { x: d.x, y: d.y || 0 } })));
          break;
        case 'TEXT':
        case 'MTEXT':
          if (d.x !== undefined && d.text) {
            out.push(makeEntity('text', Object.assign(props, {
              p: { x: d.x, y: d.y || 0 },
              text: d.text.replace(/\\P/g, ' ').replace(/\{[^}]*\}/g, ''),
              height: d.r || 2.5,
              rotation: d.a0 ? rad(d.a0) : 0,
            })));
          }
          break;
        case 'SOLID': // title blocks often use SOLID fills; keep the outline
          if (d.pts.length >= 3) {
            out.push(makeEntity('polyline', Object.assign(props, {
              pts: d.pts.slice(0, 4), closed: true,
            })));
          }
          break;
        case 'INSERT':
          if (d.name && d.x !== undefined) {
            out.push(makeEntity('insert', Object.assign(props, {
              name: d.name, p: { x: d.x, y: d.y || 0 },
              scale: d.xs || 1,
              rotation: d.a0 ? rad(d.a0) : 0,
            })));
          }
          break;
        case 'LWPOLYLINE':
          if (d.pts.length >= 2) {
            out.push(makeEntity('polyline', Object.assign(props, {
              pts: d.pts, closed: !!(d.flags & 1),
            })));
          }
          break;
        case 'POLYLINE': {
          const pl = { pts: [], closed: !!(d.flags & 1) };
          while (i < pairs.length) {
            if (pairs[i][0] === 0 && pairs[i][1] === 'VERTEX') {
              const vx = { x: 0, y: 0 };
              i++;
              while (i < pairs.length && pairs[i][0] !== 0) {
                if (pairs[i][0] === 10) vx.x = parseFloat(pairs[i][1]);
                if (pairs[i][0] === 20) vx.y = parseFloat(pairs[i][1]);
                i++;
              }
              pl.pts.push(vx);
            } else if (pairs[i][0] === 0 && pairs[i][1] === 'SEQEND') {
              i++;
              while (i < pairs.length && pairs[i][0] !== 0) i++;
              break;
            } else break;
          }
          if (pl.pts.length >= 2) out.push(makeEntity('polyline', Object.assign(props, pl)));
          break;
        }
      }
    };

    const ENT_TYPES = ['LINE', 'CIRCLE', 'ARC', 'POINT', 'TEXT', 'MTEXT', 'SOLID', 'INSERT', 'LWPOLYLINE', 'POLYLINE'];

    while (i < pairs.length) {
      const [code, val] = pairs[i];
      if (code === 0 && val === 'SECTION' && i + 1 < pairs.length && pairs[i + 1][0] === 2) {
        section = pairs[i + 1][1];
        i += 2;
        continue;
      }
      if (code === 0 && val === 'ENDSEC') { section = ''; curBlock = null; i++; continue; }

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

      if (section === 'BLOCKS' && code === 0 && val === 'BLOCK') {
        const blk = { name: null, base: { x: 0, y: 0 }, entities: [] };
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 2 && !blk.name) blk.name = v;
          else if (c === 10) blk.base.x = parseFloat(v);
          else if (c === 20) blk.base.y = parseFloat(v);
          i++;
        }
        curBlock = blk;
        continue;
      }
      if (section === 'BLOCKS' && code === 0 && val === 'ENDBLK') {
        if (curBlock && curBlock.name) {
          const lname = curBlock.name.toLowerCase();
          if (lname.startsWith('*paper_space')) {
            const suffix = lname.slice('*paper_space'.length);
            if (curBlock.entities.length) {
              psBuckets[suffix] = (psBuckets[suffix] || []).concat(curBlock.entities);
            }
          } else if (lname.startsWith('*model_space')) entities.push(...curBlock.entities);
          else if (!lname.startsWith('*') && curBlock.entities.length) blocks[curBlock.name] = curBlock;
        }
        curBlock = null;
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) i++;
        continue;
      }

      if (section === 'OBJECTS' && code === 0 && val === 'LAYOUT') {
        const meta = { name: null, order: 0, w: 0, h: 0 };
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 1) meta.name = v;
          else if (c === 71) meta.order = parseInt(v, 10) || 0;
          else if (c === 44) meta.w = parseFloat(v) / 25.4;  // PLOTSETTINGS sizes are mm
          else if (c === 45) meta.h = parseFloat(v) / 25.4;
          i++;
        }
        if (meta.name && meta.name.toLowerCase() !== 'model') layoutMetas.push(meta);
        continue;
      }

      if ((section === 'ENTITIES' || (section === 'BLOCKS' && curBlock)) && code === 0 && ENT_TYPES.includes(val)) {
        i++;
        readEnt(val);
        continue;
      }
      i++;
    }

    // assemble per-layout paper spaces: bucket order '' (active), '0', '1', …
    const bucketKeys = Object.keys(psBuckets).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);
    });
    for (const k of bucketKeys) paperEntities.push(...psBuckets[k]);
    layoutMetas.sort((a, b) => a.order - b.order);
    const paperLayouts = bucketKeys.map((k, idx) => {
      const meta = bucketKeys.length === layoutMetas.length ? layoutMetas[idx] : layoutMetas[idx] || null;
      return {
        name: (meta && meta.name) || `Layout${idx + 1}`,
        w: meta ? meta.w : 0,
        h: meta ? meta.h : 0,
        entities: psBuckets[k],
      };
    });

    return { entities, paperEntities, layers, blocks, paperLayouts };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { DXF };
