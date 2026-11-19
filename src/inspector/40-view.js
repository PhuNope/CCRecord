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
      editQueue:Promise.resolve(), pendingEdits:0, failedEdits:0, persistenceUnverified:false, priorDisplay,priorPriority,rowEls:[],duplicateCount:0,validationScheduled:false };
    // Scene IPC is asynchronous. Serialize quick Key/Value edits (including
    // + followed by input) so a second event never races the first set-property.
    const enqueue = (operation, change) => {
      record.pendingEdits++;
      record.editQueue = record.editQueue.then(() => {
        if (active.get(el) !== record || !el.isConnected) return false;
        return change();
      }).catch((error) => {
        record.failedEdits++;
        reportEditError(record, operation, error);
        return false;
      }).finally(() => { record.pendingEdits--; });
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
