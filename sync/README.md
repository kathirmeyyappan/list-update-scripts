# spreadsheet-notion-sync

Syncs an anime tracking Google Sheet + MyAnimeList data into a Notion database. Runs as a local CLI or a static web app (GitHub Pages + Cloudflare Worker for API proxy).

## Screenshots

<img width="665" height="404" alt="image" src="https://github.com/user-attachments/assets/8bfe7594-382e-437b-b113-afaab19508c4" />

## How it works

Data flows **Google Sheets + MAL → Notion**. The sheet and MAL list are read; each row becomes or updates a page in the Notion database. Sync uses a stable **ID** (from the MAL URL) and a **content hash** so existing pages are updated in place and only changed or new rows cause writes. To wipe and re-import, run **Clear** then **Sync**.

---

## CLI

Run from the terminal with credentials in `.env` (no worker needed).

### Setup

```bash
cd spreadsheet-notion-sync
npm install
```

Create a `.env` file with: `GOOGLE_API_KEY`, `MAL_CLIENT_ID`, `NOTION_TOKEN`, `DATA_SOURCE_ID`, `NOTION_DATABASE_ID`. Optional: `SHEET_KEY`, `SHEET_TAB_NAME`, `MAL_USER_NAME` (defaults in `cli.js`).

### Commands

| Command      | What to do |
|-------------|------------|
| `clear`     | Archive every page in the Notion database. |
| `sync`      | Diff-based sync: update changed pages, add new rows, archive pages no longer in the sheet. |
| `force-add` | Append a new page per sheet row (no clear, no prune; can create duplicates). |

Wipe and re-import: run `clear` then `sync`.

### Usage

```bash
npm run cli clear
npm run cli sync
npm run cli force-add
```

Or run `npm run cli` and type `clear`, `sync`, `force-add`, or `exit`.

---

## Web UI

Same three actions as the CLI. The app is in `public/`; you serve it locally or host it (e.g. GitHub Pages). It talks to a Cloudflare Worker that holds API keys and checks a password — the browser never sees secrets.

### What to do

1. Deploy the worker (`cloudflare/worker.js`) and set its secrets (see Cloudflare Worker below).
2. Run the app: `npx serve public` (or use your host). Open the URL (e.g. `http://localhost:3000`).
3. Open the config panel and set the **Password** (must match the worker’s `AUTH_PASSWORD`) and worker URL if needed.
4. Use the three buttons:

| Button                 | What to do |
|------------------------|------------|
| **Clear database**     | Archive all pages in the Notion database. |
| **Sync only**          | Diff-based sync: update changed, add new, archive missing. |
| **Force add (append)** | Add a new page for every sheet row (can create duplicates). |

### Stats

After a run, the UI shows counts:

- **Created** — New Notion page added.
- **Updated** — Existing page content updated.
- **Unchanged** — Row matched an existing page and content was identical (no write).
- **Archived** — Page was archived (after Clear: all; after Sync: pages whose anime is no longer in the sheet).
- **Skipped** — Row had no MAL link; skipped.
- **Errors** — A Notion or API call failed for that item.

---

## Cloudflare Worker

The worker proxies Notion, Google Sheets, and MAL so the browser can call them without storing keys. It checks the `X-Auth` header against `AUTH_PASSWORD` and injects credentials.

Deploy manually: paste `cloudflare/worker.js` into the Cloudflare dashboard (Workers & Pages → your worker → Edit Code). Set **Secrets**: `AUTH_PASSWORD`, `NOTION_TOKEN`, `GOOGLE_API_KEY`, `MAL_CLIENT_ID`.
