#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const channel = process.argv[2];
const allowedBranches = {
  production: 'main',
  experimental: 'experimental',
};

if (!Object.hasOwn(allowedBranches, channel)) {
  console.error('Usage: node scripts/check-release-channel.mjs production|experimental');
  process.exit(1);
}

const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  encoding: 'utf8',
}).trim();

const expectedBranch = allowedBranches[channel];
const override = process.env.FIELD_THEORY_RELEASE_BRANCH_OVERRIDE === 'true';

if (currentBranch === 'HEAD') {
  console.error(`Release channel check failed: ${channel} releases require branch ${expectedBranch}, not detached HEAD.`);
  process.exit(1);
}

if (!override && currentBranch !== expectedBranch) {
  console.error(`Release channel check failed: ${channel} releases must run from ${expectedBranch}; current branch is ${currentBranch}.`);
  console.error('Set FIELD_THEORY_RELEASE_BRANCH_OVERRIDE=true only for an intentional local test package.');
  process.exit(1);
}

if (override && currentBranch !== expectedBranch) {
  console.warn(`Release channel check override: packaging ${channel} from ${currentBranch}; expected ${expectedBranch}.`);
}

console.log(`Release channel check passed: ${channel} on ${currentBranch}.`);
