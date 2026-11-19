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
const key=k=>({name:'key',type:'enum',value:k,enumList:[{name:'Head',value:0},{name:'Hand',value:1},{name:'Foot',value:2}],path:'enumNodeRecord.entries.0.key'});
const nodeVal=v=>({name:'value',type:'cc.Node',cid:'cc.Node',value:v,default:null,path:'enumNodeRecord.entries.0.value'});
const numberVal=v=>({name:'value',type:'CCFloat',value:v,default:0});
const e=(k,v)=>({cid:'CVHRecordEntry_Enum_NodeSlot_Node',path:'enumNodeRecord.entries.0',value:{key:key(k),value:nodeVal(v)}});
const makeRecord=(name,cid,entries)=>({cid,name,type:'Object',value:{entries:{name:'entries',type:'Array',path:name+'.entries',value:entries,elementTypeData:e(0,null)}}});
const owner={ keepMe:'KEEP_ME', keepCount:12345, label:'important',
  a:makeRecord('a','CVHRecord_Integer_String',[]),
  numberRecord:makeRecord('numberRecord','CVHRecord_String_Float',[]),
  nodeRecord:makeRecord('nodeRecord','CVHRecord_String_Node',[]),
  enumNodeRecord:makeRecord('enumNodeRecord','CVHRecord_Enum_NodeSlot_Node',[e(0,'uuid-head')]),
  sameTypeRecord:makeRecord('sameTypeRecord','CVHRecord_Enum_NodeSlot_Node',[e(1,'uuid-other')])
};
const otherOriginal={...owner, a:JSON.stringify(owner.a),numberRecord:JSON.stringify(owner.numberRecord),nodeRecord:JSON.stringify(owner.nodeRecord)};

// Scene service is authoritative: set-property makes the scene dirty and
// updates only the selected component's entries. Every request must use a
// concrete node UUID and full component path, not an Inspector dump event.
const sceneState={dirty:false,commits:[],queries:[],snapshots:0};
const editor={Selection:{getSelected(kind){assert.equal(kind,'node');return ['node-A'];}},
 Message:{async request(domain,method,opt){assert.equal(domain,'scene');
   if(method==='query-node') return {__comps__:[{value:owner}]};
   if(method==='query-dirty') return sceneState.dirty;
   if(method==='snapshot'){ sceneState.snapshots++; sceneState.dirty=true; return; }
   if(method==='set-property') {
     assert.equal(opt.uuid,'node-A');assert.equal(opt.record,true);
     const match=opt.path.match(/^__comps__\.0\.([^.]+)\.entries(?:\.(\d+)\.(key|value))?$/);
     assert(match,'Only a single Record array or a leaf may be edited: '+opt.path);
     const prop=owner[match[1]];assert(prop,'unknown property');
     if(match[2] !== undefined) {
       const i=Number(match[2]);const field=match[3];
       assert(prop.value.entries.value[i]);
       prop.value.entries.value[i].value[field].value=JSON.parse(JSON.stringify(opt.dump.value));
       sceneState.commits.push({kind:'leaf',name:match[1],path:opt.path,value:opt.dump.value});
     } else {
       prop.value.entries.value=opt.dump.value;
       sceneState.commits.push({kind:'array',name:match[1],path:opt.path});
     }
     return true;
   }
   if(method==='remove-array-element') {
     assert.equal(opt.uuid,'node-A');assert.match(opt.path,/^__comps__\.0\.[^.]+\.entries$/);
     const prop=owner[opt.path.split('.')[2]];assert(prop);
     prop.value.entries.value.splice(opt.index,1);
     sceneState.commits.push({kind:'remove',name:opt.path.split('.')[2],path:opt.path,index:opt.index});
     return true;
   }
   throw new Error('unexpected scene method '+method);
 }}};
w.Editor=editor;context.Editor=editor;
const originalEnum=owner.enumNodeRecord;
const initialValueObj=owner.enumNodeRecord.value;
const initialArrayDump=owner.enumNodeRecord.value.entries;
const untouchedSameType=JSON.stringify(owner.sameTypeRecord);
let commits=sceneState.commits;
panel.addEventListener('change-dump',ev=>{ throw new Error('Unexpected UI dump bubbling instead of set-property Scene IPC'); });
async function main() {
  const tick=()=>new Promise(r=>setImmediate(r));
  const original=new UiProp();panel.appendChild(original);original.render(owner.enumNodeRecord);
  const find=(el,className)=>{if(el.className===className)return el;for(const c of el.children){let x=find(c,className);if(x)return x}return null;};
  const widget=original.nextSibling;
  const oldRecord=owner.enumNodeRecord;
  const oldOther=JSON.stringify(owner.sameTypeRecord);
  const oldA=JSON.stringify(owner.a);
  const size=find(widget,'cvh-global-size');
  size.value='3';size.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  assert.equal(owner.enumNodeRecord.value.entries.value.length,3);
  assert.equal(sceneState.commits[0].kind,'array');
  assert.equal(sceneState.snapshots,1,'size increase should create fallback snapshot');
  assert.equal(JSON.stringify(owner.enumNodeRecord.value.entries.value.map(e=>e.value.key.value)),'[0,1,2]');
  const rows=find(widget,'cvh-global-rows');
  const second=rows.children[1].querySelectorAll('ui-prop');
  assert.equal(second.length,2);
  // First set a distinct Node value; then rename the Enum key.
  second[1].dump.value='uuid-hand';
  second[1].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();
  assert.equal(owner.enumNodeRecord.value.entries.value[1].value.value.value,'uuid-hand');
  assert.equal(sceneState.commits.at(-1).kind,'leaf');
  assert.equal(sceneState.commits.at(-1).path,'__comps__.0.enumNodeRecord.entries.1.value');
  assert.equal(owner.keepMe,'KEEP_ME');
  // Change Enum key from Hand to Foot.  No other value should change.
  const firstNodeBefore=owner.enumNodeRecord.value.entries.value[0].value.value.value;
  const secondValueBefore=owner.enumNodeRecord.value.entries.value[1].value.value.value;
  const thirdValueBefore=owner.enumNodeRecord.value.entries.value[2].value.value.value;
  second[0].dump.value=2;
  second[0].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();
  assert.equal(sceneState.commits.at(-1).kind,'leaf','Enum key must never commit the entire array');
  assert.equal(sceneState.commits.at(-1).path,'__comps__.0.enumNodeRecord.entries.1.key');
  assert.equal(owner.enumNodeRecord.value.entries.value[1].value.key.value,2);
  assert.equal(owner.enumNodeRecord.value.entries.value[1].value.value.value,secondValueBefore);
  assert.equal(owner.enumNodeRecord.value.entries.value[0].value.value.value,firstNodeBefore);
  assert.equal(owner.enumNodeRecord.value.entries.value[2].value.value.value,thirdValueBefore);
  assert.strictEqual(owner.enumNodeRecord,oldRecord);
  assert.equal(JSON.stringify(owner.sameTypeRecord),oldOther);
  assert.equal(JSON.stringify(owner.a),oldA);
  assert.equal(owner.keepMe,'KEEP_ME'); assert.equal(owner.keepCount,12345);
  assert.equal(sceneState.dirty,true);
  // Remove third entry through native Scene message even if dirty reset externally.
  sceneState.dirty=false;
  const thirdDelete=find(rows.children[2],'cvh-global-delete');
  thirdDelete.dispatchEvent(new Event('click',{bubbles:true}));await tick();
  assert.equal(sceneState.commits.at(-1).kind,'remove');
  assert.equal(sceneState.dirty,true);
  assert.equal(sceneState.snapshots,2,'delete triggers fallback snapshot');
  assert.equal(owner.enumNodeRecord.value.entries.value.length,2);
  assert.equal(owner.enumNodeRecord.value.entries.value[1].value.value.value,'uuid-hand');
  // Reduce SIZE using remove-array-element and keep the remaining node intact.
  sceneState.dirty=false;
  size.value='1';size.dispatchEvent(new Event('change',{bubbles:true}));await tick();
  assert.equal(owner.enumNodeRecord.value.entries.value.length,1);
  assert.equal(sceneState.dirty,true);
  assert.equal(sceneState.snapshots,3,'size decrease triggers fallback snapshot');
  assert.equal(sceneState.commits.at(-1).kind,'remove');
  assert.equal(owner.enumNodeRecord.value.entries.value[0].value.value.value,'uuid-head');
  assert.equal(JSON.stringify(owner.sameTypeRecord),oldOther);
  assert.equal(owner.keepMe,'KEEP_ME'); assert.equal(owner.keepCount,12345);
  assert.equal(hook.stats().lastSceneDirty,true);
  hook.stop();assert.strictEqual(UiProp.prototype.render,origRender);
  console.log('PASS v0.8.4: forced snapshot fallback on add/delete/SIZE + Enum leaf integrity');
}
main().catch(e=>{console.error(e);process.exitCode=1});
