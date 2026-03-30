// Anime → Notion sync utilities.
//
// Browser mode (via Cloudflare Worker):
//   config = { WORKER_URL, PASSWORD, DATA_SOURCE_ID, NOTION_DATABASE_ID, SHEET_KEY, ... }
//   All API secrets live in the worker as env vars.
//
// CLI mode (direct, no worker):
//   config = { NOTION_TOKEN, GOOGLE_API_KEY, MAL_CLIENT_ID, SHEET_KEY, ... }

import { replacePageContent } from './notionPageUtils.js';
import { buildRowPayload } from './syncUtils/rowPayload.js';
import { createStats, reportProgress } from './syncUtils/stats.js';

const ROW_DELAY_MS = 200;

/** Transient Notion errors — bounded retries, not infinite. */
const NOTION_RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const NOTION_FETCH_MAX_ATTEMPTS = 5;
const NOTION_RETRY_BASE_MS = 500;
const NOTION_RETRY_CAP_MS = 16_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Same as apiFetch but retries 429/502/503/504 with backoff (max NOTION_FETCH_MAX_ATTEMPTS). */
async function apiFetchNotionRetry(url, options, config) {
  let lastRes;
  for (let attempt = 0; attempt < NOTION_FETCH_MAX_ATTEMPTS; attempt++) {
    lastRes = await apiFetch(url, options, config);
    if (lastRes.ok) return lastRes;
    if (!NOTION_RETRYABLE_STATUS.has(lastRes.status)) return lastRes;
    if (attempt < NOTION_FETCH_MAX_ATTEMPTS - 1) {
      await sleep(Math.min(NOTION_RETRY_BASE_MS * 2 ** attempt, NOTION_RETRY_CAP_MS));
    }
  }
  return lastRes;
}

// Route a fetch through the Cloudflare worker (if configured) or call directly.
function apiFetch(url, options = {}, config = {}) {
  if (!config.WORKER_URL) return fetch(url, options);

  const workerUrl = url
    .replace(/^https:\/\/api\.notion\.com\/v1/, config.WORKER_URL.replace(/\/$/, '') + '/notion')
    .replace(/^https:\/\/sheets\.googleapis\.com/, config.WORKER_URL.replace(/\/$/, '') + '/sheets')
    .replace(/^https:\/\/api\.myanimelist\.net/, config.WORKER_URL.replace(/\/$/, '') + '/mal')
    .replace(/[?&]key=[^&]+/, ''); // strip Google API key — worker injects its own

  const headers = { ...(options.headers || {}), 'X-Auth': config.PASSWORD };
  delete headers['Authorization'];
  delete headers['X-MAL-CLIENT-ID'];

  return fetch(workerUrl, { ...options, headers });
}

export async function populateMalCache(config) {
  const { MAL_CLIENT_ID, MAL_USER_NAME = 'Uji_Gintoki_Bowl' } = config;
  const malCache = {};
  const baseUrl = `https://api.myanimelist.net/v2/users/${encodeURIComponent(MAL_USER_NAME)}/animelist`;
  const headers = config.WORKER_URL ? {} : { 'X-MAL-CLIENT-ID': MAL_CLIENT_ID };
  let nextUrl = `${baseUrl}?fields=id,title,synopsis,mean,main_picture,alternative_titles&nsfw=true&limit=500&offset=0`;

  while (nextUrl) {
    const res = await apiFetch(nextUrl, { headers }, config);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MAL request failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data = await res.json();

    for (const obj of data.data ?? []) {
      const entry = obj.node;
      const alt = entry.alternative_titles;
      malCache[String(entry.id)] = {
        mean: entry.mean ?? 'NA',
        image: entry.main_picture
          ? entry.main_picture.large ?? entry.main_picture.medium ?? null
          : null,
        malTitle: entry.title,
        officialTitle: entry.title ?? '',
        altEn: alt?.en ?? null,
        altJa: alt?.ja ?? null,
        synopsis: entry.synopsis ?? '',
      };
    }

    nextUrl = data.paging?.next ?? null;
  }

  console.log(`MAL cache populated with ${Object.keys(malCache).length} entries`);
  return malCache;
}

async function getSheetData(config) {
  const {
    SHEET_KEY,
    SHEET_TAB_NAME = 'Anime List (Statistics Version)',
    GOOGLE_API_KEY,
  } = config;

  const range = encodeURIComponent(`${SHEET_TAB_NAME}!A2:N`);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_KEY}/values/${range}`;
  const url = config.WORKER_URL ? base : `${base}?key=${GOOGLE_API_KEY}`;

  const res = await apiFetch(url, {}, config);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.values ?? [];
}

async function getFilteredSheetRows(config) {
  const rows = await getSheetData(config);
  return rows.filter((row) => row[2] && row[2] !== '');
}

function notionHeaders(config) {
  const h = {
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
    accept: 'application/json',
  };
  if (!config.WORKER_URL && config.NOTION_TOKEN) {
    h.Authorization = `Bearer ${config.NOTION_TOKEN}`;
  }
  return h;
}

async function archiveNotionPage(pageId, config) {
  const headers = notionHeaders(config);
  const res = await apiFetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ archived: true }),
  }, config);
  return res.ok;
}

async function createNotionPage(resolvedDataSourceId, payloadCore, config, stats, logLabel) {
  const headers = notionHeaders(config);
  const payload = { parent: { data_source_id: resolvedDataSourceId }, ...payloadCore };
  const res = await apiFetch('https://api.notion.com/v1/pages', { method: 'POST', headers, body: JSON.stringify(payload) }, config);
  if (res.ok) {
    stats.created++;
  } else {
    stats.errors++;
    const text = await res.text();
    console.error(`Failed to create page for "${logLabel}" (${res.status}): ${text.slice(0, 500)}`);
  }
}

async function fetchExistingPagesByMalId(config) {
  const { NOTION_DATABASE_ID } = config;
  const headers = notionHeaders(config);
  const pagesByMalId = {};
  const pagesWithoutMalId = new Set();

  if (!NOTION_DATABASE_ID) {
    console.warn('NOTION_DATABASE_ID is not set; existing pages cannot be indexed by MAL ID.');
    return { pagesByMalId, pagesWithoutMalId };
  }

  let hasMore = true;
  let startCursor;

  while (hasMore) {
    const body = {
      page_size: 100,
    };
    if (startCursor) body.start_cursor = startCursor;

    const res = await apiFetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, config);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to query anime database (${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    for (const page of data.results ?? []) {
      const props = page.properties || {};
      const idProp = props['ID'] ?? props['userDefined:ID'];
      const syncHashProp = props['Sync Hash'];

      const malId = idProp && typeof idProp.number === 'number'
        ? idProp.number
        : null;
      const syncHashValue = Array.isArray(syncHashProp?.rich_text) && syncHashProp.rich_text[0]
        ? syncHashProp.rich_text[0].plain_text ?? null
        : null;

      if (malId != null) {
        const malIdKey = String(malId);
        pagesByMalId[malIdKey] = {
          pageId: page.id,
          syncHash: syncHashValue,
        };
      } else {
        pagesWithoutMalId.add(page.id);
      }
    }

    hasMore = Boolean(data.has_more);
    startCursor = data.next_cursor;
  }

  console.log(`Loaded ${Object.keys(pagesByMalId).length} existing pages with MAL ID from Notion.`);
  return { pagesByMalId, pagesWithoutMalId };
}

/** @param {{ respectHash: boolean, progressLabel: string }} mode */
async function runNotionSync(config, mode) {
  const { respectHash, progressLabel } = mode;
  const { DATA_SOURCE_ID, NOTION_DATA_SOURCE_ID } = config;
  const resolvedDataSourceId = NOTION_DATA_SOURCE_ID ?? DATA_SOURCE_ID;
  const headers = notionHeaders(config);

  const rows = await getFilteredSheetRows(config);
  const total = rows.length;
  const onProgress = config.onProgress ?? null;
  const onStats = config.onStats ?? null;
  let done = 0;

  console.log(
    respectHash
      ? `Soft sync: ${total} rows to Notion (hash-aware).`
      : `Hard sync: ${total} rows to Notion (writing every row regardless of hash).`
  );

  const malCache = await populateMalCache(config);
  const { pagesByMalId } = await fetchExistingPagesByMalId(config);
  const seenMalIds = new Set();
  const stats = createStats();
  if (onStats) onStats(stats);

  for (const row of rows) {
    const { payloadCore, key, hash } = buildRowPayload(row, malCache);
    const malId = key.malId;
    const animeName = String(row[2] ?? '');

    if (malId == null) {
      console.warn(`Skipping row without MAL ID for "${animeName}".`);
      stats.skipped++;
      done++;
      reportProgress(done, total, progressLabel, stats, onProgress, onStats);
      continue;
    }

    const malIdKey = String(malId);
    seenMalIds.add(malIdKey);
    const existing = pagesByMalId[malIdKey];

    if (respectHash && existing && existing.syncHash === hash) {
      stats.unchanged++;
      done++;
      reportProgress(done, total, progressLabel, stats, onProgress, onStats);
      continue;
    }

    if (existing) {
      stats.updated++;
      const patchRes = await apiFetchNotionRetry(`https://api.notion.com/v1/pages/${existing.pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          properties: payloadCore.properties,
          icon: payloadCore.icon,
          erase_content: true,
        }),
      }, config);

      if (!patchRes.ok) {
        stats.errors++;
        const text = await patchRes.text();
        console.error(`Failed to update page for "${animeName}" (${patchRes.status}): ${text.slice(0, 500)}`);
      } else {
        try {
          await replacePageContent(existing.pageId, payloadCore.children, config, stats, {
            notionHeaders,
            apiFetchNotionRetry,
          });
        } catch (err) {
          console.error(String(err));
        }
      }
    } else {
      await createNotionPage(resolvedDataSourceId, payloadCore, config, stats, animeName);
    }

    done++;
    reportProgress(done, total, progressLabel, stats, onProgress, onStats);
    await new Promise((r) => setTimeout(r, ROW_DELAY_MS));
  }

  const archiveTargets = Object.keys(pagesByMalId).filter((malIdKey) => !seenMalIds.has(malIdKey));
  if (archiveTargets.length) {
    console.log(`Archiving ${archiveTargets.length} pages no longer present in sheet...`);
    await Promise.all(
      archiveTargets.map(async (malIdKey) => {
        const pageId = pagesByMalId[malIdKey].pageId;
        const ok = await archiveNotionPage(pageId, config);
        if (ok) stats.archived++;
        else {
          stats.errors++;
          console.error(`Failed to archive page ${pageId}`);
        }
      })
    );
    if (onStats) onStats(stats);
  }
}

export async function clearNotionDatabase(config) {
  const { NOTION_DATABASE_ID } = config;
  const compactDbId = (NOTION_DATABASE_ID || '').trim().replace(/-/g, '');
  const headers = notionHeaders(config);

  console.log('Collecting pages to archive...');

  const pageIds = [];
  let hasMore = true;
  let startCursor;

  while (hasMore) {
    const body = { page_size: 100, filter: { property: 'object', value: 'page' } };
    if (startCursor) body.start_cursor = startCursor;

    const res = await apiFetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, config);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to query Notion (${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json();

    (data.results ?? [])
      .filter((page) => {
        const parent = page.parent || {};
        if (parent.type !== 'database_id') return false;
        return (parent.database_id || '').replace(/-/g, '') === compactDbId;
      })
      .forEach((page) => pageIds.push(page.id));

    hasMore = Boolean(data.has_more);
    startCursor = data.next_cursor;
  }

  console.log(`Archiving ${pageIds.length} pages...`);

  const total = pageIds.length;
  const onProgress = config.onProgress ?? null;
  const onStats = config.onStats ?? null;
  const stats = createStats();
  if (onStats) onStats(stats);
  let done = 0;

  await Promise.all(
    pageIds.map(async (id) => {
      const ok = await archiveNotionPage(id, config);
      done++;
      if (ok) stats.archived++;
      else {
        stats.errors++;
        console.error(`Failed to archive ${id}`);
      }
      reportProgress(done, total, 'Archiving', stats, onProgress, onStats);
    })
  );

  console.log(`Done. Archived ${total} pages.`);
}

/** Hash-aware diff sync: skip rows unchanged vs stored Sync Hash; archive DB rows missing from sheet. */
export async function syncToNotion(config) {
  return runNotionSync(config, { respectHash: true, progressLabel: 'Soft syncing' });
}

/** Re-write every sheet row to Notion (properties, icon, body) even when hash matches; still adds new + archives missing. */
export async function hardSyncToNotion(config) {
  return runNotionSync(config, { respectHash: false, progressLabel: 'Hard syncing' });
}
