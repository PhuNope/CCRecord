'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','dist','inspector.js'),'utf8');
let doc;
function sty(){const vals=new Map(), priorities=new Map();return {getPropertyValue:k=>vals.get(k)||'',getPropertyPriority:k=>priorities.get(k)||'',setProperty:(k,v,p)=>{vals.set(k,v);priorities.set(k,p||'')},removeProperty:k=>{vals.delete(k);priorities.delete(k)}};}
class El {
 constructor(tag='div'){this.localName=tag;this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.attributes=new Map();this.parentNode=null;this.style=sty();this.ownerDocument=doc;this.className='';this.textContent='';this.hidden=false;this._handlers=new Map();}
 setAttribute(k,v){this.attributes.set(k,String(v))}getAttribute(k){return this.attributes.get(k)||null}hasAttribute(k){return this.attributes.has(k)}removeAttribute(k){this.attributes.delete(k)}
 appendChild(child){if(child.__frag){for(const c of [...child.children])this.appendChild(c);return child;}if(child.parentNode)child.remove();this.children.push(child);child.parentNode=this;return child;}
 insertBefore(child,before){if(child.parentNode)child.remove();const at=this.children.indexOf(before);this.children.splice(at<0?this.children.length:at,0,child);child.parentNode=this;return child;}
 get previousSibling(){const at=this.parentNode?.children.indexOf(this);return at>0?this.parentNode.children[at-1]:null}get nextSibling(){const at=this.parentNode?.children.indexOf(this);return at>=0?this.parentNode.children[at+1]||null:null}
 replaceChildren(...children){for(const c of this.children)c.parentNode=null;this.children=[];for(const c of children)this.appendChild(c)}
 remove(){if(!this.parentNode)return;const at=this.parentNode.children.indexOf(this);if(at>=0)this.parentNode.children.splice(at,1);this.parentNode=null;}
 contains(el){for(let cur=el;cur;cur=cur.parentNode)if(cur===this)return true;return false}
 get isConnected(){for(let cur=this;cur;cur=cur.parentNode)if(cur===doc)return true;return false}
 getRootNode(){return doc}
 addEventListener(name,fn){let a=this._handlers.get(name);if(!a)this._handlers.set(name,a=[]);a.push(fn);}
 dispatchEvent(ev){if(!ev.target){try{Object.defineProperty(ev,'target',{configurable:true,value:this});}catch(_){}}let cur=this;while(cur){for(const h of cur._handlers.get(ev.type)||[])h.call(cur,ev);if(ev.cancelBubble||!ev.bubbles)break;cur=cur.parentNode;}return true;}
 querySelectorAll(sel){const terms=sel.split(',').map(t=>t.trim());const matches=(el,t)=>t==='*'||el.localName===t||t.startsWith('ui-panel')&&el.localName==='ui-panel';let result=[];const walk=el=>{for(const c of el.children){if(terms.some(t=>matches(c,t)))result.push(c);walk(c)}};walk(this);return result;}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
class UiProp extends El {constructor(){super('ui-prop')}render(dump){this.dump=dump;this.calls=(this.calls||0)+1;}}
class Doc extends El {constructor(){super('#document');this.nodeType=9;this.ownerDocument=this;this.body=new El('body');this.body.ownerDocument=this;this.appendChild(this.body);this.activeElement=null;}createElement(tag){return tag==='ui-prop'?new UiProp():new El(tag)}createDocumentFragment(){const el=new El('fragment');el.__frag=true;return el;}}
doc=new Doc();doc.body.setAttribute('name','main');const panel=new El('ui-panel');panel.setAttribute('name','inspector');doc.body.appendChild(panel);
const origRender=UiProp.prototype.render;
const w={customElements:{get(name){return name==='ui-prop'?UiProp:null}}};
const context={window:w,document:doc,Event,setInterval(){return 1},clearInterval(){},console,require(name){assert.equal(name,'@editor/panel');return {query(){return [panel]}}}};
assert.equal(vm.runInNewContext(source,context).status,'running');
const hook=w.__CCRECORD_INSPECTOR_HOOK__;

// The native ui-prop editor updates a nested @ccclass dump before firing
// change-dump. Scene is independent from this Inspector snapshot.
const snapshot = obj => JSON.parse(JSON.stringify(obj));
const stringField=(name,value)=>({name,type:'String',value});
const numField=(name,value)=>({name,type:'Integer',value});
const stats=(desc,damage)=>({description:stringField('description',desc),damage:numField('damage',damage)});
const makeValue=(desc,damage)=>({name:'value',cid:'CVHItemStatsV1',type:'Object',value:stats(desc,damage)});
const entry=(desc,damage)=>({cid:'CVHRecordEntry_AutoItem_Stats_v1',value:{key:{name:'key',type:'String',value:'sword'},value:makeValue(desc,damage)}});
const makeRecord=()=>({cid:'CVHRecord_AutoItem_Stats_v1',name:'items',type:'Object',value:{entries:{name:'entries',type:'Array',value:[entry('start',10)],elementTypeData:entry('template',0)}}});
const sceneRecord=makeRecord();
const inspectorRecord=snapshot(sceneRecord);
const sceneState={dirty:false,requests:[],snapshots:0,nativeEvents:0};
const getScene=()=>({__comps__:[{value:{items:snapshot(sceneRecord)}}]});
const editor={Selection:{getSelected(kind){assert.equal(kind,'node');return ['node-A'];}},Message:{async request(domain,method,opt){
  assert.equal(domain,'scene');
  if(method==='query-node') return getScene();
  if(method==='query-dirty') return sceneState.dirty;
  if(method==='snapshot'){sceneState.snapshots++;return;}
  if(method==='set-property') {
    assert.equal(opt.uuid,'node-A');assert.equal(opt.record,true);
    const parts=opt.path.split('.');
    assert.equal(parts.slice(0,5).join('.'),'__comps__.0.items.entries.0');
    let current=sceneRecord.value.entries.value[0];
    for(const key of parts.slice(5)) current=current.value?.[key] || current[key];
    current.value=snapshot(opt.dump.value);
    sceneState.requests.push(opt.path);
    return true; // In some builds Scene does NOT set the dirty flag here.
  }
  if(method==='remove-array-element'){
    sceneRecord.value.entries.value.splice(opt.index,1);
    sceneState.requests.push('remove'); return undefined; // Creator 3.8.2-3.8.4
  }
  throw Error('unexpected scene IPC '+method);
}}};
w.Editor=editor;context.Editor=editor;
panel.addEventListener('change-dump',()=>{ sceneState.nativeEvents++;sceneState.dirty=true; });
const find=(el,className)=>{if(el.className===className)return el;for(const child of el.children){const found=find(child,className);if(found)return found;}return null;};
const tick=()=>new Promise(r=>setImmediate(r));
const prop=new UiProp();panel.appendChild(prop);prop.render(inspectorRecord);
const widget=prop.nextSibling;
const rows=find(widget,'cvh-global-rows');
const controls=rows.children[0].querySelectorAll('ui-prop');
assert.equal(controls.length,2);
async function main(){
  const value=controls[1];
  // User modifies ItemStats.description locally. This is not newer Scene data.
  value.dump.value.description.value='Sword';
  value.dispatchEvent(new Event('change-dump',{bubbles:true}));
  await tick();
  assert.equal(sceneRecord.value.entries.value[0].value.value.value.description.value,'Sword');
  assert.equal(sceneRecord.value.entries.value[0].value.value.value.damage.value,10);
  assert.equal(sceneState.requests[0],'__comps__.0.items.entries.0.value.description');
  assert.equal(sceneState.nativeEvents,1,'native inspector event should mark clean Scene dirty');
  assert.equal(sceneState.dirty,true);
  // Scene update to an unrelated sibling is not a conflict. It must survive.
  sceneRecord.value.entries.value[0].value.value.value.damage.value=777;
  const currentValue=find(widget,'cvh-global-rows').children[0].querySelectorAll('ui-prop')[1];
  currentValue.dump.value.description.value='Great Sword';
  currentValue.dispatchEvent(new Event('change-dump',{bubbles:true}));
  await tick();
  assert.equal(sceneRecord.value.entries.value[0].value.value.value.description.value,'Great Sword');
  assert.equal(sceneRecord.value.entries.value[0].value.value.value.damage.value,777);
  assert.equal(sceneState.requests[1],'__comps__.0.items.entries.0.value.description');
  // A concurrent edit to the SAME nested field is a real conflict.
  sceneRecord.value.entries.value[0].value.value.value.description.value='External';
  const last=find(widget,'cvh-global-rows').children[0].querySelectorAll('ui-prop')[1];
  last.dump.value.description.value='Local';
  last.dispatchEvent(new Event('change-dump',{bubbles:true}));
  await tick();
  assert.equal(sceneRecord.value.entries.value[0].value.value.value.description.value,'External');
  assert.equal(sceneState.requests.length,2);
  // When removing an item, Scene snapshots still fail to make dirty on some
  // versions. The native Inspector change path is attempted as a fallback.
  sceneState.dirty=false;
  const del=find(widget,'cvh-global-delete');
  del.dispatchEvent(new Event('click',{bubbles:true}));await tick();
  assert.equal(sceneRecord.value.entries.value.length,0);
  assert.equal(sceneState.snapshots,1);
  assert.equal(sceneState.nativeEvents,2);
  assert.equal(hook.stats().lastSceneDirty,true);
  hook.stop();assert.strictEqual(UiProp.prototype.render,origRender);
  console.log('PASS v0.2.1: custom ItemStats.Description granular edit, no false conflict, sibling preserved, native dirty fallback, void remove');
}
main().catch(e=>{console.error(e);process.exitCode=1});
