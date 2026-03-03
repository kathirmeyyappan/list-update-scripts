/**
 * Cloudflare Worker — transparent CORS proxy for Notion, Google Sheets, and MAL.
 *
 * IMPORTANT: This file is not auto-deployed. If you make changes here, paste the
 * updated contents manually into the Cloudflare dashboard editor and redeploy.
 * (Workers & Pages → anime-sync → Edit Code)
 *
 * Required Worker env vars (set via Cloudflare dashboard → Settings → Variables):
 *   AUTH_PASSWORD    — password the browser sends in X-Auth header
 *   NOTION_TOKEN     — Notion integration token (ntn_...)
 *   GOOGLE_API_KEY   — Google Cloud API key with Sheets API enabled
 *   MAL_CLIENT_ID    — MyAnimeList API client ID
 *
 * Routes:
 *   /notion/*  → https://api.notion.com/v1/*   (injects Authorization + Notion-Version)
 *   /sheets/*  → https://sheets.googleapis.com/* (injects ?key=...)
 *   /mal/*     → https://api.myanimelist.net/*  (injects X-MAL-CLIENT-ID)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth, Notion-Version, Authorization, accept',
};

function corsResponse(body, status, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS, ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    const password = request.headers.get('X-Auth');
    if (!password || password !== env.AUTH_PASSWORD) {
      return corsResponse('Unauthorized', 401);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const search = url.search;

    let upstreamUrl;
    /** @type {Record<string, string>} */
    let upstreamHeaders = {};

    if (path.startsWith('/notion/')) {
      const notionPath = path.slice('/notion'.length);
      upstreamUrl = `https://api.notion.com/v1${notionPath}${search}`;
      upstreamHeaders = {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        accept: 'application/json',
      };
    } else if (path.startsWith('/sheets/')) {
      const sheetsPath = path.slice('/sheets'.length);
      const sheetsUrl = new URL(`https://sheets.googleapis.com${sheetsPath}${search}`);
      sheetsUrl.searchParams.set('key', env.GOOGLE_API_KEY);
      upstreamUrl = sheetsUrl.toString();
      upstreamHeaders = {};
    } else if (path.startsWith('/mal/')) {
      const malPath = path.slice('/mal'.length);
      upstreamUrl = `https://api.myanimelist.net${malPath}${search}`;
      upstreamHeaders = { 'X-MAL-CLIENT-ID': env.MAL_CLIENT_ID };
    } else {
      return corsResponse('Not Found', 404);
    }

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
    });

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...Object.fromEntries(upstream.headers.entries()),
        ...CORS,
      },
    });
  },
};
