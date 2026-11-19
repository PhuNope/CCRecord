'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const manifest = require('../package.json');
assert.equal(manifest.editor,'>=3.8.2');
assert.deepEqual(manifest.contributions['asset-db'],{mount:{path:'./assets',readonly:true}});
assert.ok(fs.existsSync(path.join(root,'assets','CCRecord.ts')));
assert.ok(manifest.contributions.menu.every(x=>x.path==='i18n:menu.extension/CCRecord'));
assert.ok(manifest.contributions.menu.every(x=>manifest.contributions.messages[x.message]));
assert.ok(manifest.contributions.menu.some(x=>x.message==='open-panel'));
assert.ok(manifest.contributions.messages['import-test-files']);
assert.equal(manifest.panels.default.main,'./dist/panels/default');
for (const name of fs.readdirSync(path.join(root,'test-assets'))) {
  const code=fs.readFileSync(path.join(root,'test-assets',name),'utf8');
  assert.ok(!code.includes("from './CCRecord'"), name+' has stale local runtime import');
}
const panelSource=fs.readFileSync(path.join(root,'src/panels/default/index.js'),'utf8');
assert.ok(panelSource.includes('selectedFiles()'));
assert.ok(panelSource.includes('color:var(--color-normal-contrast'), 'panel needs readable foreground text');
assert.ok(!panelSource.includes('color:var(--color-normal-fill,'), 'fill is a background color, not text');
assert.ok(!fs.readFileSync(path.join(root,'src/inspector/20-scene-commands.js'),'utf8').includes('Scene trả về'), 'no stale Scene warning in Inspector');
assert.ok(panelSource.includes("this.action('import-test-files',[files])"));
console.log('PASS manifest: mounted runtime, CCRecord menu grouping, selectable test panel, no stale imports');
