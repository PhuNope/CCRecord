'use strict';
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {WindowHookHost} = require('../src/main/window-host');
class WebContents extends EventEmitter {
  constructor(id, result='running') {super();this.id=id;this.result=result;this.calls=[];this.destroyed=false;}
  isDestroyed() {return this.destroyed;}
  isLoading() {return false;}
  async executeJavaScript(source) {this.calls.push(source);return source.includes('?.stop?.()') ? null : {status:this.result};}
}
async function main() {
  const mainWindow=new WebContents(1);
  const otherWindow=new WebContents(2,'not-main');
  const timers=[];
  const host=new WindowHookHost({
    browserWindow:{getAllWindows:()=>[{webContents:mainWindow},{webContents:otherWindow}]},
    readScript:()=>'(function() { return {status:"running"}; })()',
    schedule:()=>{const id=timers.length+1;timers.push(id);return id;}, cancel:()=>{},
    log:{warn:()=>{}},
  });
  host.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mainWindow.calls.length,1);
  assert.equal(otherWindow.calls.length,1);
  host.scan();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mainWindow.calls.length,1,'inject only once per document');
  assert.equal(otherWindow.calls.length,1,'skip non-main documents');
  mainWindow.emit('did-finish-load');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mainWindow.calls.length,2,'reinject on navigation');
  await host.stop({unload:true});
  assert.equal(mainWindow.calls.length,3,'reversible hook');
  assert.equal(host.entries.size,0,'cleanup');
  assert.equal(mainWindow.listenerCount('did-finish-load'),0);
  assert.equal(otherWindow.listenerCount('destroyed'),0);
  assert.equal(timers.length,1);
  console.log('PASS window lifecycle injection and cleanup');
}
main().catch(error=>{console.error(error);process.exitCode=1});
