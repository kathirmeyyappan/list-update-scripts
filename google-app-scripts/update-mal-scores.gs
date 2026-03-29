/**
 * Column G from malCache — same row walk as syncToNotion (notion-sync.gs).
 * Menu: menus.gs
 */

const MAL_SCORES_SHEET_NAME = 'Anime List (Statistics Version)';
const COL_MAL_RATING = 7;

function runUpdateMalScores() {
  const malClientId = PropertiesService.getScriptProperties().getProperty('MAL_CLIENT_ID');
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

  populateMALCache();

  let lastRow = sheet.getLastRow();
  let data = sheet.getDataRange().getValues();

  let startRow = 2;
  let endRow = lastRow;

  data = data.slice(startRow - 1, endRow);

  const updates = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row[2] === "") continue;

    const sheetRow = startRow + i;
    const animeName = row[2].toString();
    const url = row[12];
    const oldRaw = row[6];
    const oldScore = oldRaw === '' || oldRaw === null ? 0 : parseFloat(oldRaw);

    const match = url && String(url).match(/\/anime\/(\d+)\/?/);
    if (!match) continue;

    const mal_id = match[1];
    const newScore = malCache[mal_id] ? (malCache[mal_id].mean ?? 'NA') : 'NA';

    sheet.getRange(sheetRow, COL_MAL_RATING).setValue(newScore);

    const oldCmp = isNaN(oldScore) ? 0 : oldScore;
    if (oldCmp != newScore) {
      updates.push([animeName, oldCmp, newScore]);
    }
  }

  let msg;
  if (updates.length === 0) {
    msg = 'NO UPDATES (column G refreshed from MAL cache).';
  } else {
    msg = 'UPDATES (' + updates.length + '):\n\n';
    updates.forEach(function (r) {
      msg += r[0] + ' — ' + r[1] + ' → ' + r[2] + '\n';
    });
  }
  SpreadsheetApp.getUi().alert('MAL scores', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}
