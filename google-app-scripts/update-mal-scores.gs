/**
 * Update column G (MAL mean) from MAL API — same logic as python-scripts/update_mal_scores.py
 *
 * Requires Script property: MAL_CLIENT_ID (same as notion-sync.gs)
 * Menu entry: menus.gs → onOpen
 */

const MAL_SCORES_SHEET_NAME = 'Anime List (Statistics Version)';
const MAL_SCORES_USER = 'Uji_Gintoki_Bowl';
const COL_ANIME_NAME = 3;  // C
const COL_MAL_RATING = 7;  // G
const COL_MAL_URL = 13;    // M

function getMalClientId_() {
  return PropertiesService.getScriptProperties().getProperty('MAL_CLIENT_ID');
}

/**
 * Paginated animelist → { malId: mean | 'NA' } (matches Python score_map).
 */
function buildMalScoreMapFromAnimelist_(malClientId) {
  const map = {};
  const base =
    'https://api.myanimelist.net/v2/users/' +
    encodeURIComponent(MAL_SCORES_USER) +
    '/animelist?fields=id,mean&nsfw=true&limit=500&offset=0';
  let nextUrl = base;
  const headers = { 'X-MAL-CLIENT-ID': malClientId };

  while (nextUrl) {
    const res = UrlFetchApp.fetch(nextUrl, { headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('MAL animelist failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 400));
    }
    const data = JSON.parse(res.getContentText());
    (data.data || []).forEach(function (obj) {
      const e = obj.node;
      map[String(e.id)] = e.mean !== undefined && e.mean !== null ? e.mean : 'NA';
    });
    nextUrl = data.paging && data.paging.next ? data.paging.next : null;
  }
  return map;
}

/** GET /v2/anime/{id}?fields=mean when id not in animelist cache (Python get_mal_rating). */
function fetchMalMeanForAnime_(animeId, malClientId) {
  const url = 'https://api.myanimelist.net/v2/anime/' + animeId + '?fields=mean';
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-MAL-CLIENT-ID': malClientId },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return 'NA';
  const j = JSON.parse(res.getContentText());
  return j.mean !== undefined && j.mean !== null ? j.mean : 'NA';
}

function runUpdateMalScores() {
  const malClientId = getMalClientId_();
  if (!malClientId) {
    SpreadsheetApp.getUi().alert('Set MAL_CLIENT_ID in Project Settings → Script properties.');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MAL_SCORES_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Sheet not found: ' + MAL_SCORES_SHEET_NAME);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No data rows.');
    return;
  }

  const numRows = lastRow - 1;
  const names = sheet.getRange(2, COL_ANIME_NAME, lastRow, COL_ANIME_NAME).getValues();
  const oldCells = sheet.getRange(2, COL_MAL_RATING, lastRow, COL_MAL_RATING).getValues();
  const urls = sheet.getRange(2, COL_MAL_URL, lastRow, COL_MAL_URL).getValues();

  let scoreMap;
  try {
    scoreMap = buildMalScoreMapFromAnimelist_(malClientId);
  } catch (err) {
    SpreadsheetApp.getUi().alert('MAL error: ' + err.message);
    return;
  }

  const newScores = [];
  const updates = [];

  for (let i = 0; i < numRows; i++) {
    const url = String(urls[i][0] || '').trim();
    const oldRaw = oldCells[i][0];
    const oldScore = oldRaw === '' || oldRaw === null ? 0 : parseFloat(oldRaw);
    const animeName = String(names[i][0] || '');

    const match = url.match(/\/anime\/(\d+)\/?/);
    if (!match) {
      newScores.push([oldRaw === '' || oldRaw === null ? '' : oldRaw]);
      continue;
    }

    const id = match[1];
    const newScore = scoreMap[id] !== undefined ? scoreMap[id] : fetchMalMeanForAnime_(id, malClientId);
    newScores.push([newScore]);

    const oldCmp = isNaN(oldScore) ? 0 : oldScore;
    if (oldCmp != newScore) {
      updates.push([animeName, oldCmp, newScore]);
    }
  }

  sheet.getRange(2, COL_MAL_RATING, lastRow, COL_MAL_RATING).setValues(newScores);

  let msg;
  if (updates.length === 0) {
    msg = 'NO UPDATES (column G refreshed from MAL).';
  } else {
    msg = 'UPDATES (' + updates.length + '):\n\n';
    updates.forEach(function (row) {
      msg += row[0] + ' — ' + row[1] + ' → ' + row[2] + '\n';
    });
  }
  SpreadsheetApp.getUi().alert('MAL scores', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
