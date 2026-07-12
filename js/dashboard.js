// ============================================================
// DASHBOARD.JS — Main dashboard logic
// Depends on: config.js, utils.js, auth.js
// ============================================================

let currentProfile  = null;
let allData         = [];   // grouped by assignment_id
let filteredData    = [];
let selectedIds     = new Set();
let currentPage     = 1;
let pageSize        = 25;
let sortField       = 'first_seen';
let sortDir         = 'desc';
let showReopenHighlight = false;
let debounceTimer   = null;

// ============================================================
// INIT
// ============================================================
async function initDashboard() {
  const session = await getSession();
  currentProfile = session?.profile || null;

  const userDisplayName = document.getElementById('userDisplayName');
  const userRoleBadge   = document.getElementById('userRoleBadge');
  const loginNavBtn     = document.getElementById('loginNavBtn');
  const logoutNavBtn    = document.getElementById('logoutNavBtn');
  const adminNavBtn     = document.getElementById('adminNavBtn');

  if (currentProfile) {
    const name = getSessionName(currentProfile);
    if (userDisplayName) userDisplayName.textContent = name;
    if (userRoleBadge) {
      userRoleBadge.textContent = currentProfile.role.toUpperCase();
      userRoleBadge.className = `type-badge type-${
        currentProfile.role === 'ppl' ? 'keluarga' :
        currentProfile.role === 'pml' ? 'usaha' : 'keduanya'}`;
      userRoleBadge.style.display = 'inline-block';
    }
    loginNavBtn?.classList.add('hidden');
    logoutNavBtn?.classList.remove('hidden');
    const isAdmin = ['superadmin', 'admin'].includes(currentProfile.role);
    adminNavBtn?.classList.toggle('hidden', !isAdmin);
  } else {
    if (userDisplayName) userDisplayName.textContent = 'Guest';
    if (userRoleBadge)   userRoleBadge.style.display = 'none';
    loginNavBtn?.classList.remove('hidden');
    logoutNavBtn?.classList.add('hidden');
    adminNavBtn?.classList.add('hidden');
  }

  // Run stats + dropdown options in parallel with the main table data
  await Promise.all([loadStats(), loadAnomalinomorOptions(), loadData()]);
}

// ============================================================
// STATS
// ============================================================
async function loadStats() {
  try {
    const { data, error } = await db.rpc('get_dashboard_stats', {
      p_user_id: currentProfile?.id || null,
      p_role: currentProfile?.role || 'guest'
    });

    if (!error && data) {
      renderStats(data.total, data.belum, data.selesai, data.progress);
      return;
    }

    // Fallback: fungsi RPC belum dijalankan di database.
    // Gunakan count cepat per tipe status dari server, tanpa mengambil raw rows.
    console.warn('get_dashboard_stats tidak tersedia, menggunakan fallback count');
    const buildCount = (statusFilter) => {
      let q = db.from('assignment_anomali')
        .select('assignment_id', { count: 'exact', head: false })
        .limit(50000);
      if (currentProfile?.role === 'ppl')      q = q.eq('tipe', 'keluarga');
      else if (currentProfile?.role === 'pml') q = q.eq('tipe', 'usaha');
      if (statusFilter) q = q.eq('status', statusFilter);
      return q;
    };

    // Ambil semua baris assignment_id + status (hanya 2 kolom, cepat)
    let baseQ = db.from('assignment_anomali')
      .select('assignment_id, status')
      .limit(50000);
    if (currentProfile?.role === 'ppl') {
      baseQ = baseQ.eq('tipe', 'keluarga');
      const { data: sl } = await db.rpc('get_my_sls');
      const codes = (sl || []).map(r => r.kode_sls);
      if (codes.length > 0) baseQ = baseQ.in('kode_sls_gabungan', codes);
    } else if (currentProfile?.role === 'pml') {
      baseQ = baseQ.eq('tipe', 'usaha');
      const { data: sl } = await db.rpc('get_pml_sls');
      const codes = (sl || []).map(r => r.kode_sls);
      if (codes.length > 0) baseQ = baseQ.in('kode_sls_gabungan', codes);
    }
    const { data: rows, error: rowErr } = await baseQ;
    if (rowErr) throw rowErr;

    const map = {};
    (rows || []).forEach(r => {
      if (!map[r.assignment_id]) map[r.assignment_id] = [];
      map[r.assignment_id].push(r.status);
    });
    const DONE     = new Set(['sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi']);
    const total    = Object.keys(map).length;
    const selesai  = Object.values(map).filter(ss => ss.every(s => DONE.has(s))).length;
    const belum    = total - selesai;
    const progress = total > 0 ? Math.round((selesai / total) * 100) : 0;
    renderStats(total, belum, selesai, progress);
  } catch (e) {
    console.error('loadStats error:', e);
  }
}

function renderStats(total, belum, selesai, progress) {
  const safe = v => (v ?? 0);
  document.getElementById('statTotal').textContent    = safe(total).toLocaleString('id');
  document.getElementById('statBelum').textContent    = safe(belum).toLocaleString('id');
  document.getElementById('statSelesai').textContent  = safe(selesai).toLocaleString('id');
  document.getElementById('statProgress').textContent = `${safe(progress)}%`;
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = `${safe(progress)}%`;
}


// ============================================================
// DATA LOADING
// ============================================================
async function loadAnomalinomorOptions() {
  const { data } = await db.from('anomali_ref')
    .select('nomor, tipe')
    .order('nomor');
  const select = document.getElementById('filterNomor');
  if (!select) return;
  // Clear existing options except first
  while (select.options.length > 1) {
    select.remove(1);
  }
  const seen = new Set();
  (data || []).forEach(row => {
    const key = `${row.tipe}:${row.nomor}`;
    if (seen.has(key)) return;
    seen.add(key);
    const opt = document.createElement('option');
    opt.value       = key;
    opt.textContent = `Anomali ${row.nomor} (${row.tipe === 'keluarga' ? 'KK' : 'Usaha'})`;
    select.appendChild(opt);
  });
}

async function loadData() {
  showTableLoading();
  try {
    const COLS = 'id, assignment_id, tipe, nama_entitas, kode_desa, kode_sls, kode_sub_sls, kode_sls_gabungan, nomor_anomali, status, first_seen, last_seen, is_ever_reopened';

    // Baca filter aktif dari UI
    const status = document.getElementById('filterStatus')?.value;
    const jenis  = document.getElementById('filterJenis')?.value;
    const nomor  = document.getElementById('filterNomor')?.value;
    const ket    = document.getElementById('filterKeterangan')?.value;
    const sls    = document.getElementById('filterSLS')?.value.trim();
    const search = document.getElementById('filterSearch')?.value.trim();

    // Builder: buat query dengan semua filter kecuali tipe
    const buildQuery = (tipeOverride) => {
      let q = db.from('assignment_anomali').select(COLS).order('first_seen', { ascending: false });
      if (tipeOverride) q = q.eq('tipe', tipeOverride);
      if (status) q = q.eq('status', status);
      if (nomor) {
        const [nTipe, nNomor] = nomor.split(':');
        q = q.eq('tipe', nTipe).eq('nomor_anomali', parseInt(nNomor));
      }
      if (ket === 'selesai') q = q.in('status', ['sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi']);
      else if (ket === 'belum') q = q.eq('status', 'belum_ditindaklanjuti');
      if (sls)    q = q.ilike('kode_sls_gabungan', `%${sls}%`);
      if (search) q = q.or(`assignment_id.ilike.%${search}%,nama_entitas.ilike.%${search}%`);
      q = q.limit(1000);
      return q;
    };

    // Tambahkan filter SLS berdasarkan role
    const applyRoleFilter = async (q, tipe) => {
      if (currentProfile?.role === 'ppl') {
        const { data: sl } = await db.rpc('get_my_sls');
        const codes = (sl || []).map(r => r.kode_sls);
        if (codes.length === 0) return null;
        return q.in('kode_sls_gabungan', codes);
      } else if (currentProfile?.role === 'pml') {
        const { data: sl } = await db.rpc('get_pml_sls');
        const codes = (sl || []).map(r => r.kode_sls);
        if (codes.length === 0) return null;
        return q.in('kode_sls_gabungan', codes);
      }
      return q;
    };

    let rows = [];

    if (jenis === 'keduanya') {
      // Ambil kedua tipe secara paralel, lalu tampilkan hanya assignment_id yang ada di KEDUANYA
      const [qKK, qUsaha] = await Promise.all([
        applyRoleFilter(buildQuery('keluarga'), 'keluarga'),
        applyRoleFilter(buildQuery('usaha'),    'usaha')
      ]);
      if (!qKK || !qUsaha) { allData = []; filteredData = []; renderAll(); return; }
      const [resKK, resUsaha] = await Promise.all([qKK, qUsaha]);
      if (resKK.error) throw resKK.error;
      if (resUsaha.error) throw resUsaha.error;

      // Intersect: hanya assignment_id yang muncul di kedua tipe
      const kkIds    = new Set((resKK.data || []).map(r => r.assignment_id));
      const usahaIds = new Set((resUsaha.data || []).map(r => r.assignment_id));
      const bothIds  = new Set([...kkIds].filter(id => usahaIds.has(id)));
      rows = [
        ...(resKK.data   || []).filter(r => bothIds.has(r.assignment_id)),
        ...(resUsaha.data || []).filter(r => bothIds.has(r.assignment_id))
      ];
    } else {
      // Tipe tunggal atau semua tipe (admin)
      let tipeFilter = null;
      if (currentProfile?.role === 'ppl')      tipeFilter = 'keluarga';
      else if (currentProfile?.role === 'pml') tipeFilter = 'usaha';
      else if (jenis && jenis !== 'keduanya')   tipeFilter = jenis;

      let q = buildQuery(tipeFilter);
      q = await applyRoleFilter(q, tipeFilter);
      if (!q) { allData = []; filteredData = []; renderAll(); return; }
      const { data, error } = await q;
      if (error) throw error;
      rows = data || [];
    }

    allData = groupByAssignment(rows);
    filteredData = [...allData];
    sortData();
    renderAll();
    updateFilterChips();
  } catch (e) {
    console.error('loadData error:', e);
    showToast('Gagal memuat data: ' + e.message, 'error');
  }
}

// ============================================================
// DATA PROCESSING
// ============================================================
function groupByAssignment(rows) {
  const map = {};
  rows.forEach(row => {
    if (!map[row.assignment_id]) {
      map[row.assignment_id] = {
        assignment_id:     row.assignment_id,
        kode_sls_gabungan: row.kode_sls_gabungan,
        kode_desa:         row.kode_desa,
        kode_sls:          row.kode_sls,
        kode_sub_sls:      row.kode_sub_sls,
        nama_kk:           null,
        nama_usaha_list:   [],
        anomali_keluarga:  [],
        anomali_usaha:     [],
        is_ever_reopened:  false,
        first_seen:        row.first_seen,
        last_seen:         row.last_seen,
        rows:              []
      };
    }
    const asgn = map[row.assignment_id];
    asgn.rows.push(row);
    if (row.is_ever_reopened) asgn.is_ever_reopened = true;
    if (row.tipe === 'keluarga') {
      asgn.nama_kk = row.nama_entitas;
      asgn.anomali_keluarga.push(row);
    } else {
      if (row.nama_entitas && !asgn.nama_usaha_list.includes(row.nama_entitas))
        asgn.nama_usaha_list.push(row.nama_entitas);
      asgn.anomali_usaha.push(row);
    }
    if (row.first_seen < asgn.first_seen) asgn.first_seen = row.first_seen;
    if (row.last_seen  > asgn.last_seen)  asgn.last_seen  = row.last_seen;
  });
  return Object.values(map);
}

const DONE_STATUSES = new Set(['sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi']);

function getKeterangan(group) {
  return group.rows.every(r => DONE_STATUSES.has(r.status)) ? 'selesai' : 'belum';
}

function getJenis(group) {
  const hasKK    = group.anomali_keluarga.length > 0;
  const hasUsaha = group.anomali_usaha.length > 0;
  if (hasKK && hasUsaha) return 'keduanya';
  return hasKK ? 'keluarga' : 'usaha';
}

function jenisLabel(jenis) {
  return jenis === 'keluarga' ? 'Keluarga' : jenis === 'usaha' ? 'Usaha' : 'KK & Usaha';
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

// ============================================================
// FILTER & SORT
// ============================================================
function applyFilters() {
  currentPage = 1;
  loadData();
}

function applyFiltersDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 300);
}

function resetFilters() {
  ['filterStatus', 'filterJenis', 'filterNomor', 'filterKeterangan', 'filterSLS', 'filterSearch']
    .forEach(id => { document.getElementById(id).value = ''; });
  applyFilters();
}

function sortTable(field) {
  sortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
  sortField = field;
  sortData();
  renderAll();
}

function sortData() {
  filteredData.sort((a, b) => {
    const getVal = g => {
      switch (sortField) {
        case 'assignment_id':     return g.assignment_id;
        case 'kode_sls_gabungan': return g.kode_sls_gabungan;
        case 'nama_kk':           return g.nama_kk || '';
        case 'nama_usaha':        return g.nama_usaha_list[0] || '';
        case 'keterangan':        return getKeterangan(g);
        default:                  return g.first_seen;
      }
    };
    const va = getVal(a), vb = getVal(b);
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  const start    = (currentPage - 1) * pageSize;
  const pageData = filteredData.slice(start, start + pageSize);
  renderTable(pageData);
  renderMobileCards(pageData);
  renderPagination();
  updateTableCount();
}

function renderTable(pageData) {
  const tbody = document.getElementById('tableBody');
  if (filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
      <div class="empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div class="empty-state-title">Tidak ada data ditemukan</div>
      <div class="empty-state-sub">Coba ubah filter atau reset pencarian</div>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = pageData.map(group => {
    const jenis      = getJenis(group);
    const ket        = getKeterangan(group);
    const isReopened = group.is_ever_reopened && showReopenHighlight;
    const isSelected = selectedIds.has(group.assignment_id);
    const namaUsaha  = group.nama_usaha_list.length > 0
      ? group.nama_usaha_list.slice(0, 2).join(', ') + (group.nama_usaha_list.length > 2 ? ` +${group.nama_usaha_list.length - 2}` : '')
      : '—';

    return `<tr class="${isReopened ? 'reopened' : ''} ${isSelected ? 'selected' : ''}" data-id="${group.assignment_id}">
      <td class="col-checkbox">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${group.assignment_id}', this)" style="cursor:pointer;accent-color:var(--primary)">
      </td>
      <td>
        <div class="assignment-id-cell">${group.assignment_id.slice(0, 8)}...</div>
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
      <td><div class="anomali-list-str">${buildAnomaliString(group)}</div></td>
      <td style="text-align:center"><strong>${group.rows.length}</strong></td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="openDetail('${group.assignment_id}')">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          Aksi
        </button>
      </td>
      <td><span class="keterangan-${ket}">${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}</span></td>
    </tr>`;
  }).join('');
}

function renderMobileCards(pageData) {
  const container = document.getElementById('mobileCardList');
  if (filteredData.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Tidak ada data ditemukan</div></div>`;
    return;
  }
  container.innerHTML = pageData.map(group => {
    const jenis      = getJenis(group);
    const ket        = getKeterangan(group);
    const isReopened = group.is_ever_reopened && showReopenHighlight;
    const isSelected = selectedIds.has(group.assignment_id);
    return `<div class="mobile-card ${isReopened ? 'reopened' : ''} ${isSelected ? 'selected' : ''}" data-id="${group.assignment_id}">
      <div class="mobile-card-header">
        <div>
          <div class="mobile-card-id">${group.assignment_id.slice(0, 8)}... ${isReopened ? '<span class="reopen-badge">Re-open</span>' : ''}</div>
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
        <button class="btn btn-primary btn-sm" onclick="openDetail('${group.assignment_id}')">Aksi</button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// PAGINATION
// ============================================================
function renderPagination() {
  const total      = filteredData.length;
  const totalPages = Math.ceil(total / pageSize);
  const pag        = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  const prevBtn = `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>`;
  const nextBtn = `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>`;

  const range = [];
  for (let i = Math.max(1, currentPage - 3); i <= Math.min(totalPages, currentPage + 3); i++) range.push(i);

  let pageButtons = '';
  if (range[0] > 1) {
    pageButtons += `<button class="page-btn" onclick="goPage(1)">1</button>`;
    if (range[0] > 2) pageButtons += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
  }
  range.forEach(p => { pageButtons += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`; });
  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) pageButtons += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
    pageButtons += `<button class="page-btn" onclick="goPage(${totalPages})">${totalPages}</button>`;
  }

  pag.innerHTML = prevBtn + pageButtons + nextBtn;
}

function goPage(p) {
  const totalPages = Math.ceil(filteredData.length / pageSize);
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changePageSize() {
  pageSize    = parseInt(document.getElementById('pageSizeSelect').value);
  currentPage = 1;
  renderAll();
}

function updateTableCount() {
  const start   = (currentPage - 1) * pageSize + 1;
  const end     = Math.min(currentPage * pageSize, filteredData.length);
  const total   = filteredData.length;
  const all     = allData.length;
  const dbTotal = document.getElementById('statTotal')?.textContent || '0';

  // Cek apakah ada filter aktif yang membatasi dataset
  const hasActiveFilters = document.getElementById('filterStatus')?.value ||
                           document.getElementById('filterJenis')?.value ||
                           document.getElementById('filterNomor')?.value ||
                           document.getElementById('filterKeterangan')?.value ||
                           document.getElementById('filterSLS')?.value.trim() ||
                           document.getElementById('filterSearch')?.value.trim();

  let text = total === 0 
    ? 'Tidak ada data' 
    : `Menampilkan ${start}–${end} dari ${hasActiveFilters ? total.toLocaleString('id') : dbTotal}`;
  if (hasActiveFilters && total < all) {
    text += ` (difilter dari ${dbTotal})`;
  }
  document.getElementById('tableCount').textContent = text;
}

// ============================================================
// SELECTION
// ============================================================
function toggleSelect(id, cb) {
  if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
  if (!cb.checked) document.getElementById('selectAll').checked = false;
  updateFab();
  document.querySelectorAll(`tr[data-id="${id}"], .mobile-card[data-id="${id}"]`)
    .forEach(el => el.classList.toggle('selected', cb.checked));
}

function toggleSelectAll(cb) {
  const ids = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(g => g.assignment_id);
  ids.forEach(id => { if (cb.checked) selectedIds.add(id); else selectedIds.delete(id); });
  updateFab();
  renderAll();
}

function clearSelection() {
  selectedIds.clear();
  document.getElementById('selectAll').checked = false;
  updateFab(); renderAll();
}

function updateFab() {
  const count = selectedIds.size;
  document.getElementById('fabCount').textContent = `${count} baris dipilih`;
  document.getElementById('fabBar').classList.toggle('visible', count > 0);
}

function copySelectedIds() {
  if (!selectedIds.size) return;
  const text = Array.from(selectedIds).join('\n');
  navigator.clipboard.writeText(text)
    .then(() => showToast(`${selectedIds.size} Assignment ID disalin ke clipboard`, 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(`${selectedIds.size} Assignment ID disalin`, 'success');
    });
}

// ============================================================
// UI HELPERS
// ============================================================
function toggleReopenHighlight() {
  showReopenHighlight = !showReopenHighlight;
  const btn = document.getElementById('reopenToggle');
  btn.classList.toggle('btn-primary',   showReopenHighlight);
  btn.classList.toggle('btn-secondary', !showReopenHighlight);
  renderAll();
}

function updateFilterChips() {
  const bar    = document.getElementById('filterActiveBar');
  const status = document.getElementById('filterStatus').value;
  const jenis  = document.getElementById('filterJenis').value;
  const nomor  = document.getElementById('filterNomor').value;
  const ket    = document.getElementById('filterKeterangan').value;
  const sls    = document.getElementById('filterSLS').value.trim();
  const search = document.getElementById('filterSearch').value.trim();

  const chips = [
    status && { label: `Status: ${STATUS_CONFIG[status]?.label}`,  clear: () => { document.getElementById('filterStatus').value = ''; applyFilters(); } },
    jenis  && { label: `Jenis: ${jenisLabel(jenis)}`,              clear: () => { document.getElementById('filterJenis').value  = ''; applyFilters(); } },
    nomor  && { label: `Nomor: ${nomor.split(':')[1]} (${nomor.split(':')[0] === 'keluarga' ? 'KK' : 'Usaha'})`, clear: () => { document.getElementById('filterNomor').value = ''; applyFilters(); } },
    ket    && { label: `Ket: ${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}`, clear: () => { document.getElementById('filterKeterangan').value = ''; applyFilters(); } },
    sls    && { label: `SLS: ${sls}`,                              clear: () => { document.getElementById('filterSLS').value    = ''; applyFilters(); } },
    search && { label: `Cari: "${search}"`,                        clear: () => { document.getElementById('filterSearch').value = ''; applyFilters(); } }
  ].filter(Boolean);

  bar.innerHTML = chips.map(c =>
    `<span class="filter-active-chip" onclick="(${c.clear.toString()})()">
      ${escHtml(c.label)}
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
    </span>`
  ).join('');
}

function showTableLoading() {
  const spinner = `<div class="spinner" style="margin:0 auto"></div>`;
  document.getElementById('tableBody').innerHTML = `<tr><td colspan="9" style="text-align:center;padding:3rem;color:var(--text-muted)">${spinner}</td></tr>`;
  document.getElementById('mobileCardList').innerHTML = `<div style="text-align:center;padding:3rem">${spinner}</div>`;
}

// ============================================================
// BOOTSTRAP
// ============================================================
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    const s = await getSession();
    if (s?.profile?.role === 'admin' && !sessionStorage.getItem('admin_session_name')) {
      document.getElementById('adminNameModal')?.classList.add('open');
    } else {
      initDashboard();
    }
  })();
});
