'use strict';
// Regression for Creator 3.8.8: multiple change-dump events while typing in
// itemsExplicit.Value.Description, with lagging Scene query-node, a native
// Inspector rerender and a focus nested inside ui-prop's Shadow DOM.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'inspector.js'), 'utf8');
let doc;
function style(){const vals=new Map();return {getPropertyValue:k=>vals.get(k)||'', getPropertyPriority:()=>'', setProperty:(k,v)=>vals.set(k,v),removeProperty:k=>vals.delete(k)};}
class El {
  constructor(tag='div') {this.localName=tag;this.nodeType=1;this.children=[];this.parentNode=null;this.attributes=new Map();this.style=style();this.ownerDocument=doc;this.className='';this.textContent='';this.hidden=false;this.events=new Map();}
  setAttribute(k,v){this.attributes.set(k,String(v));}getAttribute(k){return this.attributes.get(k)||null;}hasAttribute(k){return this.attributes.has(k);}removeAttribute(k){this.attributes.delete(k);}
  appendChild(child){if(child.frag){for(const x of [...child.children])this.appendChild(x);return child;}child.remove?.();this.children.push(child);child.parentNode=this;return child;}
  insertBefore(child,next){child.remove?.();const at=this.children.indexOf(next);this.children.splice(at<0?this.children.length:at,0,child);child.parentNode=this;return child;}
  replaceChildren(...children){for(const c of this.children)c.parentNode=null;this.children=[];for(const c of children)this.appendChild(c);}
  remove(){if(!this.parentNode)return;const i=this.parentNode.children.indexOf(this);if(i>=0)this.parentNode.children.splice(i,1);this.parentNode=null;}
  get nextSibling(){const i=this.parentNode?.children.indexOf(this);return i>=0?this.parentNode.children[i+1]||null:null;}
  get previousSibling(){const i=this.parentNode?.children.indexOf(this);return i>0?this.parentNode.children[i-1]:null;}
  get isConnected(){for(let p=this;p;p=p.parentNode)if(p===doc)return true;return false;}
  getRootNode(){return doc;}
  contains(other){for(let p=other;p;p=p.parentNode)if(p===this)return true;return false;}
  addEventListener(name,fn){const list=this.events.get(name)||[];list.push(fn);this.events.set(name,list);}
  removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){for(let node=this;node;node=node.parentNode){for(const fn of node.events?.get?.(event.type)||[])fn.call(node,event);if(event.cancelBubble||!event.bubbles)break;}return true;}
  querySelectorAll(selector){const select=selector.split(',').map(x=>x.trim());const out=[];const walk=(node)=>{for(const el of node.children){if(select.some(x=>x==='*'||x===el.localName))out.push(el);walk(el);}};walk(this);return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
class UiProp extends El {constructor(){super('ui-prop');this.calls=0;}render(dump){this.dump=dump;this.calls++;}}
class Doc extends El {constructor(){super('#document');this.nodeType=9;this.ownerDocument=this;this.body=new El('body');this.appendChild(this.body);this.activeElement=null;}createElement(name){return name==='ui-prop'?new UiProp():new El(name);}createDocumentFragment(){const el=new El('fragment');el.frag=true;return el;}}
doc=new Doc();doc.body.setAttribute('name','main');const panel=new El('ui-panel');panel.setAttribute('name','inspector');doc.body.appendChild(panel);
const window={customElements:{get(name){return name==='ui-prop'?UiProp:null;}}};
const context={window,document:doc,console,setInterval(){return 1;},clearInterval(){},setTimeout,Event,require(){return {query(){return [panel];}}}};
assert.equal(vm.runInNewContext(source,context).status,'running');
const clone=x=>JSON.parse(JSON.stringify(x));
const field=(name,value,type='String')=>({name,value,type});
const entry=()=>({cid:'CVHRecordEntry_String_CVHItemStatsV1',value:{key:field('key','key1'),value:{name:'value',cid:'CVHItemStatsV1',type:'Object',value:{description:field('description',''),damage:field('damage',10,'Integer')}}}});
const record=()=>({name:'itemsExplicit',cid:'CVHRecord_String_CVHItemStatsV1',type:'Object',value:{entries:{name:'entries',type:'Array',value:[entry()],elementTypeData:entry()}}});
const scene=record();
const getScene=()=>({__comps__:[{value:{itemsExplicit:clone(scene)}}]});
let staleReplies=0, staleScene=null, injectedNativeRender=false;
const state={dirty:false, errors:[],writes:[],saves:[],recordings:0, ends:0};
const loggedConsole={...console,error(...args){state.errors.push(args.map(String).join(' '));}};
// Logger must capture internal errors without falsely failing the known external conflict check.
context.console=loggedConsole;
const editor={Selection:{getSelected(){return ['node-A'];}},Message:{async request(topic,method,arg){
  assert.equal(topic,'scene');
  if(method==='query-node') {if(staleReplies-->0)return clone(staleScene);return getScene();}
  if(method==='query-dirty')return state.dirty;
  if(method==='begin-recording')return 'undo-'+(++state.recordings);
  if(method==='end-recording'){state.ends++;state.dirty=true;return true;}
  if(method==='cancel-recording')return true;
  if(method==='snapshot')throw Error('Scene recording unexpectedly failed to dirty');
  if(method==='set-property') {
    assert.equal(arg.path,'__comps__.0.itemsExplicit.entries.0.value.description');
    assert.equal(arg.record,true);
    const oldScene=getScene();
    await new Promise(resolve=>setTimeout(resolve,3));
    // Creator may rerender the original native Inspector control with the
    // previous dump before the previous Scene change is fully visible.
    if(!injectedNativeRender){injectedNativeRender=true;original.render(clone(oldScene.__comps__[0].value.itemsExplicit));}
    staleScene=oldScene;
    scene.value.entries.value[0].value.value.value.description.value=arg.dump.value;
    staleReplies=1;
    state.writes.push(arg.dump.value);
    return true;
  }
  if(method==='save-scene'){state.saves.push(clone(scene.value.entries.value[0].value.value.value.description.value));state.dirty=false;return true;}
  throw Error('Unexpected Scene IPC '+method);
}}};window.Editor=editor;context.Editor=editor;
const original=new UiProp();panel.appendChild(original);original.render(clone(scene));
const find=(node,name)=>{if(node.className===name)return node;for(const child of node.children){const result=find(child,name);if(result)return result;}return null;};
const widget=original.nextSibling,rows=find(widget,'cvh-global-rows');
const value=rows.children[0].querySelectorAll('ui-prop')[1];
// The real native input is under Shadow DOM: document.activeElement is the
// ui-prop host, NOT the actual input. Its input's parent has host=value.
const focusedInput=new El('input');focusedInput.parentNode={host:value,parentNode:null};
value.shadowRoot={activeElement:focusedInput};doc.activeElement=value;
async function tick(){await new Promise(resolve=>setTimeout(resolve,0));}
async function main(){
  // Queue several revisions before the previous IPC write finishes.
  for(const text of ['a','ab','abc','abcd','abcde','abcdef']){
    value.dump.value.description.value=text;
    value.dispatchEvent(new Event('change-dump',{bubbles:true}));
  }
  await new Promise(resolve=>setTimeout(resolve,160));
  assert.deepEqual(state.writes, ['a','ab','abc','abcd','abcde','abcdef']);
  assert.equal(scene.value.entries.value[0].value.value.value.description.value,'abcdef');
  assert.equal(state.errors.length,0,'own stale Scene revisions must not appear as external changes');
  assert.equal(value.dump.value.description.value,'abcdef','native render must not erase focused input');
  assert.equal(state.recordings,6);
  assert.equal(state.ends,6);
  assert.equal(state.dirty,true);
  // During the brief stale query window, a refreshed native Inspector render
  // must not rewind the committed baseline, even when the field is blurred.
  doc.activeElement=null;value.shadowRoot.activeElement=null;
  const before=value.calls;
  const older=clone(scene);older.value.entries.value[0].value.value.value.description.value='abcde';
  original.render(older);
  assert.equal(value.dump.value.description.value,'abcdef');
  assert.equal(value.calls,before,'stale native echo must not re-render our confirmed value');
  // Next keystroke remains editable after this transient stale refresh.
  doc.activeElement=value;value.shadowRoot.activeElement=focusedInput;
  value.dump.value.description.value='abcdefg';
  value.dispatchEvent(new Event('change-dump',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(scene.value.entries.value[0].value.value.value.description.value,'abcdefg');
  assert.equal(state.errors.length,0);
  // Ctrl+S from inside the shadow-hosted input must save exactly the final value.
  focusedInput.blur=()=>{doc.activeElement=null;value.shadowRoot.activeElement=null;};
  const shortcut=new Event('keydown',{bubbles:true,cancelable:true});
  let intercepted=false;
  Object.defineProperties(shortcut,{key:{value:'s'},ctrlKey:{value:true},preventDefault:{value(){intercepted=true;}},stopImmediatePropagation:{value(){}}});
  value.dispatchEvent(shortcut);
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal(intercepted,true);
  assert.deepEqual(state.saves,['abcdefg']);
  assert.equal(state.errors.length,0);
  // A truly foreign value is STILL a conflict. A normal pending Editor edit
  // must never clobber someone else's newly written Description.
  staleReplies=0;
  scene.value.entries.value[0].value.value.value.description.value='EXTERNAL';
  value.dump.value.description.value='unknown external overwrite';
  value.dispatchEvent(new Event('change-dump',{bubbles:true}));
  await tick();await tick();
  assert.equal(scene.value.entries.value[0].value.value.value.description.value,'EXTERNAL');
  assert.ok(state.errors.some(x=>x.includes('Field was modified outside this Inspector')));
  window.__CCRECORD_INSPECTOR_HOOK__.stop();
  console.log('PASS v0.2.4: rapid nested typing, lagging Scene queries, shadow focus, native rerender, Ctrl+S persistence and genuine conflict');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
