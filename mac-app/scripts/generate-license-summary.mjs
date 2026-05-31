#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const lockPath = path.resolve(process.cwd(), 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const packages = lock.packages ?? {};

function packageNameFromPath(packagePath) {
  const parts = packagePath.split('/');
  const nodeModulesIndex = parts.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0 || nodeModulesIndex === parts.length - 1) return null;
  const first = parts[nodeModulesIndex + 1];
  if (first?.startsWith('@')) {
    const second = parts[nodeModulesIndex + 2];
    return second ? `${first}/${second}` : null;
  }
  return first ?? null;
}

const rows = [];

for (const [packagePath, meta] of Object.entries(packages)) {
  if (!packagePath.startsWith('node_modules/')) continue;
  const name = packageNameFromPath(packagePath);
  if (!name) continue;
  rows.push({
    name,
    version: meta.version ?? '',
    license: meta.license ?? 'MISSING',
    dev: meta.dev === true,
    optional: meta.optional === true,
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const licenseCounts = new Map();
const missing = [];

for (const row of rows) {
  licenseCounts.set(row.license, (licenseCounts.get(row.license) ?? 0) + 1);
  if (row.license === 'MISSING') missing.push(row);
}

console.log('# Field Theory Mac Dependency License Summary');
console.log('');
console.log(`Generated from package-lock.json. Total package entries: ${rows.length}.`);
console.log('');
console.log('## License Counts');
console.log('');
console.log('| License | Count |');
console.log('| --- | ---: |');
for (const [license, count] of [...licenseCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`| ${license.replaceAll('|', '\\|')} | ${count} |`);
}
console.log('');
console.log('## Missing License Metadata');
console.log('');
if (missing.length === 0) {
  console.log('No package-lock entries are missing license metadata.');
} else {
  console.log('| Package | Version | Scope |');
  console.log('| --- | --- | --- |');
  for (const row of missing) {
    const scope = row.dev ? 'dev' : row.optional ? 'optional' : 'runtime';
    console.log(`| ${row.name} | ${row.version} | ${scope} |`);
  }
}
console.log('');
console.log('## Package Entries');
console.log('');
console.log('| Package | Version | License | Scope |');
console.log('| --- | --- | --- | --- |');
for (const row of rows) {
  const scope = row.dev ? 'dev' : row.optional ? 'optional' : 'runtime';
  console.log(`| ${row.name} | ${row.version} | ${row.license.replaceAll('|', '\\|')} | ${scope} |`);
}
