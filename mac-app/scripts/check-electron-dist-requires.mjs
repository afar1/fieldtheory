#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'electron-dist');
const requirePattern = /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const failures = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(entryPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function existsWithExactCase(targetPath) {
  const resolved = path.resolve(targetPath);
  const { root } = path.parse(resolved);
  const segments = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    let names;
    try {
      names = fs.readdirSync(current);
    } catch {
      return false;
    }

    if (!names.includes(segment)) {
      return false;
    }

    current = path.join(current, segment);
  }

  return fs.existsSync(current);
}

function resolveRelativeRequire(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    `${base}.node`,
    path.join(base, 'index.js'),
  ];

  return candidates.find((candidate) => existsWithExactCase(candidate));
}

if (!fs.existsSync(distDir)) {
  console.error('Electron dist require check failed: electron-dist does not exist. Run npm run build:electron first.');
  process.exit(1);
}

for (const filePath of walk(distDir)) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(requirePattern)) {
    const request = match[1];
    if (!resolveRelativeRequire(filePath, request)) {
      failures.push(`${path.relative(rootDir, filePath)} requires ${request}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Electron dist require check failed. Missing exact-case relative modules:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Electron dist require check passed');
