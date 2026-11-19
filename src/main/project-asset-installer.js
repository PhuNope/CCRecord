'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Import demo scripts into the current project's AssetDB on explicit request.
 * The actual CCRecord module is mounted read-only from the extension, NOT copied.
 * Boundaries: manifest/selection validation -> staging/backup -> AssetDB sync.
 */
class ProjectAssetInstaller {
  constructor({fsApi = fs, pathApi = path, editor, log = console} = {}) {
    this.fs = fsApi;
    this.path = pathApi;
    this.editor = editor;
    this.log = log;
  }

  listFiles({sourceDir}) {
    if (!sourceDir || !this.fs.existsSync(sourceDir)) throw new Error('CCRecord test assets are not bundled');
    return this.fs.readdirSync(sourceDir).filter(name => /^CCRecord[A-Za-z0-9_-]*\.ts$/.test(name) && name !== 'CCRecord.ts').sort();
  }

  async install({projectPath, sourceDir, selectedFiles}) {
    const {fs, path} = this;
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
      throw new Error('Cannot identify the current Cocos Creator project directory');
    }
    const available = this.listFiles({sourceDir});
    const selected = selectedFiles === undefined ? available : selectedFiles;
    if (!Array.isArray(selected) || !selected.length || selected.some(name => typeof name !== 'string' || !available.includes(name)) || new Set(selected).size !== selected.length) {
      throw new Error('Choose one or more valid CCRecord test files');
    }
    const request = this.editor?.Message?.request;
    if (typeof request !== 'function') throw new Error('AssetDB API is unavailable; no files were modified');
    // Refuse to create conflicting serialized CCClasses after upgrading from 0.1.x.
    if (fs.existsSync(path.join(projectPath, 'assets', 'CCRecord', 'CCRecord.ts'))) {
      throw new Error('Legacy assets/CCRecord/CCRecord.ts detected (v0.1.x). Back up your project, migrate imports and remove the legacy copy first to avoid duplicate class registration.');
    }
    // Resolve local fixture imports so selecting one demo never introduces missing scripts.
    const required = new Set();
    const visit = (name) => {
      if (required.has(name)) return;
      required.add(name);
      const code = fs.readFileSync(path.join(sourceDir,name),'utf8');
      for (const match of code.matchAll(/from\s+['"]\.\/(CCRecord[A-Za-z0-9_-]+)['"]/g)) {
        const dependency = match[1] + '.ts';
        if (!available.includes(dependency)) throw new Error(`Missing required demo dependency: ${dependency}`);
        visit(dependency);
      }
    };
    selected.forEach(visit);
    const expanded = [...required];
    const targetDir = path.join(projectPath, 'assets', 'CCRecordTests');
    const plans = expanded.map(name => {
      const source = path.join(sourceDir, name);
      const target = path.join(targetDir, name);
      const contents = fs.readFileSync(source);
      // Source filenames are vetted against a static prefix/extension allowlist.
      if (!contents.includes(Buffer.from("db://ccrecord/CCRecord")) && name !== 'CCRecordValueDemo.ts' && name !== 'CCRecordObjectKeyDemo.ts') {
        throw new Error(`Test fixture ${name} does not import mounted CCRecord module`);
      }
      if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`Destination is not a regular file: ${name}`);
      const prior = fs.existsSync(target) ? fs.readFileSync(target) : null;
      return {name, target, contents, prior, changed: !prior || !prior.equals(contents)};
    });
    const updates = plans.filter(plan => plan.changed);
    if (!updates.length) return {status:'unchanged', files: plans.map(p=>({name:p.name,status:'unchanged'})), backup:null, refreshed:true};

    // Backups are outside assets, so Editor won't import old demo scripts twice.
    let backup = null;
    if (updates.some(p=>p.prior)) {
      const backupRoot = path.join(projectPath, '.ccrecord-backups');
      fs.mkdirSync(backupRoot, {recursive:true});
      backup = fs.mkdtempSync(path.join(backupRoot, 'tests-'));
      for (const plan of updates) if (plan.prior) fs.writeFileSync(path.join(backup,plan.name), plan.prior, {flag:'wx'});
    }
    fs.mkdirSync(targetDir, {recursive:true});
    const changed = [];
    try {
      for (const plan of updates) {
        const temp = path.join(targetDir, `.${process.pid}-${Date.now()}-${plan.name}.tmp`);
        try { fs.writeFileSync(temp, plan.contents, {flag:'wx'}); fs.renameSync(temp, plan.target); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        changed.push(plan);
      }
    } catch (error) {
      // Roll back only files written by this operation; no project meta files are touched.
      for (const plan of changed.reverse()) {
        if (plan.prior) fs.writeFileSync(plan.target, plan.prior);
        else fs.unlinkSync(plan.target);
      }
      throw error;
    }

    // File changes exist even if AssetDB refresh fails; never report full success then.
    const url = 'db://assets/CCRecordTests';
    const warnings=[];
    for (const assetUrl of ['db://assets',url]) {
      try { await request.call(this.editor.Message,'asset-db','refresh-asset',assetUrl); }
      catch (error) { warnings.push(`${assetUrl}: ${String(error)}`); }
    }
    const files = plans.map(p=>({name:p.name,status:!p.changed?'unchanged':p.prior?'updated':'installed'}));
    if (warnings.length) this.log.warn('[CCRecord] AssetDB refresh requires manual retry:', warnings);
    return {status:warnings.length?'refresh-failed':'ok', files, backup, refreshed:warnings.length===0, warnings};
  }
}
module.exports = {ProjectAssetInstaller};
