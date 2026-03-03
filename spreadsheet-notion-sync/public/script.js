import { clearNotionDatabase, syncToNotion, clearAndSync } from './notionSync.js';

const STORAGE_KEY = 'notion_sync_config';
const REQUIRED = ['SHEET_KEY', 'GOOGLE_API_KEY', 'MAL_CLIENT_ID', 'NOTION_TOKEN', 'DATA_SOURCE_ID', 'NOTION_DATABASE_ID'];

// --- Config (localStorage) ---

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function isConfigComplete() {
  const cfg = loadConfig();
  return REQUIRED.every(k => cfg[k]);
}

function getConfig() {
  return {
    SHEET_TAB_NAME: 'Anime List (Statistics Version)',
    MAL_USER_NAME: 'Uji_Gintoki_Bowl',
    ...loadConfig(),
    onProgress: (done, total, label = 'Progress') => {
      statusMessage.textContent = `${label}… ${done} / ${total}`;
    },
  };
}

// --- DOM refs ---

const btnClear     = document.getElementById('btn-clear');
const btnSync      = document.getElementById('btn-sync');
const btnClearSync = document.getElementById('btn-clear-sync');
const btnConfig    = document.getElementById('btn-config');
const statusMessage = document.getElementById('status-message');
const statusTag    = document.getElementById('status-tag');
const configPanel  = document.getElementById('config-panel');
const btnSaveCfg   = document.getElementById('btn-save-config');
const cfgWarning   = document.getElementById('cfg-warning');

const FIELDS = [
  { id: 'cfg-sheet-key',       key: 'SHEET_KEY',          label: 'Sheet Key',          type: 'text',     required: true },
  { id: 'cfg-sheet-tab',       key: 'SHEET_TAB_NAME',     label: 'Sheet Tab Name',     type: 'text',     required: false },
  { id: 'cfg-google-api-key',  key: 'GOOGLE_API_KEY',     label: 'Google API Key',     type: 'password', required: true },
  { id: 'cfg-mal-client-id',   key: 'MAL_CLIENT_ID',      label: 'MAL Client ID',      type: 'password', required: true },
  { id: 'cfg-mal-username',    key: 'MAL_USER_NAME',      label: 'MAL Username',       type: 'text',     required: false },
  { id: 'cfg-notion-token',    key: 'NOTION_TOKEN',       label: 'Notion Token',       type: 'password', required: true },
  { id: 'cfg-data-source-id',  key: 'DATA_SOURCE_ID',     label: 'Data Source ID',     type: 'text',     required: true },
  { id: 'cfg-notion-db-id',    key: 'NOTION_DATABASE_ID', label: 'Notion Database ID', type: 'text',     required: true },
];

// --- Settings panel ---

function populateFields() {
  const cfg = loadConfig();
  for (const { id, key } of FIELDS) {
    const el = document.getElementById(id);
    if (el) el.value = cfg[key] || '';
  }
}

function toggleConfig(open) {
  const isOpen = open ?? configPanel.style.display === 'none';
  configPanel.style.display = isOpen ? 'block' : 'none';
  btnConfig.textContent = isOpen ? '▲ Config' : '⚙ Config';
}

btnConfig.addEventListener('click', () => toggleConfig());

btnSaveCfg.addEventListener('click', () => {
  const cfg = loadConfig();
  for (const { id, key } of FIELDS) {
    const val = document.getElementById(id)?.value.trim();
    if (val) cfg[key] = val;
  }
  saveConfig(cfg);

  if (isConfigComplete()) {
    cfgWarning.style.display = 'none';
    toggleConfig(false);
    setStatus('Config saved.', 'ok');
  } else {
    const missing = REQUIRED.filter(k => !cfg[k]).join(', ');
    cfgWarning.textContent = `Still missing: ${missing}`;
    cfgWarning.style.display = 'block';
  }
});

// --- Action buttons ---

function setLoading(isLoading) {
  for (const btn of [btnClear, btnSync, btnClearSync]) btn.disabled = isLoading;
  if (isLoading) { statusTag.textContent = 'Working…'; statusTag.className = 'status-tag'; }
}

function setStatus(msg, state) {
  statusMessage.textContent = msg;
  statusTag.textContent = state === 'ok' ? 'OK' : state === 'error' ? 'Error' : 'Idle';
  statusTag.className = `status-tag${state ? ' ' + state : ''}`;
}

async function callAction(fn, label) {
  if (!isConfigComplete()) {
    toggleConfig(true);
    setStatus('Please fill in all required config fields first.', 'error');
    return;
  }

  setLoading(true);
  statusMessage.textContent = `${label} started…`;

  try {
    await fn(getConfig());
    setStatus(`${label} completed.`, 'ok');
  } catch (err) {
    setStatus(String(err), 'error');
  } finally {
    setLoading(false);
  }
}

btnClear.addEventListener('click',     () => callAction(clearNotionDatabase, 'Clear'));
btnSync.addEventListener('click',      () => callAction(syncToNotion, 'Sync'));
btnClearSync.addEventListener('click', () => callAction(clearAndSync, 'Clear + Sync'));

// --- Init ---

populateFields();
if (!isConfigComplete()) {
  toggleConfig(true);
  cfgWarning.textContent = 'Fill in the required fields to get started.';
  cfgWarning.style.display = 'block';
}
