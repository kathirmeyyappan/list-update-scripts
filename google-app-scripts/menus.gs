/**
 * Single onOpen for the whole project. GAS allows only one `onOpen` — duplicate names
 * in other .gs files hide menus. Handlers live in notion-sync.gs and update-mal-scores.gs.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('Notion Sync Utilities')
    .addItem('Sync ALL rows (timeout likely)', 'runFullSync')
    .addItem('Sync RANGE of rows', 'runPartialSyncUI')
    .addToUi();

  ui.createMenu('MAL scores')
    .addItem('Update MAL scores (column G)', 'runUpdateMalScores')
    .addToUi();
}
