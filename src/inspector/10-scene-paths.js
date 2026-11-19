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

  // Atomically edit ONLY one Record's entries. The caller's original dump is
  // not touched until the Scene service has confirmed set-property. The Scene
  // service owns the dirty flag and undo stack, including prefab stage edits.
