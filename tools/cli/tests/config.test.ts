import test from 'node:test';
import assert from 'node:assert/strict';
import { loadChromeSessionConfig } from '../src/config.js';

test('loadChromeSessionConfig reads chrome user data dir and profile directory from env', () => {
  process.env.FT_CHROME_USER_DATA_DIR = '/tmp/chrome-user-data';
  process.env.FT_CHROME_PROFILE_DIRECTORY = 'Profile 1';
  const config = loadChromeSessionConfig('/tmp/project');
  assert.equal(config.chromeUserDataDir, '/tmp/chrome-user-data');
  assert.equal(config.chromeProfileDirectory, 'Profile 1');
  delete process.env.FT_CHROME_USER_DATA_DIR;
  delete process.env.FT_CHROME_PROFILE_DIRECTORY;
});

test('loadChromeSessionConfig defaults profile to Default', () => {
  process.env.FT_CHROME_USER_DATA_DIR = '/tmp/chrome-user-data';
  delete process.env.FT_CHROME_PROFILE_DIRECTORY;
  const config = loadChromeSessionConfig('/tmp/project');
  assert.equal(config.chromeProfileDirectory, 'Default');
  delete process.env.FT_CHROME_USER_DATA_DIR;
});
