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
  function activeNativeInput() {
    // Inputs rendered by ui-prop usually live in nested shadow roots.
    let focused = document.activeElement;
    for (let i = 0; i < 12 && focused?.shadowRoot?.activeElement; i++) {
      focused = focused.shadowRoot.activeElement;
    }
    return focused;
  }

  function recordForShortcut(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const focused = activeNativeInput();
    for (const state of active.values()) {
      if (path.includes(state.widget) || (focused && state.widget.contains(focused))) return state;
    }
    return null;
  }

  // The native string editor may wait for blur before it emits change-dump.
  // Without this barrier, Ctrl+S can save BEFORE the async Scene IPC write.
  let shortcutSaving = false;
  async function saveAfterPendingEdits(selectedState) {
    if (shortcutSaving) return;
    shortcutSaving = true;
    try {
      const states = [...new Set([
        ...(selectedState ? [selectedState] : []),
        ...[...active.values()].filter(x => x.pendingEdits > 0),
      ])];
      const failedBefore = states.map(x => x.failedEdits);
      // Let ui-input finish its blur/change handlers before sampling ui-prop.
      await Promise.resolve();
      if (typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0));
      for (const state of states) {
        for (let retry = 0; retry < 5 && state.pendingEdits > 0; retry++) await state.editQueue;
        if (active.get(state.el) !== state) continue;
        // change-dump can be deferred by nested custom @ccclass controls.
        // Flush a modified dump explicitly if the blur handler did not emit it.
        for (let i = 0; i < state.rowEls.length; i++) {
          const row = state.rowEls[i];
          for (let c = 0; c < 2; c++) {
            const prop = row.props[c];
            if (!prop?.dump || !Array.isArray(row.snapshots)) continue;
            if (changedValueLeaves(row.snapshots[c], prop.dump.value).length) {
              const proposed = cloneDump(prop.dump);
              await state.enqueue('save pending field', () => updateField(state, i, c === 0 ? 'key' : 'value', proposed));
            }
          }
        }
        await state.editQueue;
      }
      if (states.some((state, i) => state.failedEdits > failedBefore[i])) {
        console.error('[CCRecord] Save canceled: a Record edit failed; see Inspector Diagnostics.');
        return;
      }
      const editor = window.Editor || (typeof Editor !== 'undefined' ? Editor : null);
      if (!editor?.Message?.request) return;
      // Explicit save after IPC completion: native Ctrl+S would otherwise race
      // the Scene write even when the dirty indicator updates correctly.
      await editor.Message.request('scene','save-scene');
      shortcutSaves++;
    } catch (error) {
      lastError = 'Save after edit: ' + String(error?.stack || error);
      console.error('[CCRecord] ' + lastError);
    } finally { shortcutSaving = false; }
  }

  function handleSaveShortcut(event) {
    if (stopped || !((event.ctrlKey || event.metaKey) && !event.altKey &&
        String(event.key || '').toLowerCase() === 's')) return;
    const target = recordForShortcut(event);
    const pending = [...active.values()].some(state => state.pendingEdits > 0);
    if (!target && !pending) return; // ordinary Creator Ctrl+S remains untouched
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    // First blur to propagate the pending string value into its native dump.
    const focused = activeNativeInput();
    if (target && focused && typeof focused.blur === 'function') focused.blur();
    void saveAfterPendingEdits(target);
  }
  document.addEventListener('keydown', handleSaveShortcut, true);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener?.('keydown', handleSaveShortcut, true);
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
      confirmedSceneCommits, failedSceneCommits, lastCommitRoute, lastSceneDirty, dirtyMismatchCount, fallbackSnapshots, completedSceneRecordings, shortcutSaves,
      recordsWithDuplicateKeys: [...active.values()].filter(x => x.duplicateCount > 0).length,
      knownRecordNames: [...active.values()].map(x => x.metadata.className).slice(0,30) }),
  };
  timer = setInterval(scan, 1200);
  scan();
  return { status: 'running', reused: false, mode: installed ? 'prototype' : 'pending' };
})();
