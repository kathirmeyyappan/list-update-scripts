# spreadsheet-notion-sync

Syncs an anime tracking Google Sheet + MyAnimeList data into a Notion database. Runs as a local CLI or a static web app (hosted on GitHub Pages).

---

## Screenshots

<!-- add screenshots here -->

---

## How it works

Data flows one way: **Google Sheets + MAL → Notion**.

1. Reads rows from the Google Sheet (title, scores, watch year, MAL URL, notes, etc.)
2. For each row, pulls cover art, synopsis, and MAL score from the MAL API
3. Creates a page in the Notion database with all the combined data

A full sync clears the Notion database first to avoid duplicates, then repopulates it from scratch.

---

## Web UI

The web app is a static site (`public/`) that can be hosted anywhere — GitHub Pages, locally, etc.

All sync logic runs in the browser. A Cloudflare Worker (`cloudflare/worker.js`) sits in front of the external APIs (Notion, Google Sheets, MAL) to handle CORS and inject API credentials, so no secrets are ever stored in the frontend.

### First-time setup

1. Open the site
2. Click **⚙ Config** and enter the worker password (`AUTH_PASSWORD`)
3. Click **Save Config** — this is stored in `localStorage` and autofills on future visits

### Buttons

| Button | What it does |
|---|---|
| **Clear database** | Archives all pages in the Notion database |
| **Sync only** | Populates Notion from the sheet (may create duplicates if not cleared first) |
| **Clear + Sync** | Full resync — clears then repopulates |

Progress is shown as a bar above the status line while an operation is running.

### Serving locally

```bash
cd spreadsheet-notion-sync
npx serve public
# open http://localhost:3000
```

---

## CLI

The CLI runs the same sync logic directly from the terminal using the Cloudflare Worker is not needed — it calls the APIs directly with credentials from `.env`.

### Setup

```bash
cd spreadsheet-notion-sync
npm install
```

Create `.env` with the required secrets (see `.env` for the current values — only secrets are stored there, everything else is hardcoded):

```
GOOGLE_API_KEY=...
MAL_CLIENT_ID=...
NOTION_TOKEN=...
```

### Usage

Run with a command directly:

```bash
npm run cli clear          # archive all Notion pages
npm run cli sync           # sync sheet → Notion
npm run cli clear-and-sync # full resync
```

Or run interactively:

```bash
npm run cli
# then type: clear / sync / clear-and-sync / exit
```

---

## Cloudflare Worker

The worker (`cloudflare/worker.js`) is a transparent proxy that:
- Verifies a password header (`X-Auth`) so only you can trigger syncs
- Forwards requests to Notion, Google Sheets, and MAL with the real API credentials injected
- Adds CORS headers so the browser can talk to these APIs

**Note:** The worker is deployed manually — paste `cloudflare/worker.js` into the Cloudflare dashboard editor and redeploy whenever it changes.
(Workers & Pages → anime-sync → Edit Code)

### Worker env vars

Set these as **Secrets** in the Cloudflare dashboard (Settings → Variables and Secrets):

| Variable | Description |
|---|---|
| `AUTH_PASSWORD` | Password the web UI sends to authorize operations |
| `NOTION_TOKEN` | Notion integration token (`ntn_...`) |
| `GOOGLE_API_KEY` | Google Cloud API key with Sheets API enabled |
| `MAL_CLIENT_ID` | MyAnimeList API client ID |
