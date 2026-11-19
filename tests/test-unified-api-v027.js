'use strict';
const fs=require('fs'); const path=require('path'); const os=require('os'); const assert=require('assert/strict'); const cp=require('child_process');
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const root=path.resolve(__dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ccrecord-v027-'));
try {
 const cc=path.join(tmp,'node_modules','cc');fs.mkdirSync(cc,{recursive:true});
 fs.writeFileSync(path.join(cc,'index.js'),`'use strict';
 const classes=new Map(), ids=new Map();
 const property=(type)=>(proto,key)=>{const C=proto.constructor;(C.properties||={})[key]=type;};
 const ccclass=(name)=>(ctor)=>{ctor.ccclassName=name;classes.set(name,ctor);ids.set(name,ctor);};
 const CCString={name:'CCString'},CCInteger={name:'CCInteger'},CCFloat={name:'CCFloat'},CCBoolean={name:'CCBoolean'};
 class Node{}class Asset{}class Component{}
 const Enum=function(type){type.__enum=true;return type;};Enum.isEnum=t=>!!t?.__enum;Enum.getList=t=>t.__enums__||(t.__enums__=Object.keys(t).filter(k=>typeof t[k]==='number').map(k=>({name:k,value:t[k]})));
 const js={getClassName:t=>t?.ccclassName||t?.name||'',getClassId:t=>t?.ccclassName||'',getClassById:id=>ids.get(id),getClassByName:name=>classes.get(name),setClassAlias:(ctor,id)=>{const existing=ids.get(id)||classes.get(id);if(existing&&existing!==ctor)throw Error('collision');ids.set(id,ctor);classes.set(id,ctor)}};
 module.exports={_decorator:{property,ccclass},CCString,CCInteger,CCFloat,CCBoolean,Node,Asset,Component,Enum,js,classes,ids};`);
 fs.writeFileSync(path.join(cc,'index.d.ts'),`export declare const _decorator: {property(type?:any): PropertyDecorator; ccclass(name:string):ClassDecorator};
 export declare const CCString:any,CCInteger:any,CCFloat:any,CCBoolean:any,Enum:any,js:any;
 export declare class Node{name:string;}export declare class Asset{}export declare class Component{}`);
 for(const name of ['CCRecord.ts',...fs.readdirSync(path.join(root,'test-assets')).filter(x=>x.endsWith('.ts'))]){
  const src=name==='CCRecord.ts'?path.join(root,'assets',name):path.join(root,'test-assets',name);
  fs.writeFileSync(path.join(tmp,name),fs.readFileSync(src,'utf8').replaceAll('db://ccrecord/CCRecord','./CCRecord'));
 }
 fs.writeFileSync(path.join(tmp,'Contract.ts'),`import { CCRecord, ICCRecord } from './CCRecord';
 import { _decorator, CCString, Node } from 'cc'; const {property,ccclass}=_decorator;
 @ccclass('ContractObjectKey') class ItemKey { @property(CCString) id=''; }
 @ccclass('ContractDemo') class Host {
   @property(CCRecord<string,string>(CCString,CCString)) text!: Record<string,string>;
   @property(CCRecord<Node,Node>(Node,Node)) nodes!: ICCRecord<Node,Node>;
   @property(CCRecord<ItemKey,Node|null>(ItemKey,Node,{keyField:'id'})) keyed!: ICCRecord<ItemKey,Node|null>;
   method(node:Node) { const v=this.nodes.get(node); this.nodes.set(node,node); this.text['x']='hi'; return v; }
 }
 // @ts-expect-error Object keys are not a TypeScript Record index.
 type BadRecord=Record<Node,Node>;
 // @ts-expect-error Removed symbol must not be imported.
 import {CCRecordClass} from './CCRecord';
 // @ts-expect-error Removed symbol must not be imported.
 import {CCIndexRecord} from './CCRecord';
 // @ts-expect-error Removed symbol must not be imported.
 import {createRecord} from './CCRecord';
 // @ts-expect-error Removed symbol must not be imported.
 import {CCRecordEnumId} from './CCRecord';
 // @ts-expect-error No fourth positional argument.
 CCRecord(CCString,CCString,undefined,{});
 // @ts-expect-error Unsupported legacyIds option.
 CCRecord(CCString,CCString,{legacyIds:['old']});`);
 const options={compilerOptions:{target:'ES2020',module:'CommonJS',moduleResolution:'node',useDefineForClassFields:false,experimentalDecorators:true,strict:true,skipLibCheck:true,noEmit:true},include:['./*.ts']};
 fs.writeFileSync(path.join(tmp,'tsconfig.json'),JSON.stringify(options));
 cp.execFileSync('tsc',['-p',path.join(tmp,'tsconfig.json')],{stdio:'inherit'});
 for(const file of fs.readdirSync(tmp).filter(x=>x.endsWith('.ts'))){const js=ts.transpileModule(fs.readFileSync(path.join(tmp,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,experimentalDecorators:true,useDefineForClassFields:false}}).outputText;fs.writeFileSync(path.join(tmp,file.replace(/\.ts$/,'.js')),js);}
 const ccmod=require(path.join(cc,'index.js'));const {CCRecord}=require(path.join(tmp,'CCRecord.js'));
 assert.equal('CCRecordClass' in require(path.join(tmp,'CCRecord.js')),false);
 assert.equal('CCIndexRecord' in require(path.join(tmp,'CCRecord.js')),false);
 assert.equal('createRecord' in require(path.join(tmp,'CCRecord.js')),false);
 assert.equal('CCRecordEnumId' in require(path.join(tmp,'CCRecord.js')),false);
 const name=CCRecord(ccmod.CCString,ccmod.CCString), text=name.default();
 text['sword']='Sword';text['bow']='Bow';assert.deepEqual(Object.keys(text),['sword','bow']);
 assert.notStrictEqual(name.default(),name.default(),'separate default stores');
 const nodeMetadata=CCRecord(ccmod.Node,ccmod.Node),nodes=nodeMetadata.default(),node=new ccmod.Node();
 nodes.set(node,node);assert.strictEqual(nodes.get(node),node);assert.equal(nodes.entries.length,1);
 assert.equal(new (ccmod.classes.get('CVHRecordEntry_Node_Node'))().key,null);
 const {ItemKey}=require(path.join(tmp,'CCRecordObjectKeyDemo.js'));const keyed=CCRecord(ItemKey,ccmod.Node,{keyField:'id'}).default();
 const a=new ItemKey();a.id='sword';const b=new ItemKey();b.id='sword';keyed.set(a,node);
 assert.strictEqual(keyed.get(b),node);
 const enumType={A:0,B:1};ccmod.Enum(enumType);
 const enumMeta=CCRecord(enumType,ccmod.Node,{enumId:'DemoV1'});assert.equal(ccmod.classes.get('CVHRecord_Enum_DemoV1_Node'),enumMeta.type);
 assert.strictEqual(CCRecord(enumType,ccmod.Node,{enumId:'DemoV1'}).type,enumMeta.type);
 assert.throws(()=>CCRecord(ccmod.CCString,ccmod.Node,{enumId:'Nope'}),/enumId is only valid/);
 assert.throws(()=>CCRecord(ccmod.CCString,ccmod.Node,{legacyIds:['Old']}),/Unsupported option/);
 // Scene/Prefab round trip: serialized CCClass Entry array is sufficient.
 const nodeScene=nodes.entries.map(e=>({key:e.key,value:e.value}));
 const nodeRevived=nodeMetadata.default();nodeRevived.entries=nodeScene;
 assert.strictEqual(nodeRevived.get(node),node);
 const stringClass=CCRecord(ccmod.CCString,ccmod.CCString).type;
 const oldIds=ccmod.ids.get('CVHRecord_String_String');
 ccmod.classes.delete('CVHRecord_String_String');ccmod.ids.delete('CVHRecord_String_String');
 assert.strictEqual(CCRecord(ccmod.CCString,ccmod.CCString).type,stringClass,'existing serialized class must be re-registered');
 assert.strictEqual(ccmod.ids.get('CVHRecord_String_String'),oldIds);
 const enumAuto1={A:0,B:1};ccmod.Enum(enumAuto1);
 const metaAuto=CCRecord(enumAuto1,ccmod.Node);const oldEnumList=ccmod.Enum.getList(enumAuto1);
 const enumAuto2={A:0,B:1,C:2};ccmod.Enum(enumAuto2);
 assert.strictEqual(CCRecord(enumAuto2,ccmod.Node).type,metaAuto.type,'compatible Enum refresh must keep constructor');
 assert.equal(enumAuto1.C,2);
 assert.strictEqual(ccmod.Enum.getList(enumAuto1),oldEnumList,'enum list should stay in place');
 const enumIncompatible={X:99};ccmod.Enum(enumIncompatible);
 assert.throws(()=>CCRecord(enumIncompatible,ccmod.Node),/Ambiguous Enum schema/);
 const enumDifferent={First:0};ccmod.Enum(enumDifferent);
 const otherSchema=CCRecord(enumDifferent,ccmod.Node,{enumId:'AnotherEnum'});
 assert.notStrictEqual(otherSchema.type,enumMeta.type);
 assert.throws(()=>CCRecord(enumType,ccmod.Node,{enumId:'not valid'}),/enumId/);
 assert.equal(CCRecord(ccmod.CCString,ccmod.CCString).type,stringClass);
 // No legacy aliases or positional IDs may be registered as hidden side effects.
 assert.equal(ccmod.classes.has('CVHRecord_String_String_Old'),false);
 for(const name of fs.readdirSync(tmp).filter(x=>x.endsWith('Demo.js')))require(path.join(tmp,name));
 console.log('PASS unified CCRecord API, TypeScript type contract, primitive index, Node/custom keys, stable enums, all examples');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
