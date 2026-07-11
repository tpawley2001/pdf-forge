// Single source of truth for app version.
// Reads package.json once. Every other file should import/require from here.
// DO NOT hardcode version strings anywhere else.

const path = require('path');
const fs = require('fs');

const pkgPath = path.resolve(__dirname, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const VERSION = pkg.version;

module.exports = { VERSION };
