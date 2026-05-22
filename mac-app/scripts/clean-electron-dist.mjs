#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(rootDir, 'electron-dist');

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`Removed ${path.relative(rootDir, outDir)}`);
