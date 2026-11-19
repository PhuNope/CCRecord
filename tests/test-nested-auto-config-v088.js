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

const key = k => ({name:'key',type:'enum',value:k,enumList:[{name:'Primary',value:0},{name:'Secondary',value:1},{name:'Extra',value:2}],path:'config.attachments.entries.0.key'});
const nodeVal = v => ({name:'value',type:'cc.Node',cid:'cc.Node',value:v,default:null,path:'config.attachments.entries.0.value'});
const entry = (k,v) => ({cid:'CVHRecordEntry_Enum_AttachmentSlot_Node',path:'config.attachments.entries.0',value:{key:key(k),value:nodeVal(v)}});
const makeRecord=(name,route,list)=>({cid:'CVHRecord_Enum_AttachmentSlot_Node',name,path:route,type:'Object',value:{entries:{name:'entries',type:'Array',path:route+'.entries',value:list,elementTypeData:entry(0,null)}}});
const attachment = makeRecord('attachments','config.attachments',[]);
const backupAttachment=makeRecord('attachments','backup.attachments',[entry(2,'backup-ref')]);
const otherRecord=makeRecord('items','items',[entry(1,'items-ref')]);
const owner={
  keepMe:'SAFE',
  config:{name:'config',cid:'CVHRecordAutoConfigV1',type:'Object',value:{attachments:attachment}},
  backup:{name:'backup',cid:'CVHRecordAutoConfigV1',type:'Object',value:{attachments:backupAttachment}},
  items:otherRecord,
};
const otherComp={config:{name:'config',cid:'CVHRecordAutoConfigV1',type:'Object',value:{attachments:makeRecord('attachments','__comps__.1.config.attachments',[entry(0,'other-component')])}}};
const untouchedBackup = JSON.stringify(backupAttachment);
const untouchedOther=JSON.stringify(otherRecord);
const untouchedComp=JSON.stringify(otherComp);
const state={dirty:false,commits:[],snapshots:0};
const queryNode = () => ({__comps__:[{value:owner},{value:otherComp}]});
function atScenePath(path) {
  const names=path.split('.');assert.equal(names[0],'__comps__');
  let curr=queryNode().__comps__[Number(names[1])].value;
  for (const k of names.slice(2)) {
    curr = curr?.value?.[k] ?? curr?.[k];
    assert(curr!==undefined,'Scene path not found: '+path+' / '+k);
  }
  return curr;
}
const editor={Selection:{getSelected(k){assert.equal(k,'node');return ['node-A']}},Message:{async request(domain,method,opt){
  assert.equal(domain,'scene');
  if(method==='query-node')return queryNode();
  if(method==='query-dirty')return state.dirty;
  if(method==='snapshot'){state.dirty=true;state.snapshots++;return;}
  if(method==='set-property'){
    assert.equal(opt.uuid,'node-A');assert.equal(opt.record,true);
    assert.match(opt.path,/^__comps__\.0\.config\.attachments\.entries(?:\.\d+\.(?:key|value))?$/);
    atScenePath(opt.path).value=JSON.parse(JSON.stringify(opt.dump.value));
    state.dirty=true;state.commits.push(opt.path);return true;
  }
  if(method==='remove-array-element'){
    assert.equal(opt.uuid,'node-A');assert.equal(opt.path,'__comps__.0.config.attachments.entries');
    atScenePath(opt.path).value.splice(opt.index,1);state.dirty=true;
    state.commits.push(opt.path+' REMOVE '+opt.index);return true;
  }
  throw new Error('Unexpected Scene call '+method);
}}};
w.Editor=editor;context.Editor=editor;
const find=(el,className)=>{if(el.className===className)return el;for(const c of el.children){const found=find(c,className);if(found)return found;}return null;};
const tick=()=>new Promise(r=>setImmediate(r));
async function main(){
  const prop=new UiProp();panel.appendChild(prop);prop.render(attachment);
  const widget=prop.nextSibling;
  assert(widget,'UI widget should appear for nested record');
  const plus=find(widget,'cvh-global-button');
  plus.dispatchEvent(new Event('click',{bubbles:true}));await tick();await tick();
  assert.equal(attachment.value.entries.value.length,1,'append succeeds for nested record');
  assert.equal(state.commits[0],'__comps__.0.config.attachments.entries');
  assert.equal(state.dirty,true);
  assert.equal(JSON.stringify(backupAttachment),untouchedBackup);
  assert.equal(JSON.stringify(otherRecord),untouchedOther);
  assert.equal(JSON.stringify(otherComp),untouchedComp);
  assert.equal(owner.keepMe,'SAFE');
  const rows=find(widget,'cvh-global-rows');
  const props=rows.children[0].querySelectorAll('ui-prop');assert.equal(props.length,2);
  props[1].dump.value='node-target';
  props[1].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();await tick();
  assert.equal(state.commits.at(-1),'__comps__.0.config.attachments.entries.0.value');
  assert.equal(attachment.value.entries.value[0].value.value.value,'node-target');
  props[0].dump.value=1;
  props[0].dispatchEvent(new Event('change-dump',{bubbles:true}));await tick();await tick();
  assert.equal(state.commits.at(-1),'__comps__.0.config.attachments.entries.0.key');
  assert.equal(attachment.value.entries.value[0].value.key.value,1);
  assert.equal(attachment.value.entries.value[0].value.value.value,'node-target');
  const del=find(rows.children[0],'cvh-global-delete');
  del.dispatchEvent(new Event('click',{bubbles:true}));await tick();await tick();
  assert.equal(state.commits.at(-1),'__comps__.0.config.attachments.entries REMOVE 0');
  assert.equal(attachment.value.entries.value.length,0);
  assert.equal(JSON.stringify(backupAttachment),untouchedBackup);
  assert.equal(JSON.stringify(otherRecord),untouchedOther);
  assert.equal(JSON.stringify(otherComp),untouchedComp);
  // Ambiguous two Components with identical nested Record contents and only
  // a relative Inspector path: refuse, never guess which one to edit.
  otherComp.config.value.attachments.value.entries.value=[];
  const commitsBefore=state.commits.length;
  plus.dispatchEvent(new Event('click',{bubbles:true}));await tick();await tick();
  assert.equal(state.commits.length,commitsBefore,'ambiguous edit must not reach Scene');
  assert.match(find(widget,'cvh-global-error').textContent,/matching Record fields/);
  assert.equal(attachment.value.entries.value.length,0);
  hook.stop();assert.strictEqual(UiProp.prototype.render,origRender);
  console.log('PASS nested CCRecordAutoDemo: +, value, enum, delete, dirty, no sibling reset, ambiguity protection');
}
main().catch(e=>{console.error(e);process.exitCode=1});
