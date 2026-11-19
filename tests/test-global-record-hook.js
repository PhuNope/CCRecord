const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','dist','inspector.js'),'utf8');
let doc;
function sty(){ const m=new Map();const pr=new Map();return {getPropertyValue:k=>m.get(k)||'', getPropertyPriority:k=>pr.get(k)||'',setProperty:(k,v,p)=>{m.set(k,v);pr.set(k,p||'')},removeProperty:k=>{m.delete(k);pr.delete(k)}}; }
class El {
  constructor(tag='div') {this.localName=tag;this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.attributes=new Map();this.parentNode=null;this.style=sty();this.ownerDocument=doc;this.shadowRoot=null;this.className='';this.textContent='';}
  setAttribute(k,v){this.attributes.set(k,String(v))} getAttribute(k){return this.attributes.get(k)||null} hasAttribute(k){return this.attributes.has(k)} removeAttribute(k){this.attributes.delete(k)}
  appendChild(child){ if (child.__frag) {for (const c of [...child.children]) this.appendChild(c);return child;} if(child.parentNode)child.remove();this.children.push(child);child.parentNode=this;return child; }
  insertBefore(child,before){if(child.parentNode)child.remove();const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,child);child.parentNode=this;return child;}
  get previousSibling(){const i=this.parentNode?.children.indexOf(this);return i>0?this.parentNode.children[i-1]:null} get nextSibling(){const i=this.parentNode?.children.indexOf(this);return i>=0?this.parentNode.children[i+1]||null:null}
  replaceChildren(...items){for(const c of [...this.children]){c.parentNode=null;}this.children=[];for(const i of items)this.appendChild(i)}
  get firstChild(){return this.children[0]||null}
  remove(){if(this.parentNode){const i=this.parentNode.children.indexOf(this);if(i>=0)this.parentNode.children.splice(i,1);this.parentNode=null;}}
  contains(el){for(let c=el;c;c=c.parentNode)if(c===this)return true;return false;}
  get isConnected(){let n=this;while(n){if(n===doc)return true;n=n.parentNode;}return false}
  getRootNode(){return doc}
  addEventListener(){}
  querySelectorAll(sel){const out=[];const terms=sel.split(',').map(x=>x.trim());const ok=(el,t)=>t==='*'||t===el.localName||t==='ui-prop'&&el.localName==='ui-prop'||t.startsWith('ui-panel')&&el.localName==='ui-panel';const visit=(el)=>{for(const c of el.children){if(terms.some(t=>ok(c,t)))out.push(c);visit(c)}};visit(this);return out;}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
class UiProp extends El {constructor(){super('ui-prop')} render(dump){this.dump=dump;this.rendered=(this.rendered||0)+1;}}
class Doc extends El {constructor(){super('#document');this.nodeType=9;this.body=new El('body');this.body.ownerDocument=this;this.appendChild(this.body);this.activeElement=null;}
 createElement(tag){return tag==='ui-prop'?new UiProp():new El(tag)} createTextNode(s){const e=new El('#text');e.nodeType=3;e.nodeValue=s;return e} createDocumentFragment(){const f=new El('fragment');f.__frag=true;return f;}}
doc=new Doc();doc.body.setAttribute('name','main');
const inspector=new El('ui-panel');inspector.setAttribute('name','inspector');doc.body.appendChild(inspector);
const prop=new UiProp();inspector.appendChild(prop);
const orig=UiProp.prototype.render;
const win={customElements:{get(name){return name==='ui-prop'?UiProp:null}}};
const ctx={document:doc,window:win,console, setInterval(){return 3},clearInterval(){},require(name){assert.equal(name,'@editor/panel');return {query(){return [inspector]}}}};
assert.equal(vm.runInNewContext(source,ctx).status,'running');
assert.equal(win.__CCRECORD_INSPECTOR_HOOK__.stats().patchMode,'prototype');
const key=(val)=>({name:'key',type:'Enum',value:val,cid:'SomeEnum',path:'config.bones.entries.0.key'});
const value=(val)=>({name:'value',type:'Node',value:val,cid:'cc.Node',path:'config.bones.entries.0.value'});
const dump={cid:'CVHRecord_Enum_BoneSlot_Node', name:'bones', type:'Object', value:{entries:{name:'entries',type:'Array',value:[{cid:'CVHRecordEntry_Enum_BoneSlot_Node',value:{key:key(0),value:value('uuid-of-node')}}]}}};
prop.render(dump);
const hook=win.__CCRECORD_INSPECTOR_HOOK__;
assert.equal(hook.stats().activeRecords,1);
assert.equal(prop.style.getPropertyValue('display'),'none');
assert.equal(prop.nextSibling.localName,'section');
assert.equal(prop.nextSibling.querySelectorAll('ui-prop').length,3); // array and two fields
assert.equal(hook.stats().fallbackCount,0);
// Do not take over another arbitrary class that merely has an 'entries' array.
const other=new UiProp();inspector.appendChild(other);
other.render({...dump,cid:'CustomDictionary',type:'Object'});
assert.equal(hook.stats().activeRecords,1);
// Re-render should preserve widget and append no duplicate.
const widget=prop.nextSibling;
prop.render({...dump,value:{entries:{...dump.value.entries,value:[]}}});
assert.strictEqual(prop.nextSibling,widget);
assert.equal(hook.stats().activeRecords,1);
const valRec={...dump,cid:'Unknown',value:{entries:{...dump.value.entries, elementTypeData:{cid:'CVHRecordEntry_Enum_BoneSlot_Node'}}}};
other.render(valRec);
assert.equal(hook.stats().activeRecords,2);
// Cleanup and restore original ui-prop and methods.
hook.stop();
assert.equal(prop.style.getPropertyValue('display'),'');
assert.equal(other.style.getPropertyValue('display'),'');
assert.equal(hook.stats().activeRecords,0);
assert.strictEqual(UiProp.prototype.render,orig);
assert.equal(prop.nextSibling,other);
console.log('PASS global Inspector record hook: strict class detection, Enum -> Node, fallback metadata, native ui-prop fields, no takeover, cleanup');
