// ============================================================
// DASHBOARD.JS — Main dashboard logic
// ============================================================

let currentProfile = null;
let allData = [];         // grouped by assignment_id
let filteredData = [];
let selectedIds = new Set();
let currentPage = 1;
let pageSize = 25;
let sortField = 'first_seen';
let sortDir = 'desc';
let showReopenHighlight = false;
let debounceTimer = null;

// ---- Init ----
async function initDashboard() {
  const session = await requireAuth(['superadmin', 'admin', 'pml', 'ppl']);
  if (!session) return;
  currentProfile = session.profile;

  // Set user info in navbar
  const name = getSessionName(currentProfile);
  document.getElementById('userDisplayName').textContent = name;
  const roleEl = document.getElementById('userRoleBadge');
  roleEl.textContent = currentProfile.role.toUpperCase();
  roleEl.className = `type-badge type-${currentProfile.role === 'ppl' ? 'keluarga' : currentProfile.role === 'pml' ? 'usaha' : 'keduanya'}`;

  await loadStats();
  await loadAnomalinomorOptions();
  await loadData();
}

// ---- Load Stats ----
async function loadStats() {
  try {
    // Get all unique assignment IDs and their completion status
    let query = db.from('assignment_anomali').select('assignment_id, status');

    if (currentProfile.role === 'ppl') {
      const { data: mySlsList } = await db.rpc('get_my_sls');
      const slsCodes = (mySlsList || []).map(r => r.kode_sls);
      if (slsCodes.length > 0) query = query.in('kode_sls_gabungan', slsCodes);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Group by assignment_id
    const assignments = {};
    (data || []).forEach(row => {
      if (!assignments[row.assignment_id]) assignments[row.assignment_id] = [];
      assignments[row.assignment_id].push(row.status);
    });

    const total = Object.keys(assignments).length;
    let selesai = 0;
    Object.values(assignments).forEach(statuses => {
      const isSelesai = statuses.every(s =>
        s === 'sesuai_kondisi' || s === 'sudah_diperbaiki' || s === 'tidak_terdeteksi_lagi'
      );
      if (isSelesai) selesai++;
    });
    const belum = total - selesai;
    const progress = total > 0 ? Math.round((selesai / total) * 100) : 0;

    document.getElementById('statTotal').textContent = total.toLocaleString('id');
    document.getElementById('statBelum').textContent = belum.toLocaleString('id');
    document.getElementById('statSelesai').textContent = selesai.toLocaleString('id');
    document.getElementById('statProgress').textContent = `${progress}%`;
    document.getElementById('progressFill').style.width = `${progress}%`;
  } catch (e) {
    console.error('loadStats error:', e);
  }
}

// ---- Load Anomali Nomor Options ----
async function loadAnomalinomorOptions() {
  const { data } = await db
    .from('assignment_anomali')
    .select('nomor_anomali, tipe')
    .order('nomor_anomali');

  const seen = new Set();
  const select = document.getElementById('filterNomor');
  (data || []).forEach(row => {
    const key = `${row.tipe}-${row.nomor_anomali}`;
    if (!seen.has(key)) {
      seen.add(key);
      const opt = document.createElement('option');
      opt.value = `${row.tipe}:${row.nomor_anomali}`;
      opt.textContent = `Anomali ${row.nomor_anomali} (${row.tipe === 'keluarga' ? 'KK' : 'Usaha'})`;
      select.appendChild(opt);
    }
  });
}

// ---- Load Data ----
async function loadData() {
  showTableLoading();

  try {
    let query = db
      .from('assignment_anomali')
      .select('*')
      .order('first_seen', { ascending: false });

    // PPL: only their SLS
    if (currentProfile.role === 'ppl') {
      const { data: mySlsList } = await db.rpc('get_my_sls');
      const slsCodes = (mySlsList || []).map(r => r.kode_sls);
      if (slsCodes.length > 0) {
        query = query.in('kode_sls_gabungan', slsCodes);
      } else {
        allData = [];
        renderAll();
        return;
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    // Group by assignment_id
    allData = groupByAssignment(data || []);
    applyFilters();
  } catch (e) {
    console.error('loadData error:', e);
    showToast('Gagal memuat data: ' + e.message, 'error');
  }
}

// ---- Group rows by assignment_id ----
function groupByAssignment(rows) {
  const map = {};
  rows.forEach(row => {
    if (!map[row.assignment_id]) {
      map[row.assignment_id] = {
        assignment_id: row.assignment_id,
        kode_sls_gabungan: row.kode_sls_gabungan,
        kode_desa: row.kode_desa,
        kode_sls: row.kode_sls,
        kode_sub_sls: row.kode_sub_sls,
        nama_kk: null,
        nama_usaha_list: [],
        anomali_keluarga: [],
        anomali_usaha: [],
        is_ever_reopened: false,
        first_seen: row.first_seen,
        last_seen: row.last_seen,
        rows: []
      };
    }
    const asgn = map[row.assignment_id];
    asgn.rows.push(row);
    if (row.is_ever_reopened) asgn.is_ever_reopened = true;

    if (row.tipe === 'keluarga') {
      asgn.nama_kk = row.nama_entitas;
      asgn.anomali_keluarga.push(row);
    } else {
      if (row.nama_entitas && !asgn.nama_usaha_list.includes(row.nama_entitas)) {
        asgn.nama_usaha_list.push(row.nama_entitas);
      }
      asgn.anomali_usaha.push(row);
    }

    // Track earliest first_seen
    if (row.first_seen < asgn.first_seen) asgn.first_seen = row.first_seen;
    if (row.last_seen > asgn.last_seen) asgn.last_seen = row.last_seen;
  });

  return Object.values(map);
}

// ---- Determine keterangan for an assignment group ----
function getKeterangan(group) {
  const allDone = group.rows.every(r =>
    r.status === 'sesuai_kondisi' ||
    r.status === 'sudah_diperbaiki' ||
    r.status === 'tidak_terdeteksi_lagi'
  );
  return allDone ? 'selesai' : 'belum';
}

// ---- Determine jenis anomali ----
function getJenis(group) {
  const hasKK = group.anomali_keluarga.length > 0;
  const hasUsaha = group.anomali_usaha.length > 0;
  if (hasKK && hasUsaha) return 'keduanya';
  if (hasKK) return 'keluarga';
  return 'usaha';
}

// ---- Apply Filters ----
function applyFilters() {
  const status    = document.getElementById('filterStatus').value;
  const jenis     = document.getElementById('filterJenis').value;
  const nomor     = document.getElementById('filterNomor').value;
  const ket       = document.getElementById('filterKeterangan').value;
  const sls       = document.getElementById('filterSLS').value.trim().toLowerCase();
  const search    = document.getElementById('filterSearch').value.trim().toLowerCase();

  filteredData = allData.filter(group => {
    // Status filter: any row matches
    if (status && !group.rows.some(r => r.status === status)) return false;

    // Jenis filter
    const gjenis = getJenis(group);
    if (jenis && gjenis !== jenis) return false;

    // Nomor anomali filter
    if (nomor) {
      const [nTipe, nNomor] = nomor.split(':');
      if (!group.rows.some(r => r.tipe === nTipe && String(r.nomor_anomali) === nNomor)) return false;
    }

    // Keterangan filter
    if (ket) {
      const gket = getKeterangan(group);
      if (ket === 'belum' && gket !== 'belum') return false;
      if (ket === 'selesai' && gket !== 'selesai') return false;
    }

    // SLS filter
    if (sls && !group.kode_sls_gabungan.toLowerCase().includes(sls)) return false;

    // Search filter
    if (search) {
      const searchable = [
        group.assignment_id,
        group.nama_kk || '',
        ...group.nama_usaha_list
      ].join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }

    return true;
  });

  // Sort
  sortData();
  currentPage = 1;
  renderAll();
  updateFilterChips();
}

function applyFiltersDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 300);
}

function resetFilters() {
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterJenis').value = '';
  document.getElementById('filterNomor').value = '';
  document.getElementById('filterKeterangan').value = '';
  document.getElementById('filterSLS').value = '';
  document.getElementById('filterSearch').value = '';
  applyFilters();
}

// ---- Sort ----
function sortTable(field) {
  if (sortField === field) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDir = 'asc';
  }
  // Update sort icons
  document.querySelectorAll('thead th').forEach(th => th.classList.remove('sorted'));
  sortData();
  renderAll();
}

function sortData() {
  filteredData.sort((a, b) => {
    let va, vb;
    switch (sortField) {
      case 'assignment_id':   va = a.assignment_id;       vb = b.assignment_id; break;
      case 'kode_sls_gabungan': va = a.kode_sls_gabungan; vb = b.kode_sls_gabungan; break;
      case 'nama_kk':         va = a.nama_kk || '';       vb = b.nama_kk || ''; break;
      case 'nama_usaha':      va = a.nama_usaha_list[0] || ''; vb = b.nama_usaha_list[0] || ''; break;
      case 'keterangan':      va = getKeterangan(a);      vb = getKeterangan(b); break;
      case 'first_seen':      va = a.first_seen;          vb = b.first_seen; break;
      default:                va = a.first_seen;          vb = b.first_seen;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ---- Render ----
function renderAll() {
  const start = (currentPage - 1) * pageSize;
  const pageData = filteredData.slice(start, start + pageSize);

  renderTable(pageData);
  renderMobileCards(pageData);
  renderPagination();
  updateTableCount();
}

function renderTable(pageData) {
  const tbody = document.getElementById('tableBody');
  if (filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><div class="empty-state-title">Tidak ada data ditemukan</div><div class="empty-state-sub">Coba ubah filter atau reset pencarian</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = pageData.map(group => {
    const jenis = getJenis(group);
    const ket   = getKeterangan(group);
    const isReopened = group.is_ever_reopened && showReopenHighlight;
    const isSelected = selectedIds.has(group.assignment_id);

    const namaUsaha = group.nama_usaha_list.length > 0
      ? group.nama_usaha_list.slice(0, 2).join(', ') + (group.nama_usaha_list.length > 2 ? ` +${group.nama_usaha_list.length - 2}` : '')
      : '—';

    const anomaliStr = buildAnomaliString(group);

    return `<tr class="${isReopened ? 'reopened' : ''} ${isSelected ? 'selected' : ''}" data-id="${group.assignment_id}">
      <td class="col-checkbox">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${group.assignment_id}', this)" style="cursor:pointer;accent-color:var(--primary)">
      </td>
      <td>
        <div class="assignment-id-cell">${group.assignment_id.slice(0,8)}...</div>
        <a href="${buildFasihLink(group.assignment_id)}" target="_blank" rel="noopener" class="fasih-link" onclick="event.stopPropagation()">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          Fasih-SM
        </a>
        ${isReopened ? '<span class="reopen-badge">Re-open</span>' : ''}
      </td>
      <td><span class="sls-code">${group.kode_sls_gabungan || '—'}</span></td>
      <td>${group.nama_kk ? escHtml(group.nama_kk) : '<span style="color:var(--text-subtle)">—</span>'}</td>
      <td>${group.nama_usaha_list.length > 0 ? escHtml(namaUsaha) : '<span style="color:var(--text-subtle)">—</span>'}</td>
      <td><span class="type-badge type-${jenis}">${jenisLabel(jenis)}</span></td>
      <td><div class="anomali-list-str">${anomaliStr}</div></td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="openDetail('${group.assignment_id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          Tindak Lanjut
        </button>
      </td>
      <td>
        <span class="keterangan-${ket}">${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}</span>
      </td>
    </tr>`;
  }).join('');
}

function buildAnomaliString(group) {
  const parts = [];
  if (group.anomali_keluarga.length > 0) {
    const nums = [...new Set(group.anomali_keluarga.map(r => r.nomor_anomali))].join(', ');
    parts.push(`<strong>KK:</strong> #${nums}`);
  }
  if (group.anomali_usaha.length > 0) {
    const nums = [...new Set(group.anomali_usaha.map(r => r.nomor_anomali))].join(', ');
    parts.push(`<strong>Usaha:</strong> #${nums}`);
  }
  return parts.join(' &nbsp;|&nbsp; ') || '—';
}

function jenisLabel(jenis) {
  if (jenis === 'keluarga') return 'Keluarga';
  if (jenis === 'usaha') return 'Usaha';
  return 'KK & Usaha';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Mobile Cards ----
function renderMobileCards(pageData) {
  const container = document.getElementById('mobileCardList');
  if (filteredData.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Tidak ada data ditemukan</div></div>`;
    return;
  }
  container.innerHTML = pageData.map(group => {
    const jenis = getJenis(group);
    const ket   = getKeterangan(group);
    const isReopened = group.is_ever_reopened && showReopenHighlight;
    const isSelected = selectedIds.has(group.assignment_id);

    return `<div class="mobile-card ${isReopened ? 'reopened' : ''} ${isSelected ? 'selected' : ''}" data-id="${group.assignment_id}">
      <div class="mobile-card-header">
        <div>
          <div class="mobile-card-id">${group.assignment_id.slice(0,8)}... ${isReopened ? '<span class="reopen-badge">Re-open</span>' : ''}</div>
          <div class="mobile-card-name">${escHtml(group.nama_kk || group.nama_usaha_list[0] || '—')}</div>
        </div>
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${group.assignment_id}', this)" style="cursor:pointer;accent-color:var(--primary);width:18px;height:18px">
      </div>
      <div class="mobile-card-meta">
        <span class="type-badge type-${jenis}">${jenisLabel(jenis)}</span>
        <span class="chip">${group.kode_sls_gabungan}</span>
        <span class="keterangan-${ket}" style="font-size:0.8rem">${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}</span>
      </div>
      <div class="anomali-list-str" style="margin-bottom:0.75rem">${buildAnomaliString(group)}</div>
      <div class="mobile-card-footer">
        <a href="${buildFasihLink(group.assignment_id)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" onclick="event.stopPropagation()">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          Fasih-SM
        </a>
        <button class="btn btn-primary btn-sm" onclick="openDetail('${group.assignment_id}')">Tindak Lanjut</button>
      </div>
    </div>`;
  }).join('');
}

// ---- Pagination ----
function renderPagination() {
  const total = filteredData.length;
  const totalPages = Math.ceil(total / pageSize);
  const pag = document.getElementById('pagination');

  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  </button>`;

  // Show max 7 page buttons
  const delta = 3;
  const range = [];
  for (let i = Math.max(1, currentPage - delta); i <= Math.min(totalPages, currentPage + delta); i++) {
    range.push(i);
  }
  if (range[0] > 1) {
    html += `<button class="page-btn" onclick="goPage(1)">1</button>`;
    if (range[0] > 2) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
  }
  range.forEach(p => {
    html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
  });
  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
    html += `<button class="page-btn" onclick="goPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  </button>`;

  pag.innerHTML = html;
}

function goPage(p) {
  const totalPages = Math.ceil(filteredData.length / pageSize);
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changePageSize() {
  pageSize = parseInt(document.getElementById('pageSizeSelect').value);
  currentPage = 1;
  renderAll();
}

function updateTableCount() {
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, filteredData.length);
  const total = filteredData.length;
  const all = allData.length;
  let text = total === 0 ? 'Tidak ada data' :
    `Menampilkan ${start}–${end} dari ${total.toLocaleString('id')}`;
  if (total < all) text += ` (difilter dari ${all.toLocaleString('id')})`;
  document.getElementById('tableCount').textContent = text;
}

// ---- Selection ----
function toggleSelect(id, cb) {
  if (cb.checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
    document.getElementById('selectAll').checked = false;
  }
  updateFab();
  // Update row highlight
  document.querySelectorAll(`tr[data-id="${id}"], .mobile-card[data-id="${id}"]`).forEach(el => {
    el.classList.toggle('selected', cb.checked);
  });
}

function toggleSelectAll(cb) {
  const currentIds = filteredData
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .map(g => g.assignment_id);
  currentIds.forEach(id => {
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  updateFab();
  renderAll();
}

function clearSelection() {
  selectedIds.clear();
  document.getElementById('selectAll').checked = false;
  updateFab();
  renderAll();
}

function updateFab() {
  const count = selectedIds.size;
  const fab = document.getElementById('fabBar');
  document.getElementById('fabCount').textContent = `${count} baris dipilih`;
  fab.classList.toggle('visible', count > 0);
}

function copySelectedIds() {
  if (selectedIds.size === 0) return;
  const text = Array.from(selectedIds).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast(`${selectedIds.size} Assignment ID disalin ke clipboard`, 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`${selectedIds.size} Assignment ID disalin`, 'success');
  });
}

// ---- Reopen Highlight Toggle ----
function toggleReopenHighlight() {
  showReopenHighlight = !showReopenHighlight;
  const btn = document.getElementById('reopenToggle');
  btn.classList.toggle('btn-primary', showReopenHighlight);
  btn.classList.toggle('btn-secondary', !showReopenHighlight);
  renderAll();
}

// ---- Filter Chips ----
function updateFilterChips() {
  const bar = document.getElementById('filterActiveBar');
  const chips = [];
  const status = document.getElementById('filterStatus').value;
  const jenis  = document.getElementById('filterJenis').value;
  const nomor  = document.getElementById('filterNomor').value;
  const ket    = document.getElementById('filterKeterangan').value;
  const sls    = document.getElementById('filterSLS').value.trim();
  const search = document.getElementById('filterSearch').value.trim();

  if (status) chips.push({ label: `Status: ${STATUS_CONFIG[status]?.label}`, clear: () => { document.getElementById('filterStatus').value = ''; applyFilters(); } });
  if (jenis)  chips.push({ label: `Jenis: ${jenisLabel(jenis)}`, clear: () => { document.getElementById('filterJenis').value = ''; applyFilters(); } });
  if (nomor)  chips.push({ label: `Nomor: ${nomor.split(':')[1]} (${nomor.split(':')[0] === 'keluarga' ? 'KK' : 'Usaha'})`, clear: () => { document.getElementById('filterNomor').value = ''; applyFilters(); } });
  if (ket)    chips.push({ label: `Ket: ${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}`, clear: () => { document.getElementById('filterKeterangan').value = ''; applyFilters(); } });
  if (sls)    chips.push({ label: `SLS: ${sls}`, clear: () => { document.getElementById('filterSLS').value = ''; applyFilters(); } });
  if (search) chips.push({ label: `Cari: "${search}"`, clear: () => { document.getElementById('filterSearch').value = ''; applyFilters(); } });

  bar.innerHTML = chips.map((c, i) =>
    `<span class="filter-active-chip" onclick="(${c.clear.toString()})()">
      ${escHtml(c.label)}
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
    </span>`
  ).join('');
}

// ---- Table Loading ----
function showTableLoading() {
  document.getElementById('tableBody').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:3rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></td></tr>`;
  document.getElementById('mobileCardList').innerHTML = `<div style="text-align:center;padding:3rem"><div class="spinner" style="margin:0 auto"></div></div>`;
}

// ---- Toast ----
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const id = 'toast-' + Date.now();
  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };
  const toast = document.createElement('div');
  toast.id = id;
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || ''}<span style="flex:1">${escHtml(message)}</span><button class="toast-close" onclick="document.getElementById('${id}').remove()"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg></button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
    document.getElementById('iconSun').classList.remove('hidden');
    document.getElementById('iconMoon').classList.add('hidden');
  }
}
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('iconSun').classList.toggle('hidden', !isDark);
  document.getElementById('iconMoon').classList.toggle('hidden', isDark);
}

// ---- Init on load ----
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  const session = (async () => {
    const s = await getSession();
    if (!s || !s.profile) { window.location.href = '/login.html'; return; }
    if (s.profile.role === 'admin' && !sessionStorage.getItem('admin_session_name')) {
      document.getElementById('adminNameModal').classList.add('open');
    } else {
      initDashboard();
    }
  })();
});
