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
      // Cache the serialized key/value values (not dump paths) to detect an
      // accidental reset of older entries after appending.
      const oldValues = before.map(e => {
        const fields = getFields(e);
        return fields ? [cloneDump(fields.key?.value), cloneDump(fields.value?.value)] : null;
      });
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
      // + / increasing SIZE: query the authoritative Scene again. If a
      // softReload discarded this generated CCClass or old key/value pairs,
      // display a red error and instruct the user NOT TO SAVE this scene.
      if (draftEntries.value.length > before.length) {
        const latestNode = await route.editor.Message.request('scene','query-node',route.uuid);
        const latestProperty = locateComponentDump(latestNode, route);
        const remote = extract(latestProperty);
        const actual = remote?.entries?.value;
        let safe = Array.isArray(actual) && actual.length === draftEntries.value.length;
        if (safe) for (let i = 0; i < oldValues.length; i++) {
          const fields = getFields(actual[i]);
          if (!fields || JSON.stringify([fields.key.value,fields.value.value]) !== JSON.stringify(oldValues[i])) {
            safe = false; break;
          }
        }
        if (!safe) {
          throw new Error('Scene trả về Record bị thay đổi hoặc thiếu class sau thao tác thêm entry. KHÔNG SAVE scene; dùng Undo rồi reload.');
        }
      }
      confirmedSceneCommits++;
      lastCommitRoute = route.path;
      // + / SIZE growth is always a structural edit. Ensure the Scene/Prefab
      // participates in the undo/dirty system, even if set-property itself
      // did not publish a dirty change in this Editor build.
      await verifyDirty(route, state, true);
      // Update presentation only after Scene confirmed. No second change-dump
      // event: that would perform the same operation twice and can reset dumps.
      if (state.el.dump === owner && active.get(state.el) === state) {
        current.entries.value = draftEntries.value;
        commitsPreservingOwner++;
        const latest = extract(owner);
        if (latest) syncWidget(state.el, owner, latest);
      }
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

  // v0.8.3: A Key/Value change is a LEAF edit, not a replacement of the
  // serialized CCRecordEntry[] array. This is especially important for Enum
  // dropdowns: rewriting the array unnecessarily forces CCClass reconstruction.
  // Use the Scene's *fresh* leaf dump so the paired value and every sibling
  // remain untouched. Never trigger a second change-dump event.
  async function commitLeaf(state, index, column, editedDump) {
    if (stopped || active.get(state.el) !== state || !state.el.isConnected) return false;
    if (state.busy) throw new Error('A Record edit is already in progress');
    state.busy = true;
    try {
      if (!Number.isInteger(index) || index < 0 || (column !== 'key' && column !== 'value')) {
        throw new Error('Invalid entry edit');
      }
      if (!isObject(editedDump) || !Object.prototype.hasOwnProperty.call(editedDump, 'value')) {
        throw new Error('Edited Key/Value dump has no value');
      }
      const owner = state.el.dump;
      const current = extract(owner);
      if (!current?.cells?.[index]?.[column === 'key' ? 0 : 1]) {
        throw new Error('Record entry changed. Re-select the node before editing.');
      }
      if (owner?.isMultiple || owner?.values?.length > 1) {
        throw new Error('Multi-selection editing is unsupported');
      }
      const route = await resolveSceneProperty(state, owner);
      const remote = extract(route.sceneProperty);
      if (!remote?.cells || remote.cells.length !== current.cells.length) {
        throw new Error('Scene and Inspector entries are out of sync; edit canceled');
      }
      const cellNumber = column === 'key' ? 0 : 1;
      // Ensure the target has not changed while the popup was open.
      const nativeCell = remote.cells[index][cellNumber];
      const originalCell = current.cells[index][cellNumber];
      const sameValue = (a,b) => {
        try { return JSON.stringify(a) === JSON.stringify(b); }
        catch (_) { return a === b; }
      };
      if (!sameValue(nativeCell.value, originalCell.value)) {
        throw new Error('The Scene has newer data than this dropdown. Re-select node and try again.');
      }
      const updatedValue = cloneDump(editedDump.value);
      if (sameValue(updatedValue, nativeCell.value)) return false;
      if (column === 'key' && Array.isArray(nativeCell.enumList)) {
        const allowed = nativeCell.enumList.some(o => o?.value === updatedValue);
        if (!allowed) throw new Error('Selected Enum value is not present in this Enum definition.');
      }
      const leafDump = cloneDump(nativeCell);
      leafDump.value = updatedValue;
      const path = `${route.path}.${index}.${column}`;
      if (state.el.dump !== owner || active.get(state.el) !== state || !state.el.isConnected) {
        throw new Error('Selection changed; edit canceled');
      }
      const response = await route.editor.Message.request('scene', 'set-property', {
        uuid: route.uuid, path, dump: leafDump, record: true,
      });
      if (response !== true) throw new Error('Scene rejected leaf set-property: ' + String(response));
      confirmedSceneCommits++;
      lastCommitRoute = path;
      // Sync only the edited leaf. The VALUE beside an edited KEY is never
      // modified, and all other record/component properties are untouched.
      if (state.el.dump === owner && active.get(state.el) === state) {
        originalCell.value = updatedValue;
        commitsPreservingOwner++;
        const latest = extract(owner);
        if (latest) syncWidget(state.el, owner, latest);
      }
      isolatedCommits++;
      await verifyDirty(route, state);
      return true;
    } catch (e) {
      failedSceneCommits++;
      throw e;
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
      if (response !== true) throw new Error('Scene rejected remove-array-element: ' + String(response));
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
