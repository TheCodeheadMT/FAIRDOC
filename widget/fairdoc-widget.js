// <fairdoc-widget> — drop-in document panel for any web app.
//
//   <script type="module" src="http://fairdoc.example/widget/fairdoc-widget.js"></script>
//   <fairdoc-widget api-base="http://fairdoc.example" group="<entra group id>"></fairdoc-widget>
//   widget.getToken = async () => msalToken;     // the user's O365 token, passed through
//
// Attributes: api-base, group, collection (preselect), tabs ("files,search,sharing,activity,stats")
// Events (bubbling, composed): `fairdoc:event` with detail { type, ... } for every action.
// Theming: --fd-accent, --fd-bg, --fd-fg, --fd-muted, --fd-border, --fd-radius, --fd-font.
import { FairDoc, saveDownload } from '../sdk/fairdoc.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const LABELS = ['Public', 'Internal', 'Protected'];
const LICENSES = ['All rights reserved', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'CC0-1.0', 'MIT'];
const TYPES = ['Text', 'Dataset', 'Image', 'Software', 'Presentation', 'Other'];

const CSS = `
:host { --fd-accent:#2563eb; --fd-bg:#fff; --fd-fg:#111827; --fd-muted:#6b7280; --fd-border:#e5e7eb; --fd-soft:#f3f4f6; --fd-radius:10px; --fd-danger:#b91c1c; --fd-ok:#047857;
  --fd-font: system-ui, -apple-system, "Segoe UI", sans-serif; display:block; font-family:var(--fd-font); color:var(--fd-fg); font-size:14px; }
@media (prefers-color-scheme: dark) { :host(:not([theme=light])) { --fd-bg:#111827; --fd-fg:#f3f4f6; --fd-muted:#9ca3af; --fd-border:#374151; --fd-soft:#1f2937; --fd-accent:#60a5fa; --fd-danger:#f87171; --fd-ok:#34d399; } }
* { box-sizing:border-box; }
.wrap { background:var(--fd-bg); border:1px solid var(--fd-border); border-radius:var(--fd-radius); overflow:hidden; }
header { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--fd-border); flex-wrap:wrap; }
.brand { font-weight:650; letter-spacing:.2px; } .brand small { font-weight:400; color:var(--fd-muted); margin-left:6px; }
.who { color:var(--fd-muted); font-size:12px; }
nav { display:flex; gap:2px; padding:0 8px; border-bottom:1px solid var(--fd-border); overflow-x:auto; }
nav button { border:0; background:none; padding:9px 12px; color:var(--fd-muted); border-bottom:2px solid transparent; cursor:pointer; font:inherit; white-space:nowrap; }
nav button.on { color:var(--fd-fg); border-bottom-color:var(--fd-accent); font-weight:600; }
section { padding:14px; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.grow { flex:1; min-width:160px; }
button.b, select, input, textarea { font:inherit; color:var(--fd-fg); background:var(--fd-bg); border:1px solid var(--fd-border); border-radius:7px; padding:6px 10px; }
button.b { cursor:pointer; } button.b:hover { background:var(--fd-soft); }
button.p { background:var(--fd-accent); border-color:var(--fd-accent); color:#fff; } button.p:hover { filter:brightness(1.08); background:var(--fd-accent); }
button.d { color:var(--fd-danger); } button.s { padding:3px 8px; font-size:12px; }
textarea { width:100%; min-height:54px; resize:vertical; }
label.f { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--fd-muted); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }
.card { border:1px solid var(--fd-border); border-radius:8px; padding:12px; margin-top:12px; background:var(--fd-bg); }
.drop { border:2px dashed var(--fd-border); border-radius:8px; padding:14px; text-align:center; color:var(--fd-muted); }
.drop.over { border-color:var(--fd-accent); color:var(--fd-accent); }
table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:7px 6px; border-bottom:1px solid var(--fd-border); vertical-align:top; }
th { font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:var(--fd-muted); font-weight:600; }
.tag { display:inline-block; font-size:11px; padding:1px 7px; border-radius:99px; background:var(--fd-soft); color:var(--fd-muted); margin:1px 2px 1px 0; }
.lbl-Protected { background:#fee2e2; color:#991b1b; } .lbl-Internal { background:#e0e7ff; color:#3730a3; } .lbl-Public { background:#d1fae5; color:#065f46; }
.muted { color:var(--fd-muted); font-size:12px; } .del { opacity:.55; } .del td:first-child { text-decoration:line-through; }
.acts { display:flex; gap:4px; flex-wrap:wrap; }
.msg { margin:10px 14px 0; padding:8px 12px; border-radius:7px; font-size:13px; }
.msg.err { background:#fee2e2; color:#991b1b; } .msg.ok { background:#d1fae5; color:#065f46; }
pre { background:var(--fd-soft); padding:10px; border-radius:7px; overflow:auto; font-size:12px; max-height:260px; }
.stat { border:1px solid var(--fd-border); border-radius:8px; padding:10px 12px; } .stat b { display:block; font-size:22px; }
.bar { height:8px; background:var(--fd-accent); border-radius:4px; min-width:2px; }
.bars { display:grid; grid-template-columns:auto 1fr auto; gap:6px 10px; align-items:center; font-size:12px; }
.empty { text-align:center; color:var(--fd-muted); padding:24px; }
.tablewrap { overflow-x:auto; }
`;

class FairDocWidget extends HTMLElement {
  static get observedAttributes() { return ['group', 'api-base']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.s = { tab: 'files', cols: [], docs: [], showDeleted: false, adminAll: false, panel: null, results: null, stats: null, activity: null, msg: null };
    this.getToken = null;
  }

  connectedCallback() {
    this.shadowRoot.addEventListener('click', (e) => this.onClick(e));
    this.shadowRoot.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e.target); });
    this.shadowRoot.addEventListener('change', (e) => this.onChange(e));
    this.shadowRoot.addEventListener('dragover', (e) => { if (e.target.closest?.('.drop')) { e.preventDefault(); e.target.closest('.drop').classList.add('over'); } });
    this.shadowRoot.addEventListener('dragleave', (e) => e.target.closest?.('.drop')?.classList.remove('over'));
    this.shadowRoot.addEventListener('drop', (e) => { const d = e.target.closest?.('.drop'); if (d) { e.preventDefault(); this.pendingFile = e.dataTransfer.files[0]; this.render(); } });
    this.render();
  }

  attributeChangedCallback() { if (this.fd) this.start(); }

  /** Called by the host app once it has a token. Re-callable when the user/group changes. */
  async start() {
    this.fd = new FairDoc({ baseUrl: this.getAttribute('api-base') || '', getToken: () => (typeof this.getToken === 'function' ? this.getToken() : this.token), group: this.getAttribute('group') || null });
    this.s = { ...this.s, panel: null, results: null, stats: null, activity: null, msg: null };
    try {
      this.me = await this.fd.me();
      await this.loadCols(this.getAttribute('collection'));
    } catch (e) { this.fail(e); }
    this.render();
  }

  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent('fairdoc:event', { detail: { type, ...detail }, bubbles: true, composed: true })); }
  ok(text) { this.s.msg = { kind: 'ok', text }; }
  fail(e) { this.s.msg = { kind: 'err', text: e.status ? `${e.status}: ${e.message}` : e.message }; this.emit('error', { message: e.message, status: e.status }); }

  async loadCols(prefer) {
    this.s.cols = await this.fd.listCollections({ all: this.s.adminAll });
    const keep = prefer || this.s.colId;
    this.s.colId = this.s.cols.some((c) => c.id === keep) ? keep : this.s.cols[0]?.id || null;
    await this.loadDocs();
  }
  async loadDocs() { this.s.docs = this.s.colId ? await this.fd.listDocuments(this.s.colId, { includeDeleted: this.s.showDeleted }) : []; }
  get col() { return this.s.cols.find((c) => c.id === this.s.colId); }
  canWrite() { return ['write', 'manage'].includes(this.col?.myRole); }

  async act(fn) {
    this.s.msg = null;
    try { await fn(); } catch (e) { this.fail(e); }
    this.render();
  }

  async onChange(e) {
    const t = e.target;
    if (t.name === 'col') await this.act(async () => { this.s.colId = t.value; this.s.panel = null; await this.loadDocs(); this.emit('collection.selected', { collectionId: t.value }); });
    if (t.name === 'showDeleted') await this.act(async () => { this.s.showDeleted = t.checked; await this.loadDocs(); });
    if (t.name === 'adminAll') await this.act(async () => { this.s.adminAll = t.checked; await this.loadCols(); });
    if (t.name === 'file' && t.form?.dataset.form === 'upload') { this.pendingFile = t.files[0]; this.render(); }
  }

  async onClick(e) {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const { a, id, v } = el.dataset;
    const fd = this.fd;
    switch (a) {
      case 'tab': this.s.tab = v; this.s.msg = null; this.render(); if (v === 'stats') this.act(async () => { this.s.stats = await fd.stats({ global: this.s.adminAll }); }); if (v === 'activity') this.act(async () => { this.s.activity = await fd.audit({ limit: 100 }); }); break;
      case 'panel': this.s.panel = this.s.panel?.id === id && this.s.panel.kind === v ? null : { id, kind: v }; this.render();
        if (v === 'history') this.act(async () => { this.s.panel.data = await fd.documentAudit(id); });
        if (v === 'jsonld') this.act(async () => { this.s.panel.data = await fd.exportMetadata(id); this.emit('metadata.exported', { documentId: id }); });
        break;
      case 'download': this.act(async () => { const r = await fd.download(id, { version: v }); saveDownload(r); this.emit('document.downloaded', { documentId: id, version: v, filename: r.filename }); }); break;
      case 'delete': if (confirm('Delete this document? It can be restored later.')) this.act(async () => { await fd.deleteDocument(id); await this.loadDocs(); this.ok('Document deleted — tick "Show deleted" to restore it.'); this.emit('document.deleted', { documentId: id }); }); break;
      case 'restore': this.act(async () => { await fd.restoreDocument(id); await this.loadDocs(); this.ok('Document restored.'); this.emit('document.restored', { documentId: id }); }); break;
      case 'unshare': this.act(async () => { await fd.unshare(this.s.colId, id); await this.loadCols(); this.ok('Access revoked.'); this.emit('collection.unshared', { collectionId: this.s.colId, principalId: id }); }); break;
      case 'refresh': this.act(() => this.loadCols()); break;
      case 'verify': this.act(async () => { const r = await fd.verifyAudit(); this.ok(r.valid ? `Audit chain intact: ${r.total} entries, retained ≥ ${r.retentionYears} years.` : `Audit chain BROKEN at entry ${r.brokenAt}`); }); break;
      case 'open': this.act(async () => { const d = await fd.getDocument(id); this.s.tab = 'files'; this.s.colId = d.collectionId; this.s.showDeleted = false; await this.loadDocs(); this.s.panel = { id, kind: 'versions' }; }); break;
    }
  }

  async onSubmit(form) {
    const f = Object.fromEntries(new FormData(form));
    const fd = this.fd;
    const kw = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const id = form.dataset.id;
    switch (form.dataset.form) {
      case 'newcol': return this.act(async () => { const c = await fd.createCollection({ name: f.name, label: f.label, description: f.description, memberRole: f.memberRole }); await this.loadCols(c.id); this.ok(`Collection "${c.name}" created (owner: ${c.ownerName}).`); this.emit('collection.created', { collection: c }); });
      case 'upload': return this.act(async () => {
        const file = this.pendingFile || form.file.files[0];
        if (!file) throw new Error('Choose a file first');
        const d = await fd.upload(this.s.colId, file, { title: f.title || file.name, label: f.label, metadata: { description: f.description, keywords: kw(f.keywords), license: f.license, resourceType: f.resourceType } });
        this.pendingFile = null; await this.loadDocs();
        this.ok(`Uploaded "${d.title}" — PID ${d.pid}`); this.emit('document.uploaded', { document: d });
      });
      case 'version': return this.act(async () => { const file = form.file.files[0]; if (!file) throw new Error('Choose a file'); const d = await fd.newVersion(id, file, { comment: f.comment }); await this.loadDocs(); this.ok(`Version ${d.latest.version} uploaded.`); this.emit('document.versioned', { document: d }); });
      case 'edit': return this.act(async () => { const d = await fd.updateMetadata(id, { title: f.title, label: f.label, metadata: { description: f.description, keywords: kw(f.keywords), license: f.license, resourceType: f.resourceType, creators: kw(f.creators) } }); await this.loadDocs(); this.s.panel = null; this.ok('Metadata saved.'); this.emit('document.updated', { document: d }); });
      case 'move': return this.act(async () => { const d = await fd.moveDocument(id, f.dest, f.reason); await this.loadDocs(); this.s.panel = null; this.ok(`Moved to "${d.collectionName}".`); this.emit('document.moved', { document: d }); });
      case 'share': return this.act(async () => { const c = await fd.share(this.s.colId, { type: f.type, id: f.principal, role: f.role }); await this.loadCols(); this.ok('Shared.'); this.emit('collection.shared', { collection: c }); });
      case 'search': return this.act(async () => { this.s.results = await fd.search(f.q, { label: f.label }); this.emit('search', { q: f.q, count: this.s.results.length }); });
    }
  }

  // ---------- rendering ----------
  render() {
    const s = this.s;
    const tabs = (this.getAttribute('tabs') || 'files,search,sharing,activity,stats').split(',');
    const names = { files: 'Documents', search: 'Search', sharing: 'Sharing', activity: 'Activity log', stats: 'Usage' };
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="wrap">
      <header><div class="brand">FAIRDOC<small>document storage</small></div>
        <div class="who">${this.me ? `${esc(this.me.name)} · via <b>${esc(this.me.app)}</b>${this.me.group ? ` · ${esc(this.me.group.name)}` : ''}` : 'Not signed in'}</div></header>
      ${this.me ? `<nav>${tabs.map((t) => `<button data-a="tab" data-v="${t}" class="${s.tab === t ? 'on' : ''}">${names[t]}</button>`).join('')}</nav>` : ''}
      ${s.msg ? `<div class="msg ${s.msg.kind}">${esc(s.msg.text)}</div>` : ''}
      <section>${!this.me ? '<div class="empty">Waiting for the host app to pass a sign-in token…</div>' : this[`v_${s.tab}`]()}</section></div>`;
  }

  v_files() {
    const s = this.s, c = this.col;
    return `<div class="row">
        <select name="col" class="grow" aria-label="Collection">${s.cols.map((x) => `<option value="${x.id}" ${x.id === s.colId ? 'selected' : ''}>${esc(x.name)} — ${esc(x.ownerName)} (${x.documentCount})</option>`).join('') || '<option>No collections yet</option>'}</select>
        <label class="muted"><input type="checkbox" name="showDeleted" ${s.showDeleted ? 'checked' : ''}> Show deleted</label>
        ${this.me.isAdmin ? `<label class="muted"><input type="checkbox" name="adminAll" ${s.adminAll ? 'checked' : ''}> Admin: all users' collections</label>` : ''}
        <button class="b s" data-a="refresh">Refresh</button></div>
      ${c ? `<p class="muted">${esc(c.description || '')} <span class="tag lbl-${c.label}">${c.label}</span> Your access: <b>${c.myRole}</b></p>` : ''}
      <details class="card"><summary><b>New collection</b> <span class="muted">${this.me.group ? `owned by group ${esc(this.me.group.name)}` : 'owned by you'}</span></summary>
        <form data-form="newcol" class="row" style="margin-top:10px"><input name="name" placeholder="Collection name" required class="grow"><input name="description" placeholder="Description" class="grow">
        <select name="label">${LABELS.map((l) => `<option ${l === 'Internal' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${this.me.group ? '<select name="memberRole" aria-label="Group member access"><option value="write">Members can edit</option><option value="read">Members read-only</option></select>' : ''}<button class="b p">Create</button></form></details>
      ${c && this.canWrite() ? this.uploadForm(c) : ''}
      <div class="tablewrap" style="margin-top:12px">${s.docs.length ? `<table><thead><tr><th>Document</th><th>Label</th><th>Version</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${s.docs.map((d) => this.docRow(d)).join('')}</tbody></table>` : `<div class="empty">${c ? 'No documents in this collection yet.' : 'Create a collection to get started.'}</div>`}</div>`;
  }

  uploadForm(c) {
    return `<form data-form="upload" class="card"><b>Upload document</b>
      <div class="drop" style="margin:10px 0">${this.pendingFile ? `📄 ${esc(this.pendingFile.name)} (${bytes(this.pendingFile.size)})` : 'Drag a file here or'} <input type="file" name="file"></div>
      <div class="grid"><label class="f">Title<input name="title" placeholder="defaults to file name"></label>
        <label class="f">Keywords (comma separated)<input name="keywords"></label>
        <label class="f">License<select name="license">${LICENSES.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <label class="f">Resource type<select name="resourceType">${TYPES.map((l) => `<option>${l}</option>`).join('')}</select></label>
        <label class="f">Sensitivity<select name="label">${LABELS.map((l) => `<option ${l === c.label ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="f" style="margin-top:8px">Description<textarea name="description"></textarea></label>
      <div class="row" style="margin-top:8px"><button class="b p">Upload</button><span class="muted">Stored with a persistent ID and FAIR metadata.</span></div></form>`;
  }

  docRow(d) {
    const w = this.canWrite(), p = this.s.panel;
    const btn = (a, label, v = '', cls = '') => `<button class="b s ${cls}" data-a="${a}" data-id="${d.id}" ${v ? `data-v="${v}"` : ''}>${label}</button>`;
    const acts = d.deletedAt
      ? (w ? btn('restore', 'Restore') : '') + btn('panel', 'History', 'history')
      : [btn('download', 'Download'), btn('panel', 'Versions', 'versions'), w && btn('panel', 'Edit', 'edit'), btn('panel', 'Metadata', 'jsonld'), w && btn('panel', 'Move', 'move'), btn('panel', 'History', 'history'), w && btn('delete', 'Delete', '', 'd')].filter(Boolean).join('');
    return `<tr class="${d.deletedAt ? 'del' : ''}"><td><b>${esc(d.title)}</b><div class="muted">${esc(d.latest?.filename || '')} · ${d.latest ? bytes(d.latest.size) : 'no content'} · ${esc(d.pid)}</div>
        <div>${(d.metadata.keywords || []).map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>${d.deletedAt ? `<div class="muted">Deleted ${when(d.deletedAt)} by ${esc(d.deletedByUpn)}</div>` : ''}</td>
      <td><span class="tag lbl-${d.label}">${d.label}</span></td><td>v${d.latest?.version || 0}</td><td class="muted">${when(d.updatedAt)}</td><td><div class="acts">${acts}</div></td></tr>
      ${p && p.id === d.id ? `<tr><td colspan="5">${this.panel(d, p)}</td></tr>` : ''}`;
  }

  panel(d, p) {
    if (p.kind === 'versions') return `<table><thead><tr><th>Ver</th><th>File</th><th>Size</th><th>By</th><th>When</th><th>SHA-256</th><th></th></tr></thead><tbody>
      ${[...d.versions].reverse().map((v) => `<tr><td>v${v.version}</td><td>${esc(v.filename)}${v.comment ? `<div class="muted">${esc(v.comment)}</div>` : ''}</td><td>${bytes(v.size)}</td><td>${esc(v.createdByUpn)}</td><td class="muted">${when(v.createdAt)}</td><td class="muted">${v.sha256.slice(0, 12)}…</td><td><button class="b s" data-a="download" data-id="${d.id}" data-v="${v.version}">Get</button></td></tr>`).join('')}</tbody></table>
      ${this.canWrite() ? `<form data-form="version" data-id="${d.id}" class="row" style="margin-top:8px"><input type="file" name="file"><input name="comment" placeholder="What changed?" class="grow"><button class="b p">Upload new version</button></form>` : ''}`;
    if (p.kind === 'edit') return `<form data-form="edit" data-id="${d.id}"><div class="grid">
      <label class="f">Title<input name="title" value="${esc(d.title)}"></label>
      <label class="f">Creators (comma separated)<input name="creators" value="${esc((d.metadata.creators || []).join(', '))}"></label>
      <label class="f">Keywords<input name="keywords" value="${esc((d.metadata.keywords || []).join(', '))}"></label>
      <label class="f">License<select name="license">${LICENSES.map((l) => `<option ${l === d.metadata.license ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Resource type<select name="resourceType">${TYPES.map((l) => `<option ${l === d.metadata.resourceType ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Sensitivity<select name="label">${LABELS.map((l) => `<option ${l === d.label ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="f" style="margin-top:8px">Description<textarea name="description">${esc(d.metadata.description)}</textarea></label><button class="b p" style="margin-top:8px">Save metadata</button></form>`;
    if (p.kind === 'move') return `<form data-form="move" data-id="${d.id}" class="row"><select name="dest" class="grow">${this.s.cols.filter((c) => c.id !== d.collectionId && ['write', 'manage'].includes(c.myRole)).map((c) => `<option value="${c.id}">${esc(c.name)} [${c.label}]</option>`).join('')}</select>
      <input name="reason" placeholder="Reason (audited)" class="grow"><button class="b p">Move</button></form><p class="muted">Policy: a document can't move into a collection with a lower sensitivity label.</p>`;
    if (p.kind === 'jsonld') return p.data ? `<p class="muted">Machine-readable FAIR metadata (schema.org JSON-LD):</p><pre>${esc(JSON.stringify(p.data, null, 2))}</pre>` : '<p class="muted">Loading…</p>';
    if (p.kind === 'history') return p.data ? this.auditTable(p.data) : '<p class="muted">Loading…</p>';
    return '';
  }

  auditTable(rows) {
    return rows.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>User</th><th>App</th><th>Action</th><th>Outcome</th><th>Retain until</th></tr></thead><tbody>
      ${rows.map((e) => `<tr><td class="muted" style="white-space:nowrap">${new Date(e.ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(e.upn || '—')}</td><td>${esc(e.app || '—')}</td><td>${esc(e.action)}${e.detail?.reason ? `<div class="muted">${esc(e.detail.reason)}</div>` : ''}</td><td>${e.outcome === 'success' ? '✓' : `<b style="color:var(--fd-danger)">${esc(e.outcome)}</b>`}</td><td class="muted">${e.retainUntil.slice(0, 10)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No events.</div>';
  }

  v_search() {
    const r = this.s.results;
    return `<form data-form="search" class="row"><input name="q" placeholder="Search titles, descriptions, keywords, creators, PIDs…" class="grow" autofocus>
      <select name="label"><option value="">Any label</option>${LABELS.map((l) => `<option>${l}</option>`).join('')}</select><button class="b p">Search</button></form>
      ${r ? (r.length ? `<table style="margin-top:12px"><thead><tr><th>Document</th><th>Collection</th><th>Label</th><th></th></tr></thead><tbody>${r.map((d) => `<tr><td><b>${esc(d.title)}</b><div class="muted">${esc(d.metadata.description || '')}</div></td><td>${esc(d.collectionName)}</td><td><span class="tag lbl-${d.label}">${d.label}</span></td><td><button class="b s" data-a="open" data-id="${d.id}">Open</button> <button class="b s" data-a="download" data-id="${d.id}">Download</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No matches you have access to.</div>') : '<p class="muted">Only documents you can access are searched.</p>'}`;
  }

  v_sharing() {
    const c = this.col;
    if (!c) return '<div class="empty">Select a collection on the Documents tab.</div>';
    const manage = c.myRole === 'manage';
    return `<p><b>${esc(c.name)}</b> — owner: ${esc(c.ownerName)} <span class="tag lbl-${c.label}">${c.label}</span></p>
      <table><thead><tr><th>Shared with</th><th>Type</th><th>Access</th><th></th></tr></thead><tbody>
      ${c.shares.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.type}</td><td>${x.role}</td><td>${manage ? `<button class="b s d" data-a="unshare" data-id="${esc(x.id)}">Revoke</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Not shared beyond the owner.</td></tr>'}</tbody></table>
      ${manage ? `<form data-form="share" class="row card"><select name="type" id="stype"><option value="group">Group</option><option value="user">User</option></select>
        <select name="principal" class="grow">${this.me.groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}<option disabled>── users (demo directory) ──</option>
        ${['u-0001-srivera', 'u-0002-achen', 'u-0003-okafor', 'u-0004-admin'].map((u) => `<option value="${u}">${u}</option>`).join('')}</select>
        <select name="role"><option>read</option><option>write</option></select><button class="b p">Share</button></form>
        <p class="muted">Groups come from your O365 token. Pick "User" as type when sharing with a person.</p>` : '<p class="muted">Only the collection owner or an admin can change sharing.</p>'}`;
  }

  v_activity() {
    const r = this.s.activity;
    return `<div class="row"><p class="muted grow">${this.me.isAdmin ? 'All recorded activity (admin view).' : 'Your own activity trail.'} Every read, write and denied attempt is logged and kept for at least 3 years.</p>
      ${this.me.isAdmin ? '<button class="b s" data-a="verify">Verify audit chain</button>' : ''}</div>${r ? this.auditTable(r) : '<p class="muted">Loading…</p>'}`;
  }

  v_stats() {
    const st = this.s.stats;
    if (!st) return '<p class="muted">Loading…</p>';
    const max = Math.max(1, ...st.activityLast7Days.map((d) => d.events));
    const apps = Object.entries(st.eventsByApp), amax = Math.max(1, ...apps.map((x) => x[1]));
    return `<p class="muted">Scope: ${st.scope === 'global' ? 'whole system (admin)' : 'collections you can access, your activity'}</p>
      <div class="grid"><div class="stat"><span class="muted">Documents</span><b>${st.documents}</b></div><div class="stat"><span class="muted">Versions</span><b>${st.versions}</b></div>
      <div class="stat"><span class="muted">Storage</span><b>${bytes(st.bytes)}</b></div><div class="stat"><span class="muted">Collections</span><b>${st.collections}</b></div>
      <div class="stat"><span class="muted">In trash</span><b>${st.deletedDocuments}</b></div><div class="stat"><span class="muted">Denied requests</span><b>${st.denied}</b></div></div>
      <div class="card"><b>Activity, last 7 days</b><div class="bars" style="margin-top:8px">${st.activityLast7Days.map((d) => `<span class="muted">${d.day.slice(5)}</span><div class="bar" style="width:${(d.events / max) * 100}%"></div><span>${d.events}</span>`).join('')}</div></div>
      <div class="card"><b>Requests by app</b><div class="bars" style="margin-top:8px">${apps.map(([k, v]) => `<span>${esc(k)}</span><div class="bar" style="width:${(v / amax) * 100}%"></div><span>${v}</span>`).join('') || '<span class="muted">none</span>'}</div></div>
      <div class="card"><b>Storage by collection</b><table><tbody>${st.byCollection.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.documents} docs</td><td>${bytes(c.bytes)}</td></tr>`).join('')}</tbody></table></div>`;
  }
}

customElements.define('fairdoc-widget', FairDocWidget);
