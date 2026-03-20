# Agent context: sync app

For AI agents working on this sync app. User-facing "what to do" is in **README.md** (this folder). This file contains everything needed to navigate and reason about the sync app without reading function bodies.

---

## Project layout (this folder: sync/)

```
sync/
├── AGENT_CONTEXT.md          # this file
├── README.md                 # user docs (CLI + Web UI)
├── package.json              # "cli": "node cli.js", dotenv
├── cli.js                    # CLI entry: reads .env, runAction(clear|sync|hard-sync)
├── cloudflare/
│   └── worker.js             # Worker: /notion, /sheets, /mal → upstream APIs
└── public/
    ├── index.html            # UI shell, buttons, config panel, progress, stats
    ├── script.js             # UI logic: config (localStorage), buttons → notionSync
    ├── notionSync.js         # Sync orchestration (sheet, MAL, Notion API); shared by CLI and UI
    ├── notionPageContent.js  # Page body blocks + text→paragraph helpers (no API/sync)
    └── config.template.js    # (if present) template for worker URL etc.
```

- **Entry points:** `cli.js` (Node, `node cli.js` or `npm run cli`), `public/` (static app, `script.js` + `index.html`).
- **Sync orchestration:** `public/notionSync.js`. **Notion page layout / block trees:** `public/notionPageContent.js` (imported by `notionSync.js`).

```mermaid
flowchart LR
  subgraph sources["Data sources"]
    Sheet[Google Sheet]
    MAL[MAL API]
  end
  subgraph entry["Entry points"]
    CLI[cli.js\n.env]
    UI[script.js\nlocalStorage + Worker]
  end
  subgraph logic["public/notionSync.js"]
    Sync[clear / sync / hard-sync]
  end
  Notion[(Notion DB)]
  Sheet --> Sync
  MAL --> Sync
  CLI --> Sync
  UI --> Sync
  Sync --> Notion
```

---

## Config

**Config object** passed into every notionSync function. Keys are UPPERCASE; optional callbacks for progress/stats.

| Key | Required (CLI) | Required (UI) | Description |
|-----|----------------|---------------|-------------|
| `NOTION_TOKEN` | ✓ | — | Notion integration token (CLI/direct only; worker has it for UI) |
| `GOOGLE_API_KEY` | ✓ | — | Google API key, Sheets API (CLI/direct only) |
| `MAL_CLIENT_ID` | ✓ | — | MAL API client ID (CLI/direct only) |
| `DATA_SOURCE_ID` | ✓ | ✓ | Notion data source ID (parent for new pages) |
| `NOTION_DATABASE_ID` | ✓ | ✓ | Notion database ID (query/search target) |
| `SHEET_KEY` | ✓ | ✓ | Google Sheet ID |
| `SHEET_TAB_NAME` | optional | optional | Default `'Anime List (Statistics Version)'` |
| `MAL_USER_NAME` | optional | optional | Default `'Uji_Gintoki_Bowl'` |
| `WORKER_URL` | — | ✓ (in defaults) | Base URL of Cloudflare Worker (UI only) |
| `PASSWORD` | — | ✓ | Sent as `X-Auth`; must match worker `AUTH_PASSWORD` |
| `NOTION_DATA_SOURCE_ID` | optional | optional | Overrides `DATA_SOURCE_ID` for page creation if set |
| `onProgress(done, total, label)` | optional | optional | Called during long ops (e.g. Syncing 5/100) |
| `onStats(stats)` | optional | optional | Called with `{ created, updated, unchanged, archived, skipped, errors }` |

- **CLI:** Builds config from `process.env` + `DEFAULTS` in `cli.js`. Required env: `SHEET_KEY`, `GOOGLE_API_KEY`, `MAL_CLIENT_ID`, `NOTION_TOKEN`, `DATA_SOURCE_ID`, `NOTION_DATABASE_ID`. Exits with message if any missing.
- **UI:** Builds config from `localStorage` key `notion_sync_config` + `DEFAULTS` in `script.js`. Only `PASSWORD` is required in UI; worker URL and IDs come from DEFAULTS unless overridden. Config panel: `FIELDS` in script.js (currently only `cfg-password` → `PASSWORD`).

---

## Google Sheet format

- **Range:** `{SHEET_TAB_NAME}!A2:N` (rows 2 onward, columns A–N → indices 0–13).
- **Row filtering:** Rows with empty `row[2]` are skipped (no title = skip).
- **Column usage in buildRowPayload / buildRowKey:**

| Index | Usage |
|-------|--------|
| 2 | Title / anime name |
| 3 | Score (number; also stored as score×10 for "Score Out of 100") |
| 4 | Watch year (number) |
| 5 | Release year (number) |
| 7 | Caught up (string `'TRUE'` → Yes) |
| 12 | MAL link URL (used to extract MAL ID via `/anime/(\d+)/`) |
| 13 | Notes (My Comments body) |

Unused in sync: 0, 1, 6, 8, 9, 10, 11.

---

## Notion schema (anime database / data source)

- **Page parent:** New pages are created with `parent: { data_source_id: resolvedDataSourceId }` where `resolvedDataSourceId = config.NOTION_DATA_SOURCE_ID ?? config.DATA_SOURCE_ID`.
- **Properties** (set by buildRowPayload):  
  `Title` (title), `Given Score`, `Score Out of 100`, `Watch Year`, `Release Year`, `MAL Score` (number), `Caught up?` (select Yes/No), `MAL Link` (url), `Cover` (files), **`ID`** (number, MAL ID), **`Sync Hash`** (rich_text). Optional `icon` (external image URL) when cover exists.
- **ID / Sync Hash:** Used only for diffing. **ID** = MAL anime ID from URL. **Sync Hash** = FNV-1a hash of payload (properties + children + icon). When querying, code also accepts `userDefined:ID` for **ID**.
- **Page body (blocks):** Built by **`buildAnimePageChildren`** in `notionPageContent.js` (headings + paragraph blocks; extend there for richer styling).

---

## notionPageContent.js — page body only

**File:** `public/notionPageContent.js` — pure block construction; no fetch, no sheet indices.

- **splitTextIntoParagraphs(text, chunkSize = 1800):** Splits on newlines, chunks each run to ≤ `chunkSize` chars; returns Notion `paragraph` blocks. Empty input → one empty paragraph.
- **buildAnimePageChildren({ notesText, malSynopsisText }):** Returns the `children` array for create/PATCH body: heading "My Comments", notes paragraphs, heading "MAL Synopsis", synopsis paragraphs. **Edit this file** to add callouts, toggles, dividers, etc.

---

## notionSync.js — exports and internal behavior

**File:** `public/notionSync.js`

### apiFetch (internal, not exported)

- **Signature:** `apiFetch(url, options = {}, config = {})`.
- **Behavior:** If `config.WORKER_URL` is set: rewrite URL and send `X-Auth: config.PASSWORD`; strip `Authorization` and `X-MAL-CLIENT-ID` from options. Rewrites:
  - `https://api.notion.com/v1*` → `{WORKER_URL}/notion*`
  - `https://sheets.googleapis.com*` → `{WORKER_URL}/sheets*` (and strip `?key=...`)
  - `https://api.myanimelist.net*` → `{WORKER_URL}/mal*`
- If no `WORKER_URL`, uses `fetch(url, options)` as-is (CLI adds `Authorization` and `X-MAL-CLIENT-ID` via notionHeaders / MAL calls).

### getSheetData (internal)

- GET `https://sheets.googleapis.com/v4/spreadsheets/{SHEET_KEY}/values/{SHEET_TAB_NAME}!A2:N`. With worker: no query param; without worker: `?key={GOOGLE_API_KEY}`. Returns `data.values` (array of rows) or `[]`.

### populateMalCache (exported)

- **Signature:** `populateMalCache(config) → Promise<Record<string, { mean, image, malTitle, synopsis }>>`.
- Paginated GET MAL `v2/users/{MAL_USER_NAME}/animelist?fields=id,title,synopsis,mean,main_picture&nsfw=true&limit=500&offset=0`. Follows `paging.next`. Key = string MAL id; value = `{ mean, image (large|medium), malTitle, synopsis }`. Throws on non-OK response.

### fetchExistingPagesByMalId (internal)

- POST Notion `databases/{NOTION_DATABASE_ID}/query` (paginated, page_size 100). For each result: read property **ID** (or **userDefined:ID**) as number, **Sync Hash** as rich_text[0].plain_text; also **`last_edited_time`** from the page object as **`lastEditedAt`**. Returns `{ pagesByMalId: { [malIdKey]: { pageId, syncHash, lastEditedAt } }, pagesWithoutMalId: Set<pageId> }`. If no `NOTION_DATABASE_ID`, returns empty structures.

### Helpers (internal unless noted)

- **extractMalIdFromUrl(url):** Regex `/anime/(\\d+)/` → number or null.
- **buildRowKey(row):** `row[12]` → malUrl; extractMalIdFromUrl(malUrl) → `{ malId, malUrl }`.
- **sortRowsByNotionLastEdited(rows, pagesByMalId):** Stable sort by ascending Notion `lastEditedAt` (MAL ID → lookup in `pagesByMalId`). No MAL ID or no matching page → sort key **+∞** (processed after rows with a timestamp).
- **computeRowHash(payloadCore):** FNV-1a over JSON of `{ properties, children, icon }` → hex string. **Excludes** property **`MAL Score`** from the hash input (MAL API score noise). Strips `.webp` / `.jpg` extensions in the JSON string used for hashing (cover/icon URL jitter). Does not mutate the payload sent to Notion (full properties including **MAL Score** still PATCH).
- **buildRowPayload(row, malCache, config):** Builds Notion payload from row + MAL cache; **`children`** from **`buildAnimePageChildren`** in `notionPageContent.js`; sets **ID** and **Sync Hash**; returns `{ payloadCore, key, hash }`. Row indices and Notion property names as in "Google Sheet format" and "Notion schema" above.
- **notionHeaders(config):** Returns `Notion-Version: 2022-06-28`, Content-Type, accept; if !WORKER_URL and NOTION_TOKEN, adds `Authorization: Bearer {NOTION_TOKEN}`.
- **createStats():** Returns `{ created: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0, errors: 0 }`.
- **getFilteredSheetRows(config):** getSheetData then filter rows where row[2] non-empty.
- **reportProgress(done, total, label, stats, onProgress, onStats):** Calls onProgress and onStats (onStats batched every 10 or at total).
- **archiveNotionPage(pageId, config):** PATCH page archived, returns res.ok.
- **createNotionPage(resolvedDataSourceId, payloadCore, config, stats, logLabel):** POST page, updates stats.created or stats.errors, logs on error.
- **replacePageContent(pageId, children, config, stats):** Archive existing blocks then append new children. Increments stats.errors on PATCH failures. Not exported.

### Action flow (clear / soft sync / hard sync)

Shared row loop is **`runNotionSync(config, { respectHash, progressLabel })`** (internal). **`syncToNotion`** = soft (`respectHash: true`); **`hardSyncToNotion`** = hard (`respectHash: false`). After loading `pagesByMalId`, sheet rows are iterated in **`sortRowsByNotionLastEdited`** order (oldest Notion `last_edited` first).

```mermaid
flowchart TB
  subgraph clear["clear"]
    C1[POST /search] --> C2[filter by database_id]
    C2 --> C3[PATCH each page archived]
  end
  subgraph sync["sync / hard-sync"]
    S1[getFilteredSheetRows] --> S2[populateMalCache]
    S2 --> S3[fetchExistingPagesByMalId]
    S3 --> S4[for each row: buildRowPayload]
    S4 --> S5{has MAL ID?}
    S5 -->|no| skip[skipped]
    S5 -->|yes| S6{soft sync and existing + same hash?}
    S6 -->|yes| unc[unchanged]
    S6 -->|no| S7{existing?}
    S7 -->|yes| upd[PATCH page + replacePageContent]
    S7 -->|no| crt[POST page]
    S4 --> S8[archive pages not in sheet]
  end
```

### clearNotionDatabase (exported)

- **Signature:** `clearNotionDatabase(config)`.
- POST Notion `v1/search` (paginated), filter results by `parent.database_id === NOTION_DATABASE_ID` (compact, no hyphens). Collect all page IDs, then PATCH each `pages/{id}` with `{ archived: true }`. Calls onProgress and onStats (archived / errors).

### syncToNotion (exported) — soft sync

- **Signature:** `syncToNotion(config)`.
- Calls `runNotionSync` with `respectHash: true`, progress label `Soft syncing`. Same as below; **skips** Notion writes when existing page’s stored **Sync Hash** matches the newly computed hash → **unchanged**.

### hardSyncToNotion (exported) — hard sync

- **Signature:** `hardSyncToNotion(config)`.
- Calls `runNotionSync` with `respectHash: false`, progress label `Hard syncing`. Same pipeline as soft sync (fetch index, create/update/archive missing from sheet), but **never** takes the unchanged shortcut: every row with a MAL ID triggers PATCH + `replacePageContent` if the page exists, or POST if new. **Sync Hash** on each page is still updated from the latest payload. Expect **updated** ≈ row count (minus skips); **unchanged** stays 0.

---

## API calls (reference)

| Service | Method | Endpoint / usage |
|---------|--------|-------------------|
| Google | GET | `sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}` (?key= when direct) |
| MAL | GET | `api.myanimelist.net/v2/users/{user}/animelist` (paginated, X-MAL-CLIENT-ID) |
| Notion | POST | `api.notion.com/v1/search` (clear: collect page IDs by database_id) |
| Notion | POST | `api.notion.com/v1/databases/{id}/query` (sync: pagesByMalId) |
| Notion | PATCH | `api.notion.com/v1/pages/{id}` (update properties/icon or archived: true) |
| Notion | POST | `api.notion.com/v1/pages` (create; parent data_source_id) |
| Notion | GET | `api.notion.com/v1/blocks/{id}/children?page_size=100` (paginated) |
| Notion | PATCH | `api.notion.com/v1/blocks/{id}` (archived: true) |
| Notion | PATCH | `api.notion.com/v1/blocks/{id}/children` (body: { children }) |

---

## Cloudflare Worker

- **File:** `cloudflare/worker.js`. Deployed manually (paste in dashboard).
- **Auth:** Every request must have header `X-Auth` equal to env `AUTH_PASSWORD`; else 401.

```mermaid
flowchart LR
  Browser[Browser\nX-Auth] --> Worker[Worker]
  Worker -->|/notion/*| Notion[api.notion.com/v1/*]
  Worker -->|/sheets/*| Sheets[sheets.googleapis.com\n+ ?key=]
  Worker -->|/mal/*| MAL[api.myanimelist.net\n+ X-MAL-CLIENT-ID]
```

- **Routes:** Path prefix → upstream:
  - `/notion/*` → `https://api.notion.com/v1/*` (injects Authorization, Notion-Version, Content-Type, accept)
  - `/sheets/*` → `https://sheets.googleapis.com/*` (adds `key` from env `GOOGLE_API_KEY`)
  - `/mal/*` → `https://api.myanimelist.net/*` (injects `X-MAL-CLIENT-ID`)
- **CORS:** Allow-Origin *, methods GET/POST/PATCH/PUT/DELETE/OPTIONS, headers Content-Type, X-Auth, Notion-Version, Authorization, accept.
- **Env (Worker secrets):** AUTH_PASSWORD, NOTION_TOKEN, GOOGLE_API_KEY, MAL_CLIENT_ID.

---

## UI (script.js + index.html)

**Files:** `public/script.js`, `public/index.html`

- **Config:** localStorage key `notion_sync_config`. Required key: `PASSWORD`. FIELDS: `{ id: 'cfg-password', key: 'PASSWORD', label: 'Password', type: 'password', required: true }`. DEFAULTS include WORKER_URL, SHEET_KEY, SHEET_TAB_NAME, MAL_USER_NAME, DATA_SOURCE_ID, NOTION_DATABASE_ID.
- **Buttons → actions (left to right):** btn-sync → syncToNotion (soft), btn-hard-sync → hardSyncToNotion (confirm dialog), btn-clear → clearNotionDatabase. All call `callAction(fn, label)` which checks config, resets stats, sets loading, calls `fn(getConfig())`, then sets status.
- **DOM IDs:** btn-sync, btn-hard-sync, btn-clear, btn-config, status-message, status-tag, config-panel, btn-save-config, cfg-warning, progress-wrap, progress-bar, st-created, st-updated, st-unchanged, st-archived, st-skipped, st-errors, cfg-password. **Hard sync** uses `.btn-caution` (muted burnt orange `#7c2d12`, aligned with other action buttons).
- **getConfig():** Merges DEFAULTS, loadConfig(), and adds onProgress (setProgress) and onStats (setStats). setProgress updates progress bar and status message; setStats writes to st-* elements.

---

## Stats (onStats callback)

Object with numeric fields (all optional): **created**, **updated**, **unchanged**, **archived**, **skipped**, **errors**. Meaning:

- **created** — New Notion page created.
- **updated** — Existing page patched (properties + blocks).
- **unchanged** — Row matched existing page, same sync hash; no write.
- **archived** — Page archived (clear: all; sync: MAL ID no longer in sheet).
- **skipped** — Row had no MAL ID; not written.
- **errors** — A Notion (or block) request failed.

---

## Error handling

- notionSync: Throws on getSheetData, populateMalCache, fetchExistingPagesByMalId, or replacePageContent failure. Logs and increments stats.errors for per-page or per-block failures instead of throwing where the loop should continue.
- CLI: try/catch around runAction; logs error and process.exit(1).
- UI: callAction try/catch; sets status message to error string and status-tag to 'error'.

---

## Rate limiting

- `runNotionSync` (soft + hard): `ROW_DELAY_MS` (200) after each row that performs a create or update to reduce Notion 429 risk.
