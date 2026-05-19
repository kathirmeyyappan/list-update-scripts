const SHEET_KEY  = atob('MU1DUGkwR0N6X1lyTGFsNTBleTA5WnZPcVhHZjhGSDIzWE1DMVRlUDJldEE=');
const API_KEY    = atob('QUl6YVN5QlZfS1dJRHJPa0NKV05lM0FrWVhsSTVCa2g1Y3RtZlRF');
// Honestly, the stuff above is fine to expose because it's read-only. I don't think I'll get cooked...
const TAB        = '.csv Anime List Mirror';
const WRAP_TITLE = new Set(['anime_name']);
const WRAP_NOTES = new Set(['notes']);
const URL_COLS   = new Set(['url']);

async function load() {
  const range = encodeURIComponent(TAB);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_KEY}/values/${range}?key=${API_KEY}`;

  let rows;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    rows = data.values ?? [];
  } catch (e) {
    document.getElementById('status').textContent = `Error: ${e.message}`;
    return;
  }

  if (!rows.length) { document.getElementById('status').textContent = 'No data.'; return; }

  const [headers, ...body] = rows;

  const htr = document.createElement('tr');
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.className = `col-${i % 10}`;
    htr.appendChild(th);
  });
  document.getElementById('thead').appendChild(htr);

  const tbody = document.getElementById('tbody');
  body.forEach(row => {
    const tr = document.createElement('tr');
    headers.forEach((h, i) => {
      const td = document.createElement('td');
      const val = row[i] ?? '';
      td.className = `col-${i % 10}`;
      if (URL_COLS.has(h)) {
        td.classList.add('wrap-url');
        if (val) {
          const a = document.createElement('a');
          a.href = val; a.textContent = val;
          a.target = '_blank'; a.rel = 'noopener noreferrer';
          td.appendChild(a);
        }
      } else if (WRAP_TITLE.has(h)) {
        td.classList.add('wrap-title');
        td.textContent = val;
      } else if (WRAP_NOTES.has(h)) {
        td.classList.add('wrap-notes');
        const inner = document.createElement('div');
        inner.className = 'notes-inner';
        inner.textContent = val;
        td.appendChild(inner);
        const toggle = document.createElement('div');
        toggle.className = 'notes-toggle';
        toggle.textContent = '[read more]';
        td.appendChild(toggle);
        td.addEventListener('click', () => {
          const expanded = td.classList.toggle('expanded');
          toggle.textContent = expanded ? '[collapse]' : '[read more]';
        });
      } else {
        td.textContent = val;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  document.getElementById('status').textContent = '';

  const titleIdx  = headers.indexOf('anime_name');
  const notesIdx  = headers.indexOf('notes');
  const urlIdx    = headers.indexOf('url');

  $('#table').DataTable({
    paging: false,
    order: [],
    autoWidth: false,
    columnDefs: [
      { targets: '_all', orderable: true },
      { targets: titleIdx, width: '180px' },
      { targets: notesIdx, width: '600px' },
      { targets: urlIdx,   width: '220px' },
    ],
  });
}

load();
