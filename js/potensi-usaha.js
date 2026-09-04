// ============================================================
// POTENSI-USAHA.JS — Dashboard Logic for Potensi Usaha Langsung
// Only accessible by Admin and Superadmin
// ============================================================

let currentProfile = null;
let allData = [];
let filteredData = [];
let selectedRowIds = new Set();

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
let bulkSelectedStatusValue = null;

let parsedExcelRowsForImport = [];

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
      if (!matchArt && !matchKec && !matchDesa && !matchSls && !matchProfesi && !matchKedudukan) {
        return false;
      }
    }

    return true;
  });

  // Sort
  sortFilteredData();

  // Clear or adjust page
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

    tableHtml += `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" class="row-checkbox" data-id="${row.id}" ${isChecked ? 'checked' : ''}
            onchange="onRowCheckChange(this, ${row.id})" style="cursor:pointer;accent-color:var(--primary)">
        </td>
        <td>
          <div style="font-weight:600;color:var(--text);">${escapeHtml(row.nama_art || '—')}</div>
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
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-xs" onclick="openEditModal(${row.id})"
            style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
            </svg>
            Edit
          </button>
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
          <button class="btn btn-secondary btn-xs" onclick="openEditModal(${row.id})">Edit Status</button>
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

  // Update master checkbox
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

  // Update Option Radio State
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
    // Uncheck if clicked again (kembali ke belum dikerjakan)
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

    // Local update
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

// ─── BULK EDIT MODAL ─────────────────────────────────────────
function openBulkModal() {
  const total = selectedRowIds.size;
  if (total === 0) return;

  bulkSelectedStatusValue = null;
  document.getElementById('bulkSubtitle').textContent = `${total} baris dipilih untuk diperbarui`;

  const cardD = document.getElementById('bulkCardDikerjakan');
  const cardS = document.getElementById('bulkCardSelesai');
  cardD?.classList.remove('selected');
  cardS?.classList.remove('selected');
  document.getElementById('bulkRadioDikerjakan').checked = false;
  document.getElementById('bulkRadioSelesai').checked = false;

  const modal = document.getElementById('bulkModal');
  if (modal) modal.classList.add('open');
}

function selectBulkStatusOption(val) {
  bulkSelectedStatusValue = val;
  const cardD = document.getElementById('bulkCardDikerjakan');
  const cardS = document.getElementById('bulkCardSelesai');

  if (val === 'sudah_dikerjakan') {
    cardD?.classList.add('selected');
    cardS?.classList.remove('selected');
    document.getElementById('bulkRadioDikerjakan').checked = true;
  } else {
    cardD?.classList.remove('selected');
    cardS?.classList.add('selected');
    document.getElementById('bulkRadioSelesai').checked = true;
  }
}

function closeBulkModal() {
  const modal = document.getElementById('bulkModal');
  if (modal) modal.classList.remove('open');
  bulkSelectedStatusValue = null;
}

function handleBulkOverlayClick(e) {
  if (e.target.id === 'bulkModal') {
    closeBulkModal();
  }
}

async function saveBulkStatus() {
  if (!bulkSelectedStatusValue) {
    alert('Silakan pilih salah satu status terlebih dahulu.');
    return;
  }

  const ids = Array.from(selectedRowIds);
  if (ids.length === 0) return;

  const btn = document.getElementById('btnSaveBulk');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const adminName = getSessionName(currentProfile);
    const nowIso = new Date().toISOString();

    const updatePayload = {
      status: bulkSelectedStatusValue,
      updated_at: nowIso
    };

    if (bulkSelectedStatusValue === 'sudah_selesai') {
      updatePayload.selesai_oleh = adminName;
      updatePayload.selesai_at = nowIso;
    } else {
      updatePayload.dikerjakan_oleh = adminName;
      updatePayload.dikerjakan_at = nowIso;
    }

    // Chunked update (200 rows per batch)
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { error } = await db
        .from('potensi_usaha')
        .update(updatePayload)
        .in('id', chunk);

      if (error) throw error;
    }

    // Update local state
    const setIds = new Set(ids);
    allData.forEach(row => {
      if (setIds.has(row.id)) {
        Object.assign(row, updatePayload);
      }
    });

    closeBulkModal();
    clearSelection();
    renderStats();
    renderKecamatanProgress();
    applyFilters();
    showToast(`Berhasil memperbarui ${ids.length} data!`, 'success');
  } catch (err) {
    alert('Gagal memperbarui status massal: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan Semua';
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
      const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!jsonRows || jsonRows.length === 0) {
        alert('File Excel kosong atau tidak berisi data.');
        return;
      }

      // Filter kolom & mapping:
      // Abaikan no, admin fasih, link assignment. Ambil: kecamatan, desa, nama sls, nama art, kedudukan, uraian profesi.
      const parsed = [];
      jsonRows.forEach(row => {
        const getCol = (keySub) => {
          const key = Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z]/g, '').includes(keySub.toLowerCase().replace(/[^a-z]/g, '')));
          return key ? String(row[key]).trim() : '';
        };

        const kecamatan = getCol('kecamatan');
        const desa = getCol('desa') || getCol('kelurahan');
        const nama_sls = getCol('sls') || getCol('subsls');
        const nama_art = getCol('nama art') || getCol('pekerja') || getCol('pelaku');
        const kedudukan_kerja = getCol('kedudukan');
        const uraian_profesi = getCol('profesi') || getCol('uraian');

        if (nama_art) {
          parsed.push({
            kecamatan: kecamatan || 'LEBAK',
            desa: desa || '—',
            nama_sls: nama_sls || '—',
            nama_art: nama_art,
            kedudukan_kerja: kedudukan_kerja || '—',
            uraian_profesi: uraian_profesi || '—',
            status: 'belum'
          });
        }
      });

      parsedExcelRowsForImport = parsed;

      document.getElementById('previewTotalBaris').textContent = jsonRows.length.toLocaleString('id-ID');
      document.getElementById('previewTotalValid').textContent = parsed.length.toLocaleString('id-ID');
      document.getElementById('uploadPreviewStatArea').style.display = 'block';
    } catch (err) {
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
