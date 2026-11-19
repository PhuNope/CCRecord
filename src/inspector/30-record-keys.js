  function getFields(item) {
    const v = item?.value;
    return isObject(v) ? (v.key ? v : v.value) : null;
  }
  // An object-reference key (Node / Asset / Component) is serialized by
  // Creator as a UUID, often wrapped in {uuid} or {uuid:{value}}. Its display
  // name is not a stable identity. Never count null/unassigned references.
  function referenceUuid(field) {
    const raw = field?.value;
    const typeName = String(field?.cid || field?.type || '');
    const referenceType = /(?:^|\.)(?:Node|Asset|Component)$/.test(typeName) ||
      /(?:^|\.)\w*(?:Asset|Component)$/.test(typeName);
    const unwrapUuid = (value) => {
      let item = value;
      for (let depth = 0; depth < 4; depth++) {
        if (typeof item === 'string') return item.length ? item : null;
        if (!isObject(item)) return null;
        if (Object.prototype.hasOwnProperty.call(item, 'value')) item = item.value;
        else return null;
      }
      return null;
    };
    // Some Creator 3.8 dump variants carry a direct string UUID.
    if (typeof raw === 'string') return referenceType ? unwrapUuid(raw) : null;
    if (!isObject(raw)) return null;
    for (const candidate of [raw, isObject(raw.value) ? raw.value : null]) {
      if (!candidate) continue;
      if (Object.prototype.hasOwnProperty.call(candidate, 'uuid')) {
        return unwrapUuid(candidate.uuid);
      }
      if (Object.prototype.hasOwnProperty.call(candidate, '__uuid__')) {
        return unwrapUuid(candidate.__uuid__);
      }
    }
    return null;
  }
  function getObjectKeyId(value) {
    // Custom @ccclass keys with a serializable `id` field. This is separate
    // from object references (which use UUID identity, not the key's id).
    if (!isObject(value)) return null;
    const obj = isObject(value.value) ? value.value : value;
    const field = obj.id;
    const id = isObject(field) ? field.value : field;
    if ((typeof id === 'string' && id.length) || (typeof id === 'number' && Number.isFinite(id))) {
      return id;
    }
    return null;
  }
  function keyIdentity(field) {
    const refId = referenceUuid(field);
    if (refId !== null) return 'reference:' + refId;
    const value = field?.value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // Ignore unassigned Node references; do not confuse them with empty keys.
      if (value === '' && /(?:^|\.)Node$/.test(String(field.cid || field.type || ''))) return null;
      return 'primitive:' + String(value);
    }
    const id = getObjectKeyId(value);
    return id === null ? null : 'object-id:' + String(id);
  }
  function keyCaption(field) {
    const value = field.value;
    const option = Array.isArray(field.enumList) && field.enumList.find((o) => o?.value === value);
    if (option && option.name !== undefined) return String(option.name);
    const uuid = referenceUuid(field);
    if (uuid !== null) return 'Node ' + uuid;
    const id = getObjectKeyId(value);
    if (id !== null) return 'id=' + id;
    if (isObject(value)) return '[custom key]';
    if (value === null) return '[unassigned]';
    if (value === '') return '""';
    return String(value);
  }
  function findDuplicateKeys(entries) {
    const groups = new Map();
    for (const [index, item] of (Array.isArray(entries?.value) ? entries.value : []).entries()) {
      const keyField = getFields(item)?.key;
      if (!isObject(keyField)) continue;
      const id = keyIdentity(keyField);
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
    if (referenceUuid(key) !== null || /(?:^|\.)(?:Node|Asset|Component)$/.test(String(key.cid || key.type || ''))) {
      // A cloned entry must never inherit the previous Node/Asset key.
      key.value = null;
    } else if (classFields && isObject(classFields.id)) {
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

