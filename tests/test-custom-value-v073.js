'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvh-value-'));
try {
  fs.mkdirSync(path.join(tmp,'node_modules','cc'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'node_modules','cc','index.js'),`'use strict';
    const classes = new Map();
    const classIds = new Map();
    const property = (type) => (proto,key) => { const C=proto.constructor; (C.properties ||= {})[key]=type; };
    const ccclass = (name) => (ctor) => { ctor.ccclassName=name; classes.set(name,ctor); classIds.set(name,ctor); };
    const CCString={name:'CCString'}, CCInteger={name:'CCInteger'}, CCFloat={name:'CCFloat'}, CCBoolean={name:'CCBoolean'};
    class Node { constructor(){this.name='Node';} }
    class Asset {}
    class Component {}
    const Enum = function(type) { type.__enum=true; return type; }; Enum.isEnum=type=>!!type?.__enum; Enum.getList=type => type.__enums__ || (type.__enums__ = Object.keys(type).filter(k=>typeof type[k]==='number').map(k=>({name:k,value:type[k]})));
    const js={getClassName:type=>type?.ccclassName||type?.name||'',getClassId:type=>type?.ccclassName||'',getClassById:id=>classIds.get(id),getClassByName:name=>classes.get(name),setClassAlias:(ctor,id)=>{const existing=classIds.get(id)||classes.get(id);if(existing&&existing!==ctor)throw Error('alias collision: '+id);classIds.set(id,ctor);classes.set(id,ctor)}};
    module.exports={ _decorator:{property,ccclass}, CCString,CCInteger,CCFloat,CCBoolean,Node,Asset,Component,Enum,js,classes,classIds };
  `);
  fs.writeFileSync(path.join(tmp,'node_modules','cc','index.d.ts'),`
    export declare const _decorator:{ccclass(name:string):ClassDecorator;property(type?:any):PropertyDecorator};
    export declare const CCString:any, CCInteger:any, CCFloat:any, CCBoolean:any;
    export declare class Node { name:string; } export declare class Asset {} export declare class Component {}
    export declare const Enum:any; export declare const js:any;
  `);
  for (const f of ['CCRecord.ts','CCRecordValueDemo.ts','CCRecordDemo.ts','CCRecordNestedDemo.ts','CCRecordObjectKeyDemo.ts','CCRecordAutoDemo.ts','CCRecordSameTypeDemo.ts','CCRecordEnumStableDemo.ts','CCRecordEnumTwoArgsDemo.ts']) {
    const body = fs.readFileSync(path.join(root,'tests','fixtures',f),'utf8');
    fs.writeFileSync(path.join(tmp,f), body);
  }
  fs.writeFileSync(path.join(tmp,'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2020',module:'commonjs',moduleResolution:'node',experimentalDecorators:true,strict:false,skipLibCheck:true,noEmit:true},include:['./*.ts']}));
  cp.execFileSync('/opt/nvm/versions/node/v22.16.0/bin/tsc',['-p',path.join(tmp,'tsconfig.json')],{stdio:'inherit'});
  for (const f of ['CCRecord.ts','CCRecordValueDemo.ts','CCRecordObjectKeyDemo.ts','CCRecordAutoDemo.ts','CCRecordSameTypeDemo.ts','CCRecordEnumStableDemo.ts','CCRecordEnumTwoArgsDemo.ts']) {
    const out=ts.transpileModule(fs.readFileSync(path.join(tmp,f),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true}}).outputText;
    fs.writeFileSync(path.join(tmp,f.replace('.ts','.js')),out);
  }
  const cc=require(path.join(tmp,'node_modules','cc'));
  const {ItemStats,CCRecordValueDemo}=require(path.join(tmp,'CCRecordValueDemo.js'));
  const {CCRecord,CCRecordClass}=require(path.join(tmp,'CCRecord.js'));
  // v0.2.2: third argument is now options, a stable ID is generated.
  const {ItemKey}=require(path.join(tmp,'CCRecordObjectKeyDemo.js'));
  const objectStore=CCRecordClass(ItemKey,cc.Node,{keyField:'id'});
  assert.strictEqual(objectStore,cc.classes.get('CVHRecord_CVHItemKeyV1_Node'));
  assert.strictEqual(cc.classes.get('CVHRecord_ItemKey_Node_v1'),objectStore,
    'previous demo scenes must continue to deserialize through legacy alias');
  const keyed=new objectStore();
  const left=new ItemKey();left.id='sword';
  keyed.set(left,new cc.Node());
  const byStableField=new ItemKey();byStableField.id='sword';
  assert.strictEqual(keyed.get(byStableField),keyed.get(left),
    'keyField allows lookup by new object after serialization');
  assert.equal(keyed.remove(byStableField),true);
  // keyField is optional: reference semantics, like a JS Map. Callers must
  // use the same object reference when they choose not to declare keyField.
  class RefKey {constructor(){this.label='same-value';}}
  cc._decorator.ccclass('CVHReferenceKeyV1')(RefKey);
  const refCtor=CCRecordClass(RefKey,cc.CCString);
  assert.strictEqual(refCtor,CCRecordClass(RefKey,cc.CCString,{}));
  const refRecord=new refCtor();const refA=new RefKey(),refB=new RefKey();
  refRecord.set(refA,'a');
  assert.equal(refRecord.get(refA),'a');
  assert.equal(refRecord.get(refB),undefined);
  assert.equal(refRecord.entries.length,1);
  refRecord.set(refB,'b');
  assert.equal(refRecord.entries.length,2);
  const refClassId='CVHRecord_CVHReferenceKeyV1_String';
  assert.strictEqual(cc.classes.get(refClassId),refCtor);
  assert.strictEqual(CCRecord(RefKey,cc.CCString,{}).type,refCtor,
    'CCRecord shorthand must support the same options API');
  assert.throws(()=>CCRecordClass(RefKey,cc.CCString,{keyField:'bad-name'}),/keyField|collision/);
  assert.throws(()=>CCRecordClass(RefKey,cc.CCString,{},{legacyIds:[]}),/only once/);
  const {CCRecordAutoDemo, RecordAutoConfig, AttachmentSlot}=require(path.join(tmp,'CCRecordAutoDemo.js'));
  const { CCRecordSameTypeDemo }=require(path.join(tmp,'CCRecordSameTypeDemo.js'));
  const same=new CCRecordSameTypeDemo();
  assert.notStrictEqual(same.first,same.second);
  assert.notStrictEqual(same.first.entries,same.second.entries);
  same.first['a']=10;assert.equal(same.second['a'],undefined);
  assert.equal(same.keepText,'DO_NOT_RESET');
  assert.equal(same.keepNumber,98765);
  const valueOptions = CCRecord(cc.CCString, ItemStats, 'String_ItemStats_v1');
  const valueType = valueOptions.type;
  assert.equal(typeof valueOptions.default, 'function');
  assert.notStrictEqual(valueOptions.default(),valueOptions.default(),'default factory must not share objects');
  const entryClass=cc.classes.get('CVHRecordEntry_String_ItemStats_v1');
  assert(entryClass,'generated @ccclass entry registered');
  const entry = new entryClass();
  assert(entry.value instanceof ItemStats,'custom class value initialized as editable instance');
  assert.equal(entry.value.damage,10);
  assert.equal(entry.value.cooldown,0.5);
  assert.equal(entry.value.enabled,true);
  assert.equal(entry.value.owner,null);
  const Holder=new CCRecordValueDemo();
  const auto=new CCRecordAutoDemo();
  const autoMeta=cc.classes.get('CVHRecord_AutoItem_Stats_v1');
  assert(autoMeta,'auto store serializable class id');
  assert.strictEqual(cc.classes.get('CVHRecord_AutoSlot_Node_v1'), cc.classes.get('CVHRecord_AutoSlot_Node_v1'));
  assert.equal(typeof CCRecord(cc.CCString,ItemStats,'AutoItem_Stats_v1').default,'function');
  assert.equal(auto.items,undefined,'mock CCClass does not inject default itself');
  auto.items=CCRecord(cc.CCString,ItemStats,'AutoItem_Stats_v1').default();
  assert(auto.items instanceof autoMeta);
  const bow=new ItemStats(); bow.damage=9; auto.items['bow']=bow;
  assert.strictEqual(auto.items['bow'],bow);
  auto.config.attachments=CCRecord(AttachmentSlot,cc.Node,'AutoSlot_Node_v1').default();
  assert.equal(auto.config.attachments[AttachmentSlot.Primary],undefined);
  // Mimic Creator applying the CCClass property default factory on an
  // uninitialized TypeScript field (the actual Editor is not in this test).
  assert.strictEqual(cc.CCString, cc.CCString);
  assert.strictEqual(CCRecord(cc.CCString,ItemStats,'String_ItemStats_v1').type,valueType);
  assert.strictEqual(Holder.items, undefined, 'mock Component does not implement Cocos default initialization');
  Holder.items=valueOptions.default();
  assert(Holder.items instanceof valueType, 'CCRecord generated store must match CCClass type');
  assert.equal(Holder instanceof cc.Component,true);
  assert.equal(Holder.title,'Weapon configuration');
  assert.equal(Holder.version,7);
  assert.equal(Holder.debugEnabled,true);
  const item=new ItemStats(); item.damage=55; item.owner=new cc.Node();
  Holder.items['sword'] = item;
  assert.strictEqual(Holder.items['sword'],item);
  // Simulate a serialized class's data shape and read it back in a new instance.
  const saved=Holder.items.entries.map(e=>({key:e.key,value:{description:e.value.description,damage:e.value.damage,cooldown:e.value.cooldown,enabled:e.value.enabled,owner:e.value.owner}}));
  const revived=new valueType();
  revived.entries=saved.map(x=>({key:x.key,value:Object.assign(new ItemStats(),x.value)}));
  assert.equal(revived['sword'].damage,55);
  assert.strictEqual(revived['sword'].owner,item.owner);
  assert.equal(Holder.title,'Weapon configuration');
  // Editor may clear class tables while keeping the CCRecord module cache.
  const beforeLookup=cc.classes.get('CVHRecord_String_ItemStats_v1');
  cc.classes.delete('CVHRecord_String_ItemStats_v1');
  cc.classIds.delete('CVHRecord_String_ItemStats_v1');
  assert.strictEqual(CCRecordClass(cc.CCString,ItemStats,'String_ItemStats_v1'),beforeLookup, 'must keep stable serialized constructor');
  assert.strictEqual(cc.js.getClassById('CVHRecord_String_ItemStats_v1'),beforeLookup, 'must rebind missing ID mapping');
  // Two-argument Enum IDs do NOT contain members. Appending D must preserve
  // the same generated class AND the existing Node value, across mock reload.
  const enumOne={A:0,B:1,C:2};cc.Enum(enumOne);
  const autoFirst=CCRecord(enumOne,cc.Node);
  const enumListReference = cc.Enum.getList(enumOne);
  const oldNode=new cc.Node();
  const inScene=autoFirst.default();inScene[0]=oldNode;
  const stableId='CVHRecord_Enum_Node';
  assert.strictEqual(cc.js.getClassById(stableId),autoFirst.type);
  const enumTwo={A:0,B:1,C:2,D:3};cc.Enum(enumTwo);
  const afterReload=CCRecord(enumTwo,cc.Node);
  assert.strictEqual(afterReload.type,autoFirst.type);
  assert.strictEqual(cc.js.getClassById(stableId),autoFirst.type);
  assert.equal(enumOne.D,3,'cached enum metadata must expose newly added D');
  assert.strictEqual(cc.Enum.getList(enumOne), enumListReference);
  assert(enumListReference.some(x=>x.name==='D' && x.value===3), 'native inspector Enum array must be updated in place');
  // Scene VM can clear engine registration without clearing the CCRecord module.
  cc.classes.delete('CVHRecordEntry_Enum_Node');cc.classIds.delete('CVHRecordEntry_Enum_Node');
  cc.classes.delete('CVHRecord_Enum_Node');cc.classIds.delete('CVHRecord_Enum_Node');
  assert.strictEqual(CCRecord(enumTwo,cc.Node).type, autoFirst.type);
  assert.strictEqual(cc.js.getClassById('CVHRecord_Enum_Node'), autoFirst.type);
  const restored=afterReload.default();restored.entries=inScene.entries.map(e=>({...e}));
  assert.strictEqual(restored[0],oldNode, 'old value at numeric key 0 preserved');
  const changedEnum={OnlyOther:77}; cc.Enum(changedEnum);
  assert.throws(()=>CCRecord(changedEnum,cc.Node),/Ambiguous Enum schema/,
      'must refuse different Enums that have no compatible members');
  const explicitSecond=CCRecord(enumTwo,cc.Node,'TestRecord_SecondEnumNode_v1');
  assert(explicitSecond.type);
  const { CCRecordLegacyAlias }=require(path.join(tmp,'CCRecord.js'));
  CCRecordLegacyAlias(explicitSecond.type,'TestRecord_SecondEnumNode_OLD');
  assert.strictEqual(cc.js.getClassById('CVHRecord_TestRecord_SecondEnumNode_OLD'),explicitSecond.type);
  assert.strictEqual(cc.js.getClassByName('CVHRecord_TestRecord_SecondEnumNode_OLD'),explicitSecond.type);
  // Stable Enum identity survives value-list code changes; historical
  // generated class IDs are aliased to the same Store/Entry constructors.
  const { CCRecordEnumId } = require(path.join(tmp,'CCRecord.js'));
  const old={A:0,B:1}; cc.Enum(old);
  CCRecordEnumId(old,'SavedSlotsV1');
  const historical='Enum_A_B_142efc07_cc_Node';
  const renamedSchema=CCRecord(old,cc.Node,undefined,{legacyIds:[historical]});
  assert.equal(typeof renamedSchema.default,'function');
  assert.equal(cc.classes.get('CVHRecord_Enum_SavedSlotsV1_Node'),renamedSchema.type);
  assert.equal(cc.classes.get('CVHRecord_'+historical),renamedSchema.type);
  assert(cc.classes.get('CVHRecordEntry_'+historical));
  const savedRecord=renamedSchema.default();
  const linked=new cc.Node();savedRecord.set(0,linked);
  old.C=2; // modify enum source, but not the stable serialization name
  assert.strictEqual(CCRecord(old,cc.Node).type,renamedSchema.type);
  const reconstructed=renamedSchema.default();
  reconstructed.entries=savedRecord.entries.map(x=>({...x}));
  assert.strictEqual(reconstructed.get(0),linked);
  // Renaming while retaining the same numeric key preserves its associated value.
  delete old.A; old.Primary=0;
  assert.strictEqual(CCRecord(old,cc.Node).type,renamedSchema.type);
  assert.strictEqual(reconstructed.get(0),linked);
  // v0.8.5: CCIndexRecord forwards legacyIds and stable enum identity.
  const {CCIndexRecord: Indexed}=require(path.join(tmp,'CCRecord.js'));
  const userEnum={A:0,B:1,C:2,D:3};cc.Enum(userEnum);
  CCRecordEnumId(userEnum,'TestEnumV1');
  const indexed=Indexed(userEnum,cc.Node,undefined,{legacyIds:[
      'Enum_A_B_1ea8d27f_cc_Node'
  ]});
  assert.equal(cc.js.getClassById('CVHRecord_Enum_TestEnumV1_Node'),indexed);
  assert.equal(cc.js.getClassById('CVHRecord_Enum_A_B_1ea8d27f_cc_Node'),indexed);
  assert.equal(cc.js.getClassById('CVHRecordEntry_Enum_A_B_1ea8d27f_cc_Node'),
      cc.js.getClassById('CVHRecordEntry_Enum_TestEnumV1_Node'));
  const indexedValue=new indexed();const ref=new cc.Node();indexedValue[0]=ref;
  userEnum.E=4;
  assert.strictEqual(Indexed(userEnum,cc.Node),indexed);
  assert.strictEqual(indexedValue[0],ref);
  const indexedRevived=new indexed();indexedRevived.entries=indexedValue.entries.map(x=>({...x}));
  assert.strictEqual(indexedRevived[0],ref);
  const nodeValue=CCRecord(cc.CCString,cc.Node,'String_Node_Regression_v1');
  const nodeEntry=cc.classes.get('CVHRecordEntry_String_Node_Regression_v1');
  assert.equal(new nodeEntry().value,null,'Node reference must be null until assigned');
  const {CCRecordEnumTwoArgsDemo,TwoArgSlot} = require(path.join(tmp,'CCRecordEnumTwoArgsDemo.js'));
  const twoArg = new CCRecordEnumTwoArgsDemo();
  assert.notStrictEqual(twoArg.first, twoArg.second);
  const twoArgNode=new cc.Node();
  twoArg.first[TwoArgSlot.A]=twoArgNode;
  assert.strictEqual(twoArg.first[TwoArgSlot.A],twoArgNode);
  assert.strictEqual(twoArg.second[TwoArgSlot.A],undefined);
  assert.equal(twoArg.shouldStay,'KEEP_THIS');
  // v0.8.7: Object enumeration exposes logical primitive record keys,
  // never the CCClass backing-array field. The backing array remains
  // registered in Cocos @property metadata and directly accessible.
  twoArg.first[TwoArgSlot.C] = new cc.Node();
  assert.deepEqual(Object.keys(twoArg.first), ['0','2']);
  assert.strictEqual(Object.values(twoArg.first)[0], twoArgNode);
  assert.strictEqual(Object.entries(twoArg.first)[0][1], twoArgNode);
  assert.deepEqual([...Object.entries(twoArg.first)].map(x => x[0]), ['0','2']);
  assert.deepEqual(Object.keys(twoArg.second), []);
  assert(Array.isArray(twoArg.first.entries));
  assert.equal(Object.getOwnPropertyDescriptor(twoArg.first,'entries').enumerable, false);
  assert(cc.classes.get('CVHRecord_Enum_Node').properties.entries,'Cocos @property entries metadata retained');
  const traversed=[];
  for (const key in twoArg.first) traversed.push(key);
  assert.deepEqual(traversed, ['0','2']);
  const oldNodeRef=twoArg.first[TwoArgSlot.A];
  twoArg.first.entries.push({key: TwoArgSlot.A, value: twoArg.first[TwoArgSlot.C]});
  assert.deepEqual(Object.keys(twoArg.first), ['0','2'], 'duplicate keys must enumerate once');
  assert.strictEqual(twoArg.first[TwoArgSlot.A], twoArg.first[TwoArgSlot.C], 'last matching entry wins');
  delete twoArg.first[TwoArgSlot.C];
  assert.deepEqual(Object.keys(twoArg.first), ['0']);
  twoArg.first[TwoArgSlot.A]=oldNodeRef;
  assert.deepEqual(Object.keys(twoArg.first), ['0']);
  const stringRecClass = CCRecordClass(cc.CCString,cc.CCString,'String_String_Keys_v087');
  const stringRec = new stringRecClass();
  stringRec.set('sword','Sword');stringRec.set('bow','Bow');
  assert.deepEqual(Object.keys(stringRec), ['sword','bow']);
  assert.deepEqual(Object.entries(stringRec), [['sword','Sword'],['bow','Bow']]);
  assert.equal(Object.getOwnPropertyNames(stringRec).includes('entries'), true,
     'Reflectable backing entry property must still exist');
  const revivedEnumeration = new (CCRecordClass(TwoArgSlot,cc.Node))();
  revivedEnumeration.entries = twoArg.first.entries.map(e=>({key:e.key,value:e.value}));
  assert.deepEqual(Object.keys(revivedEnumeration), ['0']);
  assert.strictEqual(revivedEnumeration[0],oldNodeRef);
  console.log('PASS TS + mock roundtrip + Object.keys/Object.entries/for..in over CCRecord');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
