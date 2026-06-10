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

  /* ---- HATCH: extract the first boundary loop (polyline or line edges) ---- */

  _hatchLoop(raw) {
    let i = 0;
    const n = raw.length;
    const num = (v) => parseFloat(v);
    while (i < n && raw[i][0] !== 92) i++;
    while (i < n) {
      const flag = parseInt(raw[i][1], 10);
      i++;
      if (flag & 2) {
        // polyline loop: 72 has_bulge, 73 closed, 93 count, then 10/20 (+42)
        let count = 0;
        while (i < n && raw[i][0] !== 93 && raw[i][0] !== 92) i++;
        if (i < n && raw[i][0] === 93) { count = parseInt(raw[i][1], 10); i++; }
        const pts = [];
        while (i < n && pts.length < count) {
          if (raw[i][0] === 10) {
            const x = num(raw[i][1]);
            let y = 0;
            if (i + 1 < n && raw[i + 1][0] === 20) { y = num(raw[i + 1][1]); i++; }
            pts.push({ x, y });
          }
          i++;
        }
        if (pts.length >= 3) return pts;
      } else {
        // edge loop: 93 edge count, per edge 72=type (1=line: 10/20 start, 11/21 end)
        let count = 0;
        while (i < n && raw[i][0] !== 93 && raw[i][0] !== 92) i++;
        if (i < n && raw[i][0] === 93) { count = parseInt(raw[i][1], 10); i++; }
        const pts = [];
        let ok = true;
        for (let e = 0; e < count && ok && i < n; e++) {
          while (i < n && raw[i][0] !== 72) i++;
          if (i >= n || parseInt(raw[i][1], 10) !== 1) { ok = false; break; }
          i++;
          let x = null, y = 0;
          while (i < n && raw[i][0] !== 11) {
            if (raw[i][0] === 10) x = num(raw[i][1]);
            if (raw[i][0] === 20) y = num(raw[i][1]);
            i++;
          }
          if (x === null) { ok = false; break; }
          pts.push({ x, y });
        }
        if (ok && pts.length >= 3) return pts;
      }
      while (i < n && raw[i][0] !== 92) i++;
    }
    return null;
  },

  /* ---- text cleanup: MTEXT inline codes and %% sequences ---- */

  cleanText(str, mtext) {
    let t = String(str);
    // \U+XXXX unicode escapes (both TEXT and MTEXT)
    t = t.replace(/\\U\+([0-9A-Fa-f]{4,5})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    if (mtext) {
      t = t.replace(/\\P/g, '\n')
        .replace(/\\~/g, ' ')
        .replace(/\\S([^;^#\/]*)[#^\/] ?([^;]*);/g, '$1/$2') // stacked fractions
        .replace(/\\[ACFHQTWfpc][^;\\{}]*;/g, '')        // formatting with arguments
        .replace(/\\[LlOoKkX]/g, '')                       // toggles without arguments
        .replace(/[{}]/g, '');
    }
    return t
      .replace(/%%[cC]/g, 'Ø')
      .replace(/%%[dD]/g, '°')
      .replace(/%%[pP]/g, '±')
      .replace(/%%[uUoO]/g, '');
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
    const layoutMetas = [];    // OBJECTS section LAYOUT: {name, order, w, h, rot, br}
    const recName = {};        // BLOCK_RECORD handle -> block name
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
      const d = { pts: [], chunks: [], raw: [] };
      while (i < pairs.length && pairs[i][0] !== 0) {
        const [c, v] = pairs[i];
        const f = parseFloat(v);
        if (type === 'HATCH') d.raw.push([c, v]);
        switch (c) {
          case 8: d.layer = v; break;
          case 2: d.name = v; break;
          case 62: d.aci = parseInt(v, 10); break;
          case 67: d.paper = parseInt(v, 10) === 1; break;
          case 10: d.x = f; d.pts.push({ x: f, y: 0 }); break;
          case 20: d.y = f; if (d.pts.length) d.pts[d.pts.length - 1].y = f; break;
          case 11: d.x2 = f; break;
          case 21: d.y2 = f; break;
          case 12: d.vx = f; break;
          case 22: d.vy = f; break;
          case 40: d.r = f; break;
          case 41: d.xs = f; break;
          case 45: d.g45 = f; break;
          case 50: d.a0 = v; break;
          case 51: d.a1 = v; break;
          case 52: d.g52 = f; break;
          case 68: d.g68 = parseInt(v, 10); break;
          case 69: d.g69 = parseInt(v, 10); break;
          case 70: d.flags = parseInt(v, 10); break;
          case 71: d.g71 = parseInt(v, 10); break;
          case 72: d.g72 = parseInt(v, 10); break;
          case 74: d.g74 = parseInt(v, 10); break;
          case 1: d.text = v; break;
          case 3: d.chunks.push(v); break;
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
        case 'ATTRIB': {
          if (d.x === undefined || !d.text) break;
          if (type === 'ATTRIB' && d.flags && (d.flags & 1)) break; // invisible attribute
          // alignment: when 72/74 set, the second alignment point is the anchor
          const aligned = (d.g72 || d.g74) && d.x2 !== undefined;
          const align = d.g72 === 1 || d.g72 === 4 ? 'center' : (d.g72 === 2 ? 'right' : 'left');
          out.push(makeEntity('text', Object.assign(props, {
            p: aligned ? { x: d.x2, y: d.y2 || 0 } : { x: d.x, y: d.y || 0 },
            text: DXF.cleanText(d.text, false),
            height: d.r || 2.5,
            rotation: d.a0 ? rad(d.a0) : 0,
            align: aligned ? align : 'left',
          })));
          break;
        }
        case 'ATTDEF':
          break; // attribute placeholder, value comes from ATTRIB
        case 'MTEXT': {
          const rawTxt = d.chunks.join('') + (d.text || '');
          if (d.x === undefined || !rawTxt) break;
          const h = d.r || 2.5;
          const txt = DXF.cleanText(rawTxt, true);
          const linesArr = txt.split('\n');
          const maxLen = Math.max(1, ...linesArr.map(l => l.length));
          const width = d.xs > 1e-9 ? d.xs : maxLen * 0.62 * h + h;
          const ent = makeEntity('mtext', Object.assign(props, {
            p: { x: d.x, y: d.y || 0 }, width, height: h, text: txt,
          }));
          // attachment point 71: 1-9 = TL TC TR / ML MC MR / BL BC BR
          if (d.g71 && d.g71 >= 1 && d.g71 <= 9) {
            const estH = (typeof ENT !== 'undefined' ? ENT.mtextLines(ent).length : linesArr.length) * 1.6 * h;
            const col = (d.g71 - 1) % 3, row = Math.floor((d.g71 - 1) / 3);
            ent.p.x -= [0, 0.5, 1][col] * width;
            ent.p.y += [0, 0.5, 1][row] * estH;
          }
          out.push(ent);
          break;
        }
        case 'VIEWPORT': {
          // 69=1 is the overall paper-space viewport; 68<=0 means off
          if (d.g69 === 1 || (d.g68 !== undefined && d.g68 <= 0)) break;
          if (d.x === undefined || !(d.r > 0) || !(d.xs > 0)) break;
          const scale = d.g45 > 0 ? d.xs / d.g45 : 1;
          out.push(makeEntity('viewport', Object.assign(props, {
            p: { x: d.x - d.r / 2, y: (d.y || 0) - d.xs / 2 },
            w: d.r, h: d.xs,
            center: { x: d.vx || 0, y: d.vy || 0 },
            scale,
          })));
          break;
        }
        case 'HATCH': {
          const pts = DXF._hatchLoop(d.raw);
          if (!pts || pts.length < 3) break;
          const solid = !!(d.flags & 1);
          const name = (d.name || '').toUpperCase();
          out.push(makeEntity('hatch', Object.assign(props, {
            boundary: { kind: 'poly', pts },
            pattern: solid ? 'solid' : 'lines',
            spacing: 0.125 * (d.xs > 0 ? d.xs : 1),
            angle: rad(d.g52 || 0) + (name.startsWith('ANSI3') ? Math.PI / 4 : 0),
          })));
          break;
        }
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

    const ENT_TYPES = ['LINE', 'CIRCLE', 'ARC', 'POINT', 'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'SOLID', 'INSERT', 'LWPOLYLINE', 'POLYLINE', 'VIEWPORT', 'HATCH'];

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
          // keep anonymous blocks too (*U dynamic blocks, *T tables hold real geometry)
          else if (curBlock.entities.length) blocks[curBlock.name] = curBlock;
        }
        curBlock = null;
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) i++;
        continue;
      }

      if (section === 'TABLES' && code === 0 && val === 'BLOCK_RECORD') {
        let h = null, nm = null;
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          if (pairs[i][0] === 5) h = pairs[i][1].trim().toUpperCase();
          if (pairs[i][0] === 2) nm = pairs[i][1].trim();
          i++;
        }
        if (h && nm) recName[h] = nm;
        continue;
      }

      if (section === 'OBJECTS' && code === 0 && val === 'LAYOUT') {
        const meta = { name: null, order: 0, w: 0, h: 0, rot: 0, br: null };
        i++;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 1 && v.trim()) meta.name = v;             // PLOTSETTINGS has an empty 1 first
          else if (c === 71) meta.order = parseInt(v, 10) || 0;
          else if (c === 44) meta.w = parseFloat(v) / 25.4;   // PLOTSETTINGS sizes are mm
          else if (c === 45) meta.h = parseFloat(v) / 25.4;
          else if (c === 73) meta.rot = parseInt(v, 10) || 0; // plot rotation, 1=90°
          else if (c === 330) meta.br = v.trim().toUpperCase(); // last 330 = block record
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

    // assemble per-layout paper spaces
    const bucketKeys = Object.keys(psBuckets).sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);
    });
    for (const k of bucketKeys) paperEntities.push(...psBuckets[k]);
    layoutMetas.sort((a, b) => a.order - b.order);

    // exact mapping: LAYOUT.330 -> BLOCK_RECORD -> *Paper_SpaceN suffix
    const paperLayouts = [];
    const used = new Set();
    for (const m of layoutMetas) {
      const bn = m.br && recName[m.br];
      if (!bn || !/^\*paper_space/i.test(bn)) continue;
      const key = bn.slice('*Paper_Space'.length).toLowerCase();
      if (!psBuckets[key] || !psBuckets[key].length || used.has(key)) continue;
      used.add(key);
      let w = m.w, h = m.h;
      if (m.rot % 2 === 1) { const t = w; w = h; h = t; } // plot rotation 90°/270°
      paperLayouts.push({ name: m.name, w, h, entities: psBuckets[key] });
    }
    // fall back to positional pairing for anything unmatched
    const freeMetas = layoutMetas.filter(m => !m.br || !recName[m.br] ||
      !used.has((recName[m.br] || '').slice('*Paper_Space'.length).toLowerCase()));
    let fi = 0;
    for (const k of bucketKeys) {
      if (used.has(k) || !psBuckets[k].length) continue;
      const m = freeMetas[fi++];
      let w = m ? m.w : 0, h = m ? m.h : 0;
      if (m && m.rot % 2 === 1) { const t = w; w = h; h = t; }
      paperLayouts.push({ name: (m && m.name) || `Layout${paperLayouts.length + 1}`, w, h, entities: psBuckets[k] });
    }

    return { entities, paperEntities, layers, blocks, paperLayouts };
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { DXF };
