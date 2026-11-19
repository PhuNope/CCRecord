'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {RuntimeInstaller}=require('../src/main/runtime-installer');
async function main() {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ccrecord-installer-'));
  const sourceFile=path.join(folder,'source.ts');
  const actions=[];
  const installer=new RuntimeInstaller({editor:{Message:{request:async(...args)=>{actions.push(args)}}}});
  try {
    fs.writeFileSync(sourceFile,'export const state = 1;\n');
    const a=await installer.install({projectPath:folder,sourceFile});
    assert.equal(a.status,'installed');
    assert.equal(a.refreshed,true);
    assert.equal(fs.readFileSync(a.destination,'utf8'),'export const state = 1;\n');
    const b=await installer.install({projectPath:folder,sourceFile});
    assert.equal(b.status,'unchanged');
    assert.equal(actions.length,3,'skip AssetDB refresh for identical file');
    fs.writeFileSync(a.destination,'existing project changes');
    const c=await installer.install({projectPath:folder,sourceFile});
    assert.equal(c.status,'updated');
    assert.equal(fs.readFileSync(c.backup,'utf8'),'existing project changes');
    assert.equal(fs.readFileSync(c.destination,'utf8'),'export const state = 1;\n');
    console.log('PASS runtime install: idempotent, explicit backup, AssetDB refresh');
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
