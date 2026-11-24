// Starts everything for the demos:
//   :4000  FAIRDOC API + mock Entra + widget/SDK/embed
//   :4100  Demo 3 advising portal (backend proxy)
//   :4300  Host apps for demos 1, 2, 5 (a different origin from FAIRDOC, like real apps)
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const procs = [
  spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { stdio: 'inherit' }),
  spawn(process.execPath, [path.join(ROOT, 'demos/3-advising-proxy/server.js')], { stdio: 'inherit' }),
];
process.on('SIGINT', () => { procs.forEach((p) => p.kill()); process.exit(0); });

const DEMOS = path.join(ROOT, 'demos');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.resolve(DEMOS, '.' + rel);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(DEMOS) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(4300, () => console.log('Host apps (demos 1, 2, 5) on http://localhost:4300  ← start here'));
