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
    .cvh-global-error { color:#e8ae78; font-size:10px; padding:4px 0 0; }
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

  // A Record can live directly on a Component OR inside any serializable
  // @ccclass field, e.g. Test.config.attachments.  Do not identify a property
  // by its leaf name alone: nested classes and sibling components may both
  // contain a field called "attachments".

  function findRecordProperties(component, componentIndex, classId, leafName) {
    const found = new Map();
    const seen = new WeakSet();
    const walkFields = (fields, ancestors, depth) => {
      if (!isObject(fields) || depth > 16 || seen.has(fields)) return;
      seen.add(fields);
      for (const [fieldName, child] of Object.entries(fields)) {
        if (!isObject(child) || !Object.prototype.hasOwnProperty.call(child, 'value')) continue;
        // Every editable scene property is a dump; arbitrary nested JS objects
        // inside `value` are NOT automatically property dumps.
        if (!(typeof child.name === 'string' || typeof child.cid === 'string' ||
              typeof child.type === 'string' || typeof child.path === 'string')) continue;
        const segments = ancestors.concat(fieldName);
        if (fieldName === leafName && classNameOf(child) === classId) {
          const path = `__comps__.${componentIndex}.${segments.join('.')}`;
          found.set(path, { componentIndex, property: child, path, segments });
        }
        // Do not walk a Record's entries to avoid finding a Record accidentally
        // inside an entry's Key/Value, or building wrong Scene paths.
        if (classNameOf(child)) continue;
        if (Array.isArray(child.value)) continue; // array indices need separate routing
        if (isObject(child.value)) {
          walkFields(child.value, segments, depth + 1);
          // Some Scene dumps wrap a serializable custom class as value.value.
          if (isObject(child.value.value)) {
            walkFields(child.value.value, segments, depth + 1);
          }
        }
      }
    };
    // Normal Cocos query-node: component.value is a field-name -> dump map.
    // Some variants nest the same map one level further in `value.value`.
    walkFields(component?.value, [], 0);
    walkFields(component?.value?.value, [], 0);
    return [...found.values()];
  }

  function normalizeDumpPath(path) {
    return typeof path === 'string' ? path.replace(/\[(\d+)\]/g, '.$1').replace(/^\.+|\.+$/g, '') : '';
  }

  async function resolveSceneProperty(state, owner) {
    const editor = window.Editor || (typeof Editor !== 'undefined' ? Editor : null);
    if (!editor?.Message?.request || !editor?.Selection?.getSelected) {
      throw new Error('Editor Scene IPC / selection is not available. No changes were made.');
    }
    const selected = Array.from(editor.Selection.getSelected('node') || []);
    if (selected.length !== 1 || typeof selected[0] !== 'string') {
      throw new Error('Select exactly one Scene/Prefab node; multi-selection is not supported.');
    }
    const uuid = selected[0];
    const dump = await editor.Message.request('scene', 'query-node', uuid);
    const compsRaw = dump?.__comps__;
    const comps = Array.isArray(compsRaw) ? compsRaw :
      (Array.isArray(compsRaw?.value) ? compsRaw.value : []);
    if (!comps.length) {
      throw new Error('Cannot determine component index from Scene query-node; operation canceled.');
    }
    const cls = classNameOf(owner);
    const name = owner?.name;
    if (!cls || typeof name !== 'string' || !name) {
      throw new Error('Record metadata is incomplete; cannot locate property.');
    }
    const all = comps.flatMap((component, componentIndex) =>
      findRecordProperties(component, componentIndex, cls, name));
    // Dump paths, when present, disambiguate repeated field names (e.g. one
    // Component with `front.attachments` and `rear.attachments`).
    const ownerPath = normalizeDumpPath(owner?.path);
    let matches = all;
    if (ownerPath && all.length > 1) {
      const matched = all.filter((m) => {
        const path = normalizeDumpPath(m.path);
        const relative = m.segments.join('.');
        return ownerPath === path || ownerPath.endsWith('.' + relative) ||
          ownerPath === relative;
      });
      if (matched.length) matches = matched;
    }
    // Multiple Components can have the same nested property path.  Match
    // *current serialized entry values* when path alone is not unique. This
    // is a discriminator, never a reason to blindly pick the first match.
    if (matches.length > 1) {
      const identity = (prop) => {
        const fields = extract(prop)?.cells;
        if (!fields) return null;
        try { return JSON.stringify(fields.map(([k,v]) => [k.value,v.value])); }
        catch (_) { return null; }
      };
      const expected = identity(owner);
      if (expected !== null) {
        const same = matches.filter(m => identity(m.property) === expected);
        if (same.length) matches = same;
      }
    }
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ?
        `Record "${name}" not found on selected node (including nested @ccclass fields). Change canceled.` :
        `Found ${matches.length} matching Record fields named "${name}". Cannot determine path safely; edit canceled.`);
    }
    const m = matches[0];
    const entries = extract(m.property)?.entries?.value;
    const currentEntries = extract(owner)?.entries?.value;
    if (Array.isArray(entries) && Array.isArray(currentEntries) && entries.length !== currentEntries.length) {
      throw new Error('Scene and Inspector entry counts differ. Re-select node before editing.');
    }
    return { editor, uuid, path: m.path + '.entries', sceneProperty: m.property,
      componentIndex: m.componentIndex, propertyName: name, propertyPath: m.path, segments: m.segments, classId: cls };
  }

  function locateComponentDump(nodeDump, route) {
    const compsRaw = nodeDump?.__comps__;
    const comps = Array.isArray(compsRaw) ? compsRaw :
      (Array.isArray(compsRaw?.value) ? compsRaw.value : []);
    const component = comps[route.componentIndex];
    if (!component) return null;
    // Re-use the same structural path discovery as pre-commit resolution, so
    // post-append verification works for RecordAutoConfig.attachments too.
    return findRecordProperties(component, route.componentIndex,
      route.classId, route.propertyName).find((p) => p.path === route.propertyPath)?.property || null;
  }

  // A successful set-property does not guarantee that a generated @ccclass
  // round-trips with exactly the same dump shape. Read the Scene's normalized
  // representation before creating editable row baselines (especially newly
  // appended custom class / Node values). A lagging query-node is not treated
  // as authoritative: do not replace our rows with a mismatched entry count.
  async function readBackEntries(route, expectedCount) {
    // query-node can lag set-property by one or two reads on 3.8.x.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const node = await route.editor.Message.request('scene', 'query-node', route.uuid);
        const actual = extract(locateComponentDump(node, route));
        if (actual?.cells?.length === expectedCount) return actual.entries.value;
      } catch (error) {
        // The edit was already accepted; preserve its local draft and let the
        // next native Inspector render rebase from the Scene instead.
        lastError = 'Scene read-back: ' + String(error?.message || error);
        return null;
      }
    }
    return null;
  }

  // Atomically edit ONLY one Record's entries. The caller's original dump is
  // not touched until the Scene service has confirmed set-property. The Scene
  // service owns the dirty flag and undo stack, including prefab stage edits.

  async function commitRecord(state, apply) {
    if (stopped || active.get(state.el) !== state || !state.el.isConnected) return false;
    if (state.busy) throw new Error('A Record edit is already in progress');
    state.busy = true;
    try {
      const owner = state.el.dump;
      const current = extract(owner);
      if (!current || !Array.isArray(current.entries?.value)) {
        throw new Error('Record dump changed; reopen Inspector and retry');
      }
      if (owner?.values?.length > 1 || owner?.isMultiple === true) {
        throw new Error('Multi-selection editing is not supported');
      }
      const before = current.entries.value;
      const draftList = cloneDump(before);
      const draftEntries = { ...current.entries, value: draftList };
      const draft = { ...current, entries: draftEntries, list: draftList };
      apply(draft);
      if (!Array.isArray(draftEntries.value)) {
        throw new Error('Record edit produced an invalid entries array');
      }
      if (JSON.stringify(draftEntries.value) === JSON.stringify(before)) return false;
      // Resolve the exact node + component property before sending anything.
      const route = await resolveSceneProperty(state, owner);
      if (stopped || !state.el.isConnected || state.el.dump !== owner ||
          active.get(state.el) !== state || current.entries.value !== before) {
        throw new Error('Inspector selection changed before commit; edit canceled.');
      }
      const newDump = cloneDump(current.entries);
      newDump.value = draftEntries.value;
      const result = await route.editor.Message.request('scene', 'set-property', {
        uuid: route.uuid, path: route.path, dump: newDump, record: true,
      });
      if (result !== true) throw new Error('Scene did not confirm set-property (result: ' + String(result) + ')');
      // The query-node result can lag behind set-property for generated CCClasses.
      // Do not show a false "Scene returned ..." failure after a confirmed edit;
      // the Scene service is authoritative and dirty verification is separate.
      confirmedSceneCommits++;
      lastCommitRoute = route.path;
      // Use canonical Scene values for the new rows. Scene may hydrate Node
      // references / custom @ccclass defaults differently than elementTypeData;
      // comparing a newly edited field against a local template would then
      // incorrectly report "modified outside Inspector".
      const readBack = await readBackEntries(route, draftEntries.value.length);
      if (state.el.dump === owner && active.get(state.el) === state) {
        current.entries.value = readBack ? cloneDump(readBack) : draftEntries.value;
        commitsPreservingOwner++;
        const latest = extract(owner);
        if (latest) syncWidget(state.el, owner, latest, true);
      }
      await verifyDirty(route, state, true);
      isolatedCommits++;
      return true;
    } catch (error) {
      failedSceneCommits++;
      throw error;
    } finally {
      state.busy = false;
    }
  }

  function reportEditError(state, operation, err) {
    lastError = operation + ': ' + String(err?.stack || err);
    if (!state.error) return;
    state.error.textContent = String(err?.message || err);
    state.error.hidden = false;
  }

  function preventChildCommit(event) {
    event.stopPropagation?.();
    // Do not use preventDefault: native ui-prop needs its own edit processing.
    capturedChildEdits++;
  }

  // Edit only the changed paths of a serialized custom @ccclass value.
  // ui-prop mutates its local dump before emitting change-dump, so comparing
  // Scene data with that *live* dump produces a false "newer data" conflict.
  // Each row retains the last committed value as an immutable baseline.
  function sameSerializedValue(left, right) {
    try { return JSON.stringify(left) === JSON.stringify(right); }
    catch (_) { return left === right; }
  }

  function serializedFields(value) {
    if (!isObject(value)) return null;
    const isDump = (field) => isObject(field) &&
      Object.prototype.hasOwnProperty.call(field, 'value') &&
      (typeof field.name === 'string' || typeof field.type === 'string' || typeof field.cid === 'string');
    const candidates = [value, value.value];
    for (const candidate of candidates) {
      if (!isObject(candidate)) continue;
      const entries = Object.entries(candidate);
      if (entries.length > 0 && entries.every(([name, field]) => name !== '__type__' && isDump(field))) {
        return candidate;
      }
    }
    return null;
  }

  // Returns changed sub-properties with relative Scene paths; for a primitive
  // leaf, returns one change with an empty path. Unknown shapes fail closed by
  // treating them as one value (never by choosing an arbitrary nested field).
  function changedValueLeaves(previous, proposed, segments = [], depth = 0) {
    if (sameSerializedValue(previous, proposed)) return [];
    if (depth < 12) {
      const priorFields = serializedFields(previous);
      const newFields = serializedFields(proposed);
      if (priorFields && newFields &&
          Object.keys(priorFields).length === Object.keys(newFields).length &&
          Object.keys(priorFields).every((key) => Object.prototype.hasOwnProperty.call(newFields, key))) {
        return Object.keys(priorFields).flatMap((key) =>
          changedValueLeaves(priorFields[key].value, newFields[key].value,
            segments.concat(key), depth + 1));
      }
    }
    return [{segments, value:cloneDump(proposed)}];
  }

  function propertyAtSegments(dump, segments) {
    let current = dump;
    for (const key of segments) {
      const fields = serializedFields(current.value);
      if (!fields || !isObject(fields[key])) return null;
      current = fields[key];
    }
    return current;
  }

  function patchValueAtSegments(value, segments, updated) {
    if (!segments.length) return cloneDump(updated);
    const copy = cloneDump(value);
    let cursor = copy;
    for (let i = 0; i < segments.length; i++) {
      const fields = serializedFields(cursor);
      if (!fields?.[segments[i]]) throw new Error('Custom value layout changed; edit canceled');
      if (i === segments.length - 1) fields[segments[i]].value = cloneDump(updated);
      else cursor = fields[segments[i]].value;
    }
    return copy;
  }

  async function commitLeaf(state, index, column, editedDump) {
    if (stopped || active.get(state.el) !== state || !state.el.isConnected) return false;
    if (state.busy) throw new Error('A Record edit is already in progress');
    state.busy = true;
    try {
      if (!Number.isInteger(index) || index < 0 || !['key','value'].includes(column)) {
        throw new Error('Invalid entry edit');
      }
      if (!isObject(editedDump) || !Object.prototype.hasOwnProperty.call(editedDump, 'value')) {
        throw new Error('Edited Key/Value dump has no value');
      }
      const owner = state.el.dump;
      const current = extract(owner);
      const columnIndex = column === 'key' ? 0 : 1;
      const originalCell = current?.cells?.[index]?.[columnIndex];
      const row = state.rowEls[index];
      if (!originalCell || !row || !Array.isArray(row.snapshots)) {
        throw new Error('Record entry changed; reselect the node before editing');
      }
      if (owner?.isMultiple || owner?.values?.length > 1) {
        throw new Error('Multi-selection editing is unsupported');
      }
      const baseline = row.snapshots[columnIndex];
      const changes = changedValueLeaves(baseline, editedDump.value);
      if (!changes.length) return false;
      const route = await resolveSceneProperty(state, owner);
      const remote = extract(route.sceneProperty);
      if (!remote?.cells || remote.cells.length !== current.cells.length) {
        throw new Error('Scene and Inspector entries are out of sync; edit canceled');
      }
      const nativeCell = remote.cells[index][columnIndex];
      const root = `${route.path}.${index}.${column}`;
      // Verify each changed leaf against its last committed value, not the
      // whole custom class. Concurrent Scene edits to unrelated fields survive.
      const prepared = changes.map((change) => {
        const baselineDump = {value:baseline};
        const expected = propertyAtSegments(baselineDump, change.segments);
        const target = propertyAtSegments(nativeCell, change.segments);
        if (!target || !expected || !sameSerializedValue(target.value,expected.value)) {
          throw new Error('Field was modified outside this Inspector; reselect the node before editing');
        }
        const path = [root,...change.segments].join('.');
        if (column === 'key' && change.segments.length === 0 && Array.isArray(target.enumList)) {
          if (!target.enumList.some(o => o?.value === change.value)) {
            throw new Error('Selected Enum value is not part of this Enum definition');
          }
        }
        const dump = cloneDump(target);
        dump.value = cloneDump(change.value);
        return {path, dump, change};
      });
      if (state.el.dump !== owner || active.get(state.el) !== state || !state.el.isConnected) {
        throw new Error('Selection changed; edit canceled');
      }
      for (const preparedEdit of prepared) {
        const response = await route.editor.Message.request('scene', 'set-property', {
          uuid:route.uuid, path:preparedEdit.path, dump:preparedEdit.dump, record:true,
        });
        if (response !== true) throw new Error('Scene rejected leaf set-property: ' + String(response));
        confirmedSceneCommits++;
        lastCommitRoute = preparedEdit.path;
      }
      // Only the edited leaves are applied locally. Never overwrite sibling
      // values with a stale copy of the entire ItemStats object.
      let committed = cloneDump(nativeCell.value);
      for (const {change} of prepared) committed = patchValueAtSegments(committed, change.segments, change.value);
      if (state.el.dump === owner && active.get(state.el) === state) {
        originalCell.value = committed;
        row.snapshots[columnIndex] = cloneDump(committed);
        commitsPreservingOwner++;
        const latest = extract(owner);
        if (latest) syncWidget(state.el, owner, latest);
      }
      isolatedCommits++;
      await verifyDirty(route, state);
      return true;
    } catch (error) {
      failedSceneCommits++;
      throw error;
    } finally { state.busy = false; }
  }

  function updateField(state, index, column, editedDump) {
    return commitLeaf(state, index, column, editedDump);
  }

  async function verifyDirty(route, state, structureEdit = false) {
    try {
      let dirty = await route.editor.Message.request('scene', 'query-dirty');
      // Creator 3.8.8 does not expose a public set-dirty message. A Scene
      // snapshot participates in its undo/dirty bookkeeping. Only snapshot
      // when dirty was NOT already set, to avoid duplicate undo commands.
      if (structureEdit && dirty !== true) {
        await route.editor.Message.request('scene', 'snapshot');
        fallbackSnapshots++;
        dirty = await route.editor.Message.request('scene', 'query-dirty');
      }
      // Cocos 3.8's snapshot is an undo operation, not a guaranteed dirty
      // signal. The built-in Inspector normally routes a ui-prop change-dump
      // event through its own change tracking, so retry that native path only
      // when Scene IPC has confirmed a change but still reports clean.
      if (dirty !== true && state.el?.isConnected) {
        const native = state.el;
        if (typeof native.dispatch === 'function') native.dispatch('change-dump');
        else if (typeof native.dispatchEvent === 'function')
          native.dispatchEvent(new Event('change-dump', {bubbles:true, composed:true}));
        dirty = await route.editor.Message.request('scene','query-dirty');
      }
      lastSceneDirty = dirty === true;
      if (dirty !== true) {
        dirtyMismatchCount++;
        state.error.textContent = 'Scene/Prefab is still not marked dirty. Verify the data before saving.';
        state.error.hidden = false;
      }
    } catch (error) {
      lastSceneDirty = null;
      dirtyMismatchCount++;
      state.error.textContent = 'Unable to verify Scene dirty state: ' + String(error?.message || error);
      state.error.hidden = false;
    }
  }

  // Dedicated Scene message for DELETE. Do not serialize and reapply the full
  // generated CCClass array just to remove one entry.
  async function deleteEntry(state, index) {
    if (stopped || active.get(state.el) !== state || !state.el.isConnected) return false;
    if (state.busy) throw new Error('A Record edit is already in progress');
    state.busy = true;
    try {
      const owner = state.el.dump;
      const before = extract(owner);
      if (!before?.cells || !Number.isInteger(index) || index < 0 || index >= before.cells.length) {
        throw new Error('Invalid entry index');
      }
      const route = await resolveSceneProperty(state, owner);
      const remote = extract(route.sceneProperty);
      if (!remote?.cells || remote.cells.length !== before.cells.length) {
        throw new Error('Scene/Inspector entries do not match; cancel delete');
      }
      if (state.el.dump !== owner || active.get(state.el) !== state) {
        throw new Error('Selection changed; canceled delete');
      }
      const response = await route.editor.Message.request('scene', 'remove-array-element', {
        uuid: route.uuid, path: route.path, index,
      });
      if (response === false) throw new Error('Scene rejected remove-array-element'); // 3.8.2-3.8.4 return void
      confirmedSceneCommits++;
      lastCommitRoute = route.path + '.' + index + ' (remove-array-element)';
      // Keep the current ui-prop instance reference but only update its own
      // Record array. Scene owns undo + dirty bookkeeping.
      if (state.el.dump === owner && active.get(state.el) === state) {
        const list = before.list.slice();
        list.splice(index,1);
        list.forEach((entry,i)=>rebaseEntryPaths(entry,i));
        before.entries.value = list;
        commitsPreservingOwner++;
        const updated = extract(owner);
        if (updated) syncWidget(state.el,owner,updated);
      }
      isolatedCommits++;
      await verifyDirty(route,state,true);
      return true;
    } catch(e) { failedSceneCommits++; throw e; }
    finally { state.busy = false; }
  }

  function handleNativeArrayEdit(state, nativeDump) {
    return commitRecord(state, (next) => {
      if (!Array.isArray(nativeDump?.value)) throw new Error('Array dump is not editable');
      const list = cloneDump(nativeDump.value);
      list.forEach((item, index) => rebaseEntryPaths(item, index));
      next.entries.value = list;
    });
  }

  function getFields(item) {
    const v = item?.value;
    return isObject(v) ? (v.key ? v : v.value) : null;
  }
  // Compare keys the same way a JS Record uses object property names.
  // Enum(0) and string('0') map to the same key; missing dump values are ignored.
  function getObjectKeyId(value) {
    // CCRecord custom key PoC convention: @ccclass with @property(CCString) id.
    // Inspector dump may nest the class object in a `value` wrapper.
    if (!isObject(value)) return null;
    const obj = isObject(value.value) ? value.value : value;
    const field = obj.id;
    const id = isObject(field) ? field.value : field;
    if ((typeof id === 'string' && id.length) || (typeof id === 'number' && Number.isFinite(id))) {
      return id;
    }
    return null;
  }
  function keyIdentity(value) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    const id = getObjectKeyId(value);
    return id === null ? null : `object-id:${String(id)}`;
  }
  function keyCaption(field) {
    const value = field.value;
    const option = Array.isArray(field.enumList) && field.enumList.find((o) => o?.value === value);
    if (option && option.name !== undefined) return String(option.name);
    const id = getObjectKeyId(value);
    if (id !== null) return `id=${id}`;
    if (isObject(value)) return '[custom key]';
    if (value === '') return '""';
    return String(value);
  }
  function findDuplicateKeys(entries) {
    const groups = new Map();
    for (const [index, item] of (Array.isArray(entries?.value) ? entries.value : []).entries()) {
      const keyField = getFields(item)?.key;
      if (!isObject(keyField)) continue;
      const id = keyIdentity(keyField.value);
      if (id === null) continue;
      let group = groups.get(id);
      if (!group) {
        group = { label:keyCaption(keyField), indices:[] };
        groups.set(id, group);
      }
      group.indices.push(index);
    }
    const duplicates = Array.from(groups.values()).filter((g) => g.indices.length > 1);
    return {
      duplicates,
      indices: new Set(duplicates.flatMap((g) => g.indices)),
    };
  }
  function updateDuplicateWarning(state) {
    const result = findDuplicateKeys(state.metadata?.entries);
    const count = result.duplicates.length;
    if (count) {
      const labels = result.duplicates.slice(0, 3)
        .map((item) => `${item.label} (${item.indices.length} occurrences)`);
      const remaining = count - labels.length;
      const message = 'Duplicate keys: ' + labels.join(', ') +
        (remaining ? `, and ${remaining} more` : '');
      if (state.warningText.textContent !== message) state.warningText.textContent = message;
      if (state.warning.title !== message) state.warning.title = message;
      if (state.warning.hidden) state.warning.hidden = false;
      if (!state.widget.hasAttribute('data-cvh-has-duplicates')) {
        state.widget.setAttribute('data-cvh-has-duplicates', '');
      }
    } else {
      if (!state.warning.hidden) state.warning.hidden = true;
      if (state.warning.title) state.warning.title = '';
      if (state.widget.hasAttribute('data-cvh-has-duplicates')) {
        state.widget.removeAttribute('data-cvh-has-duplicates');
      }
    }
    for (const [index, entry] of state.rowEls.entries()) {
      const isDuplicate = result.indices.has(index);
      if (isDuplicate) {
        if (!entry.row.hasAttribute('data-cvh-duplicate')) entry.row.setAttribute('data-cvh-duplicate', '');
        const rowTitle = 'Duplicate key: ' + keyCaption(getFields(state.metadata.entries.value[index]).key);
        if (entry.row.title !== rowTitle) entry.row.title = rowTitle;
      } else {
        if (entry.row.hasAttribute('data-cvh-duplicate')) entry.row.removeAttribute('data-cvh-duplicate');
        if (entry.row.title) entry.row.title = '';
      }
    }
    state.duplicateCount = count;
  }
  function scheduleValidation(state) {
    if (state.validationScheduled || !active.has(state.el)) return;
    state.validationScheduled = true;
    Promise.resolve().then(() => {
      state.validationScheduled = false;
      if (!stopped && active.get(state.el) === state) updateDuplicateWarning(state);
    });
  }
  function prepareNewEntry(metadata, index) {
    const entries = metadata.entries;
    const template = entries.elementTypeData || entries.value[entries.value.length - 1];
    if (!isObject(template)) throw new Error('No elementTypeData; expand Native array editor to add entries');
    const copy = cloneDump(template);
    const fields = getFields(copy);
    if (!fields || !isObject(fields.key) || !isObject(fields.value)) {
      throw new Error('Entry dump has unknown shape; use Native array editor');
    }
    const key = fields.key;
    const used = new Set(entries.value.map((e) => getFields(e)?.key?.value));
    const classFields = isObject(key.value) ? (isObject(key.value.value) ? key.value.value : key.value) : null;
    if (classFields && isObject(classFields.id)) {
      // Avoid copying a saved custom class key ID from the cloned template.
      const usedIds = new Set(entries.value.map((e) => getObjectKeyId(getFields(e)?.key?.value)));
      let n = index + 1;
      while (usedIds.has('key' + n)) n++;
      classFields.id.value = 'key' + n;
    } else if (Array.isArray(key.enumList) && key.enumList.length) {
      const options = key.enumList.map((opt) => opt.value).filter((v) => typeof v === 'number');
      key.value = options.find((v) => !used.has(v)) ?? options[0];
    } else if (/integer|int|number/i.test(String(key.type || key.cid || ''))) {
      let next = index;
      while (used.has(next)) next++;
      key.value = next;
    } else {
      let next = index + 1;
      while (used.has('key' + next)) next++;
      key.value = 'key' + next;
    }
    // A native elementTypeData contains factory defaults. A saved previous
    // entry is NOT a safe template: reset its references and primitives without
    // erasing the nested fields of custom @ccclass values.
    const resetField = (field) => {
      const children = isObject(field?.value) ? Object.values(field.value)
        .filter((v) => isObject(v) && Object.prototype.hasOwnProperty.call(v, 'value')) : [];
      if (children.length) {
        children.forEach(resetField);
      } else if (Object.prototype.hasOwnProperty.call(field, 'default')) {
        field.value = field.default === undefined ? null : cloneDump(field.default);
      } else {
        const type = String(field.type || field.cid || '');
        field.value = /node|asset|component/i.test(type) ? null
          : typeof field.value === 'number' ? 0
          : typeof field.value === 'boolean' ? false
          : typeof field.value === 'string' ? '' : null;
      }
      delete field.values;
    };
    resetField(fields.value);
    delete fields.key.values;
    // Paths in template dumps may contain a numeric array index.
    // Update the copied dump path only; do not mutate existing entries.
    const prev = entries.value[entries.value.length - 1];
    const oldIndex = entries.value.length - 1;
    const oldPath = typeof prev?.path === 'string' ? prev.path : '';
    const newPath = oldPath.replace(new RegExp('(\\.|\\[)' + oldIndex + '(?=\\.|\\]|$)'), '$1' + index);
    if (newPath && newPath !== oldPath) {
      const updatePaths = (obj) => {
        if (!isObject(obj) && !Array.isArray(obj)) return;
        if (typeof obj.path === 'string' && oldPath) obj.path = obj.path.replace(oldPath, newPath);
        for (const value of Object.values(obj)) if (value && typeof value === 'object') updatePaths(value);
      };
      updatePaths(copy);
    }
    return copy;
  }
  function rebaseEntryPaths(entry, newIndex) {
    // Clones from elementTypeData can carry a stale index (often always 0).
    // Rebase *all* paths under the serialized `entries` array, not just the
    // row being removed, before native Cocos ui-prop commits the new dump.
    const visit = (obj, seen = new Set()) => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);
      if (typeof obj.path === 'string') {
        obj.path = obj.path
          .replace(/(\.entries\.)\d+(?=\.|$)/, '$1' + newIndex)
          .replace(/(\.entries\[)\d+(?=\])/, '$1' + newIndex);
      }
      for (const v of Object.values(obj)) visit(v,seen);
    };
    visit(entry);
  }

  async function resizeRecord(state, requestedSize) {
    if (!Number.isSafeInteger(requestedSize) || requestedSize < 0 || requestedSize > 128) {
      throw new Error('Size must be an integer between 0 and 128');
    }
    const before = extract(state.el.dump)?.entries?.value?.length;
    if (!Number.isInteger(before)) throw new Error('Entries dump is unavailable');
    if (requestedSize === before) return false;
    if (requestedSize < before) {
      // Remove from end so existing entry indices and key/value pairs remain stable.
      // Each native remove-array-element command participates in Scene undo/dirty.
      for (let index = before - 1; index >= requestedSize; index--) {
        await deleteEntry(state, index);
      }
      return true;
    }
    // Cocos 3.8.8 exposes no add-array-element message in its Scene message map.
    // Insertion must still replace the entries dump; validate it narrowly and
    // retain ALL existing keys and values before the single Scene command.
    return commitRecord(state, (next) => {
      const { entries } = next;
      const unchanged = JSON.stringify(entries.value);
      const resized = entries.value.slice();
      while (resized.length < requestedSize) {
        resized.push(prepareNewEntry({ entries: { ...entries, value: resized } }, resized.length));
      }
      if (JSON.stringify(resized.slice(0,before)) !== unchanged) {
        throw new Error('Existing entries would be changed during append; canceled');
      }
      resized.forEach((item, i) => rebaseEntryPaths(item, i));
      entries.value = resized;
    });
  }


  function createWidget(el, dump, metadata) {
    if (!el.parentNode) return null;
    const doc = el.ownerDocument || document;
    const widget = doc.createElement('section');
    widget.className = 'cvh-global-record';
    widget.setAttribute('data-cvh-record-class', metadata.className);
    const style = doc.createElement('style');
    style.textContent = STYLE;
    widget.appendChild(style);
    const header = doc.createElement('div');
    header.className = 'cvh-global-header';
    const title = doc.createElement('div');
    title.className = 'cvh-global-title';
    const caret = doc.createElement('span'); caret.className = 'cvh-global-caret'; caret.textContent = '▾';
    const name = doc.createElement('span'); name.className = 'cvh-global-name';
    title.appendChild(caret); title.appendChild(name); header.appendChild(title);
    const sizeLabel = doc.createElement('span'); sizeLabel.className='cvh-global-size-label'; sizeLabel.textContent='SIZE';
    header.appendChild(sizeLabel);
    const size = doc.createElement('input');
    size.className='cvh-global-size'; size.setAttribute('type','number');
    size.setAttribute('min','0'); size.setAttribute('max','128'); size.setAttribute('step','1');
    size.title = 'Number of serialized entries (0–128)';
    header.appendChild(size);
    const plus = doc.createElement('button'); plus.className='cvh-global-button'; plus.textContent='+';
    plus.title='Add entry'; header.appendChild(plus);
    const advancedButton = doc.createElement('button'); advancedButton.className='cvh-global-button';
    advancedButton.textContent='⋯'; advancedButton.title='Native Cocos array editor'; header.appendChild(advancedButton);
    widget.appendChild(header);
    // Warning stays in the property header area, even when rows are collapsed.
    const warning = doc.createElement('div'); warning.className='cvh-global-warning';
    warning.setAttribute('role','alert'); warning.setAttribute('aria-live','polite');
    warning.hidden = true;
    const warningIcon = doc.createElement('span'); warningIcon.className='cvh-global-warning-icon';
    warningIcon.textContent='⚠'; warningIcon.setAttribute('aria-hidden','true');
    const warningText = doc.createElement('span'); warningText.className='cvh-global-warning-text';
    warning.appendChild(warningIcon); warning.appendChild(warningText); widget.appendChild(warning);
    const body = doc.createElement('div'); body.className='cvh-global-body';
    const cols = doc.createElement('div'); cols.className = 'cvh-global-gridhead';
    for (const c of ['KEY', 'VALUE', '']) {const span=doc.createElement('span');span.textContent=c;cols.appendChild(span);}
    body.appendChild(cols);
    const rows = doc.createElement('div'); rows.className = 'cvh-global-rows'; body.appendChild(rows);
    const advanced = doc.createElement('details'); advanced.className = 'cvh-global-advanced';
    const summary=doc.createElement('summary'); summary.textContent='Native array editor · fallback / reorder';
    advanced.appendChild(summary);
    const native = makeNative(doc, metadata.entries, 'array'); advanced.appendChild(native); body.appendChild(advanced);
    const error = doc.createElement('div'); error.className='cvh-global-error'; error.hidden=true; body.appendChild(error);
    widget.appendChild(body);
    title.addEventListener('click',()=>{
      if (widget.hasAttribute('data-cvh-collapsed')) widget.removeAttribute('data-cvh-collapsed');
      else widget.setAttribute('data-cvh-collapsed','');
    });
    advancedButton.addEventListener('click',()=>{
      widget.removeAttribute('data-cvh-collapsed'); advanced.open=!advanced.open;
    });
    el.parentNode.insertBefore(widget,el.nextSibling);
    const priorDisplay=el.style.getPropertyValue('display');
    const priorPriority=el.style.getPropertyPriority('display');
    el.style.setProperty('display','none','important');
    const record = { el,widget,name,size,rows,native,advanced,error,warning,warningText,metadata,busy:false,
      editQueue:Promise.resolve(), priorDisplay,priorPriority,rowEls:[],duplicateCount:0,validationScheduled:false };
    // Scene IPC is asynchronous. Serialize quick Key/Value edits (including
    // + followed by input) so a second event never races the first set-property.
    const enqueue = (operation, change) => {
      record.editQueue = record.editQueue.then(() => {
        if (active.get(el) !== record || !el.isConnected) return false;
        return change();
      }).catch((error) => {
        reportEditError(record, operation, error);
        return false;
      });
      return record.editQueue;
    };
    record.enqueue = enqueue;
    active.set(el,record);
    // Native ui-prop controls emit change-dump; refresh the warning after the
    // current edit propagates to the Cocos dump (without altering the edit).
    // Catch ALL nested change-dump events, including internals emitted by
    // Cocos native subcontrols, before they can propagate to Inspector.
    widget.addEventListener('change-dump', (ev) => {
      preventChildCommit(ev);
      scheduleValidation(record);
    });
    widget.addEventListener('change', (ev) => { ev.stopPropagation?.(); scheduleValidation(record); });
    native.addEventListener('change-dump', (ev) => {
      ev.stopPropagation?.();
      record.error.hidden = true;
      const changeDump = cloneDump(native.dump);
      void enqueue('native array edit',()=>handleNativeArrayEdit(record, changeDump));
    });
    const updateSize=(n)=>enqueue('size change', async()=>{
      error.hidden=true;
      size.disabled=true;
      plus.disabled=true;
      try {
        await resizeRecord(record,n);
        const latest=extract(record.el.dump);
        if (latest) syncWidget(record.el,record.el.dump,latest);
      } catch(err) {
        advanced.open=true;
        throw err;
      } finally {
        size.disabled=false;
        plus.disabled=false;
        size.value=String(extract(record.el.dump)?.entries?.value?.length ?? 0);
      }
    });
    size.addEventListener('change',(ev)=>{ev.stopPropagation?.();void updateSize(Number(size.value));});
    plus.addEventListener('click',(ev)=>{ev.stopPropagation?.();void updateSize((extract(record.el.dump)?.entries?.value?.length||0)+1);});
    return record;
  }
  function syncWidget(el,dump,metadata,refreshBaselines=false) {
    if (stopped || !el || !el.parentNode) return;
    let state=active.get(el);
    if (state && (state.widget.parentNode!==el.parentNode || state.widget.previousSibling!==el)) {
      restore(el);state=null;
    }
    if (!state) state=createWidget(el,dump,metadata);
    if (!state) return;
    state.metadata=metadata;
    const desiredName=dump.displayName||dump.name||metadata.className.replace(/^CVHRecord_/, '');
    if (state.name.textContent!==desiredName) state.name.textContent=desiredName;
    if (el.style.getPropertyValue('display')!=='none' || el.style.getPropertyPriority('display')!=='important') {
      el.style.setProperty('display','none','important');
    }
    const sizeFocused = state.size===document.activeElement;
    if (!sizeFocused && Array.isArray(metadata.entries.value)) state.size.value=String(metadata.entries.value.length);
    if (!Array.isArray(metadata.cells)) {
      state.rows.replaceChildren();state.rowEls=[];
      const hint=document.createElement('div');hint.className='cvh-global-empty';
      hint.textContent='Unknown entry metadata · use native array editor';
      state.rows.appendChild(hint);
      state.advanced.open=true;
    } else {
      const cells=metadata.cells;
      if (!cells.length) {
        if (state.rowEls.length || !state.rows.querySelector('.cvh-global-empty')) {
          const hint=document.createElement('div');hint.className='cvh-global-empty';
          hint.textContent='No entries · change SIZE or press +';state.rows.replaceChildren(hint);state.rowEls=[];
        }
      } else {
        if (state.rowEls.length!==cells.length || state.rowEls.some((r)=>!r.row.isConnected)) {
          const built=[];const frag=document.createDocumentFragment();
          for (let i=0;i<cells.length;i++) {
            const row=document.createElement('div');row.className='cvh-global-row';const props=[];
            for (let c=0;c<2;c++) {
              const cell=document.createElement('div');cell.className='cvh-global-cell';
              const prop=makeNative(document, cells[i][c], c===0?'key':'value');
              prop.setAttribute('no-label','');cell.appendChild(prop);row.appendChild(cell);props.push(prop);
              const fieldIndex = i;
              const fieldName = c === 0 ? 'key' : 'value';
              prop.addEventListener('change-dump', (ev) => {
                ev.stopPropagation?.();
                state.error.hidden = true;
                const proposed = cloneDump(prop.dump);
                void state.enqueue('field edit', () => updateField(state, fieldIndex, fieldName, proposed));
              });
            }
            const del=document.createElement('button');
            del.className='cvh-global-delete';
            del.setAttribute('type','button');
            del.setAttribute('aria-label', 'Delete entry ' + (i + 1));
            del.title='Delete entry ' + (i + 1);
            del.textContent='×';
            del.addEventListener('click', (event) => {
              event?.stopPropagation?.();
              state.error.hidden=true;
              void state.enqueue('delete entry', () => deleteEntry(state,i)).then((ok) => {
                if (!ok && !state.error.hidden) state.advanced.open=true;
              });
            });
            row.appendChild(del);
            frag.appendChild(row);built.push({row,props,del,
              snapshots: cells[i].map((field) => cloneDump(field.value))});
          }
          state.rows.replaceChildren(frag);state.rowEls=built;
        }
        const focused=state.widget.getRootNode()?.activeElement||document.activeElement;
        state.rowEls.forEach((r,i)=>{
          for (let j=0;j<2;j++) {
            // This render came from the native Inspector's latest Scene dump,
            // not our polling scan or a local ui-prop edit. Rebase snapshots
            // only for controls which are not being edited. Otherwise a normal
            // Scene refresh can leave their baseline stale indefinitely.
            if (r.props[j].contains(focused)) { skippedFocus++;continue; }
            if (refreshBaselines && !state.busy) {
              r.snapshots[j] = cloneDump(cells[i][j].value);
            }
            try {r.props[j].render(cloneDump(cells[i][j]));}
            catch(e){ lastError='field render: '+String(e); }
          }
        });
      }
    }
    const focusedNative=state.widget.getRootNode()?.activeElement||document.activeElement;
    if (!state.native.contains(focusedNative)) {
      try {state.native.render(cloneDump(metadata.entries));}catch(e){ lastError='array render: '+String(e); }
    }
    updateDuplicateWarning(state);
    recognized++;
  }

  function restore(el) {
    const state = active.get(el);
    if (!state) return;
    state.widget.remove();
    if (state.priorDisplay) el.style.setProperty('display',state.priorDisplay,state.priorPriority);
    else el.style.removeProperty('display');
    active.delete(el);
  }
  function handleRender(el, dump, fromNativeRender = false) {
    if (stopped || !el || el.hasAttribute?.('data-cvh-native-prop')) return;
    const metadata = extract(dump);
    if (!metadata && isObject(dump?.value) && isObject(dump.value.entries)) candidateObjects++;
    if (!metadata || !isInsideInspector(el)) {
      if (active.has(el)) restore(el);
      return;
    }
    // The native control renders first, we replace its *presentation* only.
    // No manual writes to scene/prefab serialization are performed here.
    try { syncWidget(el, dump, metadata, fromNativeRender); }
    catch(error) { lastError = 'sync: ' + String(error.stack || error); fallbackCount++; restore(el); }
  }
  function wrap(original) {
    return function cvhPatchedUiPropRender(...args) {
      renders++;
      const out = original.apply(this,args);
      handleRender(this,args[0] || this.dump, true);
      return out;
    };
  }
  function installPrototype() {
    const ctor = window.customElements?.get?.('ui-prop');
    if (!ctor?.prototype) return false;
    const p = ctor.prototype;
    if (typeof p.render !== 'function') return false;
    if (p === proto && p.render === wrappedRender) return true;
    if (proto) revertPrototype();
    proto = p;
    originalRender = p.render;
    wrappedRender = wrap(originalRender);
    try {
      p.render = wrappedRender;
      if (p.render !== wrappedRender) throw new Error('ui-prop.render is non-writable');
      installed = true;
      return true;
    } catch (error) {
      lastError = 'prototype patch: ' + String(error);
      proto = null; originalRender = null; wrappedRender = null;
      installed = false;
      return false;
    }
  }
  function revertPrototype() {
    if (proto && proto.render === wrappedRender) proto.render = originalRender;
    proto = null; originalRender = null; wrappedRender = null;
  }
  // Backup when ui-prop.render is a per-instance method, not a prototype method.
  function maybeWrapInstance(el) {
    if (!el || instances.has(el) || el.hasAttribute('data-cvh-native-prop')) return;
    if (typeof el.render !== 'function' || (proto && el.render === wrappedRender)) return;
    const original = el.render;
    const wrapped = wrap(original);
    try { el.render = wrapped; instances.set(el,{original,wrapped}); }
    catch(_) { /* non-writable, use prototype hook */ }
  }
  function walkRoots(root, callback, seen = new Set(), limit = 0) {
    if (!root || seen.has(root) || limit > 10) return;
    seen.add(root);
    callback(root);
    if (!root.querySelectorAll) return;
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) walkRoots(element.shadowRoot, callback, seen, limit+1);
    }
  }
  function inspectorRoots() {
    const panels = [];
    try {
      if (!panelModule) panelModule = require('@editor/panel');
      for (const panel of Array.from(panelModule.query('inspector') || [])) if (panel) panels.push(panel);
    } catch (_) {}
    if (!panels.length) {
      walkRoots(document, (root) => {
        for (const panel of root.querySelectorAll?.('ui-panel[name="inspector"], ui-panel[src*="inspector"]') || []) {
          panels.push(panel);
        }
      });
    }
    return panels.length ? panels : [document];
  }
  function scan() {
    if (stopped) return;
    installPrototype();
    for (const host of inspectorRoots()) walkRoots(host, (root) => {
      for (const el of root.querySelectorAll?.('ui-prop') || []) {
        if (!installed || Object.prototype.hasOwnProperty.call(el, 'render')) maybeWrapInstance(el);
        // Existing dump props may have been rendered before we patched render().
        // On their next Inspector refresh we'll see them through the wrapper.
        const dump = el.dump;
        if (isObject(dump)) handleRender(el,dump);
      }
    });
    for (const [el] of active) {
      if (!el.isConnected) restore(el);
    }
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    revertPrototype();
    for (const [el, value] of instances) {
      if (el.render === value.wrapped) el.render = value.original;
    }
    instances.clear();
    for (const [el] of active) restore(el);
    if (window[KEY]?.stop === stop) delete window[KEY];
  }
  window[KEY] = {
    stop,
    refresh: scan,
    stats: () => ({installed, activeRecords: active.size, patchMode: installed ? 'prototype' : (instances.size ? 'instance' : 'pending'),
      renderCalls: renders, detectedDumps: recognized, focusSkips: skippedFocus,
      fallbackCount, possibleRecordsWithoutClassMarker: candidateObjects, lastError,
      isolatedCommits, capturedChildEdits, commitsPreservingOwner,
      confirmedSceneCommits, failedSceneCommits, lastCommitRoute, lastSceneDirty, dirtyMismatchCount, fallbackSnapshots,
      recordsWithDuplicateKeys: [...active.values()].filter(x => x.duplicateCount > 0).length,
      knownRecordNames: [...active.values()].map(x => x.metadata.className).slice(0,30) }),
  };
  timer = setInterval(scan, 1200);
  scan();
  return { status: 'running', reused: false, mode: installed ? 'prototype' : 'pending' };
})();
