'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {WindowHookHost} = require('./window-host');
const {RuntimeInstaller} = require('./runtime-installer');

let host = null;
const log = {
  warn(...args) { console.warn(...args); },
  info(...args) { console.log(...args); },
};

exports.load = function load() {
  try {
    const {BrowserWindow} = require('electron');
    host = new WindowHookHost({
      browserWindow: BrowserWindow,
      readScript: () => fs.readFileSync(path.join(__dirname,'inspector.js'),'utf8'),
      log,
    });
    host.start();
    log.info('[CCRecord] Inspector hook enabled');
  } catch (error) {
    log.warn('[CCRecord] Unable to enable Inspector hook:', String(error));
  }
};

exports.unload = async function unload() {
  if (host) await host.stop({unload:true});
  host = null;
};

exports.methods = {
  async installRuntime() {
    try {
      const result = await new RuntimeInstaller({editor:global.Editor,log}).install({
        projectPath:global.Editor?.Project?.path,
        sourceFile:path.resolve(__dirname,'..','runtime','CCRecord.ts'),
      });
      log.info('[CCRecord] Runtime installation:', result);
      return result;
    } catch (error) {
      log.warn('[CCRecord] Runtime installation failed:', String(error));
      return {status:'error',message:String(error)};
    }
  },
  async reloadInspector() {
    if (host) await host.reload();
    return {enabled: Boolean(host)};
  },
  async disableInspector() {
    if (host) await host.stop();
    return {enabled:false};
  },
  async diagnostics() {
    const report = host ? await host.diagnose() : [];
    log.info('[CCRecord] Diagnostics:', report);
    return report;
  },
};
