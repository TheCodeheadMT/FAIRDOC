// Demo 3 — Backend (server-to-server) integration for the Student Advising portal.
//
// Pattern: the browser NEVER holds the O365 token. The advising app signs the user in
// on its server (OIDC code flow in production; mock Entra here), keeps the token in
// its session, and forwards it to FAIRDOC on each call. The app's server can also:
//   - pin the group context (always the Advising Office group when the user has it)
//   - add app-specific rules (here: a block on downloads after 22:00 is easy to add)
//   - call FAIRDOC itself with the SDK for server-side features (the case summary)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FairDoc } from '../../sdk/fairdoc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ADVISING_PORT || 4100);
const FAIRDOC = process.env.FAIRDOC_URL || 'http://localhost:4000';
const CLIENT_ID = 'advising-portal';
const ADVISING_GROUP = 'a1b2c3d4-0003-4000-8000-advising0001';
const sessions = new Map(); // sid -> { token, user, groupClaim }

const peek = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url'));
const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')));

async function signIn(userId) {
  // Production: exchange the OIDC authorization code at login.microsoftonline.com.
  const r = await fetch(`${FAIRDOC}/mock-entra/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, clientId: CLIENT_ID }) });
  const { access_token } = await r.json();
  const claims = peek(access_token);
  return { token: access_token, user: { name: claims.name, upn: claims.preferred_username, oid: claims.oid }, inAdvising: (claims.groups || []).includes(ADVISING_GROUP) };
}

async function proxy(req, res, sess, apiPath) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { Authorization: `Bearer ${sess.token}` };
  if (sess.inAdvising) headers['X-FairDoc-Group'] = ADVISING_GROUP; // server decides the group context
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  const upstream = await fetch(`${FAIRDOC}${apiPath}`, { method: req.method, headers, body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  console.log(`[advising-proxy] ${sess.user.upn} ${req.method} ${apiPath} → ${upstream.status}`);
  const out = { 'Content-Type': upstream.headers.get('content-type') || 'application/json' };
  const cd = upstream.headers.get('content-disposition');
  if (cd) { out['Content-Disposition'] = cd; out['Access-Control-Expose-Headers'] = 'Content-Disposition'; }
  res.writeHead(upstream.status, out);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/login') {
      const s = await signIn(url.searchParams.get('user') || 'u-0003-okafor');
      const sid = crypto.randomBytes(16).toString('hex');
      sessions.set(sid, s);
      res.writeHead(302, { 'Set-Cookie': `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`, Location: '/' });
      return res.end();
    }
    const sess = sessions.get(cookie(req).sid);
    if (url.pathname === '/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(sess ? { user: sess.user, inAdvising: sess.inAdvising, tokenVisibleToBrowser: false } : null));
    }
    if (url.pathname.startsWith('/fairdoc/')) {
      if (!sess) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"Sign in to the advising portal"}'); }
      return proxy(req, res, sess, url.pathname.slice('/fairdoc'.length) + url.search);
    }
    if (url.pathname === '/case-summary') {
      // Server-side use of the SDK: the app composes its own view from FAIRDOC data.
      if (!sess) { res.writeHead(401); return res.end(); }
      const fd = new FairDoc({ baseUrl: FAIRDOC, getToken: () => sess.token, group: sess.inAdvising ? ADVISING_GROUP : null });
      const cols = await fd.listCollections();
      const stats = await fd.stats();
      const summary = { caseFiles: cols.length, documents: stats.documents, protected: stats.byLabel.Protected || 0, inTrash: stats.deletedDocuments, lastActivity: (await fd.audit({ limit: 1 }))[0]?.ts || null };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(summary));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(HERE, 'public', 'index.html'), 'utf8').replaceAll('{{FAIRDOC}}', FAIRDOC));
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    console.error(e);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Upstream error: ${e.message}` }));
  }
}).listen(PORT, () => console.log(`Advising portal (demo 3) on http://localhost:${PORT}`));
