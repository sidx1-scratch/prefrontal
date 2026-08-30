#!/usr/bin/env node
'use strict';

/*
 * Distribution checks for Prefrontal.
 * Keep this as an allowlist: adding a new shipped file should be deliberate.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const runtimeFiles = [
  '.env.example',
  'agent.js',
  'app.js',
  'index.html',
  'manifest.json',
  'package.json',
  'server.js',
  'style.css',
  'vendor/highlight-dark.min.css',
  'vendor/highlight-light.min.css',
  'vendor/highlight.min.js',
  'vendor/marked.min.js',
];

// npm always includes these metadata files in a package when present.
const allowedPackageFiles = new Set(['LICENSE', 'README.md', ...runtimeFiles]);

function fail(message) {
  console.error(`Distribution check failed: ${message}`);
  process.exit(1);
}

for (const file of runtimeFiles) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing runtime file: ${file}`);
}

const pack = spawnSync(npmCommand, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
});
if (pack.status !== 0) {
  console.error(pack.stderr);
  fail(`npm pack exited with ${pack.status}`);
}

let packReport;
try {
  packReport = JSON.parse(pack.stdout);
} catch (error) {
  console.error(pack.stdout);
  fail(`could not parse npm pack JSON: ${error.message}`);
}

const packageFiles = new Set(packReport[0]?.files?.map(file => file.path) || []);
const missing = [...allowedPackageFiles].filter(file => !packageFiles.has(file));
const unexpected = [...packageFiles].filter(file => !allowedPackageFiles.has(file));
if (missing.length) fail(`npm package is missing: ${missing.join(', ')}`);
if (unexpected.length) fail(`unexpected npm package files: ${unexpected.join(', ')}`);

const installer = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
const missingFromInstaller = runtimeFiles.filter(file =>
  !installer.includes(`"${file}"`)
);
if (missingFromInstaller.length) {
  fail(`install.sh does not fetch: ${missingFromInstaller.join(', ')}`);
}

const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
for (const pattern of ['docs/', '.github/', 'tests/', 'install.sh', 'google2a39946b5f941485.html']) {
  const line = attributes.split(/\r?\n/).find(entry => entry.trim().startsWith(pattern));
  if (!line || !line.includes('export-ignore')) {
    fail(`.gitattributes must export-ignore ${pattern}`);
  }
}

console.log(`Distribution check passed: ${packageFiles.size} npm files; ${runtimeFiles.length} installer files.`);
