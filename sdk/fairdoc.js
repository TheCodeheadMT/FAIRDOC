// FAIRDOC JavaScript SDK — works in browsers and Node 18+ (uses fetch).
// The host app supplies the user's O365 token (getToken) and an optional group id.
//
//   const fd = new FairDoc({ baseUrl: 'http://localhost:4000', getToken: () => token, group });
//   const col = await fd.createCollection({ name: 'Lab data', label: 'Protected' });
//   const doc = await fd.upload(col.id, fileOrBuffer, { title: 'Run 1', metadata: { keywords: ['rna'] } });

export class FairDocError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class FairDoc {
  constructor({ baseUrl = '', getToken, group = null }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getToken = getToken;
    this.group = group;
  }

  setGroup(group) { this.group = group || null; }

  async request(method, path, { json, body, headers = {}, query, binary = false } = {}) {
    const url = new URL(this.baseUrl + path, typeof location !== 'undefined' ? location.href : 'http://localhost');
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    const token = this.getToken ? await this.getToken() : null;
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (this.group) h['X-FairDoc-Group'] = this.group;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    const res = await fetch(url, { method, headers: h, body });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new FairDocError(res.status, msg);
    }
    if (binary) {
      const cd = res.headers.get('content-disposition') || '';
      const filename = decodeURIComponent((cd.match(/filename="([^"]+)"/) || [])[1] || 'download');
      return { filename, contentType: res.headers.get('content-type'), data: await res.arrayBuffer() };
    }
    return res.json();
  }

  // --- identity ---
  me() { return this.request('GET', '/api/me'); }

  // --- collections ---
  listCollections({ all = false } = {}) { return this.request('GET', '/api/collections', { query: { all: all ? '1' : '' } }); }
  createCollection({ name, description, label, memberRole }) { return this.request('POST', '/api/collections', { json: { name, description, label, memberRole } }); }
  share(collectionId, { type, id, role = 'read' }) { return this.request('POST', `/api/collections/${collectionId}/shares`, { json: { type, id, role } }); }
  unshare(collectionId, principalId) { return this.request('DELETE', `/api/collections/${collectionId}/shares/${encodeURIComponent(principalId)}`); }

  // --- documents ---
  listDocuments(collectionId, { includeDeleted = false } = {}) {
    return this.request('GET', `/api/collections/${collectionId}/documents`, { query: { includeDeleted: includeDeleted ? '1' : '' } });
  }
  createDocument(collectionId, { title, metadata, label }) { return this.request('POST', `/api/collections/${collectionId}/documents`, { json: { title, metadata, label } }); }
  uploadContent(documentId, data, { filename, contentType, comment } = {}) {
    return this.request('PUT', `/api/documents/${documentId}/content`, {
      body: data, headers: { 'Content-Type': contentType || data?.type || 'application/octet-stream' },
      query: { filename: filename || data?.name, comment },
    });
  }
  /** Create a document and upload its first version in one call. */
  async upload(collectionId, data, { title, metadata, label, filename, contentType } = {}) {
    const doc = await this.createDocument(collectionId, { title: title || filename || data?.name || 'Untitled', metadata, label });
    return this.uploadContent(doc.id, data, { filename, contentType });
  }
  newVersion(documentId, data, opts) { return this.uploadContent(documentId, data, opts); }
  getDocument(documentId) { return this.request('GET', `/api/documents/${documentId}`); }
  updateMetadata(documentId, { title, metadata, label }) { return this.request('PATCH', `/api/documents/${documentId}`, { json: { title, metadata, label } }); }
  exportMetadata(documentId) { return this.request('GET', `/api/documents/${documentId}/metadata.jsonld`); }
  download(documentId, { version } = {}) { return this.request('GET', `/api/documents/${documentId}/download`, { query: { version }, binary: true }); }
  deleteDocument(documentId) { return this.request('DELETE', `/api/documents/${documentId}`); }
  restoreDocument(documentId) { return this.request('POST', `/api/documents/${documentId}/restore`); }
  moveDocument(documentId, collectionId, reason) { return this.request('POST', `/api/documents/${documentId}/move`, { json: { collectionId, reason } }); }

  // --- discovery, audit, stats ---
  search(q, { label } = {}) { return this.request('GET', '/api/search', { query: { q, label } }); }
  documentAudit(documentId) { return this.request('GET', `/api/documents/${documentId}/audit`); }
  audit(filter = {}) { return this.request('GET', '/api/audit', { query: filter }); }
  verifyAudit() { return this.request('GET', '/api/audit/verify'); }
  stats({ global = false } = {}) { return this.request('GET', '/api/stats', { query: { scope: global ? 'global' : '' } }); }
}

/** Browser helper: trigger a file save for a download() result. */
export function saveDownload({ filename, contentType, data }) {
  const url = URL.createObjectURL(new Blob([data], { type: contentType }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
