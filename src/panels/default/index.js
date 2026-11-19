'use strict';

/** Thin UI adapter. All filesystem and AssetDB operations belong to the main process. */
module.exports = Editor.Panel.define({
  template: `
    <section class="ccrecord-panel">
      <header><h2>CCRecord</h2><small>db://ccrecord/CCRecord (read-only mount)</small></header>
      <h3>Test files</h3>
      <p>Choose the demo scripts to import or update at <code>db://assets/CCRecordTests</code>.</p>
      <div class="selection"><label><input id="select-all" type="checkbox" checked> Select all</label></div>
      <div id="file-list" class="file-list" role="group" aria-label="Available test scripts"></div>
      <div class="actions">
        <button id="import" type="button">Import / Update selected</button>
        <button id="refresh" type="button">Refresh list</button>
      </div>
      <h3>Inspector</h3>
      <div class="actions"><button id="reload" type="button">Reload hook</button><button id="diagnose" type="button">Diagnostics</button></div>
      <pre id="output" aria-live="polite">Select files, then click Import / Update.</pre>
    </section>`,
  style: `
    .ccrecord-panel{box-sizing:border-box;padding:16px;overflow:auto;height:100%;font-size:12px;line-height:1.5;color:var(--color-normal-contrast,#e6e6e6)}
    h2{margin:0 0 4px;font-size:18px;color:var(--color-normal-contrast,#e6e6e6)}header small{opacity:.78;color:inherit}h3{font-size:13px;margin:18px 0 4px;color:inherit}p{margin:4px 0 12px;opacity:.88;color:inherit}
    code{word-break:break-all}.file-list{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--color-default-border,#454545);border-radius:4px;max-height:260px;overflow:auto}
    .file-list label,.selection label{display:flex;gap:7px;align-items:center;cursor:pointer;color:inherit;min-height:20px}.file-list label span{color:inherit}.selection{margin-bottom:8px}
    .actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}button{color:var(--color-normal-contrast,#e6e6e6);background:var(--color-default-fill,#393939);border:1px solid var(--color-default-border,#555);border-radius:4px;padding:6px 10px;cursor:pointer}
    button:hover:not(:disabled){filter:brightness(1.2)}button:disabled{opacity:.5;cursor:default}
    pre{color:var(--color-normal-contrast,#e6e6e6);white-space:pre-wrap;word-break:break-word;margin-top:12px;padding:10px;background:var(--color-normal-fill-emphasis,#252525);border-radius:4px;min-height:48px}
  `,
  $: {
    list:'#file-list', selectAll:'#select-all', import:'#import', refresh:'#refresh',
    reload:'#reload', diagnose:'#diagnose', output:'#output',
  },
  methods: {
    selectedFiles() {
      return [...this.$.list.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
    },
    async loadFiles() {
      const files = await Editor.Message.request('ccrecord','list-test-files');
      // No HTML injection: static labels rendered using textContent.
      this.$.list.replaceChildren();
      for (const name of files) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type='checkbox'; checkbox.value=name; checkbox.checked=true;
        const caption = document.createElement('span'); caption.textContent=name;
        label.append(checkbox,caption); this.$.list.append(label);
      }
      this.$.selectAll.checked=true;
      this.$.import.disabled = files.length === 0;
      this.$.output.textContent=`${files.length} test files available. Runtime is mounted automatically.`;
    },
    async action(message, args) {
      const controls=[this.$.import,this.$.refresh,this.$.reload,this.$.diagnose];
      controls.forEach(el=>el.disabled=true);
      this.$.output.textContent='Running '+message+'...';
      try {
        const result = await Editor.Message.request('ccrecord',message,...args);
        this.$.output.textContent=JSON.stringify(result,null,2);
        if (result?.status === 'error' || result?.status === 'refresh-failed') this.$.output.textContent='ATTENTION: '+this.$.output.textContent;
      } catch(error) {
        this.$.output.textContent='ERROR: '+String(error);
      } finally {controls.forEach(el=>el.disabled=false);}
    },
  },
  ready() {
    const refresh = () => this.loadFiles().catch(error => {this.$.output.textContent='ERROR: '+String(error);});
    this.$.selectAll.addEventListener('change',()=>{
      this.$.list.querySelectorAll('input[type="checkbox"]').forEach(el=>{el.checked=this.$.selectAll.checked;});
    });
    this.$.import.addEventListener('click',()=>{
      const files=this.selectedFiles();
      if (!files.length) {this.$.output.textContent='Select at least one test file.';return;}
      void this.action('import-test-files',[files]);
    });
    this.$.refresh.addEventListener('click',refresh);
    this.$.reload.addEventListener('click',()=>void this.action('reload-inspector',[]));
    this.$.diagnose.addEventListener('click',()=>void this.action('diagnostics',[]));
    refresh();
  },
});
