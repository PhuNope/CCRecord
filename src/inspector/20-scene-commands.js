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
      // Keep the Inspector dump in sync before using its native event fallback.
      if (state.el.dump === owner && active.get(state.el) === state) {
        current.entries.value = draftEntries.value;
        commitsPreservingOwner++;
        const latest = extract(owner);
        if (latest) syncWidget(state.el, owner, latest);
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
        state.error.textContent = 'Scene/Prefab vẫn chưa dirty sau khi thay đổi. KHÔNG SAVE trước khi kiểm tra dữ liệu.';
        state.error.hidden = false;
      }
    } catch (error) {
      lastSceneDirty = null;
      dirtyMismatchCount++;
      state.error.textContent = 'Không kiểm tra được trạng thái dirty: ' + String(error?.message || error);
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
