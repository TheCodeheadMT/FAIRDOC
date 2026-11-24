# FAIRDOC

Document storage that any web application can attach to, for students and faculty. It holds data up to student-protected (FERPA) information.

- **Identity:** O365 / Entra ID. Host apps **do not register** with FAIRDOC. They pass the user's token along, plus an optional group. FAIRDOC validates each token's signature, issuer (our tenant) and expiry.
- **Groups and roles:** taken **only from the token's claims** (`groups`, `roles`). There are no Microsoft Graph lookups, and Graph-audience tokens are rejected.
- **FAIR:** every document gets a persistent ID (`ark:/…`), structured metadata (creators, keywords, license, type, language), schema.org JSON-LD export, and full version history.
- **Audit:** every read, write and denied attempt is logged in a hash-chained, append-only log, **retained for at least 3 years** (`retainUntil` on every entry).
- **Storage:** S3-style bucket/key layout, designed to run against a self-hosted S3-compatible store.

This repository contains a **reference server** (no dependencies, Node 18+) and **five integration demos**.

## Quick start

```bash
npm start
```

Open **http://localhost:4300**, the demo index.

| Port | What |
|---|---|
| 4000 | FAIRDOC API, mock Entra ID, widget, SDK and iframe embed |
| 4100 | Demo 3, Advising portal (backend proxy) |
| 4300 | Host apps for demos 1, 2 and 5 (a separate origin, like real apps) |

To run the CLI demo with the servers already running:

```bash
npm run demo:cli
```

## The five integration patterns

| # | Host app | Pattern | Where the token lives | Best for |
|---|---|---|---|---|
| 1 | BIO 101 course site | **Drop-in widget**: `<fairdoc-widget>` web component | Browser, given to the widget | Fastest integration, any HTML page |
| 2 | Lab notebook | **Headless SDK**: the app builds its own UI | Browser, in the app's SDK instance | Custom UX (NotebookLM-style notebooks) |
| 3 | Advising portal | **Backend proxy**: the app server forwards calls | **Server only** (HttpOnly session) | Sensitive apps; server-side rules |
| 4 | Research data ingest | **CLI / script**: SDK in Node | Terminal or job environment | Bulk uploads, scheduled jobs |
| 5 | Committee portal | **iframe + postMessage**: FAIRDOC-hosted UI | Sent to the frame by `postMessage` | Apps you can't add scripts to; strong isolation |

Every demo exercises every function:
- sign-in by token
- group context
- creating collections
- upload with FAIR metadata
- list, search and download
- versions
- metadata editing and JSON-LD export
- sharing and revoking
- delete and restore
- move, under the label policy
- audit trail
- usage stats

Switch the demo user to **Pat Morgan (IT Admin)** to see the admin views: all users' collections, audit-chain verification and global statistics.

### Demo users (mock O365)

| User | Kind | Groups (token claim) | Roles |
|---|---|---|---|
| Sam Rivera | Student | BIO 101 | — |
| Alex Chen | Student | BIO 101, Genomics Lab | — |
| Dr. Jordan Okafor | Faculty | BIO 101, Genomics Lab, Advising, Curriculum | FairDoc.Faculty |
| Pat Morgan | Staff | Advising, Curriculum | **FairDoc.Admin** |

## How a host app integrates

```js
import { FairDoc } from 'http://fairdoc.example/sdk/fairdoc.js';
const fd = new FairDoc({
  baseUrl: 'http://fairdoc.example',
  getToken: () => msal.acquireTokenSilent(req).then((r) => r.idToken),  // the user's O365 token
  group: courseGroupId,                                                  // optional; must be in the token's groups claim
});
const col = await fd.createCollection({ name: 'Week 3 readings', label: 'Internal', memberRole: 'read' });
const doc = await fd.upload(col.id, file, { metadata: { keywords: ['cells'], license: 'CC-BY-4.0' } });
```

## API

All `/api/*` calls need `Authorization: Bearer <O365 token>`. They can optionally send `X-FairDoc-Group: <group id>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Identity, groups and roles as FAIRDOC sees them |
| GET / POST | `/api/collections` | List (`?all=1` for admins) or create. Owned by the group in context, or by the user |
| POST / DELETE | `/api/collections/:id/shares[/:principal]` | Share with a user or group (`read`/`write`), or revoke |
| GET / POST | `/api/collections/:id/documents` | List (`?includeDeleted=1`) or create a document record with metadata |
| PUT | `/api/documents/:id/content?filename=&comment=` | Upload content; each PUT is a new version |
| GET / PATCH | `/api/documents/:id` | Details and versions, or update title, metadata or label |
| GET | `/api/documents/:id/download?version=` | Download the latest or a specific version |
| GET | `/api/documents/:id/metadata.jsonld` | schema.org JSON-LD |
| DELETE | `/api/documents/:id` | Soft delete (recoverable) |
| POST | `/api/documents/:id/restore` | Recover |
| POST | `/api/documents/:id/move` | Move to another collection (label policy enforced) |
| GET | `/api/search?q=&label=` | Search the documents the caller can access |
| GET | `/api/documents/:id/audit` | A document's audit history |
| GET | `/api/audit?user=&app=&action=` | Audit log (users: own trail; admins: everything) |
| GET | `/api/audit/verify` | Admin: verify the hash chain and report retention |
| GET | `/api/stats[?scope=global]` | Usage statistics |

### Access rules
- The owner (a user, or the creator of a group collection) and admins have **manage** access.
- Group members get `memberRole`, which is `write` by default. Set it to `read` for course materials.
- Shares grant `read` or `write`.
- **Label policy:** a document can't move into a collection with a lower sensitivity label (Protected > Internal > Public). Attempts are denied and audited.

## What's demo-only, and the production path

| Demo | Production |
|---|---|
| `server/mock-entra.js` signs tokens | Real Entra ID: JWKS from `https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys` |
| Blobs on local disk (`data/s3/…`) | Self-hosted S3-compatible store (Ceph RGW, SeaweedFS, Garage, …), with versioning and SSE |
| Audit JSONL on disk | Audit bucket with **S3 Object Lock (compliance mode, ≥ 3 years)**; optional SIEM feed |
| `data/meta.json` | PostgreSQL |
| Allowed embed origins hard-coded in `embed/index.html` | Server config plus CSP `frame-ancestors` |
| Optional app allowlist `FAIRDOC_ALLOWED_APPS=app1,app2` | Same, as an env var |
| — | Management portal (log viewer, move/recover for users), built on the same admin APIs |

Environment variables:
- `FAIRDOC_PORT`
- `FAIRDOC_DATA`
- `FAIRDOC_ALLOWED_APPS`
- `FAIRDOC_AUDIT_RETENTION_YEARS` (minimum 3)
