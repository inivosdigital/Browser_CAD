/* document.js — drawing document: entities, layers, selection, undo/redo, settings. */
'use strict';

const DEFAULT_LAYER_COLORS = ['#ffffff', '#ff4444', '#ffdd44', '#44dd44', '#44dddd', '#5588ff', '#dd66dd', '#999999', '#ff8800'];

class CadDocument {
  constructor() {
    this.entities = [];
    this.blocks = {}; // name -> { name, base:{x,y}, entities:[...] }
    this.layers = [{ name: '0', color: '#ffffff', visible: true, locked: false }];
    this.currentLayer = '0';
    this.selection = new Set(); // entity ids
    this.undoStack = [];
    this.redoStack = [];
    this.modified = false;
    this.settings = {
      grid: true,
      snapGrid: false,
      ortho: false,
      polar: false,
      polarInc: 45,
      osnap: true,
      dynInput: true,
      units: 'architectural',
      gridStep: 10,
      textHeight: 2.5,
      filletRadius: 0,
      offsetDist: 10,
    };
    this.onChange = null; // callback(doc)
  }

  /* ---- layers ---- */

  layer(name) { return this.layers.find(l => l.name === name); }

  addLayer(name) {
    if (this.layer(name)) return null;
    const color = DEFAULT_LAYER_COLORS[this.layers.length % DEFAULT_LAYER_COLORS.length];
    const l = { name, color, visible: true, locked: false };
    this.layers.push(l);
    this._changed();
    return l;
  }

  deleteLayer(name) {
    if (name === '0' || !this.layer(name)) return false;
    if (this.entities.some(e => e.layer === name)) return false;
    this.layers = this.layers.filter(l => l.name !== name);
    if (this.currentLayer === name) this.currentLayer = '0';
    this._changed();
    return true;
  }

  entityColor(e) {
    if (e.color) return e.color;
    const l = this.layer(e.layer);
    return l ? l.color : '#ffffff';
  }

  /* ---- entities ---- */

  add(e) {
    if (!this.layer(e.layer)) e.layer = this.currentLayer;
    this.entities.push(e);
    this._changed();
    return e;
  }

  get(id) { return this.entities.find(e => e.id === id); }

  remove(ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    this.entities = this.entities.filter(e => !set.has(e.id));
    for (const id of set) this.selection.delete(id);
    this._changed();
  }

  selectable(e) {
    const l = this.layer(e.layer);
    return l && l.visible && !l.locked;
  }
  visible(e) {
    const l = this.layer(e.layer);
    return l && l.visible;
  }

  selectedEntities() {
    return this.entities.filter(e => this.selection.has(e.id));
  }

  clearSelection() { this.selection.clear(); }

  bbox() {
    let b = GEO.bbEmpty();
    for (const e of this.entities) {
      if (!this.visible(e)) continue;
      b = GEO.bbUnion(b, ENT.bbox(e));
    }
    return b;
  }

  /* ---- undo / redo (snapshot based) ---- */

  _snapshot() {
    return JSON.stringify({
      entities: this.entities,
      blocks: this.blocks,
      layers: this.layers,
      currentLayer: this.currentLayer,
    });
  }

  _restore(snap) {
    const s = JSON.parse(snap);
    this.entities = s.entities;
    this.blocks = s.blocks || {};
    this.layers = s.layers;
    this.currentLayer = s.currentLayer;
    // drop selection ids that no longer exist
    const ids = new Set(this.entities.map(e => e.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this._changed();
  }

  checkpoint() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
    return true;
  }

  _changed() {
    this.modified = true;
    if (this.onChange) this.onChange(this);
  }

  /* ---- persistence ---- */

  toJSON() {
    return {
      app: 'BrowserCAD',
      version: 1,
      layers: this.layers,
      currentLayer: this.currentLayer,
      entities: this.entities,
      blocks: this.blocks,
      settings: this.settings,
    };
  }

  loadJSON(data) {
    if (!data || !Array.isArray(data.entities)) throw new Error('Not a BrowserCAD drawing');
    this.entities = data.entities;
    this.blocks = data.blocks || {};
    this.layers = (data.layers && data.layers.length) ? data.layers : [{ name: '0', color: '#ffffff', visible: true, locked: false }];
    if (!this.layer('0')) this.layers.unshift({ name: '0', color: '#ffffff', visible: true, locked: false });
    this.currentLayer = this.layer(data.currentLayer) ? data.currentLayer : '0';
    if (data.settings) Object.assign(this.settings, data.settings);
    let maxId = 0;
    for (const e of this.entities) maxId = Math.max(maxId, e.id || 0);
    for (const b of Object.values(this.blocks)) {
      for (const e of b.entities) maxId = Math.max(maxId, e.id || 0);
    }
    setEntitySeq(maxId + 1);
    this.selection.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.modified = false;
    if (this.onChange) this.onChange(this);
  }

  clear() {
    this.entities = [];
    this.blocks = {};
    this.layers = [{ name: '0', color: '#ffffff', visible: true, locked: false }];
    this.currentLayer = '0';
    this.selection.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.modified = false;
    if (this.onChange) this.onChange(this);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CadDocument };
