import { clearNotionDatabase, syncToNotion, clearAndSync } from './notionSync.js';

const STORAGE_KEY = 'notion_sync_config';
const REQUIRED = ['PASSWORD'];

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

function setProgress(done, total, label) {
  progressWrap.classList.add('visible');
  progressBar.style.width = `${(done / total) * 100}%`;
  statusMessage.textContent = `${label}… ${done} / ${total}`;
  if (done === total) {
    setTimeout(() => progressWrap.classList.remove('visible'), 600);
  }
}

function getConfig() {
  return {
    ...DEFAULTS,
    ...loadConfig(),
    onProgress: (done, total, label = 'Progress') => setProgress(done, total, label),
  };
}

// --- DOM refs ---

const btnClear      = document.getElementById('btn-clear');
const btnSync       = document.getElementById('btn-sync');
const btnClearSync  = document.getElementById('btn-clear-sync');
const btnConfig     = document.getElementById('btn-config');
const statusMessage = document.getElementById('status-message');
const statusTag     = document.getElementById('status-tag');
const configPanel   = document.getElementById('config-panel');
const btnSaveCfg    = document.getElementById('btn-save-config');
const cfgWarning    = document.getElementById('cfg-warning');
const progressWrap  = document.getElementById('progress-wrap');
const progressBar   = document.getElementById('progress-bar');

const FIELDS = [
  { id: 'cfg-password', key: 'PASSWORD', label: 'Password', type: 'password', required: true },
];

// --- Settings panel ---

// Non-sensitive values that never need to be entered via the UI.
const DEFAULTS = {
  WORKER_URL:         'https://anime-sync.kathirmey.workers.dev',
  SHEET_KEY:          '1MCPi0GCz_YrLal50ey09ZvOqXGf8FH23XMC1TeP2etA',
  SHEET_TAB_NAME:     'Anime List (Statistics Version)',
  MAL_USER_NAME:      'Uji_Gintoki_Bowl',
  DATA_SOURCE_ID:     '2699871c-d3ff-80f1-b7be-000b2a3f8baf',
  NOTION_DATABASE_ID: '2699871cd3ff80228eb5ca320b444d7e',
};

function populateFields() {
  const cfg = loadConfig();
  for (const { id, key } of FIELDS) {
    const el = document.getElementById(id);
    if (el) el.value = cfg[key] || DEFAULTS[key] || '';
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
