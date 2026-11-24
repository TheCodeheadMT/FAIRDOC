// Append-only, hash-chained audit log. Each entry includes the hash of the previous
// entry, so any edit or deletion breaks the chain (see verify()). In production the
// JSONL segments are written to an S3 bucket with Object Lock (compliance mode) for
// the institutional retention period.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Minimum retention: 3 years (institutional requirement). Configurable upward only.
export const MIN_RETENTION_YEARS = 3;

export function createAudit(dataDir, retentionYears = Number(process.env.FAIRDOC_AUDIT_RETENTION_YEARS || MIN_RETENTION_YEARS)) {
  if (retentionYears < MIN_RETENTION_YEARS) throw new Error(`Audit retention must be at least ${MIN_RETENTION_YEARS} years`);
  const retainUntil = (ts) => { const d = new Date(ts); d.setUTCFullYear(d.getUTCFullYear() + retentionYears); return d.toISOString(); };
  const file = path.join(dataDir, 'audit', 'audit.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let entries = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

  const hashOf = (e) => crypto.createHash('sha256').update(JSON.stringify({ ...e, hash: undefined })).digest('hex');

  function record({ actor, action, target = null, outcome = 'success', detail = {}, ip = null }) {
    const prev = entries[entries.length - 1];
    const ts = new Date().toISOString();
    const e = {
      seq: entries.length + 1, ts, retainUntil: retainUntil(ts),
      user: actor?.oid || null, upn: actor?.upn || null, app: actor?.app || null, group: actor?.group || null,
      action, target, outcome, detail, ip, prevHash: prev ? prev.hash : 'GENESIS',
    };
    e.hash = hashOf(e);
    entries.push(e);
    fs.appendFileSync(file, JSON.stringify(e) + '\n');
    return e;
  }

  function query({ user, app, action, target, outcome, since, until, limit = 200 } = {}) {
    let r = entries;
    if (user) r = r.filter((e) => e.user === user || e.upn === user);
    if (app) r = r.filter((e) => e.app === app);
    if (action) r = r.filter((e) => e.action === action);
    if (target) r = r.filter((e) => e.target === target || e.detail?.documentId === target);
    if (outcome) r = r.filter((e) => e.outcome === outcome);
    if (since) r = r.filter((e) => e.ts >= since);
    if (until) r = r.filter((e) => e.ts <= until);
    return r.slice(-limit).reverse();
  }

  function verify() {
    let prev = 'GENESIS';
    for (const e of entries) {
      if (e.prevHash !== prev || hashOf(e) !== e.hash) return { valid: false, brokenAt: e.seq, total: entries.length };
      prev = e.hash;
    }
    return { valid: true, total: entries.length, head: prev };
  }

  return { record, query, verify, all: () => entries, retentionYears };
}
