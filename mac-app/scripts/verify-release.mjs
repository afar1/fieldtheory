#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const channel = process.argv[2] ?? 'production';

const channelConfig = {
  production: {
    packageSafetyConfig: [],
    buildScript: 'build',
    env: {
      FIELD_THEORY_BUILD_CHANNEL: 'production',
      VITE_FIELD_THEORY_BUILD_CHANNEL: 'production',
    },
  },
  experimental: {
    packageSafetyConfig: ['electron-builder.experimental.json'],
    buildScript: 'build:experimental',
    env: {
      FIELD_THEORY_BUILD_CHANNEL: 'experimental',
      VITE_FIELD_THEORY_BUILD_CHANNEL: 'experimental',
      EXPERIMENTAL: 'true',
    },
  },
};

const config = channelConfig[channel];

if (!config) {
  console.error('Usage: node scripts/verify-release.mjs production|experimental');
  process.exit(1);
}

const steps = [
  ['npm', ['run', 'typecheck']],
  ['npm', ['test']],
  ['npm', ['audit', '--omit=dev', '--audit-level=high']],
  ['npm', ['run', `guard:release-channel${channel === 'experimental' ? ':experimental' : ''}`]],
  ['npm', ['run', 'guard:tracked-sources']],
  ['npm', ['run', `guard:package-safety${channel === 'experimental' ? ':experimental' : ''}`]],
  ['npm', ['run', config.buildScript]],
  ['npm', ['run', 'guard:electron-dist-requires']],
  ['npm', ['run', 'quality:baseline', '--', '--strict']],
];

for (const [command, args] of steps) {
  const label = [command, ...args].join(' ');
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...config.env,
    },
  });

  if (result.status !== 0) {
    console.error(`\nRelease verification failed for ${channel}: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nRelease verification passed for ${channel}.`);
