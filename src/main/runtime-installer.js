'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Explicit, opt-in asset installation. Never silently overwrites project files. */
class RuntimeInstaller {
  constructor({fsApi = fs, pathApi = path, editor, log = console}) {
    this.fs = fsApi;
    this.path = pathApi;
    this.editor = editor;
    this.log = log;
  }

  async install({projectPath, sourceFile}) {
    const {fs, path} = this;
    if (!projectPath || !path.isAbsolute(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error('Cannot identify the current Cocos Creator project directory');
    }
    const dir = path.join(projectPath, 'assets', 'CCRecord');
    const destination = path.join(dir, 'CCRecord.ts');
    const source = fs.readFileSync(sourceFile);
    if (fs.existsSync(destination) && source.equals(fs.readFileSync(destination))) {
      return {status:'unchanged', destination, backup:null};
    }

    let backup = null;
    if (fs.existsSync(destination)) {
      const backupRoot = path.join(projectPath, '.ccrecord-backups');
      fs.mkdirSync(backupRoot, {recursive:true});
      const folder = fs.mkdtempSync(path.join(backupRoot, 'runtime-'));
      backup = path.join(folder,'CCRecord.ts');
      fs.copyFileSync(destination, backup, fs.constants.COPYFILE_EXCL);
    }
    fs.mkdirSync(dir, {recursive:true});
    const temporary = path.join(dir, `.${process.pid}-${Date.now()}-CCRecord.ts.tmp`);
    try {
      fs.writeFileSync(temporary, source, {flag:'wx'});
      fs.renameSync(temporary, destination);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      throw error;
    }

    const status = backup ? 'updated' : 'installed';
    const request = this.editor?.Message?.request;
    if (!request) {
      this.log.warn('[CCRecord] Runtime written, but AssetDB refresh is unavailable');
      return {status, destination, backup, refreshed:false};
    }
    const failures = [];
    for (const url of ['db://assets', 'db://assets/CCRecord/', 'db://assets/CCRecord/CCRecord.ts']) {
      try { await request.call(this.editor.Message, 'asset-db','refresh-asset',url); }
      catch (error) { failures.push(`${url}: ${String(error)}`); }
    }
    if (failures.length) this.log.warn('[CCRecord] AssetDB refresh incomplete:', failures);
    return {status, destination, backup, refreshed:failures.length === 0, warnings: failures};
  }
}
module.exports = {RuntimeInstaller};
