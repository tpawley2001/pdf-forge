#!/usr/bin/env node
/**
 * PDF Forge Update Server
 *
 * Lightweight Node.js server to host updates on your local network or Tailscale.
 * Place PDF Forge installers in ./releases/ and update versions.json.
 *
 * Usage:
 *   node update-server.js
 *   PDF_FORGE_UPDATE_TOKEN=secret node update-server.js
 *
 * Endpoints:
 *   GET /api/version       → { version, notes, sha256 }
 *   GET /api/download/:ver → serves the installer binary
 *   GET /api/health        → { ok: true }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const UPDATE_TOKEN = process.env.PDF_FORGE_UPDATE_TOKEN || '';
const RELEASES_DIR = path.resolve(__dirname, 'releases');
const RELEASES_DIR_PREFIX = RELEASES_DIR + path.sep;

if (!fs.existsSync(RELEASES_DIR)) {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  console.log('Created releases/ directory');
}

function loadConfig() {
  const configPath = path.join(__dirname, 'versions.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
  return { version: require('./package.json').version, notes: 'No updates available', latestInstaller: null };
}

function safeInstallerPath(name) {
  if (!name) return null;
  const resolved = path.resolve(RELEASES_DIR, name);
  if (resolved !== RELEASES_DIR && !resolved.startsWith(RELEASES_DIR_PREFIX)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (UPDATE_TOKEN) {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Bearer ${UPDATE_TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  if (url.pathname === '/api/version') {
    const config = loadConfig();
    let sha256 = config.sha256 || '';
    if (!sha256 && config.latestInstaller) {
      const instPath = safeInstallerPath(config.latestInstaller);
      if (instPath && fs.existsSync(instPath)) {
        try {
          sha256 = crypto.createHash('sha256').update(fs.readFileSync(instPath)).digest('hex');
        } catch (_) {}
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: config.version, notes: config.notes || '', sha256 }));
    return;
  }

  if (url.pathname.startsWith('/api/download/')) {
    const config = loadConfig();

    let installerPath = safeInstallerPath(config.latestInstaller);

    if (!installerPath || !fs.existsSync(installerPath)) {
      // Search releases/ first, then dist/ as fallback for local development
      const searchDirs = [RELEASES_DIR, path.resolve(__dirname, 'dist')];
      outer: for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.exe') && !f.endsWith('.blockmap'));
        if (files.length > 0) {
          const candidate = path.join(dir, files[files.length - 1]);
          if (candidate.startsWith(dir + path.sep) || candidate === dir) {
            installerPath = candidate;
            break outer;
          }
        }
      }
    }

    if (!installerPath || !fs.existsSync(installerPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Installer not found. Place .exe files in releases/ or run npm run build first.' }));
      return;
    }

    const stat = fs.statSync(installerPath);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${path.basename(installerPath)}"`,
    });

    const stream = fs.createReadStream(installerPath);
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('Stream error');
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  const version = loadConfig().version;
  console.log(`  PDF Forge Update Server v${version}`);
  console.log(`  Listening on http://0.0.0.0:${PORT}`);
  console.log(UPDATE_TOKEN ? '  Auth: token required' : '  Auth: none (set PDF_FORGE_UPDATE_TOKEN to enable)');
  console.log('');

  const ifaces = require('os').networkInterfaces();
  for (const [, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        console.log(`  Network: http://${addr.address}:${PORT}`);
      }
    }
  }

  console.log('');
});
