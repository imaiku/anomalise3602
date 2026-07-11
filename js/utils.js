// ============================================================
// UTILS.JS — Shared utilities used across all pages
// ============================================================

// ---- HTML Escaping ----
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Toast Notifications ----
const TOAST_ICONS = {
  success: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
  error:   '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
  warning: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  info:    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
};

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) { console.warn('showToast: #toastContainer not found'); return; }
  const id = 'toast-' + Date.now();
  const t = document.createElement('div');
  t.id = id;
  t.className = `toast ${type}`;
  t.innerHTML = `${TOAST_ICONS[type] || ''}
    <span style="flex:1">${escHtml(message)}</span>
    <button class="toast-close" onclick="document.getElementById('${id}').remove()">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
    </button>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ---- Date Formatting ----
function formatDate(dateStr, withTime = false) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleDateString('id-ID', opts);
}

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved === 'dark' || (!saved && prefersDark);
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.getElementById('iconSun')?.classList.remove('hidden');
    document.getElementById('iconMoon')?.classList.add('hidden');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('iconSun')?.classList.toggle('hidden', !isDark);
  document.getElementById('iconMoon')?.classList.toggle('hidden', isDark);
}

// ---- Validation Helper ----
function validateHeaders(headerRow, expectedCols) {
  const errors = [];
  expectedCols.forEach((col, i) => {
    const actual = String(headerRow[i] || '').trim();
    if (actual !== col) errors.push(`Kolom ${i + 1}: diharapkan "${col}", ditemukan "${actual}"`);
  });
  return errors;
}

// ---- Upload Zone Helper ----
function setZoneFile(zoneId, labelId, fileName, hasFile) {
  document.getElementById(zoneId)?.classList.toggle('has-file', hasFile);
  const label = document.getElementById(labelId);
  if (label) label.textContent = fileName || 'Pilih atau seret file di sini';
}

// ---- Validation Result HTML ----
function renderValidationResult(containerId, result) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!result.valid) {
    el.innerHTML = `<div class="validation-errors"><strong>Validasi Gagal:</strong><ul>${result.errors.map(e => `<li>${escHtml(e)}</li>`).join('')}</ul></div>`;
  } else {
    el.innerHTML = `<div class="chip success">Format file valid</div>`;
  }
}
