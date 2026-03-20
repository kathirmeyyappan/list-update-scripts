// Anime → Notion sync utilities.
//
// Browser mode (via Cloudflare Worker):
//   config = { WORKER_URL, PASSWORD, DATA_SOURCE_ID, NOTION_DATABASE_ID, SHEET_KEY, ... }
//   All API secrets live in the worker as env vars.
//
// CLI mode (direct, no worker):
//   config = { NOTION_TOKEN, GOOGLE_API_KEY, MAL_CLIENT_ID, SHEET_KEY, ... }

const ROW_DELAY_MS = 200;

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

export function splitTextIntoParagraphs(text = '', chunkSize = 1800) {
  const paragraphs = text.split(/\n+/);
  const blocks = [];

  for (const p of paragraphs) {
    let remaining = p;
    while (remaining.length > 0) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: remaining.slice(0, chunkSize) } }],
        },
      });
      remaining = remaining.slice(chunkSize);
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] },
    });
  }

  return blocks;
}

export async function populateMalCache(config) {
  const { MAL_CLIENT_ID, MAL_USER_NAME = 'Uji_Gintoki_Bowl' } = config;
  const malCache = {};
  const baseUrl = `https://api.myanimelist.net/v2/users/${encodeURIComponent(MAL_USER_NAME)}/animelist`;
  const headers = config.WORKER_URL ? {} : { 'X-MAL-CLIENT-ID': MAL_CLIENT_ID };
  let nextUrl = `${baseUrl}?fields=id,title,synopsis,mean,main_picture&nsfw=true&limit=500&offset=0`;

  while (nextUrl) {
    const res = await apiFetch(nextUrl, { headers }, config);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MAL request failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data = await res.json();

    for (const obj of data.data ?? []) {
      const entry = obj.node;
      malCache[String(entry.id)] = {
        mean: entry.mean ?? 'NA',
        image: entry.main_picture
          ? entry.main_picture.large ?? entry.main_picture.medium ?? null
          : null,
        malTitle: entry.title,
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

function createStats() {
  return { created: 0, updated: 0, unchanged: 0, archived: 0, skipped: 0, errors: 0 };
}

function reportProgress(done, total, label, stats, onProgress, onStats) {
  if (onProgress) onProgress(done, total, label);
  if (onStats && (done % 10 === 0 || done === total)) onStats(stats);
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

    // create id -> (pageId, syncHash) mapping from current Notion DB
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

// --- Notion helpers for MAL-aware upserts ---

function extractMalIdFromUrl(malUrl) {
  if (!malUrl) return null;
  const match = malUrl.match(/\/anime\/(\d+)/);
  if (!match) return null;
  const idNum = Number(match[1]);
  return Number.isFinite(idNum) ? idNum : null;
}

function buildRowKey(row) {
  const malUrl = row[12] ?? '';
  const malId = extractMalIdFromUrl(malUrl);
  return { malId, malUrl };
}

function computeRowHash(payloadCore) {
  // Build a minimal view for hashing without mutating the real payload
  const base = {
    properties: payloadCore.properties,
    children: payloadCore.children,
    icon: payloadCore.icon ?? null,
  };
  let json = JSON.stringify(base);
  // TEMP: ignore image extension jitter (.webp vs .jpg) by stripping the extension in the hash string only
  json = json.replace(/\.(webp|jpe?g)"/gi, '"');
  let hash = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildRowPayload(row, malCache, config) {
  const animeName   = String(row[2] ?? '');
  const trueScore   = row[3] !== undefined ? Number(row[3]) : null;
  const score       = row[3] !== undefined ? Math.round(Number(row[3]) * 10) : null;
  const watchYear   = row[4] !== undefined && row[4] !== '' ? Number(row[4]) : null;
  const releaseYear = row[5] !== undefined && row[5] !== '' ? Number(row[5]) : null;
  const caughtUp    = String(row[7] ?? '').toUpperCase() === 'TRUE';
  const malUrl      = row[12] ?? '';
  const notes       = row[13] ?? '';

  const key = buildRowKey(row);
  const malId = key.malId;

  let imgUrl = '';
  let malSynopsisBlocks = splitTextIntoParagraphs('');
  let malScore = null;

  if (malId != null) {
    const cached = malCache[String(malId)];
    if (cached) {
      imgUrl = cached.image ?? '';
      malSynopsisBlocks = splitTextIntoParagraphs(cached.synopsis ?? '');
      malScore = cached.mean !== undefined && cached.mean !== 'NA'
        ? Number(cached.mean)
        : null;
    } else {
      console.warn(`No MAL cache entry for id ${malId} (${animeName})`);
    }
  } else if (malUrl) {
    console.warn(`No anime ID found in URL for "${animeName}": ${malUrl}`);
  }

  const paragraphBlocks = splitTextIntoParagraphs(notes);

  const properties = {
    Title:              { title: [{ text: { content: animeName } }] },
    'Given Score':      { number: Number.isFinite(trueScore)   ? trueScore   : null },
    'Score Out of 100': { number: Number.isFinite(score)        ? score        : null },
    'Watch Year':       { number: Number.isFinite(watchYear)    ? watchYear    : null },
    'Release Year':     { number: Number.isFinite(releaseYear)  ? releaseYear  : null },
    'MAL Score':        { number: Number.isFinite(malScore)     ? malScore     : null },
    'Caught up?':       { select: { name: caughtUp ? 'Yes' : 'No' } },
    'MAL Link':         { url: malUrl || null },
    Cover: {
      files: imgUrl
        ? [{ name: 'cover.jpg', external: { url: imgUrl } }]
        : [],
    },
  };

  const children = [
    {
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'My Comments' } }] },
    },
    ...paragraphBlocks,
    {
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'MAL Synopsis' } }] },
    },
    ...malSynopsisBlocks,
  ];

  const payloadCore = {
    properties,
    children,
  };

  if (imgUrl) {
    payloadCore.icon = { type: 'external', external: { url: imgUrl } };
  }

  const hash = computeRowHash(payloadCore);

  if (malId != null) {
    payloadCore.properties['ID'] = { number: malId };
  }
  payloadCore.properties['Sync Hash'] = {
    rich_text: [{ type: 'text', text: { content: hash } }],
  };

  return { payloadCore, key, hash };
}

export async function clearNotionDatabase(config) {
  const { NOTION_DATABASE_ID } = config;
  const compactDbId = (NOTION_DATABASE_ID || '').trim().replace(/-/g, '');
  const headers = notionHeaders(config);

  console.log('Collecting pages to archive...');

  // Phase 1: collect ALL page IDs across all search pages first
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

// Replaces page body: archive existing blocks then append new children.
async function replacePageContent(pageId, children, config, stats) {
  const headers = notionHeaders(config);

  let hasMore = true;
  let startCursor;
  const blockIds = [];

  while (hasMore) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    if (startCursor) url.searchParams.set('start_cursor', startCursor);
    url.searchParams.set('page_size', '100');

    const res = await apiFetch(url.toString(), { headers }, config);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch children for page ${pageId} (${res.status}): ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    for (const block of data.results ?? []) {
      blockIds.push(block.id);
    }

    hasMore = Boolean(data.has_more);
    startCursor = data.next_cursor;
  }

  await Promise.all(
    blockIds.map(async (id) => {
      const res = await apiFetch(`https://api.notion.com/v1/blocks/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      }, config);
      if (!res.ok) {
        if (stats) stats.errors = (stats.errors ?? 0) + 1;
        const text = await res.text();
        console.error(`Failed to archive block ${id} (${res.status}): ${text.slice(0, 300)}`);
      }
    })
  );

  if (!children || children.length === 0) return;

  const appendRes = await apiFetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ children }),
  }, config);

  if (!appendRes.ok) {
    if (stats) stats.errors = (stats.errors ?? 0) + 1;
    const text = await appendRes.text();
    throw new Error(`Failed to append children for page ${pageId} (${appendRes.status}): ${text.slice(0, 500)}`);
  }
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
    const { payloadCore, key, hash } = buildRowPayload(row, malCache, config);
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
      const patchRes = await apiFetch(`https://api.notion.com/v1/pages/${existing.pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: payloadCore.properties, icon: payloadCore.icon }),
      }, config);

      if (!patchRes.ok) {
        stats.errors++;
        const text = await patchRes.text();
        console.error(`Failed to update page for "${animeName}" (${patchRes.status}): ${text.slice(0, 500)}`);
      } else {
        try {
          await replacePageContent(existing.pageId, payloadCore.children, config, stats);
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

/** Hash-aware diff sync: skip rows unchanged vs stored Sync Hash; archive DB rows missing from sheet. */
export async function syncToNotion(config) {
  return runNotionSync(config, { respectHash: true, progressLabel: 'Soft syncing' });
}

/** Re-write every sheet row to Notion (properties, icon, body) even when hash matches; still adds new + archives missing. */
export async function hardSyncToNotion(config) {
  return runNotionSync(config, { respectHash: false, progressLabel: 'Hard syncing' });
}
