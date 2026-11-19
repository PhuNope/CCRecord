  // A successful Scene set-property response only confirms the IPC write.
  // Creator records unsaved changes/Undo through the Scene recording lifecycle.
  // Use the public 3.8.x API, not a synthetic Inspector change-dump that may
  // replay an older owner dump and overwrite a nested ItemStats field.
  async function withSceneRecording(route, write) {
    let recordingId;
    let started = false;
    try {
      recordingId = await route.editor.Message.request('scene', 'begin-recording', route.uuid);
      started = recordingId !== undefined && recordingId !== null && recordingId !== false;
    } catch (error) {
      // Some Creator 3.8.x builds do not expose recording in this context.
      lastError = 'Scene recording unavailable: ' + String(error?.message || error);
    }
    try {
      const result = await write();
      if (started) {
        await route.editor.Message.request('scene', 'end-recording', recordingId);
        completedSceneRecordings++;
      }
      return result;
    } catch (error) {
      if (started) {
        try { await route.editor.Message.request('scene', 'cancel-recording', recordingId); }
        catch (_) { /* retain the original write error */ }
      }
      throw error;
    }
  }

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
      const result = await withSceneRecording(route, () => route.editor.Message.request('scene', 'set-property', {
        uuid: route.uuid, path: route.path, dump: newDump, record: true,
      }));
      if (result !== true) throw new Error('Scene did not confirm set-property (result: ' + String(result) + ')');
      // The query-node result can lag behind set-property for generated CCClasses.
      // Do not show a false "Scene returned ..." failure after a confirmed edit;
      // the Scene service is authoritative and dirty verification is separate.
      confirmedSceneCommits++;
      lastCommitRoute = route.path;
      state.ownWrites.clear(); // entry indices can change after a structure edit
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
      await verifyDirty(route, state);
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
    // Keep diagnostics available without rendering orange text below Records.
    if (state.error) {
      state.error.textContent = String(err?.message || err);
      state.error.hidden = true;
    }
    console.error('[CCRecord] ' + operation + ':', err);
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

  // Scene query-node may be one or more revisions behind a successful
  // set-property (especially while typing into generated @ccclass fields).
  // Track only the values THIS Inspector has confirmed writing to a leaf.
  // A stale echo of our own earlier value is not an external modification;
  // unknown values remain genuine conflicts and are never overwritten.
  function ownWriteKey(index, column, segments) {
    return index + ':' + column + ':' + segments.join('.');
  }

  function isOwnSceneEcho(state, index, column, segments, expected, received) {
    const history = state.ownWrites?.get(ownWriteKey(index, column, segments));
    return Boolean(history && sameSerializedValue(history.latest, expected) &&
      history.previous.some(value => sameSerializedValue(value, received)));
  }

  function rememberOwnWrite(state, index, column, segments, before, after, expected) {
    const key = ownWriteKey(index, column, segments);
    const prior = state.ownWrites.get(key);
    const previous = prior && sameSerializedValue(prior.latest, expected)
      ? prior.previous.slice() : [];
    // The accepted pre-write value and earlier confirmed values are all safe
    // to recognize as lagging Scene reads, but no arbitrary external value is.
    previous.push(cloneDump(before));
    if (prior && sameSerializedValue(prior.latest, expected)) previous.push(cloneDump(expected));
    state.ownWrites.set(key, {latest: cloneDump(after), previous: previous.slice(-24)});
  }

  function isStaleOwnCell(state, index, column, candidate, baseline) {
    const differences = changedValueLeaves(baseline, candidate);
    return differences.length > 0 && differences.every(({segments}) => {
      const earlier = propertyAtSegments({value:candidate}, segments);
      const expected = propertyAtSegments({value:baseline}, segments);
      return earlier && expected && isOwnSceneEcho(state, index, column, segments,
        expected.value, earlier.value);
    });
  }

  function sceneSelectionUnchanged(route) {
    const selected = route.editor.Selection.getSelected('node') || [];
    return selected.length === 1 && selected[0] === route.uuid;
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
        if (!target || !expected) {
          throw new Error('The edited field is no longer available in the Scene');
        }
        const path = [root,...change.segments].join('.');
        if (!sameSerializedValue(target.value, expected.value) &&
            !isOwnSceneEcho(state, index, column, change.segments, expected.value, target.value)) {
          throw new Error('Field was modified outside this Inspector; reselect the node before editing');
        }
        if (column === 'key' && change.segments.length === 0 && Array.isArray(target.enumList)) {
          if (!target.enumList.some(o => o?.value === change.value)) {
            throw new Error('Selected Enum value is not part of this Enum definition');
          }
        }
        const dump = cloneDump(target);
        dump.value = cloneDump(change.value);
        return {path, dump, change, expected: cloneDump(expected.value), before: cloneDump(target.value)};
      });
      // A native ui-prop.render can replace the owner dump while a Scene IPC
      // request is in flight; that alone does NOT mean the user changed nodes.
      if (active.get(state.el) !== state || !state.el.isConnected || !sceneSelectionUnchanged(route)) {
        throw new Error('Selection changed; edit canceled');
      }
      // Commit the whole field edit as one Undo transaction, even if the
      // native control emitted edits to multiple properties of a custom class.
      await withSceneRecording(route, async () => {
        for (const preparedEdit of prepared) {
          const response = await route.editor.Message.request('scene', 'set-property', {
            uuid:route.uuid, path:preparedEdit.path, dump:preparedEdit.dump, record:true,
          });
          if (response !== true) throw new Error('Scene rejected leaf set-property: ' + String(response));
          confirmedSceneCommits++;
          lastCommitRoute = preparedEdit.path;
        }
      });
      // Only the edited leaves are applied locally. Never overwrite sibling
      // values with a stale copy of the entire ItemStats object.
      let committed = cloneDump(nativeCell.value);
      for (const {change} of prepared) committed = patchValueAtSegments(committed, change.segments, change.value);
      if (active.get(state.el) === state && state.rowEls[index] === row && sceneSelectionUnchanged(route)) {
        const latestOwner = state.el.dump;
        const latest = extract(latestOwner);
        const cell = latest?.cells?.[index]?.[columnIndex];
        if (cell) cell.value = cloneDump(committed);
        row.snapshots[columnIndex] = cloneDump(committed);
        for (const edit of prepared) {
          rememberOwnWrite(state, index, column, edit.change.segments,
            edit.before, edit.change.value, edit.expected);
        }
        commitsPreservingOwner++;
        if (latest) syncWidget(state.el, latestOwner, latest);
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

  async function verifyDirty(route, state) {
    try {
      let dirty = await route.editor.Message.request('scene', 'query-dirty');
      // A Scene recording transaction is the primary dirty/Undo mechanism.
      // Snapshot is a compatibility fallback, never an Inspector change-dump:
      // that native event would publish the hidden ui-prop's stale dump.
      if (dirty !== true) {
        await route.editor.Message.request('scene', 'snapshot');
        fallbackSnapshots++;
        dirty = await route.editor.Message.request('scene', 'query-dirty');
      }
      lastSceneDirty = dirty === true;
      state.persistenceUnverified = dirty !== true;
      if (dirty !== true) {
        dirtyMismatchCount++;
        lastError = 'Scene did not report dirty after a confirmed CCRecord edit';
        console.error('[CCRecord] ' + lastError, route.path);
      }
      return dirty === true;
    } catch (error) {
      lastSceneDirty = null;
      state.persistenceUnverified = true;
      dirtyMismatchCount++;
      lastError = 'Unable to verify Scene dirty: ' + String(error?.message || error);
      console.error('[CCRecord] ' + lastError);
      return false;
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
      const response = await withSceneRecording(route, () => route.editor.Message.request('scene', 'remove-array-element', {
        uuid: route.uuid, path: route.path, index,
      }));
      if (response === false) throw new Error('Scene rejected remove-array-element'); // 3.8.2-3.8.4 return void
      confirmedSceneCommits++;
      lastCommitRoute = route.path + '.' + index + ' (remove-array-element)';
      state.ownWrites.clear();
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
      await verifyDirty(route,state);
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
