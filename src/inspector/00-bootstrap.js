(() => {
  'use strict';
  // Private opt-in hook for Cocos Creator 3.8.x built-in ui-prop renderer.
  // Does not patch app.asar, engine classes, or Inspector's scene data.
  const KEY = '__CCRECORD_INSPECTOR_HOOK__';
  if (!document.body || document.body.getAttribute('name') !== 'main') return { status: 'not-main' };
  if (window[KEY]) {
    window[KEY].refresh();
    return { status: 'running', reused: true };
  }

  const RECOGNIZE = /^CVHRecord_(?!Entry_)[A-Za-z][A-Za-z0-9_]*$/;
  const ENTRY_CLASS = /^CVHRecordEntry_[A-Za-z][A-Za-z0-9_]*$/;
  const STYLE = `
    .cvh-global-record { display:block; box-sizing:border-box; margin:3px 0 6px;
      border:1px solid var(--color-normal-border, #42454a); border-radius:5px;
      background:rgba(12,15,19,.13); min-width:0; color:var(--color-normal-contrast,#ddd);
      font-size:12px; line-height:1.35; overflow:hidden; }
    .cvh-global-record[hidden] { display:none!important; }
    .cvh-global-header { display:flex; align-items:center; min-height:28px;
      padding:3px 6px 3px 6px; gap:5px; user-select:none;
      background:rgba(155,173,205,.038); border-bottom:1px solid rgba(155,173,205,.09); }
    .cvh-global-title { display:flex; flex:1; min-width:0; align-items:center; gap:5px;
      font-size:12px; font-weight:500; overflow:hidden; cursor:pointer; }
    .cvh-global-caret { font-size:11px; opacity:.62; width:9px; flex:none; }
    .cvh-global-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .cvh-global-size-label { font-size:10px; opacity:.6; flex:none; }
    .cvh-global-size { box-sizing:border-box; width:43px; min-width:35px; height:20px;
      outline:none; text-align:center; padding:0 2px; border-radius:3px;
      border:1px solid var(--color-normal-border,#53575f);
      background:rgba(0,0,0,.24); color:inherit; font:inherit; font-size:11px;
      font-variant-numeric:tabular-nums; }
    .cvh-global-size:focus { border-color:var(--color-focus-fill,#5b96cc); }
    .cvh-global-button { min-width:21px; height:20px; padding:0 3px; border-radius:3px;
      border:1px solid transparent; background:transparent; color:inherit;
      font:inherit; cursor:pointer; opacity:.72; }
    .cvh-global-button:hover { opacity:1; background:rgba(160,179,206,.16); }
    .cvh-global-body { padding:5px 6px 6px; }
    .cvh-global-gridhead,.cvh-global-row { display:grid;
      grid-template-columns:minmax(0,44%) minmax(0,1fr) 21px;
      column-gap:5px; min-width:0; }
    .cvh-global-gridhead { padding:0 2px 4px; font-size:9px; font-weight:600;
      letter-spacing:.06em; opacity:.55; }
    .cvh-global-rows { display:flex; flex-direction:column; gap:3px; }
    .cvh-global-row { align-items:center; padding:2px; min-height:22px; border-radius:3px;
      background:rgba(151,166,187,.055); box-sizing:border-box; }
    .cvh-global-row:nth-child(even) { background:rgba(151,166,187,.035); }
    .cvh-global-row:hover { background:rgba(151,166,187,.095); }
    .cvh-global-row[data-cvh-duplicate] { box-shadow:inset 2px 0 #f16b73;
      background:rgba(218,60,73,.085); }
    .cvh-global-warning { display:flex; align-items:center; gap:6px; min-width:0;
      padding:5px 8px; background:rgba(191,48,64,.14); color:#ff9aa2;
      border-bottom:1px solid rgba(238,91,105,.28); font-size:10.5px;
      line-height:1.45; font-weight:500; }
    .cvh-global-warning[hidden] { display:none!important; }
    .cvh-global-warning-icon { font-size:12px; line-height:1; flex:none; }
    .cvh-global-warning-text { min-width:0; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .cvh-global-record[data-cvh-has-duplicates] { border-color:rgba(240,92,105,.55); }
    .cvh-global-record[data-cvh-has-duplicates] .cvh-global-name { color:#ff9aa2; }
    .cvh-global-cell { min-width:0; }
    .cvh-global-delete { width:20px; height:20px; margin:0; padding:0;
      display:flex; align-items:center; justify-content:center;
      background:transparent; border:0; border-radius:3px;
      font-size:15px; line-height:1; color:var(--color-normal-contrast,#ddd);
      opacity:.46; cursor:pointer; user-select:none; }
    .cvh-global-delete:hover { opacity:1; background:rgba(224,70,82,.18); color:#ff8792; }
    .cvh-global-delete:focus-visible { outline:1px solid #ff8792; outline-offset:-1px; }
    .cvh-global-delete:active { background:rgba(224,70,82,.32); }

    .cvh-global-cell > ui-prop { display:block; min-width:0; width:100%; margin:0!important; }
    .cvh-global-empty { padding:10px 4px; font-size:11px; opacity:.65; text-align:center; }
    .cvh-global-advanced { margin-top:6px; }
    .cvh-global-advanced summary { cursor:pointer; font-size:10px; opacity:.58; user-select:none; }
    .cvh-global-advanced > ui-prop { display:block; width:100%; margin-top:4px; }
    .cvh-global-error { display:none!important; }
    .cvh-global-record[data-cvh-collapsed] .cvh-global-body { display:none; }
    .cvh-global-record[data-cvh-collapsed] .cvh-global-caret { transform:rotate(-90deg); }
  `;

  let stopped = false;
  let installed = false;
  let timer = null;
  let proto = null;
  let panelModule = null;
  try { panelModule = require('@editor/panel'); } catch (_) {}
  let originalRender = null;
  let wrappedRender = null;
  let skippedFocus = 0;
  let fallbackCount = 0;
  let renders = 0;
  let recognized = 0;
  let lastError = '';
  let candidateObjects = 0;
  const active = new Map(); // original ui-prop element -> generated widget state
  const instances = new Map(); // individual fallback patches

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function classNameOf(dump) {
    if (!isObject(dump)) return '';
    // IProperty (from the shipped creator-types) exposes cid and type.
    for (const c of [dump.cid, dump.type, dump.className, dump.value?.__type__, dump.value?.cid]) {
      if (typeof c === 'string' && RECOGNIZE.test(c)) return c;
    }
    // Some dump versions expose the generated Entry class as array elementTypeData.
    const e = dump.value?.entries || dump.value?.value?.entries;
    const candidate = e?.elementTypeData?.cid || e?.elementTypeData?.type || '';
    if (typeof candidate === 'string' && ENTRY_CLASS.test(candidate)) {
      return candidate.replace('CVHRecordEntry_', 'CVHRecord_');
    }
    return '';
  }
  function extract(dump) {
    if (!classNameOf(dump)) return null; // Fail closed, never recognize by `entries` alone.
    const obj = dump.value;
    const entries = isObject(obj) ? (obj.entries || obj.value?.entries) : null;
    if (!isObject(entries)) return null;
    const list = entries.value;
    if (!Array.isArray(list)) return { className: classNameOf(dump), entries, list: null, cells: null };
    const cells = [];
    for (const item of list) {
      const v = item?.value;
      const fields = isObject(v) ? (v.key ? v : v.value) : null;
      const key = fields?.key;
      const value = fields?.value;
      if (!isObject(key) || !isObject(value)) {
        return { className: classNameOf(dump), entries, list, cells: null };
      }
      cells.push([key,value]);
    }
    return { className: classNameOf(dump), entries, list, cells };
  }
  function isInsideInspector(element) {
    // Only run on the built-in Inspector, even when ui-prop is used in other panels.
    // Walk across panel shadow roots and nested custom-component shadow roots.
    let cur = element;
    for (let i = 0; i < 28 && cur; i++) {
      if (cur.nodeType === 1) {
        const name = String(cur.getAttribute?.('name') || '');
        const src = String(cur.getAttribute?.('src') || '');
        if (cur.localName === 'ui-panel') {
          return /(^|[:.\/])inspector($|[:.\/])/i.test(name) || /inspector/i.test(src);
        }
        if (cur.localName === 'body') return cur.getAttribute('name') === 'main';
      }
      cur = cur.parentNode || cur.host || null;
    }
    return true; // Unknown encapsulation: class marker is still very strict.
  }

  function makeNative(doc, dump, className) {
    const prop = doc.createElement('ui-prop');
    prop.setAttribute('type', 'dump');
    prop.setAttribute('data-cvh-native-prop', className || 'field');
    return prop;
  }
  function cloneDump(obj) {
    if (obj === undefined) return undefined;
    // IProperty dumps are transport snapshots; never hand a live scene dump to
    // a second ui-prop (and NEVER mutate a sibling or cached dump in place).
    return JSON.parse(JSON.stringify(obj));
  }

  // IMPORTANT: structure edits (SIZE / + / - / reorder) must reach the
  // Scene service as an actual set-property operation. Mutating only ui-prop
  // snapshots and emitting change-dump is not guaranteed to mark Scene/Prefab
  // dirty or to provide a stable undo command. Do not guess a component path.
  let isolatedCommits = 0;
  let capturedChildEdits = 0;
  let commitsPreservingOwner = 0;
  let confirmedSceneCommits = 0;
  let failedSceneCommits = 0;
  let lastCommitRoute = '';
  let lastSceneDirty = null;
  let dirtyMismatchCount = 0;
  let fallbackSnapshots = 0;
  let completedSceneRecordings = 0;
  let shortcutSaves = 0;

  // A Record can live directly on a Component OR inside any serializable
  // @ccclass field, e.g. Test.config.attachments.  Do not identify a property
  // by its leaf name alone: nested classes and sibling components may both
  // contain a field called "attachments".
