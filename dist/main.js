'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {WindowHookHost} = require('./window-host');
const {ProjectAssetInstaller} = require('./project-asset-installer');

const testAssetsPath = path.resolve(__dirname,'..','test-assets');
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
    log.info('[CCRecord] Inspector hook enabled; runtime is mounted at db://ccrecord/CCRecord');
  } catch (error) {
    log.warn('[CCRecord] Unable to enable Inspector hook:', String(error));
  }
};

exports.unload = async function unload() {
  if (host) await host.stop({unload:true});
  host = null;
};

exports.methods = {
  openPanel() {
    return global.Editor.Panel.open('ccrecord');
  },
  listTestFiles() {
    return new ProjectAssetInstaller().listFiles({sourceDir:testAssetsPath});
  },
  async importTestFiles(selectedFiles) {
    try {
      const result = await new ProjectAssetInstaller({editor:global.Editor, log}).install({
        projectPath:global.Editor?.Project?.path,
        sourceDir:testAssetsPath,
        selectedFiles,
      });
      log.info('[CCRecord] Test assets import:', result);
      return result;
    } catch (error) {
      log.warn('[CCRecord] Test asset import failed:', String(error));
      return {status:'error',message:String(error)};
    }
  },
  async reloadInspector() {
    if (host) await host.reload();
    return {enabled: Boolean(host)};
  },
  async enableInspector() {
    if (host) host.start();
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
