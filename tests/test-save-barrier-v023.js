'use strict';
// Regression: editing itemsExplicit.ItemStats.Description and pressing Ctrl+S
// while the native field still has focus must flush the value BEFORE saving.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','dist','inspector.js'),'utf8');
let doc;
function sty(){const m=new Map();return {getPropertyValue:k=>m.get(k)||'',getPropertyPriority:()=>'',setProperty:(k,v)=>m.set(k,v),removeProperty:k=>m.delete(k)};}
class El {
  constructor(tag='div'){this.localName=tag;this.nodeType=1;this.children=[];this.parentNode=null;this.attributes=new Map();this.style=sty();this.ownerDocument=doc;this.className='';this.textContent='';this.hidden=false;this.events=new Map();}
  setAttribute(k,v){this.attributes.set(k,String(v))} getAttribute(k){return this.attributes.get(k)||null} hasAttribute(k){return this.attributes.has(k)} removeAttribute(k){this.attributes.delete(k)}
  appendChild(child){if(child.frag){for(const el of [...child.children])this.appendChild(el);return child;}child.remove();this.children.push(child);child.parentNode=this;return child;}
  insertBefore(child,other){child.remove();let idx=this.children.indexOf(other);this.children.splice(idx<0?this.children.length:idx,0,child);child.parentNode=this;return child;}
  replaceChildren(...elements){for(const el of [...this.children])el.parentNode=null;this.children=[];for(const el of elements)this.appendChild(el)}
  remove(){if(!this.parentNode)return;const i=this.parentNode.children.indexOf(this);if(i>=0)this.parentNode.children.splice(i,1);this.parentNode=null;}
  get nextSibling(){const idx=this.parentNode?.children.indexOf(this);return idx>=0?this.parentNode.children[idx+1]||null:null}get previousSibling(){const i=this.parentNode?.children.indexOf(this);return i>0?this.parentNode.children[i-1]:null}
  get isConnected(){for(let el=this;el;el=el.parentNode)if(el===doc)return true;return false}
  getRootNode(){return doc}contains(el){for(let e=el;e;e=e.parentNode)if(e===this)return true;return false}
  addEventListener(name,fn){let all=this.events.get(name)||[];all.push(fn);this.events.set(name,all)}removeEventListener(name,fn){this.events.set(name,(this.events.get(name)||[]).filter(x=>x!==fn))}
  dispatchEvent(ev){for(let cur=this;cur;cur=cur.parentNode){for(const fn of cur.events.get(ev.type)||[])fn.call(cur,ev);if(ev.cancelBubble||!ev.bubbles)break;}return true}
  querySelectorAll(sel){const query=sel.split(',').map(x=>x.trim());const result=[];const visit=cur=>{for(const el of cur.children){if(query.some(s=>s==='*'||s===el.localName))result.push(el);visit(el)}};visit(this);return result}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
class UiProp extends El {constructor(){super('ui-prop')}render(dump){this.dump=dump;}}
class Doc extends El {constructor(){super('#document');this.nodeType=9;this.ownerDocument=this;this.body=new El('body');this.appendChild(this.body);this.activeElement=null}createElement(name){return name==='ui-prop'?new UiProp():new El(name)}createDocumentFragment(){let el=new El('fragment');el.frag=true;return el}}
doc=new Doc();doc.body.setAttribute('name','main');const panel=new El('ui-panel');panel.setAttribute('name','inspector');doc.body.appendChild(panel);
const w={customElements:{get(n){return n==='ui-prop'?UiProp:null}}};
const context={window:w,document:doc,Event,console,require(n){assert.equal(n,'@editor/panel');return {query(){return [panel]}}},setInterval(){return 1},clearInterval(){},setTimeout};
assert.equal(vm.runInNewContext(source,context).status,'running');
const clone=v=>JSON.parse(JSON.stringify(v));
const cell=(name,value,type='String')=>({name,value,type});
const entry=()=>({cid:'CVHRecordEntry_String_CVHItemStatsV1',value:{key:cell('key','sword'),value:{name:'value',cid:'CVHItemStatsV1',type:'Object',value:{description:cell('description','initial'),damage:cell('damage',10,'Integer')}}}});
const record=()=>({name:'itemsExplicit',cid:'CVHRecord_String_CVHItemStatsV1',type:'Object',value:{entries:{name:'entries',type:'Array',value:[entry()],elementTypeData:entry()}}});
const scene=record();
const stats={requests:[],dirty:false,recording:0,ended:0,saves:[],nativeEvents:0};
const editor={Selection:{getSelected(){return ['node-A']}},Message:{async request(topic,method,opt){
  assert.equal(topic,'scene');
  if(method==='query-node')return {__comps__:[{value:{itemsExplicit:clone(scene)}}]};
  if(method==='query-dirty')return stats.dirty;
  if(method==='begin-recording'){stats.recording++;return 'undo-'+stats.recording;}
  if(method==='end-recording'){stats.ended++;stats.dirty=true;return true;}
  if(method==='cancel-recording')return true;
  if(method==='snapshot')throw Error('Unexpected snapshot; recording should mark scene dirty');
  if(method==='set-property'){
    // Make the IPC asynchronous: direct native Ctrl+S could race this write.
    await new Promise(resolve=>setTimeout(resolve,8));
    assert.equal(opt.path,'__comps__.0.itemsExplicit.entries.0.value.description');
    scene.value.entries.value[0].value.value.value.description.value=opt.dump.value;
    stats.requests.push(opt.path);
    return true;
  }
  if(method==='save-scene'){
    assert.equal(stats.dirty,true, 'save must be preceded by a committed dirty Scene');
    stats.saves.push(clone(scene.value.entries.value[0].value.value.value));
    stats.dirty=false;
    return true;
  }
  throw Error('Unexpected Scene method: '+method);
}}};w.Editor=editor;context.Editor=editor;
panel.addEventListener('change-dump',()=>{stats.nativeEvents++});
const original=new UiProp();panel.appendChild(original);original.render(clone(scene));
function find(el,c){if(el.className===c)return el;for(const child of el.children){const match=find(child,c);if(match)return match}return null}
async function main(){
  const widget=original.nextSibling;
  const row=find(widget,'cvh-global-rows').children[0];
  const value=row.querySelectorAll('ui-prop')[1];
  const input=new El('input');value.appendChild(input);
  doc.activeElement=input;
  input.blur=()=>{
    value.dump.value.description.value='description typed before Ctrl+S';
    value.dispatchEvent(new Event('change-dump',{bubbles:true}));
    doc.activeElement=null;
  };
  let prevented=false;
  const key=new Event('keydown',{bubbles:true,cancelable:true});
  Object.defineProperties(key,{key:{value:'s'},ctrlKey:{value:true},preventDefault:{value(){prevented=true}},stopImmediatePropagation:{value(){}}});
  input.dispatchEvent(key);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(prevented,true,'CCRecord must serialize Ctrl+S through its Scene write');
  assert.equal(stats.saves.length,1);
  assert.equal(stats.saves[0].description.value,'description typed before Ctrl+S');
  assert.equal(stats.recording,1);
  assert.equal(stats.ended,1);
  assert.equal(stats.nativeEvents,0,'no synthetic native change-dump after save');
  assert.equal(w.__CCRECORD_INSPECTOR_HOOK__.stats().shortcutSaves,1);
  assert.equal(find(widget,'cvh-global-error').hidden,true);
  // Some native controls change ui-prop.dump on blur without emitting a
  // change-dump event. The save gate must detect and commit that field too.
  doc.activeElement=input;
  input.blur=()=>{
    value.dump.value.description.value='typed without change-dump';
    doc.activeElement=null;
  };
  const secondKey=new Event('keydown',{bubbles:true,cancelable:true});
  Object.defineProperties(secondKey,{key:{value:'s'},ctrlKey:{value:true},stopImmediatePropagation:{value(){}}});
  input.dispatchEvent(secondKey);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(stats.saves.length,2);
  assert.equal(stats.saves[1].description.value,'typed without change-dump');
  assert.equal(stats.recording,2);
  assert.equal(stats.ended,2);
  // Ctrl+S elsewhere is NOT intercepted by CCRecord's save gate.
  const outside=new El('input');panel.appendChild(outside);doc.activeElement=outside;
  const e=new Event('keydown',{bubbles:true,cancelable:true});Object.defineProperties(e,{key:{value:'s'},ctrlKey:{value:true}});
  outside.dispatchEvent(e);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(stats.saves.length,2);
  w.__CCRECORD_INSPECTOR_HOOK__.stop();
  console.log('PASS v0.2.3: itemsExplicit.Description blur -> async Scene IPC + undo -> dirty -> Ctrl+S save; native shortcut unaffected elsewhere');
}
main().catch(error=>{console.error(error);process.exitCode=1});
