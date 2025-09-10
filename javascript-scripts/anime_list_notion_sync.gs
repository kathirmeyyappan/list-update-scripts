// hosted in Google Apps Script - can only run from there rn (linked to life's work anime stats tab)

// API info for MAL and Notion
const NOTION_TOKEN   = PropertiesService.getScriptProperties().getProperty("NOTION_TOKEN");
const DATA_SOURCE_ID = PropertiesService.getScriptProperties().getProperty("DATA_SOURCE_ID");
const MAL_CLIENT_ID  = PropertiesService.getScriptProperties().getProperty("MAL_CLIENT_ID");

// cache where image urls for Notion view will be 
let imageCache = {};


// preloads all of the image urls for sending to Notion as covers
function populateImageCache() {
  const baseUrl = "https://api.myanimelist.net/v2/users/Uji_Gintoki_Bowl/animelist";
  const headers = { "X-MAL-CLIENT-ID": MAL_CLIENT_ID }; 
  let nextUrl = `${baseUrl}?fields=id,mean,main_picture&nsfw=true&limit=500&offset=0`;

  while (nextUrl) {
    const response = UrlFetchApp.fetch(nextUrl, { headers });
    const data = JSON.parse(response.getContentText());

    data.data.forEach(obj => {
      const entry = obj.node;
      imageCache[entry.id] = {
        mean: entry.mean || "NA",
        image: entry.main_picture ? (
          entry.main_picture.large ? entry.main_picture.large : (
            entry.main_picture.medium ? entry.main_picture.medium : null
          )
        ) : null
      };
    });

    nextUrl = data.paging && data.paging.next ? data.paging.next : null;
  }

  console.log(`Image cache populated with ${Object.keys(imageCache).length} entries`);
}


// utility to split text into smaller blocks (to avoid Notion API length limits)
function splitTextIntoParagraphs(text, chunkSize = 1800) {
  const paragraphs = text.split(/\n+/); // split by line breaks
  const blocks = [];

  paragraphs.forEach(p => {
    let remaining = p;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, chunkSize);
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            { type: "text", text: { content: chunk } }
          ]
        }
      });
      remaining = remaining.slice(chunkSize);
    }
  });

  return blocks;
}


// sync life's work sheet info to the Notion database (via the proper data source)
function syncToNotion(startRow, endRow) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let lastRow = sheet.getLastRow();
  let data = sheet.getDataRange().getValues();

  // default to all rows (skip header row 1)
  startRow = startRow || 2;
  endRow   = endRow   || lastRow;

  // slice to requested range
  data = data.slice(startRow - 1, endRow); // adjust for 0-index

  data = data.filter(row => row[2] !== "");

  data.forEach(row => {
    const animeName   = row[2].toString();   // col C, Anime Name
    const trueScore   = row[3];              // col D, Rating
    const score       = Math.round(row[3] * 10);
    const watchYear   = row[4];              // col E
    const releaseYear = row[5];              // col F
    const malScore    = row[6];              // col G
    const notes       = row[13];             // col N
    
    const url = row[12]; // col M, URL
    const match = url.match(/\/anime\/(\d+)\/?/);
    let img_url = "";
    if (match) {
      const mal_id = match[1];
      img_url = imageCache[mal_id] ? imageCache[mal_id].image : "";
    } else {
      console.warn("No anime ID found in URL:", url);
    }

    const paragraphBlocks = splitTextIntoParagraphs(notes);

    const payload = {
      parent: { data_source_id: DATA_SOURCE_ID },
      properties: {
        "Title":            { title: [{ text: { content: animeName }}]}, 
        "True Given Score": { number: trueScore },       
        "Score Out of 100": { number: score },           
        "Watch Year":       { number: watchYear },       
        "Release Year":     { number: releaseYear },
        "MAL Score":        { number: malScore }
      },
      icon: { type:"external", external: { url: img_url }},
      cover: { type:"external", external: { url: img_url }},
      children: paragraphBlocks
    };

    UrlFetchApp.fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
        accept: 'application/json'
      },
      payload: JSON.stringify(payload)
    });
  });
}


// do all sync tasks e2e
function runFullSync() {
  populateImageCache();
  syncToNotion(); // defaults to all rows
}


// prompt user for row range and sync only that subset
function runPartialSyncUI() {
  const ui = SpreadsheetApp.getUi();

  const startPrompt = ui.prompt("Notion Sync", "Enter START row (e.g. 2):", ui.ButtonSet.OK_CANCEL);
  if (startPrompt.getSelectedButton() !== ui.Button.OK) return;
  const startRow = parseInt(startPrompt.getResponseText(), 10);

  const endPrompt = ui.prompt("Notion Sync", "Enter END row:", ui.ButtonSet.OK_CANCEL);
  if (endPrompt.getSelectedButton() !== ui.Button.OK) return;
  const endRow = parseInt(endPrompt.getResponseText(), 10);

  if (isNaN(startRow) || isNaN(endRow) || endRow < startRow) {
    ui.alert("Invalid range. Canceling.");
    return;
  }

  populateImageCache();
  syncToNotion(startRow, endRow);
}


// add custom menu with both full + partial sync
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Notion Sync Utilities")
    .addItem("Sync ALL rows (timeout likely)", "runFullSync")
    .addItem("Sync RANGE of rows", "runPartialSyncUI")
    .addToUi();
}
