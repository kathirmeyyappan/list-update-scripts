/**
 * Sheet row → Notion payload: MAL URL keying, sync hash, DB properties + page children.
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

export function computeRowHash(payloadCore) {
  const base = {
    properties: payloadCore.properties,
    children: payloadCore.children,
    icon: payloadCore.icon ?? null,
  };
  let json = JSON.stringify(base);
  json = json.replace(/\.(webp|jpe?g)"/gi, '"');
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildRowPayload(row, malCache) {
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

  if (malId != null) {
    const cached = malCache[String(malId)];
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

  const children = buildAnimePageChildren({ notesText: notes, malSynopsisText });

  const properties = {
    Title:              { title: [{ text: { content: animeName } }] },
    'Given Score':      { number: Number.isFinite(trueScore) ? trueScore : null },
    'Score Out of 100': { number: Number.isFinite(score) ? score : null },
    'Watch Year':       { number: Number.isFinite(watchYear) ? watchYear : null },
    'Release Year':     { number: Number.isFinite(releaseYear) ? releaseYear : null },
    'MAL Score':        { number: Number.isFinite(malScore) ? malScore : null },
    'Caught up?':       { select: { name: caughtUp ? 'Yes' : 'No' } },
    'MAL Link':         { url: malUrl || null },
    Cover: {
      files: imgUrl
        ? [{ name: 'cover.jpg', external: { url: imgUrl } }]
        : [],
    },
  };

  const payloadCore = {
    properties,
    children,
  };

  if (imgUrl) {
    payloadCore.icon = { type: 'external', external: { url: imgUrl } };
  }

  const hash = computeRowHash(payloadCore);

  if (malId != null) {
    const c = malCache[String(malId)];
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

  return { payloadCore, key, hash };
}
