# Demo guide

This guide shows how to present FAIRDOC with the five example apps. It covers setup, a suggested script for each demo, the points worth making, and how to reset between runs.

**Time:** about 25 minutes for the full tour, or 10 minutes for the short version (see [Short version](#short-version-10-minutes)).

---

## 1. Before you start

**You need:** Node 18 or newer and a modern browser. There is nothing to install.

**Start from a clean slate** in a terminal at the repo root:

```bash
rm -rf data demos/4-ingest-cli/.token
```

```bash
npm start
```

You should see:

```
Host apps (demos 1, 2, 5) on http://localhost:4300  ← start here
Advising portal (demo 3) on http://localhost:4100
FAIRDOC API on http://localhost:4000
```

**Seed some research data** in a second terminal. It runs demo 4 and leaves realistic content behind for the other demos:

```bash
npm run demo:cli
```

**Open** http://localhost:4300, the demo index. Keep it in a tab so you can go back to it between demos.

> Tip: run the seeding step before the audience arrives. Demo 4 is still worth showing live later (see below).

### What's real and what's mocked

Say this up front. It heads off the most common question.

| Real in this demo | Mocked for the demo |
|---|---|
| Token validation (RS256 signature, tenant issuer, expiry, group membership) | The O365 sign-in itself. A "Signed in (mock O365)" picker stands in for Microsoft's login page |
| Permissions, sharing, the label policy | The user directory (four fictional people) |
| Versioning, checksums, persistent IDs, JSON-LD | S3 storage (files go to local disk in an S3 layout) |
| Hash-chained audit log with 3-year retention | Object Lock (a property of the production S3 bucket) |

### The demo cast

Switch users with the picker in each app's header.

| User | Who they are | Groups in their token | Use them to show |
|---|---|---|---|
| **Dr. Jordan Okafor** | Faculty | BIO 101, Genomics Lab, Advising, Curriculum | Normal day-to-day use (the default in most demos) |
| **Alex Chen** | Student, lab member | BIO 101, Genomics Lab | Collaboration within a research group |
| **Sam Rivera** | Student | BIO 101 | Read-only access, denied actions |
| **Pat Morgan** | IT admin (`FairDoc.Admin`) | Advising, Curriculum | Support: see everything, recover and move files, verify the audit log |

---

## 2. Opening (2 minutes)

On the demo index page, scroll to the function table and make three points:

1. **One service, five ways in.** Each app here integrates differently. Pick whichever fits the app.
2. **Apps don't register with FAIRDOC.** They pass the user's O365 token along, optionally with a group. FAIRDOC checks the token on every request.
3. **Every row works in every demo.** The capability doesn't change; only the integration style does.

---

## 3. Demo 1: course site with the drop-in widget (5 minutes)

**Open:** "Course site — drop-in widget" (http://localhost:4300/1-course-site/)
**Message:** "This is the fastest integration: one script tag and one HTML element."

1. Expand **Integration code** in the grey note and show how short it is.
2. In the panel's header, point out *"via bio101-course-site · BIO 101 – Fall 2026"*. FAIRDOC read the app name and the course group from the token. Nobody configured them.
3. **Create a collection.** Open **New collection** and name it "Week 1 readings". Choose **Members read-only** and click **Create**. Note that the owner is the *course group*, not the instructor personally.
4. **Upload.** Choose any file in **Upload document**, then add a title, keywords and a license such as `CC-BY-4.0`. Click **Upload**.
   - The green message shows the persistent ID (`ark:/99999/fd-…`).
   - A notification pops up in the host page's corner. That's the course site reacting to the widget's event.
5. Use the row buttons on the document:
   - **Versions**: upload a second file as a new version, then use **Get** to download v1.
   - **Edit**: change the description, then **Save metadata**.
   - **Metadata**: the machine-readable JSON-LD. This is the "Interoperable" in FAIR.
   - **History**: everything that has happened to this file, including the view and download you just did.
6. **Search** tab: search for one of your keywords.
7. **Switch to Sam Rivera** (student) in the header. The same collection appears with *Your access: read*. There's no upload form, and there's no Edit, Move or Delete. Download still works.
8. Switch back to **Dr. Jordan Okafor**.

**Point to make:** students and staff see different things because of *their token*, not because of anything the course site coded.

---

## 4. Demo 2: lab notebook with the headless SDK (5 minutes)

**Open:** "Lab notebook — headless SDK" (http://localhost:4300/2-lab-notebook/)
**Message:** "Here the app owns every pixel. FAIRDOC is just an API underneath. This is the NotebookLM-style experience."

The default user is **Alex Chen**, in the **Genomics Research Lab** workspace, which holds the data seeded by demo 4.

1. Point out the **Workspace** picker: it lists the groups from Alex's token. Then open the **"Sequencing runs …"** notebook.
2. Point to the **FAIR metadata %** bar on each card. The app computes this from FAIRDOC's metadata to nudge researchers toward reusable data.
3. Click a card to open the side drawer:
   - **FAIR metadata**: add a keyword or change the license, then **Save metadata**. The completeness bar goes up.
   - **Versions**: this file has two versions (demo 4 added a control sample). Each shows its SHA-256 checksum.
   - **JSON-LD** and **History**: as in demo 1, but drawn by this app's own UI.
   - **Move / delete**: click **Delete source**.
4. Open **Trash (restore)** in the sidebar and **Restore** the file. Make the point that nothing is lost, and that both actions are in the audit trail.
5. **Show the label policy.** In "Sequencing runs", open a Protected source, go to **Move / delete**, choose "Published datasets (Public)" and click **Move**. FAIRDOC refuses: *a Protected document cannot move into a Public collection*. The refusal is logged. (Relabelling it Public under **FAIR metadata** first makes the move allowed.)
6. **Share.** At the bottom of a notebook, share with a group or user. Then revoke with **Revoke**.
7. **Lab dashboard & audit**: shows usage figures, the most frequent actions, and this user's audit trail, each entry retained for at least 3 years.

**Point to make:** same storage, same rules, completely different UX. Teams can build what they need.

---

## 5. Demo 3: advising portal with a backend proxy (4 minutes)

**Open:** "Advising portal — backend proxy" (http://localhost:4100/)
**Message:** "For the most sensitive data, the token never reaches the browser."

1. Read out the header: *"token held server-side"*.
2. **Prove it:** open the browser's DevTools, go to **Network**, and refresh. Every call goes to `/fairdoc/...` on this same site. None goes to `:4000`, and no `Authorization` header appears.
3. **Create a protected case file.** Open **New collection**, enter "Case file — S. Rivera", set the label to **Protected**, and click **Create**. Upload an advising note.
4. Watch the **summary tiles** at the top update. The advising app's *server* builds these by calling FAIRDOC itself, a second way the same app uses the service.
5. **Sharing** tab: share the case file with **Sam Rivera** (type *User*, access *read*), showing how a student gets access to their own record.
6. **Sign in as Pat Morgan (IT admin)** with the top-right picker, then click **Sign in**.
   - On **Documents**, tick **Admin: all users' collections**. Every collection in the system appears. This is the support view.
   - **Activity log** tab: activity from *all* apps. Click **Verify audit chain**, which reports *intact … retained ≥ 3 years*.
   - **Usage** tab: system-wide statistics, including requests per app.

**Point to make:** the app server adds its own control (it fixes the group as "Advising Office"), and FAIRDOC still enforces everything underneath.

---

## 6. Demo 4: research data ingest from the command line (3 minutes)

**Run in a terminal:** demo 4 is the same walkthrough used for seeding. Showing it live works well:

```bash
npm run demo:cli
```

**Message:** "No browser at all: scripts, scheduled jobs and instrument pipelines use the same API."

Walk through the numbered output:
- **[1]–[2]** Sign-in and group context come from the token.
- **[4]** Bulk upload: each file's FAIR metadata comes from a `metadata.json` sidecar file (open `demos/4-ingest-cli/sample-data/metadata.json` to show it).
- **[7]** The download's checksum matches the stored one.
- **[12]** The label policy blocks a move, then allows it after the file is relabelled Public.
- **[13]** Audit: the document's history, the user's own trail, and admin verification that the chain is valid with `retentionYears: 3`.

Individual commands work too, for questions from the audience:

```bash
cd demos/4-ingest-cli && node fairdoc-cli.mjs help
```

```bash
node fairdoc-cli.mjs login u-0004-admin && node fairdoc-cli.mjs audit --action document.move
```

---

## 7. Demo 5: committee portal with an iframe embed (4 minutes)

**Open:** "Committee portal — iframe + postMessage" (http://localhost:4300/5-committee-portal/)
**Message:** "For apps you can't add code to, or when you want strong isolation, embed FAIRDOC's own page."

1. Point out that the documents panel is a **frame served from a different web address** (`:4000` inside `:4300`).
2. **Live events from FAIRDOC** (right) shows *frame ready — sending token*. The token was handed over with `postMessage` and never put in a URL, where it would end up in logs.
3. Inside the frame, create a collection named "Program review 2027". The event appears in the host's feed straight away.
4. Upload a file, delete it, then tick **Show deleted** and restore it. Each action appears in the feed.
5. Use the **Host controls the frame** buttons (**Search**, **Audit log**, **Usage**) to show that the host app can drive the embedded UI.
6. Click **Refresh token**. The host passes a new token without reloading the frame, which is how long sessions stay signed in.
7. Switch to **Pat Morgan** and click **Audit log**. The admin sees every action from every demo app, each tagged with the app it came from.

**Point to make:** both sides check who they're talking to. The frame accepts tokens only from approved host sites, and the host trusts messages only from FAIRDOC.

---

## 8. Closing (2 minutes)

Pull the threads together using the admin's **Usage** tab in any demo:
- **Requests by app** lists every demo app you used, plus `(unauthenticated)` if any tokens were rejected. None of those apps were registered with FAIRDOC.
- Every read, write and denied attempt was logged, kept for at least 3 years, and protected against tampering.
- Documents have persistent IDs, structured metadata and JSON-LD: FAIR, without forcing protected data to be public.

---

## Short version (10 minutes)

1. Opening: the function table (1 min)
2. **Demo 1** steps 2–5 and 7: the widget, an upload, versions, the student view (4 min)
3. **Demo 3** steps 1–2 and 6: token held server-side, then the admin view with audit verification (3 min)
4. **Demo 5** steps 2–3: frame events in the host (2 min)

---

## Optional: security talking points

If the audience is technical, demonstrate rejections from a terminal with the servers running:

```bash
curl -s http://localhost:4000/api/me
```
→ `{"error":"Missing bearer token"}`

A token signed by the mock O365 but edited by hand (for example, adding a group to its claims) fails with `Bad signature`. Asking for a group the user isn't in fails with `User is not a member of the requested group`. Both refusals appear in the admin's **Activity log** as *denied*.

---

## Reset and troubleshooting

| Situation | Fix |
|---|---|
| Start over with empty storage | Stop `npm start` (Ctrl+C), run `rm -rf data demos/4-ingest-cli/.token`, then run `npm start` and `npm run demo:cli` again |
| `Unknown signing key` or `Bad signature` in a page after a reset | The reset created a new signing key. Reload the page to get a fresh token |
| CLI says `Token expired` or `Missing bearer token` | Run `node fairdoc-cli.mjs login u-0003-okafor` in `demos/4-ingest-cli` |
| `EADDRINUSE` when starting | Something is already on port 4000, 4100 or 4300, often an earlier `npm start`. Stop it, or find it with `lsof -i :4000` |
| A demo shows "No collections yet" | Expected for a group with no data yet (e.g. Curriculum Committee). Create one, or run `npm run demo:cli` to seed the Genomics Lab |
| Demo 3 sends you to the login page | Expected. The proxy signs you in as Dr. Okafor on the first visit |
| Tokens expire after an hour | Change user in the header picker (or click **Refresh token** in demo 5) to get a new one |
