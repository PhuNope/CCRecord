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

// A live Scene normalizes appended custom @ccclass field values and can
// return stale query-node once after a successful set-property.
const snapshot = obj => JSON.parse(JSON.stringify(obj));
const field=(name,value,type='String')=>({name,type,value});
const stats=(description,damage)=>({description:field('description',description),damage:field('damage',damage,'Integer')});
const entry=(key,description,damage=10)=>({cid:'CVHRecordEntry_String_CVHItemStatsV1',value:{key:field('key',key),value:{name:'value',cid:'CVHItemStatsV1',type:'Object',value:stats(description,damage)}}});
const record=()=>({cid:'CVHRecord_String_CVHItemStatsV1',name:'items',type:'Object',value:{entries:{name:'entries',type:'Array',value:[entry('sword','starter')],elementTypeData:entry('','template',0)}}});
const sceneRecord=record();
let staleRead=0;
let previousSnapshot=null;
const sceneState={dirty:false,requests:[],snapshots:0};
const sceneDump=()=>({__comps__:[{value:{items:snapshot(sceneRecord)}}]});
const editor={Selection:{getSelected(k){assert.equal(k,'node');return ['selected-node'];}},Message:{async request(domain,method,opt){
  assert.equal(domain,'scene');
  if(method==='query-node'){
    if(staleRead-- > 0) return previousSnapshot;
    return sceneDump();
  }
  if(method==='query-dirty')return sceneState.dirty;
  if(method==='snapshot'){sceneState.snapshots++;return;}
  if(method==='set-property'){
    assert.equal(opt.uuid,'selected-node');assert.equal(opt.record,true);
    sceneState.requests.push(opt.path);sceneState.dirty=true;
    if(opt.path==='__comps__.0.items.entries'){
      previousSnapshot=sceneDump();
      sceneRecord.value.entries.value=snapshot(opt.dump.value);
      assert.equal(sceneRecord.value.entries.value.length,2);
      // Generated custom @ccclass defaults materialize *inside* Scene.
      sceneRecord.value.entries.value[1].value.value.value.description.value='scene-default';
      staleRead=1;
      return true;
    }
    const parts=opt.path.split('.');
    assert.equal(parts.slice(0,4).join('.'),'__comps__.0.items.entries');
    let cursor=sceneRecord.value.entries.value[Number(parts[4])];
    for(const name of parts.slice(5))cursor=cursor.value?.[name] || cursor[name];
    cursor.value=snapshot(opt.dump.value);
    return true;
  }
  throw Error('Unexpected scene method '+method);
}}};
w.Editor=editor;context.Editor=editor;
const find=(el,c)=>{if(el.className===c)return el;for(const child of el.children){const v=find(child,c);if(v)return v;}return null;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const prop=new UiProp();panel.appendChild(prop);prop.render(snapshot(sceneRecord));
const widget=prop.nextSibling;
const rows=find(widget,'cvh-global-rows');
async function main(){
  const plus=find(widget,'cvh-global-button');
  plus.dispatchEvent(new Event('click',{bubbles:true}));await tick();
  assert.equal(sceneRecord.value.entries.value.length,2);
  assert.equal(sceneState.requests[0],'__comps__.0.items.entries');
  assert.equal(rows.children.length,2);
  // Old v0.2.1 created a row baseline from the local template ("template"),
  // which incorrectly rejected an immediate Desc edit as stale Scene data.
  let inputs=rows.children[1].querySelectorAll('ui-prop');
  assert.equal(inputs[1].dump.value.description.value,'scene-default',
    'read-back must seed row baseline from the Scene-normalized value');
  inputs[1].dump.value.description.value='New item';
  inputs[1].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();
  assert.equal(sceneRecord.value.entries.value[1].value.value.value.description.value,'New item');
  assert.equal(find(widget,'cvh-global-error').hidden,true);
  // Fast Key + Value changes are queued, not dropped with 'edit in progress'.
  inputs=rows.children[1].querySelectorAll('ui-prop');
  inputs[0].dump.value='sword';
  inputs[0].dispatchEvent(new Event('change-dump',{bubbles:true}));
  inputs[1].dump.value.damage.value=23;
  inputs[1].dispatchEvent(new Event('change-dump',{bubbles:true}));
  await tick();await tick();
  assert.equal(sceneRecord.value.entries.value[1].value.key.value,'sword');
  assert.equal(sceneRecord.value.entries.value[1].value.value.value.damage.value,23);
  assert.equal(sceneRecord.value.entries.value[1].value.value.value.description.value,'New item');
  const warning=find(widget,'cvh-global-warning');
  assert.equal(warning.hidden,false,'duplicate keys must be detected');
  assert.match(warning.title,/^Duplicate keys: sword \(2 occurrences\)$/);
  assert.match(rows.children[1].title,/^Duplicate key: sword$/);
  assert.equal(find(widget,'cvh-global-error').hidden,true);
  // A real native Inspector render contains newer scene data and must update
  // row snapshots; otherwise the next edit is wrongly rejected as "outside".
  sceneRecord.value.entries.value[1].value.value.value.description.value='external refresh';
  prop.render(snapshot(sceneRecord));
  inputs=rows.children[1].querySelectorAll('ui-prop');
  inputs[1].dump.value.description.value='edit after refresh';
  inputs[1].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();
  assert.equal(sceneRecord.value.entries.value[1].value.value.value.description.value,'edit after refresh');
  // But a genuine competing Scene modification to the same leaf remains
  // protected and must not be overwritten silently.
  sceneRecord.value.entries.value[1].value.value.value.description.value='real external conflict';
  inputs[1].dump.value.description.value='local stale';
  inputs[1].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();
  assert.equal(sceneRecord.value.entries.value[1].value.value.value.description.value,'real external conflict');
  assert.match(find(widget,'cvh-global-error').textContent,/Field was modified outside this Inspector/);
  hook.stop();assert.strictEqual(UiProp.prototype.render,origRender);
  console.log('PASS v0.2.2: add -> hydrate -> Key/Value, queued edits, native rebase, real conflict, English duplicate warning');
}
main().catch(e=>{console.error(e);process.exitCode=1});
