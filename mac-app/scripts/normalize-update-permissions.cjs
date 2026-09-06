const fs = require('node:fs');
const path = require('node:path');

// ShipIt removes quarantine attributes while staging an update. Read-only
// resources (including Swift package licenses) make that operation fail.
// Run on the copied app before signing, never on dependencies or installed apps.
function normalizeUpdatePermissions(root) {
  let changed = 0;
  const visit = (file) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return; // Do not follow links outside the bundle.
    if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unexpected bundle entry: ${file}`);
    const mode = stat.mode & 0o7777;
    const required = stat.isDirectory() ? 0o700 : 0o600;
    if ((mode & required) !== required) {
      fs.chmodSync(file, mode | required);
      changed++;
    }
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
  };
  visit(root);
  return changed;
}
exports.normalizeUpdatePermissions = normalizeUpdatePermissions;
