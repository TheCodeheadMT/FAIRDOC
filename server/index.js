// FAIRDOC reference server (demo). Zero dependencies — Node 18+.
//   /api/*          document storage API (token-only auth)
//   /mock-entra/*   mock O365 identity provider (demo only)
//   /sdk, /widget   client libraries served to host apps
//   /embed/         hosted UI for iframe integration
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as entra from './mock-entra.js';
import { createAuthenticator, AuthError } from './auth.js';
import { createAudit } from './audit.js';
import { createBlobStore, createMetaStore } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FAIRDOC_PORT || 4000);
const DATA = process.env.FAIRDOC_DATA || path.join(ROOT, 'data');
const ALLOWED_APPS = process.env.FAIRDOC_ALLOWED_APPS ? process.env.FAIRDOC_ALLOWED_APPS.split(',') : null;
const LABELS = ['Public', 'Internal', 'Protected'];

entra.initKeys(DATA);
const authenticate = createAuthenticator({ getJwks: entra.jwks, issuer: entra.ISSUER, allowedApps: ALLOWED_APPS });
const audit = createAudit(DATA);
const blobs = createBlobStore(DATA);
const { db, save, id: newId } = createMetaStore(DATA);

// ---------- authorization ----------
const matches = (p, a) => (p.type === 'user' ? p.id === a.oid : a.groups.includes(p.id));
const role = (col, a) => {
  if (a.isAdmin) return 'manage';
  if (col.createdBy === a.oid || (col.owner.type === 'user' && col.owner.id === a.oid)) return 'manage';
  if (matches(col.owner, a)) return col.memberRole || 'write';
  const s = col.shares.filter((x) => matches(x, a)).map((x) => x.role);
  return s.includes('write') ? 'write' : s.includes('read') ? 'read' : null;
};
const rank = { read: 1, write: 2, manage: 3 };
const can = (col, a, need) => (rank[role(col, a)] || 0) >= rank[need];
const inGroupContext = (col, group) => !group || col.owner.id === group || col.shares.some((s) => s.id === group);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const lb = (l) => LABELS.indexOf(l);
class Created { constructor(body) { this.body = body; } }
const created = (body) => new Created(body);

function getCol(cid, a, need) {
  const col = db.collections[cid];
  if (!col) throw new HttpError(404, 'Collection not found');
  if (!can(col, a, need)) throw new HttpError(403, `Requires ${need} access to collection`);
  return col;
}
function getDoc(did, a, need) {
  const doc = db.documents[did];
  if (!doc) throw new HttpError(404, 'Document not found');
  getCol(doc.collectionId, a, need);
  return doc;
}

const groupName = (gid) => entra.GROUPS[gid] || gid;
const viewCol = (c, a) => ({
  ...c, ownerName: c.owner.type === 'group' ? groupName(c.owner.id) : c.ownerUpn, myRole: role(c, a),
  shares: c.shares.map((s) => ({ ...s, name: s.type === 'group' ? groupName(s.id) : s.id })),
  documentCount: Object.values(db.documents).filter((d) => d.collectionId === c.id && !d.deletedAt).length,
});
const viewDoc = (d) => ({ ...d, collectionName: db.collections[d.collectionId]?.name, latest: d.versions[d.versions.length - 1] || null });

function jsonLd(d) {
  const latest = d.versions[d.versions.length - 1];
  return {
    '@context': 'https://schema.org', '@type': d.metadata.resourceType === 'Dataset' ? 'Dataset' : 'DigitalDocument',
    '@id': d.pid, identifier: d.pid, name: d.title, description: d.metadata.description,
    creator: (d.metadata.creators || []).map((n) => ({ '@type': 'Person', name: n })),
    keywords: d.metadata.keywords, license: d.metadata.license, inLanguage: d.metadata.language,
    dateCreated: d.createdAt, dateModified: d.updatedAt, version: latest?.version,
    encodingFormat: latest?.contentType, contentSize: latest?.size,
    conditionsOfAccess: d.label === 'Public' ? 'open' : `restricted (${d.label})`,
  };
}

// ---------- handlers ----------
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

on('GET', '/api/me', ({ a }) => ({
  oid: a.oid, upn: a.upn, name: a.name, roles: a.roles, isAdmin: a.isAdmin, app: a.app,
  group: a.group ? { id: a.group, name: groupName(a.group) } : null,
  groups: a.groups.map((g) => ({ id: g, name: groupName(g) })),
}));

on('GET', '/api/collections', ({ a, q }) => Object.values(db.collections)
  // ?all=1 (admins only) lists every collection — used for support/recovery. Otherwise
  // users see what their own identity grants, scoped to the X-FairDoc-Group if sent.
  .filter((c) => (q.all === '1' && a.isAdmin) || (role(c, { ...a, isAdmin: false }) && inGroupContext(c, a.group)))
  .map((c) => viewCol(c, a)));

on('POST', '/api/collections', ({ a, body }) => {
  const { name, description = '', label = 'Internal', memberRole = 'write' } = body;
  if (!['read', 'write'].includes(memberRole)) throw new HttpError(400, 'memberRole must be read|write');
  if (!name) throw new HttpError(400, 'name required');
  if (!LABELS.includes(label)) throw new HttpError(400, `label must be one of ${LABELS}`);
  // Owned by the group in context (X-FairDoc-Group) or by the user personally.
  const owner = a.group ? { type: 'group', id: a.group } : { type: 'user', id: a.oid };
  const c = { id: newId('col'), name, description, label, memberRole, owner, ownerUpn: a.upn, createdBy: a.oid, createdAt: new Date().toISOString(), shares: [] };
  db.collections[c.id] = c; save();
  audit.record({ actor: a, action: 'collection.create', target: c.id, detail: { name, owner, label, memberRole } });
  return created(viewCol(c, a));
});

on('POST', '/api/collections/:cid/shares', ({ a, p, body }) => {
  const col = getCol(p.cid, a, 'manage');
  const { type, id, role: r = 'read' } = body;
  if (!['user', 'group'].includes(type) || !id || !['read', 'write'].includes(r)) throw new HttpError(400, 'type(user|group), id, role(read|write) required');
  col.shares = col.shares.filter((s) => s.id !== id).concat({ type, id, role: r });
  save();
  audit.record({ actor: a, action: 'collection.share', target: col.id, detail: { type, id, role: r } });
  return viewCol(col, a);
});

on('DELETE', '/api/collections/:cid/shares/:sid', ({ a, p }) => {
  const col = getCol(p.cid, a, 'manage');
  col.shares = col.shares.filter((s) => s.id !== decodeURIComponent(p.sid));
  save();
  audit.record({ actor: a, action: 'collection.unshare', target: col.id, detail: { id: p.sid } });
  return viewCol(col, a);
});

on('GET', '/api/collections/:cid/documents', ({ a, p, q }) => {
  getCol(p.cid, a, 'read');
  return Object.values(db.documents)
    .filter((d) => d.collectionId === p.cid && (q.includeDeleted === '1' || !d.deletedAt)).map(viewDoc);
});

on('POST', '/api/collections/:cid/documents', ({ a, p, body }) => {
  const col = getCol(p.cid, a, 'write');
  const { title, metadata = {}, label = col.label } = body;
  if (!title) throw new HttpError(400, 'title required');
  if (!LABELS.includes(label)) throw new HttpError(400, 'bad label');
  const docId = newId('doc');
  const now = new Date().toISOString();
  const d = {
    id: docId, pid: `ark:/99999/fd-${docId.slice(4)}`, collectionId: col.id, title, label,
    metadata: { creators: [a.name], keywords: [], license: 'All rights reserved', resourceType: 'Text', language: 'en', description: '', ...metadata },
    createdBy: a.oid, createdByUpn: a.upn, createdAt: now, updatedAt: now, deletedAt: null, versions: [],
  };
  db.documents[d.id] = d; save();
  audit.record({ actor: a, action: 'document.create', target: d.id, detail: { collectionId: col.id, title, label } });
  return created(viewDoc(d));
});

on('PUT', '/api/documents/:did/content', ({ a, p, q, raw, req }) => {
  const d = getDoc(p.did, a, 'write');
  if (d.deletedAt) throw new HttpError(409, 'Document is deleted; restore first');
  if (!raw?.length) throw new HttpError(400, 'empty body');
  const version = d.versions.length + 1;
  const stored = blobs.put(`${d.collectionId}/${d.id}/v${version}`, raw);
  const v = { version, size: stored.size, sha256: stored.sha256, key: stored.key, filename: q.filename || `${d.title}`, contentType: req.headers['content-type'] || 'application/octet-stream', createdAt: new Date().toISOString(), createdByUpn: a.upn, comment: q.comment || '' };
  d.versions.push(v); d.updatedAt = v.createdAt; save();
  audit.record({ actor: a, action: version === 1 ? 'document.upload' : 'document.version', target: d.id, detail: { version, size: v.size, sha256: v.sha256, filename: v.filename } });
  return created(viewDoc(d));
});

on('GET', '/api/documents/:did', ({ a, p }) => {
  const d = getDoc(p.did, a, 'read');
  audit.record({ actor: a, action: 'document.view', target: d.id });
  return viewDoc(d);
});

on('GET', '/api/documents/:did/metadata.jsonld', ({ a, p }) => {
  const d = getDoc(p.did, a, 'read');
  audit.record({ actor: a, action: 'document.metadata.export', target: d.id });
  return jsonLd(d);
});

on('PATCH', '/api/documents/:did', ({ a, p, body }) => {
  const d = getDoc(p.did, a, 'write');
  const before = { title: d.title, metadata: { ...d.metadata }, label: d.label };
  if (body.title) d.title = body.title;
  if (body.metadata) d.metadata = { ...d.metadata, ...body.metadata };
  if (body.label) { if (!LABELS.includes(body.label)) throw new HttpError(400, 'bad label'); d.label = body.label; }
  d.updatedAt = new Date().toISOString(); save();
  audit.record({ actor: a, action: 'document.metadata.update', target: d.id, detail: { before, after: { title: d.title, metadata: d.metadata, label: d.label } } });
  return viewDoc(d);
});

on('GET', '/api/documents/:did/download', ({ a, p, q }) => {
  const d = getDoc(p.did, a, 'read');
  if (d.deletedAt) throw new HttpError(410, 'Document is deleted');
  const v = q.version ? d.versions.find((x) => x.version === Number(q.version)) : d.versions[d.versions.length - 1];
  if (!v) throw new HttpError(404, 'No such version');
  audit.record({ actor: a, action: 'document.download', target: d.id, detail: { version: v.version, label: d.label } });
  return { __raw: blobs.get(v.key), type: v.contentType, filename: v.filename };
});

on('DELETE', '/api/documents/:did', ({ a, p }) => {
  const d = getDoc(p.did, a, 'write');
  d.deletedAt = new Date().toISOString(); d.deletedByUpn = a.upn; save();
  audit.record({ actor: a, action: 'document.delete', target: d.id, detail: { soft: true } });
  return viewDoc(d);
});

on('POST', '/api/documents/:did/restore', ({ a, p }) => {
  const d = getDoc(p.did, a, 'write');
  d.deletedAt = null; delete d.deletedByUpn; save();
  audit.record({ actor: a, action: 'document.restore', target: d.id });
  return viewDoc(d);
});

on('POST', '/api/documents/:did/move', ({ a, p, body }) => {
  const d = getDoc(p.did, a, 'write');
  const dest = getCol(body.collectionId, a, 'write');
  if (lb(d.label) > lb(dest.label)) {
    audit.record({ actor: a, action: 'document.move', target: d.id, outcome: 'denied', detail: { reason: 'label policy', from: d.collectionId, to: dest.id } });
    throw Object.assign(new HttpError(403, `Policy: a ${d.label} document cannot move into a ${dest.label} collection`), { audited: true });
  }
  const from = d.collectionId;
  d.collectionId = dest.id; d.updatedAt = new Date().toISOString(); save();
  audit.record({ actor: a, action: 'document.move', target: d.id, detail: { from, to: dest.id, reason: body.reason || '' } });
  return viewDoc(d);
});

on('GET', '/api/search', ({ a, q }) => {
  const term = (q.q || '').toLowerCase();
  const res = Object.values(db.documents).filter((d) => {
    const col = db.collections[d.collectionId];
    if (d.deletedAt || !col || !can(col, a, 'read') || !inGroupContext(col, a.group)) return false;
    if (q.label && d.label !== q.label) return false;
    const hay = [d.title, d.metadata.description, ...(d.metadata.keywords || []), ...(d.metadata.creators || []), d.pid, ...d.versions.map((v) => v.filename)].join(' ').toLowerCase();
    return hay.includes(term);
  }).map(viewDoc);
  audit.record({ actor: a, action: 'search', detail: { q: q.q, results: res.length } });
  return res;
});

on('GET', '/api/documents/:did/audit', ({ a, p }) => {
  getDoc(p.did, a, 'read');
  return audit.query({ target: p.did, limit: 500 });
});

on('GET', '/api/audit', ({ a, q }) => {
  // Admins/auditors can query everything; everyone else sees only their own trail.
  const filter = { ...q, limit: Number(q.limit || 200) };
  if (!a.isAdmin) filter.user = a.oid;
  return audit.query(filter);
});

on('GET', '/api/audit/verify', ({ a }) => {
  if (!a.isAdmin) throw new HttpError(403, 'Admin only');
  return { ...audit.verify(), retentionYears: audit.retentionYears };
});

on('GET', '/api/stats', ({ a, q }) => {
  const global = q.scope === 'global' && a.isAdmin;
  const cols = Object.values(db.collections).filter((c) => (global ? true : can(c, a, 'read') && inGroupContext(c, a.group)));
  const ids = new Set(cols.map((c) => c.id));
  const docs = Object.values(db.documents).filter((d) => ids.has(d.collectionId));
  const events = audit.all().filter((e) => (global ? true : e.user === a.oid));
  const count = (arr, k) => arr.reduce((m, e) => { const key = e[k] ?? '(unauthenticated)'; m[key] = (m[key] || 0) + 1; return m; }, {});
  const days = [...Array(7)].map((_, i) => new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10));
  return {
    scope: global ? 'global' : 'mine',
    collections: cols.length,
    documents: docs.filter((d) => !d.deletedAt).length,
    deletedDocuments: docs.filter((d) => d.deletedAt).length,
    versions: docs.reduce((n, d) => n + d.versions.length, 0),
    bytes: docs.reduce((n, d) => n + d.versions.reduce((m, v) => m + v.size, 0), 0),
    byLabel: count(docs, 'label'),
    byCollection: cols.map((c) => {
      const cd = docs.filter((d) => d.collectionId === c.id);
      return { id: c.id, name: c.name, documents: cd.filter((d) => !d.deletedAt).length, bytes: cd.reduce((n, d) => n + d.versions.reduce((m, v) => m + v.size, 0), 0) };
    }),
    eventsByApp: count(events, 'app'),
    eventsByAction: count(events, 'action'),
    denied: events.filter((e) => e.outcome !== 'success').length,
    activityLast7Days: days.map((day) => ({ day, events: events.filter((e) => e.ts.startsWith(day)).length })),
  };
});

// ---------- mock Entra ----------
const mockRoutes = {
  'GET /mock-entra/users': () => entra.publicUsers(),
  'GET /mock-entra/discovery/v2.0/keys': () => entra.jwks(),
  'POST /mock-entra/token': ({ body }) => ({ access_token: entra.issueToken({ userId: body.userId, clientId: body.clientId || 'unknown-app', ttlSeconds: body.ttlSeconds }), token_type: 'Bearer' }),
};

// ---------- http plumbing ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function serveStatic(res, baseDir, rel) {
  const file = path.resolve(baseDir, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(baseDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-FairDoc-Group',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition',
};

function send(res, status, data) {
  if (data && data.__raw) {
    res.writeHead(status, { ...cors, 'Content-Type': data.type, 'Content-Disposition': `attachment; filename="${encodeURIComponent(data.filename)}"` });
    return res.end(data.__raw);
  }
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > 50 * 1024 * 1024) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  const ip = req.socket.remoteAddress;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  try {
    const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
    const isJson = (req.headers['content-type'] || '').includes('application/json');
    const body = raw && isJson && raw.length ? JSON.parse(raw) : {};

    const mock = mockRoutes[`${req.method} ${url.pathname}`];
    if (mock) return send(res, 200, mock({ body }));

    if (url.pathname.startsWith('/api/')) {
      let a;
      try { a = authenticate(req); } catch (e) {
        audit.record({ actor: null, action: 'auth.denied', outcome: 'denied', detail: { reason: e.message, path: url.pathname }, ip });
        throw e;
      }
      a.ip = ip;
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        try {
          const out = await r.fn({ a, p: m.groups || {}, q, body, raw, req });
          return out instanceof Created ? send(res, 201, out.body) : send(res, 200, out);
        } catch (e) {
          if (e.status === 403 && !e.audited) audit.record({ actor: a, action: `${r.method} ${url.pathname}`, outcome: 'denied', detail: { reason: e.message }, ip });
          throw e;
        }
      }
      throw new HttpError(404, 'No such endpoint');
    }

    const staticMap = [['/sdk/', 'sdk'], ['/widget/', 'widget'], ['/embed/', 'embed']];
    for (const [prefix, dir] of staticMap) {
      if (url.pathname.startsWith(prefix) && serveStatic(res, path.join(ROOT, dir), url.pathname.slice(prefix.length - 1))) return;
    }
    if (url.pathname === '/') return send(res, 200, { service: 'FAIRDOC', api: '/api', docs: 'see README.md' });
    throw new HttpError(404, 'Not found');
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    if (!e.status) console.error(e);
  }
});

server.listen(PORT, () => console.log(`FAIRDOC API on http://localhost:${PORT}`));
