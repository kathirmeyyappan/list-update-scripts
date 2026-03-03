#!/usr/bin/env node
// CLI wrapper — reads config from .env, calls the same browser-compatible
// helpers in public/notionSync.js so both interfaces share identical logic.

import 'dotenv/config';
import process from 'process';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { clearNotionDatabase, syncToNotion, clearAndSync } from './public/notionSync.js';

const CONFIG = {
  SHEET_KEY:        process.env.SHEET_KEY,
  SHEET_TAB_NAME:   process.env.SHEET_TAB_NAME,
  GOOGLE_API_KEY:   process.env.GOOGLE_API_KEY,
  MAL_CLIENT_ID:    process.env.MAL_CLIENT_ID,
  MAL_USER_NAME:    process.env.MAL_USER_NAME,
  NOTION_TOKEN:     process.env.NOTION_TOKEN,
  DATA_SOURCE_ID:   process.env.DATA_SOURCE_ID,
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
  onProgress: (done, total, label = 'Progress') => {
    process.stdout.write(`\r${label}: ${done}/${total}`);
    if (done === total) process.stdout.write('\n');
  },
};

const required = ['SHEET_KEY', 'GOOGLE_API_KEY', 'MAL_CLIENT_ID', 'NOTION_TOKEN', 'DATA_SOURCE_ID', 'NOTION_DATABASE_ID'];
const missing = required.filter((k) => !CONFIG[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

async function runAction(action) {
  if (action === 'clear') {
    await clearNotionDatabase(CONFIG);
    console.log('Database cleared.');
  } else if (action === 'sync') {
    await syncToNotion(CONFIG);
    console.log('Sync completed.');
  } else if (action === 'clear-and-sync') {
    await clearAndSync(CONFIG);
    console.log('Clear and sync completed.');
  } else {
    console.error(`Unknown action "${action}". Use: clear, sync, clear-and-sync`);
  }
}

async function main() {
  const argAction = process.argv[2];

  if (argAction) {
    try {
      await runAction(argAction);
      process.exit(0);
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  }

  const rl = readline.createInterface({ input, output });
  console.log('Anime → Notion CLI');
  console.log('Commands: clear, sync, clear-and-sync, exit');

  while (true) {
    const line = (await rl.question('> ')).trim().toLowerCase();
    if (line === 'exit' || line === 'quit') break;
    if (!line) continue;
    try {
      await runAction(line);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  rl.close();
  console.log('Goodbye.');
}

await main();
