'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/inspector/30-record-keys.js'),'utf8');
const {findDuplicateKeys,prepareNewEntry,updateDuplicateWarning}=vm.runInNewContext(`(()=>{
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const cloneDump = v => JSON.parse(JSON.stringify(v));
  ${source}
  return {findDuplicateKeys,prepareNewEntry,updateDuplicateWarning};
})()`,{});
const field=(name,value,type='cc.Node')=>({name,type,cid:type,value});
const entry=(key,value='label',type='cc.Node')=>({cid:'CVHRecordEntry_Node_String',value:{key:field('key',key,type),value:field('value',value,'String')}});
const dup=(values)=>findDuplicateKeys({value:values});
const uuid='node-uuid-0001',other='node-uuid-0002';
for(const [a,b] of [[uuid,uuid],[{uuid},{uuid}],[{uuid:{value:uuid}},{uuid:{value:uuid}}],[{value:{uuid}},{uuid}], [{__uuid__:uuid},{uuid}],[uuid,{uuid}]]) {
  const r=dup([entry(a),entry(b)]);
  assert.equal(r.duplicates.length,1,'same Node key must be detected');
  assert.deepEqual(Array.from(r.indices),[0,1]);
}
assert.equal(dup([entry(uuid),entry(other)]).duplicates.length,0);
assert.equal(dup([entry(null),entry(null)]).duplicates.length,0);
assert.equal(dup([entry({uuid:''}),entry({uuid:''})]).duplicates.length,0);
assert.equal(dup([entry(''),entry('')]).duplicates.length,0);
assert.equal(dup([entry('first',uuid,'String'),entry('second',uuid,'String')]).duplicates.length,0,
  'duplicate Values are allowed when Keys differ');
const objKey=id=>({id:field('id',id,'String'),order:field('order',0,'Integer')});
assert.equal(dup([entry(objKey('hand')),entry(objKey('hand'))]).duplicates.length,1);
const old=entry(uuid,'old');
const next=prepareNewEntry({entries:{value:[old]}},1);
assert.equal(next.value.key.value,null,'appended Node key must not inherit prior reference');
assert.equal(next.value.value.value,'','appended Value must start at its default');
assert.equal(old.value.key.value,uuid,'original entry must remain unchanged');
const copy=prepareNewEntry({entries:{value:[old],elementTypeData:entry({uuid},'template')}},1);
assert.equal(copy.value.key.value,null);
const row=()=>({row:{s:new Set(),title:'',hasAttribute(n){return this.s.has(n)},setAttribute(n){this.s.add(n)},removeAttribute(n){this.s.delete(n)}}});
const rows=[row(),row()],warning={hidden:true,title:''},warningText={textContent:''};
const widget={s:new Set(),hasAttribute(n){return this.s.has(n)},setAttribute(n){this.s.add(n)},removeAttribute(n){this.s.delete(n)}};
const state={metadata:{entries:{value:[entry({uuid}),entry({uuid})]}},rowEls:rows,warning,warningText,widget};
updateDuplicateWarning(state);
assert.equal(state.duplicateCount,1);
assert.equal(warning.hidden,false);
assert.match(warning.title,/^Duplicate keys: Node node-uuid-0001 \(2 occurrences\)$/);
assert(rows.every(x=>x.row.s.has('data-cvh-duplicate')));
state.metadata.entries.value[1].value.key.value={uuid:other};
updateDuplicateWarning(state);
assert.equal(state.duplicateCount,0);
assert.equal(warning.hidden,true);
assert(rows.every(x=>!x.row.s.has('data-cvh-duplicate')));
console.log('PASS v0.2.6: Node key references, UUID variants, duplicate warning, safe append');
