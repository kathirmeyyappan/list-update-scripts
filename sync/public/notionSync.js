// Anime → Notion sync utilities.
//
// Browser mode (via Cloudflare Worker):
//   config = { WORKER_URL, PASSWORD, DATA_SOURCE_ID, NOTION_DATABASE_ID, SHEET_KEY, ... }
//   All API secrets live in the worker as env vars.
//
// CLI mode (direct, no worker):
//   config = { NOTION_TOKEN, GOOGLE_API_KEY, MAL_CLIENT_ID, SHEET_KEY, ... }

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

  // Phase 2: fire all archive requests at once, tracking progress
  const total = pageIds.length;
  const onProgress = config.onProgress ?? null;
  let done = 0;

  await Promise.all(
    pageIds.map(async (id) => {
      const patchRes = await apiFetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ archived: true }),
      }, config);
      done++;
      if (!patchRes.ok) {
        const text = await patchRes.text();
        console.error(`Failed to archive ${id} (${patchRes.status}): ${text.slice(0, 300)}`);
      }
      if (onProgress) onProgress(done, total, 'Archiving');
    })
  );

  console.log(`Done. Archived ${total} pages.`);
}

export async function syncToNotion(config) {
  const { DATA_SOURCE_ID, NOTION_DATA_SOURCE_ID } = config;
  const resolvedDataSourceId = NOTION_DATA_SOURCE_ID ?? DATA_SOURCE_ID;
  const headers = notionHeaders(config);

  let rows = await getSheetData(config);
  rows = rows.filter((row) => row[2] && row[2] !== '');

  const total = rows.length;
  const onProgress = config.onProgress ?? null;
  let done = 0;

  console.log(`Syncing ${total} rows to Notion.`);

  const malCache = await populateMalCache(config);

  for (const row of rows) {
    const animeName   = String(row[2] ?? '');
    const trueScore   = row[3] !== undefined ? Number(row[3]) : null;
    const score       = row[3] !== undefined ? Math.round(Number(row[3]) * 10) : null;
    const watchYear   = row[4] !== undefined && row[4] !== '' ? Number(row[4]) : null;
    const releaseYear = row[5] !== undefined && row[5] !== '' ? Number(row[5]) : null;
    const caughtUp    = String(row[7] ?? '').toUpperCase() === 'TRUE';
    const malUrl      = row[12] ?? '';
    const notes       = row[13] ?? '';

    const match = malUrl ? malUrl.match(/\/anime\/(\d+)/) : null;
    let imgUrl = '';
    let malSynopsisBlocks = splitTextIntoParagraphs('');
    let malScore = null;

    if (match) {
      const cached = malCache[match[1]];
      if (cached) {
        imgUrl = cached.image ?? '';
        malSynopsisBlocks = splitTextIntoParagraphs(cached.synopsis ?? '');
        malScore = cached.mean !== undefined && cached.mean !== 'NA'
          ? Number(cached.mean)
          : null;
      } else {
        console.warn(`No MAL cache entry for id ${match[1]} (${animeName})`);
      }
    } else {
      console.warn(`No anime ID found in URL for "${animeName}": ${malUrl}`);
    }

    const paragraphBlocks = splitTextIntoParagraphs(notes);

    const payload = {
      parent: { data_source_id: resolvedDataSourceId },
      properties: {
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
      },
      ...(imgUrl ? { icon: { type: 'external', external: { url: imgUrl } } } : {}),
      children: [
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
      ],
    };

    const notionRes = await apiFetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, config);

    done++;
    if (!notionRes.ok) {
      const text = await notionRes.text();
      console.error(`Failed to create page for "${animeName}" (${notionRes.status}): ${text.slice(0, 500)}`);
    }
      if (onProgress) onProgress(done, total, 'Syncing');

    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function clearAndSync(config) {
  await clearNotionDatabase(config);
  await syncToNotion(config);
}
