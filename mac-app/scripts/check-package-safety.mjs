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
const expectedByIdentity = {
  'com.fieldtheory.app|Field Theory': {
    channel: 'production',
    output: 'release',
    repo: 'field-releases',
    configLabel: 'package.json',
  },
  'com.fieldtheory.experimental|Field Theory Experimental': {
    channel: 'experimental',
    output: 'release-experimental',
    repo: 'oscar',
    configLabel: 'electron-builder.experimental.json',
    artifactName: 'Field.Theory.Experimental-${version}-${arch}.${ext}',
  },
};

if (!allowedApps.has(appIdentity)) {
  failures.push(
    `unexpected app identity ${JSON.stringify({
      appId: buildConfig.appId,
      productName: buildConfig.productName,
    })}`,
  );
}

const expected = expectedByIdentity[appIdentity];
if (expected) {
  if (label !== expected.configLabel) {
    failures.push(`${expected.channel} app identity must be built from ${expected.configLabel}, not ${label}`);
  }

  if (buildConfig.extraMetadata?.fieldTheoryBuildChannel !== expected.channel) {
    failures.push(`${expected.channel} build must set extraMetadata.fieldTheoryBuildChannel=${expected.channel}`);
  }

  if (buildConfig.directories?.output !== expected.output) {
    failures.push(`${expected.channel} build output must be ${expected.output}`);
  }

  if (buildConfig.publish?.provider !== 'github'
    || buildConfig.publish?.owner !== 'afar1'
    || buildConfig.publish?.repo !== expected.repo) {
    failures.push(`${expected.channel} build must publish to afar1/${expected.repo}`);
  }

  if (expected.channel === 'experimental' && buildConfig.publish?.private !== true) {
    failures.push('experimental build must mark the GitHub release feed as private');
  }

  if (expected.channel === 'production' && buildConfig.publish?.private === true) {
    failures.push('production build must not mark the GitHub release feed as private');
  }

  if (buildConfig.afterSign !== 'scripts/notarize.js') {
    failures.push(`${expected.channel} build must run scripts/notarize.js after signing`);
  }

  if (buildConfig.mac?.notarize !== false) {
    failures.push(`${expected.channel} build must keep mac.notarize=false and use the explicit afterSign notarization script`);
  }

  if (expected.artifactName && buildConfig.artifactName !== expected.artifactName) {
    failures.push(`${expected.channel} build must use artifactName ${expected.artifactName}`);
  }
}

const files = buildConfig.files;
if (!Array.isArray(files)) {
  failures.push('missing build.files package allowlist');
} else {
  if (!files.includes('dist/**/*')) {
    failures.push('build.files must include dist/**/* so Browser Library and other renderer entries are packaged');
  }
  if (!files.includes('!node_modules/electron{,/**/*}')) {
    failures.push('build.files must exclude node_modules/electron so the raw Electron app is never bundled');
  }
}

if (!fs.existsSync(path.join(rootDir, 'browser-library.html'))) {
  failures.push('missing browser-library.html renderer entrypoint');
}

const requiredFileAssociations = [
  ['md', 'Markdown'],
  ['markdown', 'Markdown'],
  ['mdx', 'MDX'],
];
const fileAssociations = buildConfig.fileAssociations;
if (!Array.isArray(fileAssociations)) {
  failures.push('missing fileAssociations for markdown document opening');
} else {
  for (const [ext, name] of requiredFileAssociations) {
    const association = fileAssociations.find((item) => item?.ext === ext);
    if (!association) {
      failures.push(`missing ${ext} file association`);
      continue;
    }
    if (association.name !== name || association.role !== 'Editor' || association.rank !== 'Alternate') {
      failures.push(`${ext} file association must keep name=${name}, role=Editor, and rank=Alternate`);
    }
  }
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
