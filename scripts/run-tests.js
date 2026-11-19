'use strict';
const {execFileSync} = require('node:child_process');
const {readdirSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of readdirSync(path.join(root,'tests')).filter(f=>f.startsWith('test-') && f.endsWith('.js')).sort()) {
  console.log('TEST',name);
  execFileSync(process.execPath, [path.join(root,'tests',name)], {stdio:'inherit'});
}
