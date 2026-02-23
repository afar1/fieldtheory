const path = require('path');
const { spawnSync } = require('child_process');

exports.default = async function beforeBuild() {
  const projectRoot = path.resolve(__dirname, '..');
  const guardScript = path.join(__dirname, 'check-untracked-source.sh');

  const result = spawnSync('bash', [guardScript], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error('Aborting package: untracked source files were detected.');
  }
};
