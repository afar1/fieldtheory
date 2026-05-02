#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configArg = process.argv[2] ?? 'package.json';
const configPath = path.resolve(rootDir, configArg);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const buildConfig = config.build ?? config;
const label = path.relative(rootDir, configPath) || configPath;

const allowedApps = new Set([
  'com.fieldtheory.app|Field Theory',
  'com.fieldtheory.experimental|Field Theory Experimental',
]);

const failures = [];
const appIdentity = `${buildConfig.appId}|${buildConfig.productName}`;

if (!allowedApps.has(appIdentity)) {
  failures.push(
    `unexpected app identity ${JSON.stringify({
      appId: buildConfig.appId,
      productName: buildConfig.productName,
    })}`,
  );
}

const files = buildConfig.files;
if (!Array.isArray(files)) {
  failures.push('missing build.files package allowlist');
} else if (!files.includes('!node_modules/electron{,/**/*}')) {
  failures.push('build.files must exclude node_modules/electron so the raw Electron app is never bundled');
}

const extraResources = JSON.stringify(buildConfig.mac?.extraResources ?? []);
if (extraResources.includes('node_modules/electron') || extraResources.includes('Electron.app')) {
  failures.push('mac.extraResources must not copy the raw Electron runtime app');
}

if (failures.length > 0) {
  console.error(`Package safety check failed for ${label}:`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Package safety check passed for ${label}`);
