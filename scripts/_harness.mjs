// Shared harness for the browser suites: a private static server on its own port, plus a
// playwright-core loader that works with the locally installed copy.
//
//   import { startServer, openBrowser } from './_harness.mjs';
//   const { server, base } = await startServer(8893);
//   const { browser } = await openBrowser('chrome');

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.csv': 'text/csv' };

export async function startServer(port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(port, r));
  return { server, base: `http://127.0.0.1:${port}` };
}

export async function openBrowser(channel = 'chrome') {
  const mod = await import(pathToFileURL(process.env.PW || 'C:/Users/nekoc/node_modules/playwright-core/index.js').href);
  const chromium = mod.chromium || (mod.default && mod.default.chromium);
  const browser = await chromium.launch({ channel });
  return { browser };
}

export const signIn = (page) => page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));

// A content hash: switching to a tab with the same row count still changes it.
export const stateHash = () => `
  (function () {
    var html = document.body.innerHTML, h = 5381;
    for (var i = 0; i < html.length; i++) h = (h * 33 ^ html.charCodeAt(i)) >>> 0;
    var open = document.querySelectorAll('.open,.on,[aria-expanded=true],[aria-selected=true]').length;
    return h + ':' + open + ':' + location.pathname + location.search;
  })()`;
