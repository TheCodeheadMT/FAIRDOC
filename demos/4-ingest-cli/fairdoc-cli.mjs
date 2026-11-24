#!/usr/bin/env node
// Demo 4 — Command-line / scripted integration (bulk research-data ingest).
// Pattern: a script or scheduled job uses the SDK from Node with the user's token.
// In production the token comes from an MSAL device-code sign-in; here from mock Entra.
//
//   node fairdoc-cli.mjs login <userId>            sign in as a demo user
//   node fairdoc-cli.mjs walkthrough               run EVERY function end-to-end
//   node fairdoc-cli.mjs help                      list all commands
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FairDoc } from '../../sdk/fairdoc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.FAIRDOC_URL || 'http://localhost:4000';
const CLIENT_ID = 'ingest-cli'; // this app's own Entra client id — never registered with FAIRDOC
const TOKEN_FILE = path.join(HERE, '.token');
const MIME = { '.csv': 'text/csv', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf' };

const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i];
  else pos.push(args[i]);
}
const [cmd, ...rest] = pos;

async function login(userId) {
  const r = await fetch(`${BASE}/mock-entra/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, clientId: CLIENT_ID }) });
  const { access_token } = await r.json();
  fs.writeFileSync(TOKEN_FILE, access_token);
  return access_token;
}
const token = () => process.env.FAIRDOC_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : null);
const fd = new FairDoc({ baseUrl: BASE, getToken: token, group: flags.group || process.env.FAIRDOC_GROUP || null });

const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const table = (rows, cols) => {
  if (!rows.length) return console.log('  (none)');
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  console.log('  ' + cols.map((c, i) => c.toUpperCase().padEnd(w[i])).join('  '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  '));
};
const docRow = (d) => ({ id: d.id, title: d.title, label: d.label, ver: d.latest?.version ?? 0, size: d.latest ? fmtBytes(d.latest.size) : '-', deleted: d.deletedAt ? 'yes' : '', pid: d.pid });
const auditRow = (e) => ({ seq: e.seq, ts: e.ts.slice(0, 19), user: e.upn || '-', app: e.app || '-', action: e.action, outcome: e.outcome, retainUntil: e.retainUntil.slice(0, 10) });

function readFileArg(f) {
  const buf = fs.readFileSync(f);
  return { buf, filename: path.basename(f), contentType: MIME[path.extname(f)] || 'application/octet-stream' };
}

// Bulk ingest: every file in a directory; FAIR metadata from an optional metadata.json sidecar
// ({ "_default": {...}, "file.csv": {...} }).
async function ingest(collectionId, dir, label) {
  const sidecar = fs.existsSync(path.join(dir, 'metadata.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')) : {};
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x !== 'metadata.json')) {
    const { buf, filename, contentType } = readFileArg(path.join(dir, f));
    const meta = { ...(sidecar._default || {}), ...(sidecar[f] || {}) };
    const { title = filename, ...metadata } = meta;
    const d = await fd.upload(collectionId, buf, { title, metadata, label, filename, contentType });
    console.log(`  ↑ ${filename.padEnd(28)} → ${d.id}  ${d.pid}  (${fmtBytes(d.latest.size)}, sha256 ${d.latest.sha256.slice(0, 12)}…)`);
    out.push(d);
  }
  return out;
}

const commands = {
  async help() {
    console.log(`FAIRDOC CLI (demo 4). Global flags: --group <groupId>
  login <userId>                          sign in (mock Entra); users: node fairdoc-cli.mjs users
  users                                   list demo users
  whoami                                  show identity from token
  collections [--all]                     list collections (--all: admin)
  mkcol <name> [--label L]                create collection (group-owned if --group)
  ingest <collectionId> <dir> [--label L] bulk upload a directory with metadata.json sidecar
  upload <collectionId> <file> [--title T] upload one file
  ls <collectionId> [--deleted]           list documents
  search <text> [--label L]               search metadata
  get <docId> [--version N] [--out F]     download
  version <docId> <file> [--comment C]    upload a new version
  info <docId>                            details + version history
  meta <docId> --json '{...}'             update FAIR metadata
  export <docId>                          JSON-LD metadata export
  share <collectionId> <user|group> <id> [--role read|write]
  unshare <collectionId> <id>
  rm <docId> | restore <docId>            soft delete / recover
  mv <docId> <collectionId> [--reason R]  move document
  history <docId>                         document audit trail
  audit [--user U] [--action A]           audit log (own trail; admins: all)
  verify                                  verify audit hash chain (admin)
  stats [--global]                        usage statistics
  walkthrough                             run every function end-to-end`);
  },
  async users() { table((await (await fetch(`${BASE}/mock-entra/users`)).json()).map((u) => ({ id: u.id, name: u.name, kind: u.kind, roles: u.roles.join(','), groups: u.groups.map((g) => g.id).join(', ') })), ['id', 'name', 'kind', 'roles', 'groups']); },
  async login([u]) { await login(u); const me = await fd.me(); console.log(`Signed in as ${me.name} <${me.upn}> via app "${me.app}"`); },
  async whoami() { console.log(JSON.stringify(await fd.me(), null, 2)); },
  async collections() { table((await fd.listCollections({ all: flags.all })).map((c) => ({ id: c.id, name: c.name, label: c.label, owner: c.ownerName, role: c.myRole, docs: c.documentCount })), ['id', 'name', 'label', 'owner', 'role', 'docs']); },
  async mkcol([name]) { const c = await fd.createCollection({ name, label: flags.label || 'Internal' }); console.log(`Created ${c.id} "${c.name}" owned by ${c.ownerName}`); },
  async ingest([cid, dir]) { await ingest(cid, dir, flags.label); },
  async upload([cid, file]) { const f = readFileArg(file); const d = await fd.upload(cid, f.buf, { title: flags.title || f.filename, filename: f.filename, contentType: f.contentType, label: flags.label }); console.log(`Uploaded ${d.id} ${d.pid}`); },
  async ls([cid]) { table((await fd.listDocuments(cid, { includeDeleted: !!flags.deleted })).map(docRow), ['id', 'title', 'label', 'ver', 'size', 'deleted']); },
  async search([q]) { table((await fd.search(q, { label: flags.label })).map((d) => ({ ...docRow(d), collection: d.collectionName })), ['id', 'title', 'collection', 'label', 'ver']); },
  async get([id]) { const r = await fd.download(id, { version: flags.version }); const out = flags.out || r.filename; fs.writeFileSync(out, Buffer.from(r.data)); console.log(`Saved ${out} (${fmtBytes(r.data.byteLength)})`); },
  async version([id, file]) { const f = readFileArg(file); const d = await fd.newVersion(id, f.buf, { filename: f.filename, contentType: f.contentType, comment: flags.comment }); console.log(`Now at version ${d.latest.version}`); },
  async info([id]) {
    const d = await fd.getDocument(id);
    console.log(`${d.title}  [${d.label}]  ${d.pid}\n  collection: ${d.collectionName}\n  metadata:   ${JSON.stringify(d.metadata)}`);
    table(d.versions.map((v) => ({ v: v.version, file: v.filename, size: fmtBytes(v.size), by: v.createdByUpn, at: v.createdAt.slice(0, 19), sha256: v.sha256.slice(0, 16) })), ['v', 'file', 'size', 'by', 'at', 'sha256']);
  },
  async meta([id]) { const d = await fd.updateMetadata(id, { metadata: JSON.parse(flags.json) }); console.log(JSON.stringify(d.metadata, null, 2)); },
  async export([id]) { console.log(JSON.stringify(await fd.exportMetadata(id), null, 2)); },
  async share([cid, type, id]) { const c = await fd.share(cid, { type, id, role: flags.role || 'read' }); console.log('Shares:', c.shares.map((s) => `${s.name} (${s.role})`).join(', ')); },
  async unshare([cid, id]) { const c = await fd.unshare(cid, id); console.log('Shares:', c.shares.map((s) => `${s.name} (${s.role})`).join(', ') || '(none)'); },
  async rm([id]) { await fd.deleteDocument(id); console.log(`Deleted ${id} (recoverable)`); },
  async restore([id]) { await fd.restoreDocument(id); console.log(`Restored ${id}`); },
  async mv([id, cid]) { const d = await fd.moveDocument(id, cid, flags.reason); console.log(`Moved to ${d.collectionName}`); },
  async history([id]) { table((await fd.documentAudit(id)).map(auditRow), ['seq', 'ts', 'user', 'app', 'action', 'outcome']); },
  async audit() { table((await fd.audit({ user: flags.user, action: flags.action, limit: flags.limit || 25 })).map(auditRow), ['seq', 'ts', 'user', 'app', 'action', 'outcome', 'retainUntil']); },
  async verify() { console.log(await fd.verifyAudit()); },
  async stats() {
    const s = await fd.stats({ global: !!flags.global });
    console.log(`Scope: ${s.scope} | collections ${s.collections} | documents ${s.documents} (+${s.deletedDocuments} deleted) | versions ${s.versions} | ${fmtBytes(s.bytes)} | denied ${s.denied}`);
    console.log('  by label: ', s.byLabel, '\n  by app:   ', s.eventsByApp, '\n  by action:', s.eventsByAction);
    console.log('  last 7 days:', s.activityLast7Days.map((d) => `${d.day.slice(5)}:${d.events}`).join(' '));
  },

  async walkthrough() {
    const step = (n, t) => console.log(`\n\x1b[1m[${n}] ${t}\x1b[0m`);
    const LAB = 'a1b2c3d4-0002-4000-8000-genomicslab1';
    const BIO = 'a1b2c3d4-0001-4000-8000-bio101000001';

    step(1, 'Sign in — token pass-through (app "ingest-cli" is not registered with FAIRDOC)');
    await login('u-0003-okafor');
    const me = await fd.me();
    console.log(`  ${me.name} <${me.upn}>, roles=${JSON.stringify(me.roles)}, groups from token: ${me.groups.map((g) => g.name).join('; ')}`);

    step(2, 'Group context — act on behalf of the Genomics Research Lab (X-FairDoc-Group)');
    fd.setGroup(LAB);
    console.log(`  group verified against token claim: ${(await fd.me()).group.name}`);

    step(3, 'Create collections (group-owned, sensitivity-labelled)');
    const raw = await fd.createCollection({ name: `Sequencing runs ${new Date().toISOString().slice(0, 16)}`, label: 'Protected' });
    const pub = await fd.createCollection({ name: 'Published datasets', label: 'Public' });
    console.log(`  ${raw.id} "${raw.name}" [${raw.label}] owner=${raw.ownerName}\n  ${pub.id} "${pub.name}" [${pub.label}]`);

    step(4, 'Bulk upload with FAIR metadata (sidecar metadata.json)');
    const docs = await ingest(raw.id, path.join(HERE, 'sample-data'), 'Protected');
    const run1 = docs.find((d) => d.latest.filename === 'run-2026-11-03.csv');
    const run2 = docs.find((d) => d.latest.filename === 'run-2026-11-10.csv');
    const proto = docs.find((d) => d.latest.filename === 'protocol.md');

    step(5, 'List / browse');
    table((await fd.listDocuments(raw.id)).map(docRow), ['id', 'title', 'label', 'ver', 'size']);

    step(6, 'Search metadata (keyword "rna-seq")');
    table((await fd.search('rna-seq')).map(docRow), ['id', 'title', 'label']);

    step(7, 'Download + integrity check');
    const dl = await fd.download(run1.id);
    const crypto = await import('node:crypto');
    const sha = crypto.createHash('sha256').update(Buffer.from(dl.data)).digest('hex');
    console.log(`  ${dl.filename}: ${fmtBytes(dl.data.byteLength)}, sha256 matches stored: ${sha === run1.latest.sha256}`);

    step(8, 'New version + version history');
    await fd.newVersion(run1.id, Buffer.from(Buffer.from(dl.data).toString() + 'S9,control,9.2\n'), { filename: run1.latest.filename, contentType: 'text/csv', comment: 'added control sample' });
    await commands.info([run1.id]);

    step(9, 'Edit FAIR metadata + export JSON-LD');
    await fd.updateMetadata(run1.id, { metadata: { license: 'CC-BY-4.0', keywords: ['rna-seq', 'qc', 'controls'] } });
    console.log(JSON.stringify(await fd.exportMetadata(run1.id), null, 2).split('\n').map((l) => '  ' + l).join('\n'));

    step(10, 'Share with another group (read) and a user (write), then revoke one');
    await fd.share(raw.id, { type: 'group', id: BIO, role: 'read' });
    let c = await fd.share(raw.id, { type: 'user', id: 'u-0002-achen', role: 'write' });
    console.log('  shares:', c.shares.map((s) => `${s.name}(${s.role})`).join(', '));
    c = await fd.unshare(raw.id, BIO);
    console.log('  after revoke:', c.shares.map((s) => `${s.name}(${s.role})`).join(', '));

    step(11, 'Delete (soft) and recover');
    await fd.deleteDocument(proto.id);
    console.log(`  deleted; visible docs now ${(await fd.listDocuments(raw.id)).length}, with deleted ${(await fd.listDocuments(raw.id, { includeDeleted: true })).length}`);
    await fd.restoreDocument(proto.id);
    console.log(`  restored; visible docs ${(await fd.listDocuments(raw.id)).length}`);

    step(12, 'Move — policy blocks Protected → Public; allowed after relabel to Public');
    try { await fd.moveDocument(run2.id, pub.id); } catch (e) { console.log(`  denied (${e.status}): ${e.message}`); }
    await fd.updateMetadata(run2.id, { label: 'Public', metadata: { license: 'CC0-1.0' } });
    const moved = await fd.moveDocument(run2.id, pub.id, 'approved for publication');
    console.log(`  moved "${moved.title}" → ${moved.collectionName}`);

    step(13, 'Audit trail — document history, my trail, admin chain verification');
    console.log('  document history:');
    await commands.history([run1.id]);
    const mine = await fd.audit({ limit: 500 });
    console.log(`  my trail: ${mine.length} events, ${mine.filter((e) => e.outcome !== 'success').length} denied; each retained until ${mine[0].retainUntil.slice(0, 10)}`);
    fd.setGroup(null);
    const admin = await (await fetch(`${BASE}/mock-entra/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'u-0004-admin', clientId: CLIENT_ID }) })).json();
    const adminFd = new FairDoc({ baseUrl: BASE, getToken: () => admin.access_token });
    console.log('  admin verify:', await adminFd.verifyAudit());

    step(14, 'Usage statistics');
    fd.setGroup(LAB);
    await commands.stats();
    console.log('\nWalkthrough complete — every FAIRDOC function exercised.');
  },
};

const fn = commands[cmd || 'help'];
if (!fn) { console.error(`Unknown command ${cmd}`); process.exit(1); }
fn(rest).catch((e) => { console.error(`Error${e.status ? ` ${e.status}` : ''}: ${e.message}`); process.exit(1); });
