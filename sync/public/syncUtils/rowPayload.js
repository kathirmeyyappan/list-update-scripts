/**
 * Sheet row → Notion payload: MAL URL keying, sync hash, DB properties + page children.
 *
 * Sync Hash is derived from a small semantic object (title, scores, notes, MAL synopsis, cover
 * image URL). Cover URLs are normalized for hashing (strip trailing image extension) so CDN
 * extension jitter does not flip the hash. Full Notion blocks are not hashed — compare before building blocks.
 */

import { buildAnimePageChildren, notionRichTextProperty } from '../notionPageUtils.js';

export function extractMalIdFromUrl(malUrl) {
  if (!malUrl) return null;
  const match = malUrl.match(/\/anime\/(\d+)/);
  if (!match) return null;
  const idNum = Number(match[1]);
  return Number.isFinite(idNum) ? idNum : null;
}

export function buildRowKey(row) {
  const malUrl = row[12] ?? '';
  const malId = extractMalIdFromUrl(malUrl);
  return { malId, malUrl };
}

/**
 * Strip trailing image extension from a cover URL so `.webp` vs `.jpg` hashes the same.
 * (Same intent as the old full-payload hash, applied to the URL field only.)
 */
function normalizeCoverImageUrlForHash(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  return s.replace(/\.(webp|jpe?g)$/i, '');
}

/** FNV-1a 32-bit over JSON.stringify(semantic). */
export function computeSyncHash(semantic) {
  const json = JSON.stringify(semantic);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Everything needed for hash comparison and for building the full Notion payload (single parse).
 */
export function extractRowContext(row, malCache) {
  const animeName = String(row[2] ?? '');
  const trueScore = row[3] !== undefined ? Number(row[3]) : null;
  const score = row[3] !== undefined ? Math.round(Number(row[3]) * 10) : null;
  const watchYear = row[4] !== undefined && row[4] !== '' ? Number(row[4]) : null;
  const releaseYear = row[5] !== undefined && row[5] !== '' ? Number(row[5]) : null;
  const caughtUp = String(row[7] ?? '').toUpperCase() === 'TRUE';
  const malUrl = row[12] ?? '';
  const notes = row[13] ?? '';

  const key = buildRowKey(row);
  const malId = key.malId;

  let imgUrl = '';
  let malSynopsisText = '';
  let malScore = null;
  let cached = null;

  if (malId != null) {
    cached = malCache[String(malId)] ?? null;
    if (cached) {
      imgUrl = cached.image ?? '';
      malSynopsisText = cached.synopsis ?? '';
      malScore = cached.mean !== undefined && cached.mean !== 'NA'
        ? Number(cached.mean)
        : null;
    } else {
      console.warn(`No MAL cache entry for id ${malId} (${animeName})`);
    }
  } else if (malUrl) {
    console.warn(`No anime ID found in URL for "${animeName}": ${malUrl}`);
  }

  return {
    key,
    malId,
    animeName,
    trueScore,
    score,
    watchYear,
    releaseYear,
    caughtUp,
    malUrl,
    notes,
    imgUrl,
    malSynopsisText,
    malScore,
    cached,
  };
}

function syncHashSemanticFromContext(ctx) {
  return {
    animeTitle: ctx.animeName,
    givenScore: Number.isFinite(ctx.trueScore) ? ctx.trueScore : null,
    malScore: ctx.malScore !== null && ctx.malScore !== undefined && Number.isFinite(ctx.malScore)
      ? ctx.malScore
      : null,
    notes: String(ctx.notes ?? ''),
    malSynopsis: String(ctx.malSynopsisText ?? ''),
    imageUrl: normalizeCoverImageUrlForHash(ctx.imgUrl),
  };
}

/** Hash + key only — no Notion blocks/properties (for soft-sync skip before building payload). */
export function getRowSyncKeyAndHash(row, malCache) {
  const ctx = extractRowContext(row, malCache);
  const hash = computeSyncHash(syncHashSemanticFromContext(ctx));
  return { key: ctx.key, hash, ctx };
}

export function buildPayloadFromContext(ctx, hash) {
  const children = buildAnimePageChildren({
    notesText: ctx.notes,
    malSynopsisText: ctx.malSynopsisText,
  });

  const properties = {
    Title:              { title: [{ text: { content: ctx.animeName } }] },
    'Given Score':      { number: Number.isFinite(ctx.trueScore) ? ctx.trueScore : null },
    'Score Out of 100': { number: Number.isFinite(ctx.score) ? ctx.score : null },
    'Watch Year':       { number: Number.isFinite(ctx.watchYear) ? ctx.watchYear : null },
    'Release Year':     { number: Number.isFinite(ctx.releaseYear) ? ctx.releaseYear : null },
    'MAL Score':        { number: Number.isFinite(ctx.malScore) ? ctx.malScore : null },
    'Caught up?':       { select: { name: ctx.caughtUp ? 'Yes' : 'No' } },
    'MAL Link':         { url: ctx.malUrl || null },
    Cover: {
      files: ctx.imgUrl
        ? [{ name: 'cover.jpg', external: { url: ctx.imgUrl } }]
        : [],
    },
  };

  const payloadCore = {
    properties,
    children,
  };

  if (ctx.imgUrl) {
    payloadCore.icon = { type: 'external', external: { url: ctx.imgUrl } };
  }

  const malId = ctx.malId;
  if (malId != null) {
    const c = ctx.cached;
    if (c) {
      payloadCore.properties['MAL Official Title'] = notionRichTextProperty(c.officialTitle);
      payloadCore.properties['English Title'] = notionRichTextProperty(c.altEn);
      payloadCore.properties['Japanese Title'] = notionRichTextProperty(c.altJa);
    } else {
      payloadCore.properties['MAL Official Title'] = notionRichTextProperty('');
      payloadCore.properties['English Title'] = notionRichTextProperty('');
      payloadCore.properties['Japanese Title'] = notionRichTextProperty('');
    }
  } else {
    payloadCore.properties['MAL Official Title'] = notionRichTextProperty('');
    payloadCore.properties['English Title'] = notionRichTextProperty('');
    payloadCore.properties['Japanese Title'] = notionRichTextProperty('');
  }

  if (malId != null) {
    payloadCore.properties['ID'] = { number: malId };
  }
  payloadCore.properties['Sync Hash'] = {
    rich_text: [{ type: 'text', text: { content: hash } }],
  };

  return { payloadCore };
}

/** Full payload; use when you will write. For soft-sync skips, prefer getRowSyncKeyAndHash + buildPayloadFromContext. */
export function buildRowPayload(row, malCache) {
  const ctx = extractRowContext(row, malCache);
  const hash = computeSyncHash(syncHashSemanticFromContext(ctx));
  const { payloadCore } = buildPayloadFromContext(ctx, hash);
  return { payloadCore, key: ctx.key, hash };
}
