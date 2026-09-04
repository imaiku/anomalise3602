// ============================================================
// POTENSI-USAHA.JS — Dashboard Logic for Potensi Usaha Langsung
// Only accessible by Admin and Superadmin
// ============================================================

let currentProfile = null;
let allData = [];
let filteredData = [];
let selectedRowIds = new Set();
let bulkSelectedData = [];

let currentPage = 1;
let pageSize = 10;
let sortField = 'nama_art';
let sortDir = 'asc';

let filterKecamatanVal = '';
let filterDesaVal = '';
let filterSlsVal = '';
let filterStatusVal = '';
let searchDebounceTimer = null;

let editingRowId = null;
let selectedStatusValue = null;

let parsedExcelRowsForImport = [];

// Helper link Fasih-SM
function getFasihEditUrl(assignmentId) {
  if (!assignmentId) return null;
  return `https://fasih-sm.bps.go.id/app/assignment/fd68e454-ba45-4b85-8205-f3bf777ded24/${assignmentId}/edit`;
}

// ─── INIT & AUTH CHECK ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  await initAuth();
});

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    document.getElementById('iconSun')?.classList.remove('hidden');
    document.getElementById('iconMoon')?.classList.add('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    document.getElementById('iconSun')?.classList.add('hidden');
    document.getElementById('iconMoon')?.classList.remove('hidden');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('iconSun')?.classList.toggle('hidden', !isDark);
  document.getElementById('iconMoon')?.classList.toggle('hidden', isDark);
}

function toggleProfileDropdown(e) {
  e.stopPropagation();
  document.getElementById('profileDropdown')?.classList.toggle('open');
}

document.addEventListener('click', () => {
  document.getElementById('profileDropdown')?.classList.remove('open');
});

async function initAuth() {
  const session = await getSession();
  currentProfile = session?.profile || null;

  const userDisplayName = document.getElementById('userDisplayName');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const loginNavBtn = document.getElementById('loginNavBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const adminNavBtn = document.getElementById('adminNavBtn');
  const superadminUploadBtn = document.getElementById('superadminUploadBtn');
  const accessDeniedBanner = document.getElementById('accessDeniedBanner');

  if (!currentProfile) {
    if (loginNavBtn) loginNavBtn.classList.remove('hidden');
    if (profileDropdown) profileDropdown.classList.add('hidden');
    if (accessDeniedBanner) accessDeniedBanner.classList.remove('hidden');
    document.getElementById('tableBody').innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:2.5rem;color:var(--error)">
        Harap login terlebih dahulu sebagai Admin atau Superadmin untuk mengakses halaman ini.
      </td></tr>
    `;
    return;
  }

  const role = (currentProfile.role || '').toLowerCase();
  const isAdmin = ['admin', 'superadmin'].includes(role);
  const isSuperAdmin = role === 'superadmin';

  if (userDisplayName) userDisplayName.textContent = getSessionName(currentProfile);
  if (userRoleBadge) {
    userRoleBadge.textContent = role.toUpperCase();
    userRoleBadge.className = 'type-badge type-keduanya';
  }

  if (loginNavBtn) loginNavBtn.classList.add('hidden');
  if (profileDropdown) profileDropdown.classList.remove('hidden');
  if (adminNavBtn) adminNavBtn.classList.toggle('hidden', !isAdmin);
  if (superadminUploadBtn) superadminUploadBtn.classList.toggle('hidden', !isSuperAdmin);

  if (!isAdmin) {
    if (accessDeniedBanner) accessDeniedBanner.classList.remove('hidden');
    document.getElementById('tableBody').innerHTML = `
      <tr><td colspan="7" style="text-align:center;padding:2.5rem;color:var(--error)">
        Akses ditolak. Halaman ini hanya diperuntukkan bagi Admin dan Superadmin.
      </td></tr>
    `;
    return;
  }

  // Load Data
  await loadData();
  setupDropzone();
}

// ─── LOAD DATA ───────────────────────────────────────────────
async function loadData() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">
        <div class="spinner" style="margin:0 auto 0.5rem auto"></div>
        <div>Memuat data Potensi Usaha...</div>
      </td>
    </tr>
  `;

  try {
    let allFetched = [];
    let from = 0;
    const fetchLimit = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await db
        .from('potensi_usaha')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + fetchLimit - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allFetched = allFetched.concat(data);
        from += fetchLimit;
        if (data.length < fetchLimit) hasMore = false;
      } else {
        hasMore = false;
      }
    }

    allData = allFetched;
    renderStats();
    renderKecamatanProgress();
    populateModalWilayahOptions();
    applyFilters();
  } catch (err) {
    console.error('Error loading data:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:2.5rem;color:var(--error)">
          Gagal memuat data dari database: ${err.message || 'Periksa koneksi atau schema tabel'}.
        </td>
      </tr>
    `;
    showToast('Gagal memuat data: ' + err.message, 'error');
  }
}

// ─── STATS & PROGRESS ────────────────────────────────────────
function renderStats() {
  const total = allData.length;
  const belum = allData.filter(d => !d.status || d.status === 'belum').length;
  const dikerjakan = allData.filter(d => d.status === 'sudah_dikerjakan').length;
  const selesai = allData.filter(d => d.status === 'sudah_selesai').length;
  const percent = total > 0 ? Math.round((selesai / total) * 100) : 0;

  document.getElementById('statTotal').textContent = total.toLocaleString('id-ID');
  document.getElementById('statBelum').textContent = belum.toLocaleString('id-ID');
  document.getElementById('statDikerjakan').textContent = dikerjakan.toLocaleString('id-ID');
  document.getElementById('statSelesai').textContent = selesai.toLocaleString('id-ID');

  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('statProgressPercent');
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressText) progressText.textContent = `${percent}% selesai (${selesai}/${total})`;
}

// ─── KECAMATAN PROGRESS SECTION ──────────────────────────────
function renderKecamatanProgress() {
  const container = document.getElementById('kecProgressGrid');
  if (!container) return;

  const kecMap = {};
  allData.forEach(item => {
    const k = (item.kecamatan || 'LAINNYA').trim().toUpperCase();
    if (!kecMap[k]) {
      kecMap[k] = { total: 0, selesai: 0 };
    }
    kecMap[k].total++;
    if (item.status === 'sudah_selesai') {
      kecMap[k].selesai++;
    }
  });

  const sortedKec = Object.keys(kecMap).sort();
  if (sortedKec.length === 0) {
    container.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); padding:0.5rem;">Belum ada data wilayah kecamatan.</div>';
    return;
  }

  let html = '';
  sortedKec.forEach(kec => {
    const stat = kecMap[kec];
    const pct = stat.total > 0 ? Math.round((stat.selesai / stat.total) * 100) : 0;
    const isActive = filterKecamatanVal.toUpperCase() === kec;

    html += `
      <div class="kec-progress-card ${isActive ? 'active-filter' : ''}" onclick="filterByKecamatanCard('${kec}')">
        <div class="kec-progress-name">${kec}</div>
        <div class="kec-progress-meta">
          <span>${stat.selesai} / ${stat.total}</span>
          <span style="font-weight:600; color:${pct === 100 ? 'var(--success)' : 'var(--text)'};">${pct}%</span>
        </div>
        <div class="kec-progress-bar">
          <div class="kec-progress-fill" style="width:${pct}%;"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleKecProgress() {
  const grid = document.getElementById('kecProgressGrid');
  const txt = document.getElementById('txtToggleKec');
  const icon = document.getElementById('toggleKecIcon');
  if (!grid) return;

  const isCollapsed = grid.classList.toggle('collapsed');
  if (txt) txt.textContent = isCollapsed ? 'Tampilkan' : 'Sembunyikan';
  if (icon) icon.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
}

function filterByKecamatanCard(kec) {
  if (filterKecamatanVal.toUpperCase() === kec) {
    filterKecamatanVal = '';
  } else {
    filterKecamatanVal = kec;
  }
  filterDesaVal = '';
  filterSlsVal = '';
  renderKecamatanProgress();
  applyFilters();
}

function clearKecamatanFilter() {
  filterKecamatanVal = '';
  filterDesaVal = '';
  filterSlsVal = '';
  renderKecamatanProgress();
  applyFilters();
}

// ─── FILTER & SEARCH ─────────────────────────────────────────
function applyFiltersDebounced() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    applyFilters();
  }, 250);
}

function applyFilters() {
  const search = (document.getElementById('filterSearch')?.value || '').toLowerCase().trim();
  filterStatusVal = document.getElementById('filterStatus')?.value || '';

  filteredData = allData.filter(item => {
    // Status Filter
    if (filterStatusVal) {
      if (filterStatusVal === 'belum' && item.status && item.status !== 'belum') return false;
      if (filterStatusVal !== 'belum' && item.status !== filterStatusVal) return false;
    }

    // Wilayah Filters
    if (filterKecamatanVal && (item.kecamatan || '').toUpperCase() !== filterKecamatanVal.toUpperCase()) {
      return false;
    }
    if (filterDesaVal && (item.desa || '').toUpperCase() !== filterDesaVal.toUpperCase()) {
      return false;
    }
    if (filterSlsVal && (item.nama_sls || '').toLowerCase() !== filterSlsVal.toLowerCase()) {
      return false;
    }

    // Search input
    if (search) {
      const matchArt = (item.nama_art || '').toLowerCase().includes(search);
      const matchKec = (item.kecamatan || '').toLowerCase().includes(search);
      const matchDesa = (item.desa || '').toLowerCase().includes(search);
      const matchSls = (item.nama_sls || '').toLowerCase().includes(search);
      const matchProfesi = (item.uraian_profesi || '').toLowerCase().includes(search);
      const matchKedudukan = (item.kedudukan_kerja || '').toLowerCase().includes(search);
      const matchAssign = (item.assignment_id || '').toLowerCase().includes(search);
      if (!matchArt && !matchKec && !matchDesa && !matchSls && !matchProfesi && !matchKedudukan && !matchAssign) {
        return false;
      }
    }

    return true;
  });

  sortFilteredData();
  currentPage = 1;
  renderActiveFilterChips();
  renderTable();
}

function sortFilteredData() {
  filteredData.sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function sortTable(field) {
  if (sortField === field) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDir = 'asc';
  }

  // Update icons
  ['nama_art', 'kecamatan', 'kedudukan_kerja', 'uraian_profesi', 'status'].forEach(col => {
    const icon = document.getElementById(`sortIcon_${col}`);
    if (!icon) return;
    if (col === sortField) {
      icon.textContent = sortDir === 'asc' ? '↑' : '↓';
      icon.parentElement.classList.add('sorted');
    } else {
      icon.textContent = '↕';
      icon.parentElement.classList.remove('sorted');
    }
  });

  sortFilteredData();
  renderTable();
}

function resetFilters() {
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterStatus').value = '';
  filterKecamatanVal = '';
  filterDesaVal = '';
  filterSlsVal = '';
  filterStatusVal = '';
  renderKecamatanProgress();
  applyFilters();
}

function renderActiveFilterChips() {
  const container = document.getElementById('filterActiveBar');
  const btnClearKec = document.getElementById('btnClearKecFilter');
  if (!container) return;

  const chips = [];

  if (filterKecamatanVal) {
    chips.push({
      label: `Kec: ${filterKecamatanVal}`,
      onRemove: () => { filterKecamatanVal = ''; renderKecamatanProgress(); applyFilters(); }
    });
    if (btnClearKec) btnClearKec.style.display = 'inline-block';
  } else {
    if (btnClearKec) btnClearKec.style.display = 'none';
  }

  if (filterDesaVal) {
    chips.push({
      label: `Desa: ${filterDesaVal}`,
      onRemove: () => { filterDesaVal = ''; applyFilters(); }
    });
  }

  if (filterSlsVal) {
    chips.push({
      label: `SLS: ${filterSlsVal}`,
      onRemove: () => { filterSlsVal = ''; applyFilters(); }
    });
  }

  if (filterStatusVal) {
    const map = {
      belum: 'Belum Dikerjakan',
      sudah_dikerjakan: 'Sudah Dikerjakan',
      sudah_selesai: 'Sudah Selesai'
    };
    chips.push({
      label: `Status: ${map[filterStatusVal] || filterStatusVal}`,
      onRemove: () => {
        document.getElementById('filterStatus').value = '';
        applyFilters();
      }
    });
  }

  if (chips.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = chips.map((c, i) => `
    <span class="filter-active-chip" onclick="removeFilterChip(${i})">
      ${c.label}
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </span>
  `).join('');

  window._activeChips = chips;
}

function removeFilterChip(index) {
  if (window._activeChips && window._activeChips[index]) {
    window._activeChips[index].onRemove();
  }
}

// ─── RENDER TABLE & CARDS ────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tableBody');
  const mobileList = document.getElementById('mobileCardList');
  const countLabel = document.getElementById('tableCount');

  const total = filteredData.length;
  if (countLabel) countLabel.textContent = `(${total.toLocaleString('id-ID')} baris)`;

  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">
          Tidak ada data potensi usaha yang sesuai dengan kriteria filter.
        </td>
      </tr>
    `;
    if (mobileList) {
      mobileList.innerHTML = `
        <div style="text-align:center;padding:3rem;color:var(--text-muted)">
          Tidak ada data yang cocok.
        </div>
      `;
    }
    renderPagination(0);
    return;
  }

  const totalPages = Math.ceil(total / pageSize);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredData.slice(startIndex, startIndex + pageSize);

  // Desktop Table
  let tableHtml = '';
  let mobileHtml = '';

  pageRows.forEach(row => {
    const isChecked = selectedRowIds.has(row.id);
    const badge = getStatusBadge(row.status);
    const fasihEditUrl = getFasihEditUrl(row.assignment_id);

    tableHtml += `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" class="row-checkbox" data-id="${row.id}" ${isChecked ? 'checked' : ''}
            onchange="onRowCheckChange(this, ${row.id})" style="cursor:pointer;accent-color:var(--primary)">
        </td>
        <td>
          <div style="font-weight:600;color:var(--text);">${escapeHtml(row.nama_art || '—')}</div>
          ${row.assignment_id ? `<div style="font-size:0.7rem;font-family:monospace;color:var(--text-subtle);">${row.assignment_id.slice(0, 8)}...</div>` : ''}
        </td>
        <td>
          <div style="font-weight:500;">${escapeHtml(row.kecamatan || '—')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${escapeHtml(row.desa || '—')} • ${escapeHtml(row.nama_sls || '—')}
          </div>
        </td>
        <td>
          <div style="font-size:0.825rem;">${escapeHtml(row.kedudukan_kerja || '—')}</div>
        </td>
        <td>
          <div style="font-size:0.825rem;color:var(--text-muted);">${escapeHtml(row.uraian_profesi || '—')}</div>
        </td>
        <td>
          ${badge}
        </td>
        <td style="text-align:center;white-space:nowrap;">
          <div style="display:inline-flex;gap:0.3rem;">
            ${fasihEditUrl ? `
              <a href="${fasihEditUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-xs"
                style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.25rem 0.45rem;text-decoration:none;color:white;" title="Edit di Fasih-SM">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
                Fasih
              </a>
            ` : ''}
            <button class="btn btn-secondary btn-xs" onclick="openEditModal(${row.id})"
              style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.25rem 0.45rem;" title="Edit Status">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Status
            </button>
          </div>
        </td>
      </tr>
    `;

    // Mobile Card
    mobileHtml += `
      <div class="mobile-card">
        <div class="mobile-card-header">
          <div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(row.kecamatan || '')} • ${escapeHtml(row.desa || '')}</div>
            <div class="mobile-card-name">${escapeHtml(row.nama_art || '—')}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(row.nama_sls || '—')}</div>
          </div>
          <div>${badge}</div>
        </div>
        <div class="mobile-card-meta" style="flex-direction:column;gap:0.2rem;">
          <div style="font-size:0.8rem;"><strong>Kedudukan:</strong> ${escapeHtml(row.kedudukan_kerja || '—')}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);"><strong>Profesi:</strong> ${escapeHtml(row.uraian_profesi || '—')}</div>
        </div>
        <div class="mobile-card-footer">
          <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;cursor:pointer;margin:0;">
            <input type="checkbox" class="row-checkbox" data-id="${row.id}" ${isChecked ? 'checked' : ''}
              onchange="onRowCheckChange(this, ${row.id})">
            <span>Pilih</span>
          </label>
          <div style="display:flex;gap:0.35rem;">
            ${fasihEditUrl ? `
              <a href="${fasihEditUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-xs" style="text-decoration:none;color:white;">
                Fasih
              </a>
            ` : ''}
            <button class="btn btn-secondary btn-xs" onclick="openEditModal(${row.id})">Status</button>
          </div>
        </div>
      </div>
    `;
  });

  tbody.innerHTML = tableHtml;
  if (mobileList) mobileList.innerHTML = mobileHtml;

  renderPagination(totalPages);
  updateFab();
}

function getStatusBadge(status) {
  if (status === 'sudah_selesai') {
    return '<span class="badge-status badge-selesai">Sudah Selesai</span>';
  } else if (status === 'sudah_dikerjakan') {
    return '<span class="badge-status badge-dikerjakan">Sudah Dikerjakan</span>';
  }
  return '<span class="badge-status badge-belum">Belum</span>';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── PAGINATION ──────────────────────────────────────────────
function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }

  let html = `
    <button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">
      ‹
    </button>
  `;

  pages.forEach(p => {
    if (p === '...') {
      html += `<span style="padding:0 0.4rem; color:var(--text-muted);">...</span>`;
    } else {
      html += `
        <button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">
          ${p}
        </button>
      `;
    }
  });

  html += `
    <button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">
      ›
    </button>
  `;

  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderTable();
}

function changePageSize() {
  const select = document.getElementById('pageSizeSelect');
  if (!select) return;
  pageSize = parseInt(select.value, 10) || 10;
  currentPage = 1;
  renderTable();
}

// ─── CHECKBOX & FAB ──────────────────────────────────────────
function toggleSelectAll(masterCheckbox) {
  const checked = masterCheckbox.checked;
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredData.slice(startIndex, startIndex + pageSize);

  pageRows.forEach(row => {
    if (checked) {
      selectedRowIds.add(row.id);
    } else {
      selectedRowIds.delete(row.id);
    }
  });

  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.checked = checked;
  });

  updateFab();
}

function onRowCheckChange(checkbox, id) {
  if (checkbox.checked) {
    selectedRowIds.add(id);
  } else {
    selectedRowIds.delete(id);
  }

  const master = document.getElementById('selectAllCheckbox');
  const startIndex = (currentPage - 1) * pageSize;
  const pageRows = filteredData.slice(startIndex, startIndex + pageSize);
  const allInPageChecked = pageRows.every(r => selectedRowIds.has(r.id));
  if (master) master.checked = allInPageChecked && pageRows.length > 0;

  updateFab();
}

function updateFab() {
  const fab = document.getElementById('fabBar');
  const count = document.getElementById('fabCount');
  if (!fab || !count) return;

  const totalSelected = selectedRowIds.size;
  count.textContent = `${totalSelected} dipilih`;

  if (totalSelected > 0) {
    fab.classList.add('visible');
  } else {
    fab.classList.remove('visible');
  }
}

function clearSelection() {
  selectedRowIds.clear();
  const master = document.getElementById('selectAllCheckbox');
  if (master) master.checked = false;
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  updateFab();
}

// ─── EDIT MODAL (BOTTOM SHEET INDIVIDUAL) ────────────────────
function openEditModal(id) {
  const row = allData.find(d => d.id === id);
  if (!row) return;

  editingRowId = id;
  selectedStatusValue = row.status || null;

  document.getElementById('sheetNamaArt').textContent = row.nama_art || 'Responden';
  document.getElementById('sheetSubLoc').textContent = `${row.kecamatan || ''} / ${row.desa || ''} / ${row.nama_sls || ''}`;

  // Fasih Link
  const fasihBtn = document.getElementById('sheetFasihLink');
  const fasihUrl = getFasihEditUrl(row.assignment_id);
  if (fasihBtn) {
    if (fasihUrl) {
      fasihBtn.href = fasihUrl;
      fasihBtn.style.display = 'inline-flex';
    } else {
      fasihBtn.style.display = 'none';
    }
  }

  updateRadioOptionCards();

  // Audit info
  const auditBox = document.getElementById('auditLogInfoBox');
  if (row.status === 'sudah_selesai' && row.selesai_oleh) {
    const timeStr = row.selesai_at ? new Date(row.selesai_at).toLocaleString('id-ID') : '';
    auditBox.style.display = 'block';
    auditBox.innerHTML = `
      <strong>Diselesaikan oleh:</strong> ${escapeHtml(row.selesai_oleh)} <br>
      <span style="font-size:0.72rem;">Waktu: ${timeStr}</span>
    `;
  } else if (row.status === 'sudah_dikerjakan' && row.dikerjakan_oleh) {
    const timeStr = row.dikerjakan_at ? new Date(row.dikerjakan_at).toLocaleString('id-ID') : '';
    auditBox.style.display = 'block';
    auditBox.innerHTML = `
      <strong>Dikerjakan oleh:</strong> ${escapeHtml(row.dikerjakan_oleh)} <br>
      <span style="font-size:0.72rem;">Waktu: ${timeStr}</span>
    `;
  } else {
    auditBox.style.display = 'none';
  }

  const modal = document.getElementById('editModal');
  if (modal) modal.classList.add('open');
}

function updateRadioOptionCards() {
  const cardDikerjakan = document.getElementById('cardOptDikerjakan');
  const cardSelesai = document.getElementById('cardOptSelesai');
  const radioDikerjakan = document.getElementById('radioDikerjakan');
  const radioSelesai = document.getElementById('radioSelesai');

  if (selectedStatusValue === 'sudah_dikerjakan') {
    cardDikerjakan?.classList.add('selected');
    cardSelesai?.classList.remove('selected');
    if (radioDikerjakan) radioDikerjakan.checked = true;
  } else if (selectedStatusValue === 'sudah_selesai') {
    cardDikerjakan?.classList.remove('selected');
    cardSelesai?.classList.add('selected');
    if (radioSelesai) radioSelesai.checked = true;
  } else {
    cardDikerjakan?.classList.remove('selected');
    cardSelesai?.classList.remove('selected');
    if (radioDikerjakan) radioDikerjakan.checked = false;
    if (radioSelesai) radioSelesai.checked = false;
  }
}

function selectStatusOption(val) {
  if (selectedStatusValue === val) {
    selectedStatusValue = 'belum';
  } else {
    selectedStatusValue = val;
  }
  updateRadioOptionCards();
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) modal.classList.remove('open');
  editingRowId = null;
  selectedStatusValue = null;
}

function handleEditOverlayClick(e) {
  if (e.target.id === 'editModal') {
    closeEditModal();
  }
}

async function saveEditStatus() {
  if (!editingRowId) return;

  const btn = document.getElementById('btnSaveEdit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const adminName = getSessionName(currentProfile);
    const nowIso = new Date().toISOString();

    const updatePayload = {
      status: selectedStatusValue || 'belum',
      updated_at: nowIso
    };

    if (selectedStatusValue === 'sudah_selesai') {
      updatePayload.selesai_oleh = adminName;
      updatePayload.selesai_at = nowIso;
    } else if (selectedStatusValue === 'sudah_dikerjakan') {
      updatePayload.dikerjakan_oleh = adminName;
      updatePayload.dikerjakan_at = nowIso;
    }

    const { error } = await db
      .from('potensi_usaha')
      .update(updatePayload)
      .eq('id', editingRowId);

    if (error) throw error;

    const target = allData.find(d => d.id === editingRowId);
    if (target) {
      Object.assign(target, updatePayload);
    }

    closeEditModal();
    renderStats();
    renderKecamatanProgress();
    applyFilters();
    showToast('Status berhasil diperbarui!', 'success');
  } catch (err) {
    alert('Gagal menyimpan perubahan: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan Status';
  }
}

// ─── BULK EDIT MODAL (IDENTIK DENGAN DASHBOARD UTAMA) ────────
function openBulkModal() {
  if (!selectedRowIds.size) return;
  if (selectedRowIds.size > 50) {
    showToast('Maksimal baris yang dapat dibuka bersamaan adalah 50!', 'warning');
    return;
  }

  bulkSelectedData = allData.filter(d => selectedRowIds.has(d.id));
  renderBulkSheetBody();

  const modal = document.getElementById('bulkModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeBulkModal() {
  const modal = document.getElementById('bulkModal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function handleBulkOverlayClick(e) {
  if (e.target.id === 'bulkModal') closeBulkModal();
}

function renderBulkSheetBody() {
  const body = document.getElementById('bulkSheetBody');
  const sub = document.getElementById('bulkSubtitle');
  if (!body) return;

  if (sub) sub.textContent = `${bulkSelectedData.length} data terpilih untuk diedit status & assignment`;

  let html = `
    <div style="overflow-x:auto">
      <table class="table" style="width:100%; font-size:0.8rem; border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="padding:0.75rem; text-align:left">Nama ART / Pelaku Usaha</th>
            <th style="padding:0.75rem; text-align:center; width:135px">
              <label style="cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem; margin:0">
                <input type="checkbox" id="bulkMasterDikerjakan" onchange="toggleAllBulkStatus('dikerjakan', this.checked)" style="width:14px; height:14px; cursor:pointer">
                Dikerjakan
              </label>
            </th>
            <th style="padding:0.75rem; text-align:center; width:135px">
              <label style="cursor:pointer; display:inline-flex; align-items:center; gap:0.3rem; margin:0">
                <input type="checkbox" id="bulkMasterSelesai" onchange="toggleAllBulkStatus('selesai', this.checked)" style="width:14px; height:14px; cursor:pointer">
                Selesai
              </label>
            </th>
            <th style="padding:0.75rem; text-align:center; width:100px">Aksi</th>
          </tr>
        </thead>
        <tbody>
  `;

  bulkSelectedData.forEach((row, idx) => {
    const isDikerjakan = row.status === 'sudah_dikerjakan';
    const isSelesai = row.status === 'sudah_selesai';
    const fasihEditUrl = getFasihEditUrl(row.assignment_id);

    html += `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:0.75rem">
          <div style="font-weight:600; color:var(--text)">${escapeHtml(row.nama_art)}</div>
          <div style="font-size:0.72rem; color:var(--text-muted)">
            ${escapeHtml(row.kecamatan)} · ${escapeHtml(row.desa)} · ${escapeHtml(row.nama_sls)}
            ${row.assignment_id ? ` · <span style="font-family:monospace">${row.assignment_id.slice(0, 8)}...</span>` : ''}
          </div>
        </td>
        <td style="padding:0.75rem; text-align:center">
          <input type="checkbox" class="bulk-dikerjakan-cb" data-idx="${idx}" ${isDikerjakan ? 'checked' : ''}
            onchange="onBulkRowStatusChange(${idx}, 'dikerjakan', this.checked)"
            style="width:16px; height:16px; accent-color:var(--info); cursor:pointer">
        </td>
        <td style="padding:0.75rem; text-align:center">
          <input type="checkbox" class="bulk-selesai-cb" data-idx="${idx}" ${isSelesai ? 'checked' : ''}
            onchange="onBulkRowStatusChange(${idx}, 'selesai', this.checked)"
            style="width:16px; height:16px; accent-color:var(--success); cursor:pointer">
        </td>
        <td style="padding:0.75rem; text-align:center; white-space:nowrap">
          ${fasihEditUrl ? `
            <a href="${fasihEditUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm"
              style="padding:0.25rem 0.55rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.25rem; text-decoration:none; color:white;">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </a>
          ` : '<span style="font-size:0.7rem; color:var(--text-subtle)">No ID</span>'}
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  body.innerHTML = html;
}

function onBulkRowStatusChange(idx, type, checked) {
  const dikerjakanCbs = document.querySelectorAll('.bulk-dikerjakan-cb');
  const selesaiCbs = document.querySelectorAll('.bulk-selesai-cb');

  if (type === 'dikerjakan' && checked) {
    // Uncheck selesai karena pilihan hanya satu
    if (selesaiCbs[idx]) selesaiCbs[idx].checked = false;
  } else if (type === 'selesai' && checked) {
    // Uncheck dikerjakan
    if (dikerjakanCbs[idx]) dikerjakanCbs[idx].checked = false;
  }
}

function toggleAllBulkStatus(type, checked) {
  const dikerjakanCbs = document.querySelectorAll('.bulk-dikerjakan-cb');
  const selesaiCbs = document.querySelectorAll('.bulk-selesai-cb');

  if (type === 'dikerjakan') {
    dikerjakanCbs.forEach(cb => cb.checked = checked);
    if (checked) {
      selesaiCbs.forEach(cb => cb.checked = false);
      const masterSelesai = document.getElementById('bulkMasterSelesai');
      if (masterSelesai) masterSelesai.checked = false;
    }
  } else {
    selesaiCbs.forEach(cb => cb.checked = checked);
    if (checked) {
      dikerjakanCbs.forEach(cb => cb.checked = false);
      const masterDikerjakan = document.getElementById('bulkMasterDikerjakan');
      if (masterDikerjakan) masterDikerjakan.checked = false;
    }
  }
}

// Buka semua link tab edit Fasih-SM sekaligus (Persis dashboard utama)
function editAllBulkTabs() {
  if (bulkSelectedData.length === 0) return;
  const count = bulkSelectedData.length;
  if (count > 5) {
    if (!confirm(`Apakah Anda yakin ingin membuka ${count} tab Edit Fasih-SM sekaligus?`)) {
      return;
    }
  }

  let openedCount = 0;
  bulkSelectedData.forEach(row => {
    const url = getFasihEditUrl(row.assignment_id);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      openedCount++;
    }
  });

  if (openedCount > 0) {
    showToast(`Membuka ${openedCount} tab Edit Fasih-SM. Izinkan pop-up jika terblokir.`, 'success');
  } else {
    showToast('Tidak ada baris yang memiliki assignment_id valid.', 'warning');
  }
}

async function saveBulkChanges() {
  const saveBtn = document.getElementById('bulkSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';

  try {
    const adminName = getSessionName(currentProfile);
    const nowIso = new Date().toISOString();

    const dikerjakanCbs = document.querySelectorAll('.bulk-dikerjakan-cb');
    const selesaiCbs = document.querySelectorAll('.bulk-selesai-cb');

    for (let i = 0; i < bulkSelectedData.length; i++) {
      const row = bulkSelectedData[i];
      const isDikerjakan = dikerjakanCbs[i]?.checked || false;
      const isSelesai = selesaiCbs[i]?.checked || false;

      let newStatus = 'belum';
      if (isSelesai) newStatus = 'sudah_selesai';
      else if (isDikerjakan) newStatus = 'sudah_dikerjakan';

      const updatePayload = {
        status: newStatus,
        updated_at: nowIso
      };

      if (newStatus === 'sudah_selesai') {
        updatePayload.selesai_oleh = adminName;
        updatePayload.selesai_at = nowIso;
      } else if (newStatus === 'sudah_dikerjakan') {
        updatePayload.dikerjakan_oleh = adminName;
        updatePayload.dikerjakan_at = nowIso;
      }

      // Update ke Supabase
      const { error } = await db
        .from('potensi_usaha')
        .update(updatePayload)
        .eq('id', row.id);

      if (error) throw error;

      // Update local state
      const target = allData.find(d => d.id === row.id);
      if (target) {
        Object.assign(target, updatePayload);
      }
    }

    closeBulkModal();
    clearSelection();
    renderStats();
    renderKecamatanProgress();
    applyFilters();
    showToast('Perubahan status berhasil disimpan!', 'success');
  } catch (err) {
    alert('Gagal menyimpan perubahan massal: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Simpan Perubahan';
  }
}

// ─── WILAYAH FILTER MODAL ────────────────────────────────────
function openWilayahFilterModal() {
  const modal = document.getElementById('wilayahFilterModal');
  if (modal) modal.classList.add('open');
}

function closeWilayahFilterModal() {
  const modal = document.getElementById('wilayahFilterModal');
  if (modal) modal.classList.remove('open');
}

function populateModalWilayahOptions() {
  const kecSelect = document.getElementById('filterModalKecamatan');
  if (!kecSelect) return;

  const kecs = Array.from(new Set(allData.map(d => (d.kecamatan || '').trim().toUpperCase()).filter(Boolean))).sort();
  kecSelect.innerHTML = '<option value="">Semua Kecamatan</option>' +
    kecs.map(k => `<option value="${k}" ${k === filterKecamatanVal.toUpperCase() ? 'selected' : ''}>${k}</option>`).join('');

  onModalKecamatanChange();
}

function onModalKecamatanChange() {
  const kecSelect = document.getElementById('filterModalKecamatan');
  const desaSelect = document.getElementById('filterModalDesa');
  if (!kecSelect || !desaSelect) return;

  const selKec = kecSelect.value;
  let target = allData;
  if (selKec) {
    target = target.filter(d => (d.kecamatan || '').toUpperCase() === selKec.toUpperCase());
  }

  const desas = Array.from(new Set(target.map(d => (d.desa || '').trim().toUpperCase()).filter(Boolean))).sort();
  desaSelect.innerHTML = '<option value="">Semua Desa</option>' +
    desas.map(d => `<option value="${d}" ${d === filterDesaVal.toUpperCase() ? 'selected' : ''}>${d}</option>`).join('');

  onModalDesaChange();
}

function onModalDesaChange() {
  const kecSelect = document.getElementById('filterModalKecamatan');
  const desaSelect = document.getElementById('filterModalDesa');
  const slsSelect = document.getElementById('filterModalSLS');
  if (!slsSelect) return;

  const selKec = kecSelect?.value || '';
  const selDesa = desaSelect?.value || '';

  let target = allData;
  if (selKec) target = target.filter(d => (d.kecamatan || '').toUpperCase() === selKec.toUpperCase());
  if (selDesa) target = target.filter(d => (d.desa || '').toUpperCase() === selDesa.toUpperCase());

  const slses = Array.from(new Set(target.map(d => (d.nama_sls || '').trim()).filter(Boolean))).sort();
  slsSelect.innerHTML = '<option value="">Semua SLS</option>' +
    slses.map(s => `<option value="${s}" ${s === filterSlsVal ? 'selected' : ''}>${s}</option>`).join('');
}

function applyWilayahFilterFromModal() {
  const kecSelect = document.getElementById('filterModalKecamatan');
  const desaSelect = document.getElementById('filterModalDesa');
  const slsSelect = document.getElementById('filterModalSLS');

  filterKecamatanVal = kecSelect?.value || '';
  filterDesaVal = desaSelect?.value || '';
  filterSlsVal = slsSelect?.value || '';

  closeWilayahFilterModal();
  renderKecamatanProgress();
  applyFilters();
}

// ─── IMPORT EXCEL (SUPERADMIN) ───────────────────────────────
function openImportDialogModal() {
  const modal = document.getElementById('importDialogModal');
  const label = document.getElementById('modalDropzoneLabel');
  const statArea = document.getElementById('uploadPreviewStatArea');
  const fileInput = document.getElementById('fileExcelHidden');

  if (fileInput) fileInput.value = '';
  if (label) label.textContent = 'Klik atau seret file Excel Potensi Usaha ke sini';
  if (statArea) statArea.style.display = 'none';
  parsedExcelRowsForImport = [];

  if (modal) modal.style.display = 'flex';
}

function closeImportDialogModal() {
  const modal = document.getElementById('importDialogModal');
  if (modal) modal.style.display = 'none';
}

function setupDropzone() {
  const dropzone = document.getElementById('modalDropzone');
  const fileInput = document.getElementById('fileExcelHidden');
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--primary)';
    dropzone.style.background = 'rgba(249, 115, 22, 0.05)';
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border)';
      dropzone.style.background = 'var(--bg-card)';
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) parseExcelFile(files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) parseExcelFile(e.target.files[0]);
  });
}

function extractUuidFromLink(linkStr) {
  if (!linkStr) return null;
  const str = String(linkStr).trim();

  // Pola spesifik URL Fasih-SM:
  // https://fasih-sm.bps.go.id/app/assignment/fd68e454-ba45-4b85-8205-f3bf777ded24/{assignment_id}
  // (bisa diakhiri dengan /edit atau langsung {assignment_id})
  const pathMatch = str.match(/\/assignment\/[0-9a-fA-F-]+\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (pathMatch) {
    return pathMatch[1];
  }

  // Pola query param: assignmentId=UUID
  const paramMatch = str.match(/assignmentId=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (paramMatch) {
    return paramMatch[1];
  }

  // Fallback: Jika ada lebih dari 1 UUID, ambil UUID yang kedua / terakhir
  const allUuids = str.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g);
  if (allUuids && allUuids.length > 0) {
    return allUuids[allUuids.length - 1];
  }

  return null;
}

function parseExcelFile(file) {
  const label = document.getElementById('modalDropzoneLabel');
  if (label) label.textContent = `📄 ${file.name}`;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];

      // Dapatkan rentang worksheet (range)
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const headerRowIndex = range.s.r;

      // Identifikasi letak kolom berdasarkan header di baris pertama
      const colMap = {};
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIndex, c: C });
        const cell = worksheet[cellRef];
        if (cell && cell.v) {
          const headerClean = String(cell.v).toLowerCase().replace(/[^a-z0-9]/g, '');
          colMap[C] = headerClean;
        }
      }

      // Cari indeks kolom yang relevan
      const findColIdx = (keySub) => {
        const cleanSub = keySub.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [colIdx, name] of Object.entries(colMap)) {
          if (name.includes(cleanSub)) return parseInt(colIdx, 10);
        }
        return -1;
      };

      const kecCol = findColIdx('kecamatan');
      const desaCol = findColIdx('desa') !== -1 ? findColIdx('desa') : findColIdx('kelurahan');
      const slsCol = findColIdx('sls') !== -1 ? findColIdx('sls') : findColIdx('subsls');
      const artCol = findColIdx('namaart') !== -1 ? findColIdx('namaart') : (findColIdx('pekerja') !== -1 ? findColIdx('pekerja') : findColIdx('pelaku'));
      const kedudukanCol = findColIdx('kedudukan');
      const profesiCol = findColIdx('profesi') !== -1 ? findColIdx('profesi') : findColIdx('uraian');
      const linkCol = findColIdx('link') !== -1 ? findColIdx('link') : (findColIdx('fasih') !== -1 ? findColIdx('fasih') : findColIdx('assignment'));

      const parsed = [];
      let totalValidWithId = 0;

      // Loop setiap baris data (dari baris setelah header hingga baris akhir)
      for (let R = headerRowIndex + 1; R <= range.e.r; ++R) {
        const getVal = (colIndex) => {
          if (colIndex === -1) return '';
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: colIndex })];
          return cell && cell.v !== undefined ? String(cell.v).trim() : '';
        };

        // Ambil link / formula / hyperlink target khusus kolom link assignment
        let rawLinkStr = '';
        if (linkCol !== -1) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: linkCol })];
          if (cell) {
            // 1. Cek formula (=HYPERLINK("...", "..."))
            if (cell.f) {
              rawLinkStr += ' ' + String(cell.f);
            }
            // 2. Cek hyperlink target (.l.Target)
            if (cell.l && cell.l.Target) {
              rawLinkStr += ' ' + String(cell.l.Target);
            }
            // 3. Cek formatted value (.v atau .w)
            if (cell.v !== undefined) {
              rawLinkStr += ' ' + String(cell.v);
            }
          }
        }

        const nama_art = getVal(artCol);
        const kecamatan = getVal(kecCol);
        const desa = getVal(desaCol);
        const nama_sls = getVal(slsCol);
        const kedudukan_kerja = getVal(kedudukanCol);
        const uraian_profesi = getVal(profesiCol);

        // Ekstrak UUID assignment_id dari formula / link target
        const assignmentId = extractUuidFromLink(rawLinkStr);
        if (assignmentId) totalValidWithId++;

        if (nama_art) {
          parsed.push({
            assignment_id: assignmentId || null,
            kecamatan: kecamatan || 'LEBAK',
            desa: desa || '—',
            nama_sls: nama_sls || '—',
            nama_art: nama_art,
            kedudukan_kerja: kedudukan_kerja || '—',
            uraian_profesi: uraian_profesi || '—',
            status: 'belum'
          });
        }
      }

      if (parsed.length === 0) {
        alert('File Excel kosong atau kolom Nama ART tidak ditemukan.');
        return;
      }

      parsedExcelRowsForImport = parsed;

      document.getElementById('previewTotalBaris').textContent = (range.e.r - headerRowIndex).toLocaleString('id-ID');
      document.getElementById('previewTotalValid').innerHTML = `
        ${parsed.length.toLocaleString('id-ID')}
        <div style="font-size:0.7rem; color:var(--text-muted); font-weight:400; margin-top:2px;">
          (${totalValidWithId.toLocaleString('id-ID')} dengan Assignment ID)
        </div>
      `;
      document.getElementById('uploadPreviewStatArea').style.display = 'block';
    } catch (err) {
      console.error('Error parsing excel:', err);
      alert('Gagal membaca file Excel: ' + err.message);
    }
  };

  reader.readAsArrayBuffer(file);
}

async function executeUploadImport() {
  if (!parsedExcelRowsForImport || parsedExcelRowsForImport.length === 0) return;

  const btn = document.getElementById('btnConfirmImport');
  btn.disabled = true;

  closeImportDialogModal();

  const modal = document.getElementById('importProgressModal');
  const status = document.getElementById('importModalStatus');
  const fill = document.getElementById('importProgressFill');

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  status.textContent = `Menyiapkan ${parsedExcelRowsForImport.length} baris data...`;
  fill.style.width = '10%';

  try {
    const chunkSize = 250;
    const total = parsedExcelRowsForImport.length;

    for (let i = 0; i < total; i += chunkSize) {
      const chunk = parsedExcelRowsForImport.slice(i, i + chunkSize);
      const { error } = await db
        .from('potensi_usaha')
        .insert(chunk);

      if (error) throw error;

      const pct = Math.min(100, Math.round(((i + chunk.length) / total) * 90) + 10);
      fill.style.width = `${pct}%`;
      status.textContent = `Mengunggah baris ${Math.min(i + chunkSize, total)} dari ${total}...`;
    }

    fill.style.width = '100%';
    status.textContent = 'Selesai!';

    setTimeout(async () => {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      showToast(`Berhasil menambahkan ${total} data potensi usaha baru!`, 'success');
      await loadData();
    }, 600);
  } catch (err) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    alert('Gagal mengunggah data ke database: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ─── TOAST NOTIFICATION ──────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>${message}</span>
    </div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
