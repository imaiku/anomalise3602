// ============================================================
// DASHBOARD.JS — Main dashboard logic
// Depends on: config.js, utils.js, auth.js
// ============================================================

let currentProfile  = null;
let allData         = [];   // grouped by assignment_id
let filteredData    = [];
let selectedIds     = new Set();
let currentPage     = 1;
let pageSize        = 10;
let sortField       = 'first_seen';
let sortDir         = 'desc';
let showReopenHighlight = false;
let debounceTimer   = null;
let kecProgressData = [];

// ============================================================
// INIT
// ============================================================
async function initDashboard() {
  const session = await getSession();
  currentProfile = session?.profile || null;

  const userDisplayName = document.getElementById('userDisplayName');
  const userRoleBadge   = document.getElementById('userRoleBadge');
  const loginNavBtn     = document.getElementById('loginNavBtn');
  const adminNavBtn     = document.getElementById('adminNavBtn');
  const profileDropdown = document.getElementById('profileDropdown');
  const reopenToggle    = document.getElementById('reopenToggle');

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
    profileDropdown?.classList.remove('hidden');
    
    const isAdmin = ['superadmin', 'admin'].includes(currentProfile.role.toLowerCase());
    adminNavBtn?.classList.toggle('hidden', !isAdmin);
    document.getElementById('adminNavDivider')?.classList.toggle('hidden', !isAdmin);
    reopenToggle?.classList.toggle('hidden', !isAdmin);

    const rejectFilter = document.getElementById('filterReject');
    if (rejectFilter) {
      rejectFilter.classList.toggle('hidden', !isAdmin);
    }

    const showPetugasFilter = !['ppl', 'pml'].includes(currentProfile.role.toLowerCase());
    const container = document.getElementById('petugasFilterContainer');
    if (container) {
      container.classList.toggle('hidden', !showPetugasFilter);
    }
  } else {
    if (userDisplayName) userDisplayName.textContent = 'Guest';
    if (userRoleBadge)   userRoleBadge.style.display = 'none';
    loginNavBtn?.classList.remove('hidden');
    profileDropdown?.classList.add('hidden');
    adminNavBtn?.classList.add('hidden');
    reopenToggle?.classList.add('hidden');
    
    const rejectFilter = document.getElementById('filterReject');
    if (rejectFilter) rejectFilter.classList.add('hidden');

    // Guest gets access to filterPetugas container
    const container = document.getElementById('petugasFilterContainer');
    if (container) {
      container.classList.remove('hidden');
    }
  }

  // Run stats + dropdown options in parallel with the main table data
  await Promise.all([loadStats(), loadAnomalinomorOptions(), loadWilayahOptions(), loadKecamatanProgress(), loadData()]);
}

// ============================================================
// PETUGAS AUTOCOMPLETE SEARCH (Guest & Admin)
// ============================================================
let selectedPetugas = null;
let searchDebounce = null;

async function onPetugasSearchInput(val) {
  const suggestionsDiv = document.getElementById('petugasSuggestions');
  const btnClear = document.getElementById('btnClearPetugas');
  if (!suggestionsDiv) return;

  if (!val.trim()) {
    suggestionsDiv.innerHTML = '';
    suggestionsDiv.style.display = 'none';
    if (btnClear) btnClear.style.display = 'none';
    return;
  }

  if (btnClear) btnClear.style.display = 'flex';

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    try {
      let data = [];
      let dbError = null;
      
      // Coba panggil RPC search_petugas (aman untuk guest)
      const rpcRes = await db.rpc('search_petugas', { p_query: val.trim() });
      if (!rpcRes.error) {
        data = rpcRes.data || [];
      } else {
        dbError = rpcRes.error;
        // Fallback untuk Admin/Superadmin jika RPC belum didefinisikan di database
        const isAdmin = currentProfile && ['superadmin', 'admin'].includes(currentProfile.role);
        if (isAdmin) {
          const { data: fallbackData, error: fallbackError } = await db
            .from('profiles')
            .select('id, role, nama, email_ref')
            .in('role', ['ppl', 'pml'])
            .eq('is_active', true)
            .or(`email_ref.ilike.%${val.trim()}%,nama.ilike.%${val.trim()}%`)
            .limit(10);
          if (!fallbackError) {
            data = fallbackData || [];
            dbError = null; // Teratasi oleh fallback
          } else {
            dbError = fallbackError;
            console.error('Fallback query error:', fallbackError);
          }
        } else {
          console.error('RPC search_petugas error:', rpcRes.error);
        }
      }

      if (dbError) {
        suggestionsDiv.innerHTML = `<div style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--error)">Database Error: ${escHtml(dbError.message || 'Gagal terhubung')}</div>`;
        suggestionsDiv.style.display = 'block';
        return;
      }

      if (data.length === 0) {
        suggestionsDiv.innerHTML = `<div style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-subtle)">Tidak ada petugas ditemukan</div>`;
        suggestionsDiv.style.display = 'block';
        return;
      }

      suggestionsDiv.innerHTML = data.map(p => {
        const safeNama = p.nama.replace(/'/g, "\\'");
        const safeEmail = (p.email_ref || '').replace(/'/g, "\\'");
        return `
          <div class="suggestion-item" 
               style="padding:0.5rem 0.75rem;cursor:pointer;font-size:0.8rem;border-bottom:1px solid var(--border);color:var(--text);transition:background 0.15s" 
               onclick="selectPetugas('${p.id}', '${p.role}', '${safeNama}', '${safeEmail}')"
               onmouseover="this.style.background='var(--border)'" 
               onmouseout="this.style.background='none'">
            <strong>${escHtml(p.nama)}</strong> (${p.role.toUpperCase()}) <br/>
            <span style="font-size:0.7rem;color:var(--text-subtle)">${escHtml(p.email_ref || '—')}</span>
          </div>
        `;
      }).join('');
      suggestionsDiv.style.display = 'block';
    } catch (err) {
      console.error('Error searching petugas:', err);
    }
  }, 250);
}

function selectPetugas(id, role, nama, email) {
  selectedPetugas = { id, role, nama, email };
  
  const input = document.getElementById('filterPetugasInput');
  if (input) {
    input.value = `${nama} (${role.toUpperCase()})`;
  }
  
  const suggestionsDiv = document.getElementById('petugasSuggestions');
  if (suggestionsDiv) suggestionsDiv.style.display = 'none';
  
  const btnClear = document.getElementById('btnClearPetugas');
  if (btnClear) btnClear.style.display = 'flex';
  
  applyFilters();
}

function clearSelectedPetugas() {
  selectedPetugas = null;
  
  const input = document.getElementById('filterPetugasInput');
  if (input) input.value = '';
  
  const btnClear = document.getElementById('btnClearPetugas');
  if (btnClear) btnClear.style.display = 'none';
  
  const suggestionsDiv = document.getElementById('petugasSuggestions');
  if (suggestionsDiv) suggestionsDiv.style.display = 'none';
  
  applyFilters();
}

// Close autocomplete suggestions on clicking outside
document.addEventListener('click', (e) => {
  const container = document.getElementById('petugasFilterContainer');
  if (container && !container.contains(e.target)) {
    const suggestions = document.getElementById('petugasSuggestions');
    if (suggestions) suggestions.style.display = 'none';
  }
});

// ============================================================
// STATS
// ============================================================
async function loadStats() {
  try {
    let statsUserId = currentProfile?.id || null;
    let statsRole = (currentProfile?.role || 'guest').toLowerCase();

    // Keep statsUserId and statsRole as the logged-in user to keep the top stats intact.

    const { data, error } = await db.rpc('get_dashboard_stats', {
      p_user_id: statsUserId,
      p_role: statsRole
    });

    if (!error && data) {
      renderStats(
        data.total, data.belum, data.selesai, data.progress,
        data.anomali_total, data.anomali_belum, data.anomali_selesai
      );
      return;
    }

    // Fallback: fungsi RPC belum dijalankan di database.
    console.warn('get_dashboard_stats tidak tersedia, menggunakan fallback');
    // Ambil semua baris assignment_id + status (hanya 3 kolom, cepat)
    let baseQ = db.from('assignment_anomali')
      .select('assignment_id, status, show_anomaly')
      .limit(50000);
    if (statsRole === 'ppl') {
      baseQ = baseQ.eq('tipe', 'keluarga');
      const { data: sl } = await db.from('user_sls').select('kode_sls').eq('user_id', statsUserId).eq('status', 'aktif');
      const codes = (sl || []).map(r => r.kode_sls);
      if (codes.length > 0) baseQ = baseQ.in('kode_sls_gabungan', codes);
      else baseQ = baseQ.in('kode_sls_gabungan', ['NONE']);
    } else if (statsRole === 'pml') {
      baseQ = baseQ.eq('tipe', 'usaha');
      const { data: ppls } = await db.from('pml_ppl').select('ppl_id').eq('pml_id', statsUserId);
      const pplIds = (ppls || []).map(r => r.ppl_id);
      if (pplIds.length > 0) {
        const { data: sl } = await db.from('user_sls').select('kode_sls').eq('status', 'aktif').in('user_id', pplIds);
        const codes = (sl || []).map(r => r.kode_sls);
        if (codes.length > 0) baseQ = baseQ.in('kode_sls_gabungan', codes);
        else baseQ = baseQ.in('kode_sls_gabungan', ['NONE']);
      } else {
        baseQ = baseQ.in('kode_sls_gabungan', ['NONE']);
      }
    }
    const { data: rows, error: rowErr } = await baseQ;
    if (rowErr) throw rowErr;

    const map = {};
    const DONE = new Set(['sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi']);
    let anomaliTotal = 0;
    let anomaliSelesai = 0;
    let anomaliBelum = 0;

    const isPetugas = ['ppl', 'pml'].includes(statsRole);
    (rows || []).forEach(r => {
      if (isPetugas && r.show_anomaly === false) return; // Skip hidden anomalies

      anomaliTotal++;
      if (DONE.has(r.status)) anomaliSelesai++; else anomaliBelum++;

      if (!map[r.assignment_id]) map[r.assignment_id] = [];
      map[r.assignment_id].push(r.status);
    });

    const total    = Object.keys(map).length;
    const selesai  = Object.values(map).filter(ss => ss.every(s => DONE.has(s))).length;
    const belum    = total - selesai;
    const progress = total > 0 ? Math.round((selesai / total) * 100) : 0;
    
    renderStats(total, belum, selesai, progress, anomaliTotal, anomaliBelum, anomaliSelesai);
  } catch (e) {
    console.error('loadStats error:', e);
  }
}

function renderStats(total, belum, selesai, progress, anomTotal = 0, anomBelum = 0, anomSelesai = 0) {
  const safe = v => (v ?? 0);
  
  // Render Nilai Utama (Assignment)
  document.getElementById('statTotal').textContent    = safe(total).toLocaleString('id');
  document.getElementById('statBelum').textContent    = safe(belum).toLocaleString('id');
  document.getElementById('statSelesai').textContent  = safe(selesai).toLocaleString('id');
  document.getElementById('statProgress').textContent = `${safe(progress)}%`;
  
  // Render Sub-Label (Detail Kasus Anomali) - Inline and Shortened
  document.getElementById('statTotalSub').innerHTML    = `assignment unik <span style="font-size:0.75rem;color:var(--text-subtle)">(${safe(anomTotal).toLocaleString('id')} kasus)</span>`;
  document.getElementById('statBelumSub').innerHTML    = `ada pending <span style="font-size:0.75rem;color:var(--text-subtle)">(${safe(anomBelum).toLocaleString('id')} kasus)</span>`;
  document.getElementById('statSelesaiSub').innerHTML  = `selesai <span style="font-size:0.75rem;color:var(--text-subtle)">(${safe(anomSelesai).toLocaleString('id')} kasus)</span>`;

  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = `${safe(progress)}%`;

  // Update table subtitle count immediately with loaded stats values
  updateTableCount();
}



// ============================================================
// DATA LOADING
// ============================================================
async function loadAnomalinomorOptions() {
  const dropdown = document.getElementById('nomorChecklistDropdown');
  if (!dropdown) return;

  // Baca filter jenis dari UI
  let jenis = document.getElementById('filterJenis')?.value;
  
  // Jika PPL, paksa ke keluarga
  if (currentProfile?.role === 'ppl') {
    jenis = 'keluarga';
  }

  let query = db.from('anomali_ref').select('nomor, tipe').order('nomor');
  if (jenis && jenis !== 'keduanya') {
    query = query.eq('tipe', jenis);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching anomali_ref:', error);
    return;
  }

  const checkedSet = new Set(getSelectedNomorFilters());
  const seen = new Set();
  let html = '';

  (data || []).forEach(item => {
    const val = `${item.tipe}:${item.nomor}`;
    if (seen.has(val)) return;
    seen.add(val);
    const label = `Anomali ${item.tipe === 'keluarga' ? 'KK' : 'Usaha'} ${item.nomor}`;
    const isChecked = checkedSet.has(val);
    
    html += `
      <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; padding:0.25rem 0.5rem; cursor:pointer; color:var(--text); margin:0; hover:background-color:var(--border)">
        <input type="checkbox" class="nomor-filter-cb" value="${val}" ${isChecked ? 'checked' : ''} onchange="onNomorFilterChange()" style="width:13px; height:13px; accent-color:var(--primary); cursor:pointer">
        <span>${label}</span>
      </label>
    `;
  });

  if (!html) {
    html = `<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:0.5rem">Tidak ada opsi</div>`;
  }

  dropdown.innerHTML = html;
  updateNomorLabel();
}

function getSelectedNomorFilters() {
  const cbs = document.querySelectorAll('.nomor-filter-cb');
  const vals = [];
  cbs.forEach(cb => {
    if (cb.checked) vals.push(cb.value);
  });
  return vals;
}

function onNomorFilterChange() {
  updateNomorLabel();
  applyFilters();
}

function updateNomorLabel() {
  const selected = getSelectedNomorFilters();
  const label = document.getElementById('nomorChecklistLabel');
  if (!label) return;
  
  if (selected.length === 0) {
    label.textContent = 'Nomor: Semua';
  } else if (selected.length === 1) {
    const [tipe, nomor] = selected[0].split(':');
    label.textContent = `${tipe === 'keluarga' ? 'KK' : 'Usaha'} ${nomor}`;
  } else {
    label.textContent = `${selected.length} Terpilih`;
  }
}

function toggleNomorChecklist() {
  const dd = document.getElementById('nomorChecklistDropdown');
  if (dd) {
    const isHidden = dd.style.display === 'none';
    dd.style.display = isHidden ? 'block' : 'none';
  }
}

// Close checklist dropdown if clicking outside
document.addEventListener('click', (e) => {
  const container = document.querySelector('.dropdown-checklist-container');
  const dd = document.getElementById('nomorChecklistDropdown');
  if (container && dd && !container.contains(e.target)) {
    dd.style.display = 'none';
  }
});

async function loadData() {
  showTableLoading();
  try {
    const COLS = 'id, assignment_id, tipe, nama_entitas, kode_desa, kode_sls, kode_sub_sls, kode_sls_gabungan, nomor_anomali, status, first_seen, last_seen, is_ever_reopened, show_anomaly, is_rejected, is_api_synced';

    // Baca filter aktif dari UI
    const status = document.getElementById('filterStatus')?.value;
    const jenis  = document.getElementById('filterJenis')?.value;
    const selectedNomorList = getSelectedNomorFilters();
    const ket    = document.getElementById('filterKeterangan')?.value;
    const search = document.getElementById('filterSearch')?.value.trim();

    // Builder: buat query dengan semua filter kecuali tipe
    const buildQuery = (tipeOverride, selectCols = COLS, noLimit = false) => {
      let q = db.from('assignment_anomali').select(selectCols).order('first_seen', { ascending: false });
      if (tipeOverride) q = q.eq('tipe', tipeOverride);
      
      const isPetugas = currentProfile && ['ppl', 'pml'].includes(currentProfile.role);
      if (isPetugas) {
        q = q.eq('show_anomaly', true);
      }
      
      // Pencarian gabungan (Search SLS, KK, usaha, atau ID)
      if (search) {
        q = q.or(`assignment_id.ilike.%${search}%,nama_entitas.ilike.%${search}%,kode_sls_gabungan.ilike.%${search}%`);
      }

      // Filter Wilayah Berjenjang
      if (selectedSub) {
        q = q.eq('kode_sls_gabungan', selectedSub);
      } else if (selectedSLS) {
        q = q.like('kode_sls_gabungan', `${selectedSLS}%`);
      } else if (selectedDes) {
        q = q.eq('kode_desa', selectedDes);
      } else if (selectedKec) {
        q = q.like('kode_desa', `${selectedKec}%`);
      }

      // Filter Nomor Anomali Server-side (Handles cases where matching rows are far down)
      if (selectedNomorList && selectedNomorList.length > 0) {
        const orConditions = selectedNomorList.map(val => {
          const [tipe, nomor] = val.split(':');
          return `and(tipe.eq.${tipe},nomor_anomali.eq.${nomor})`;
        }).join(',');
        q = q.or(orConditions);
      }

      // Filter Keterangan Server-side
      if (ket) {
        if (ket === 'selesai') {
          q = q.in('status', ['sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi']);
        } else if (ket === 'belum') {
          q = q.eq('status', 'belum_ditindaklanjuti');
        }
      }

      if (!noLimit) q = q.limit(1000);
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

      // Jika login as guest/admin/superadmin, dan memfilter petugas tertentu
      const isFilterAllowed = !currentProfile || !['ppl', 'pml'].includes(currentProfile.role.toLowerCase());
      if (isFilterAllowed && selectedPetugas) {
        let codes = [];
        const rpcRes = await db.rpc('get_petugas_sls', {
          p_user_id: selectedPetugas.id,
          p_role: selectedPetugas.role.toLowerCase()
        });
        
        if (!rpcRes.error) {
          codes = (rpcRes.data || []).map(r => r.kode_sls);
        } else {
          // Fallback untuk Admin jika fungsi RPC get_petugas_sls belum dibuat
          const isAdmin = currentProfile && ['superadmin', 'admin'].includes(currentProfile.role.toLowerCase());
          if (isAdmin) {
            if (selectedPetugas.role.toLowerCase() === 'ppl') {
              const { data: sl, error: slErr } = await db
                .from('user_sls')
                .select('kode_sls')
                .eq('user_id', selectedPetugas.id)
                .eq('status', 'aktif');
              if (slErr) throw slErr;
              codes = (sl || []).map(r => r.kode_sls);
            } else if (selectedPetugas.role.toLowerCase() === 'pml') {
              const { data: ppls, error: pplsErr } = await db
                .from('pml_ppl')
                .select('ppl_id')
                .eq('pml_id', selectedPetugas.id);
              if (pplsErr) throw pplsErr;
              const pplIds = (ppls || []).map(r => r.ppl_id);
              if (pplIds.length > 0) {
                const { data: sl, error: slErr } = await db
                  .from('user_sls')
                  .select('kode_sls')
                  .eq('status', 'aktif')
                  .in('user_id', pplIds);
                if (slErr) throw slErr;
                codes = (sl || []).map(r => r.kode_sls);
              }
            }
          } else {
            console.error('RPC get_petugas_sls error:', rpcRes.error);
          }
        }

        if (codes.length === 0) return null;
        return q.in('kode_sls_gabungan', codes);
      }
      return q;
    };

    let rows = [];

    if (jenis === 'keduanya' && selectedNomorList.length === 0 && !ket) {

      const rpcParams = {
        p_status: null, // Move filtering to frontend to preserve grouping integrity
        p_nomor_anomali: null,
        p_nomor_tipe: null,
        p_ket: null,
        p_search: search || null,
        p_kec_code: selectedKec || null,
        p_desa_code: selectedDes || null,
        p_sls_code: selectedSub || selectedSLS || null
      };

      if (currentProfile?.role === 'ppl') {
        rpcParams.p_ppl_user_id = currentProfile.id;
      } else if (currentProfile?.role === 'pml') {
        rpcParams.p_pml_user_id = currentProfile.id;
      }

      const isFilterAllowed = !currentProfile || !['ppl', 'pml'].includes(currentProfile.role);
      if (isFilterAllowed && selectedPetugas) {
        if (selectedPetugas.role === 'ppl') {
          rpcParams.p_ppl_user_id = selectedPetugas.id;
        } else if (selectedPetugas.role === 'pml') {
          rpcParams.p_pml_user_id = selectedPetugas.id;
        }
      }

      const { data: resAnomalies, error: rpcErr } = await db.rpc('get_both_type_anomalies', rpcParams);
      if (rpcErr) throw rpcErr;

      rows = resAnomalies || [];
    } else {
      // Tipe tunggal atau semua tipe
      let tipeFilter = null;
      if (jenis && jenis !== 'keduanya')   tipeFilter = jenis;

      let q = buildQuery(tipeFilter);
      q = await applyRoleFilter(q, tipeFilter);
      if (!q) { allData = []; filteredData = []; renderAll(); return; }
      const { data, error } = await q;
      if (error) throw error;
      rows = data || [];
    }

    // Filter show_anomaly for PPL and PML
    if (currentProfile && ['ppl', 'pml'].includes(currentProfile.role)) {
      rows = rows.filter(r => r.show_anomaly !== false);
    }

    allData = groupByAssignment(rows);
    
    // Apply filters on the grouped assignments (frontend-side) to preserve grouping integrity
    filteredData = allData.filter(group => {
      // 1. Status Filter
      if (status && !group.rows.some(r => r.status === status)) return false;
      
      // 2. Nomor Filter (Match if group contains any of the selected anomaly numbers)
      if (selectedNomorList && selectedNomorList.length > 0) {
        const hasMatchingNomor = group.rows.some(r => {
          const val = `${r.tipe}:${r.nomor_anomali}`;
          return selectedNomorList.includes(val);
        });
        if (!hasMatchingNomor) return false;
      }
      
      // 3. Keterangan (ket) Filter
      if (ket) {
        const groupKet = getKeterangan(group);
        if (groupKet !== ket) return false;
      }

      // 4. Reject Filter
      const rejectFilterVal = document.getElementById('filterReject')?.value;
      if (rejectFilterVal === 'ya' && (!group.is_rejected || !group.is_api_synced)) return false;
      if (rejectFilterVal === 'pending' && (!group.is_rejected || group.is_api_synced)) return false;
      if (rejectFilterVal === 'tidak' && group.is_rejected) return false;
      
      return true;
    });

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
        show_anomaly:      row.show_anomaly !== undefined ? row.show_anomaly : false,
        is_rejected:       row.is_rejected !== undefined ? row.is_rejected : false,
        is_api_synced:     row.is_api_synced !== undefined ? row.is_api_synced : false,
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
  renderKecamatanProgress();
  loadStats();
  loadAnomalinomorOptions();
  loadData();
}

function applyFiltersDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 300);
}

function resetFilters() {
  ['filterStatus', 'filterJenis', 'filterKeterangan', 'filterSearch', 'filterKecamatan', 'filterDesa', 'filterSLS', 'filterSubSLS', 'filterReject']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

  // Clear all Nomor checklist checkboxes
  const cbs = document.querySelectorAll('.nomor-filter-cb');
  cbs.forEach(cb => { cb.checked = false; });
  updateNomorLabel();

  selectedPetugas = null;
  const input = document.getElementById('filterPetugasInput');
  if (input) input.value = '';
  const btnClear = document.getElementById('btnClearPetugas');
  if (btnClear) btnClear.style.display = 'none';

  selectedKec = '';
  selectedDes = '';
  selectedSLS = '';
  selectedSub = '';

  const filterDesa = document.getElementById('filterDesa');
  if (filterDesa) filterDesa.innerHTML = '<option value="">Semua Desa</option>';
  const filterSLS = document.getElementById('filterSLS');
  if (filterSLS) filterSLS.innerHTML = '<option value="">Semua SLS</option>';
  const filterSubSLS = document.getElementById('filterSubSLS');
  if (filterSubSLS) filterSubSLS.innerHTML = '<option value="">Semua Sub-SLS</option>';

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
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
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
    const nameParts = [];
    if (group.nama_kk) nameParts.push(group.nama_kk);
    if (group.nama_usaha_list.length > 0) {
      nameParts.push(group.nama_usaha_list.slice(0, 2).join(', ') + (group.nama_usaha_list.length > 2 ? ` +${group.nama_usaha_list.length - 2}` : ''));
    }
    const combinedName = nameParts.length > 0 ? nameParts.join(' / ') : '—';

    return `<tr class="${isReopened ? 'reopened' : ''} ${isSelected ? 'selected' : ''}" data-id="${group.assignment_id}">
      <td class="col-checkbox">
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleSelect('${group.assignment_id}', this)" style="cursor:pointer;accent-color:var(--primary)">
      </td>
      <td>
        <div class="assignment-id-cell">${group.assignment_id.slice(0, 8)}...</div>
        ${currentProfile && ['superadmin', 'admin'].includes(currentProfile.role) ? `
        <a href="https://fasih-sm.bps.go.id/app/assignment-detail/${group.assignment_id}" target="_blank" rel="noopener" class="fasih-link" onclick="event.stopPropagation()">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          Fasih-SM
        </a>` : ''}
        ${isReopened ? '<span class="reopen-badge">Re-open</span>' : ''}
        ${group.is_rejected ? (group.is_api_synced ? '<span class="reject-badge" style="background:var(--error); color:#fff; font-size:0.65rem; font-weight:600; padding:0.1rem 0.35rem; border-radius:var(--radius-sm); margin-left:0.25rem">Rejected</span>' : '<span class="reject-badge" style="background:var(--warning); color:#fff; font-size:0.65rem; font-weight:600; padding:0.1rem 0.35rem; border-radius:var(--radius-sm); margin-left:0.25rem">Pending</span>') : ''}
      </td>
      <td>${escHtml(combinedName)}</td>
      <td><span class="type-badge type-${jenis}">${jenisLabel(jenis)}</span></td>
      <td><div class="anomali-list-str">${buildAnomaliString(group)}</div></td>
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
          <div class="mobile-card-id">
            ${group.assignment_id.slice(0, 8)}... 
            ${isReopened ? '<span class="reopen-badge">Re-open</span>' : ''}
            ${group.is_rejected ? (group.is_api_synced ? '<span class="reject-badge" style="background:var(--error); color:#fff; font-size:0.65rem; font-weight:600; padding:0.1rem 0.35rem; border-radius:var(--radius-sm); margin-left:0.25rem">Rejected</span>' : '<span class="reject-badge" style="background:var(--warning); color:#fff; font-size:0.65rem; font-weight:600; padding:0.1rem 0.35rem; border-radius:var(--radius-sm); margin-left:0.25rem">Pending</span>') : ''}
          </div>
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
        ${currentProfile && ['superadmin', 'admin'].includes(currentProfile.role) ? `
        <a href="${buildFasihLink(group.assignment_id)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" onclick="event.stopPropagation()">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          Fasih-SM
        </a>` : ''}
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

  const firstBtn = `<button class="page-btn" onclick="goPage(1)" ${currentPage === 1 ? 'disabled' : ''} title="Halaman pertama"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg></button>`;
  const prevBtn = `<button class="page-btn" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>`;
  const nextBtn = `<button class="page-btn" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>`;
  const lastBtn = `<button class="page-btn" onclick="goPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} title="Halaman terakhir"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg></button>`;

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

  pag.innerHTML = firstBtn + prevBtn + pageButtons + nextBtn + lastBtn;
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
  const dbTotal = document.getElementById('statTotal')?.textContent || '0';

  const isTruncated = total >= 1000;
  const displayTotal = isTruncated ? '1.000+' : total.toLocaleString('id');

  // Cek apakah ada filter aktif yang membatasi dataset
  const hasActiveFilters = document.getElementById('filterStatus')?.value ||
                           document.getElementById('filterJenis')?.value ||
                           getSelectedNomorFilters().length > 0 ||
                           document.getElementById('filterKeterangan')?.value ||
                           selectedKec || selectedDes || selectedSLS || selectedSub ||
                           selectedPetugas ||
                           document.getElementById('filterReject')?.value ||
                           document.getElementById('filterSearch')?.value.trim();

  let text = total === 0 
    ? 'Tidak ada data' 
    : `Menampilkan ${start}–${end} dari ${hasActiveFilters ? displayTotal : (isTruncated ? '1.000+' : dbTotal)}`;
  const dbTotalNum = parseInt(dbTotal.replace(/\./g, '')) || 0;
  if (hasActiveFilters && (total < allData.length || allData.length < dbTotalNum)) {
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
  
  const openBtn = document.getElementById('fabOpenBtn');
  if (openBtn) {
    const isAdmin = currentProfile && ['superadmin', 'admin'].includes(currentProfile.role);
    openBtn.style.display = (count > 0 && isAdmin) ? 'flex' : 'none';
  }
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
  const selectedNomorList = getSelectedNomorFilters();
  const ket    = document.getElementById('filterKeterangan').value;
  const search = document.getElementById('filterSearch').value.trim();
  const reject = document.getElementById('filterReject')?.value;

  // Helper untuk mengambil label teks yang terpilih
  const getSelectText = id => {
    const el = document.getElementById(id);
    return el?.options[el.selectedIndex]?.text || '';
  };

  const chips = [
    status && { label: `Status: ${STATUS_CONFIG[status]?.label}`,  clear: () => { document.getElementById('filterStatus').value = ''; applyFilters(); } },
    jenis  && { label: `Jenis: ${jenisLabel(jenis)}`,              clear: () => { document.getElementById('filterJenis').value = ''; applyFilters(); } },
    ...selectedNomorList.map(val => {
      const [tipe, nomor] = val.split(':');
      return {
        label: `Nomor: ${tipe === 'keluarga' ? 'KK' : 'Usaha'} ${nomor}`,
        clear: () => {
          const cbs = document.querySelectorAll('.nomor-filter-cb');
          cbs.forEach(cb => {
            if (cb.value === val) cb.checked = false;
          });
          updateNomorLabel();
          applyFilters();
        }
      };
    }),
    selectedPetugas && { label: `Petugas: ${selectedPetugas.nama}`, clear: () => { clearSelectedPetugas(); } },
    selectedSub && { label: `Sub-SLS: ${getSelectText('filterSubSLS')}`, clear: () => { document.getElementById('filterSubSLS').value = ''; applyWilayahFilter(); } },
    (!selectedSub && selectedSLS) && { label: `SLS: ${getSelectText('filterSLS')}`, clear: () => { document.getElementById('filterSLS').value = ''; onSLSChange(); applyWilayahFilter(); } },
    (!selectedSLS && selectedDes) && { label: `Desa: ${getSelectText('filterDesa')}`, clear: () => { document.getElementById('filterDesa').value = ''; onDesaChange(); applyWilayahFilter(); } },
    (!selectedDes && selectedKec) && { label: `Kec: ${getSelectText('filterKecamatan')}`, clear: () => { document.getElementById('filterKecamatan').value = ''; onKecamatanChange(); applyWilayahFilter(); } },
    ket    && { label: `Ket: ${ket === 'selesai' ? 'Selesai' : 'Belum Selesai'}`, clear: () => { document.getElementById('filterKeterangan').value = ''; applyFilters(); } },
    reject && { label: `Reject: ${reject === 'ya' ? 'Ya' : 'Tidak'}`, clear: () => { document.getElementById('filterReject').value = ''; applyFilters(); } },
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
  document.getElementById('tableBody').innerHTML = `<tr><td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">${spinner}</td></tr>`;
  document.getElementById('mobileCardList').innerHTML = `<div style="text-align:center;padding:3rem">${spinner}</div>`;
}

// ============================================================
// WILAYAH FILTER LOGIC (6-Level Cascade Popup)
// ============================================================
let selectedKec = '';
let selectedDes = '';
let selectedSLS = '';
let selectedSub = '';

function openWilayahFilterModal() {
  const modal = document.getElementById('wilayahFilterModal');
  if (modal) modal.classList.add('open');
}

function closeWilayahFilterModal() {
  const modal = document.getElementById('wilayahFilterModal');
  if (modal) modal.classList.remove('open');
}

function applyWilayahFilter() {
  selectedKec = document.getElementById('filterKecamatan')?.value || '';
  selectedDes = document.getElementById('filterDesa')?.value || '';
  selectedSLS = document.getElementById('filterSLS')?.value || '';
  selectedSub = document.getElementById('filterSubSLS')?.value || '';
  
  closeWilayahFilterModal();
  applyFilters();
}

async function loadWilayahOptions() {
  const kecSelect = document.getElementById('filterKecamatan');
  if (!kecSelect) return;

  try {
    const { data, error } = await db
      .from('wilayah_kec')
      .select('kode_kec, nmkec')
      .order('nmkec');

    if (error) throw error;

    kecSelect.innerHTML = '<option value="">Semua Kecamatan</option>';
    (data || []).forEach(kec => {
      const opt = document.createElement('option');
      opt.value = kec.kode_kec;
      opt.textContent = kec.nmkec;
      kecSelect.appendChild(opt);
    });

    document.getElementById('filterDesa').innerHTML = '<option value="">Semua Desa</option>';
    document.getElementById('filterSLS').innerHTML = '<option value="">Semua SLS</option>';
    document.getElementById('filterSubSLS').innerHTML = '<option value="">Semua Sub-SLS</option>';
  } catch (err) {
    console.error('Error loading kecamatan:', err);
  }
}

async function onKecamatanChange() {
  const selectedKecVal = document.getElementById('filterKecamatan')?.value;
  const desSelect = document.getElementById('filterDesa');
  if (!desSelect) return;

  desSelect.innerHTML = '<option value="">Semua Desa</option>';
  document.getElementById('filterSLS').innerHTML = '<option value="">Semua SLS</option>';
  document.getElementById('filterSubSLS').innerHTML = '<option value="">Semua Sub-SLS</option>';

  if (selectedKecVal) {
    try {
      const { data, error } = await db
        .from('wilayah_desa')
        .select('kode_desa, nmdesa')
        .eq('kode_kec', selectedKecVal)
        .order('nmdesa');

      if (error) throw error;

      (data || []).forEach(des => {
        const opt = document.createElement('option');
        opt.value = des.kode_desa;
        opt.textContent = des.nmdesa;
        desSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Error loading desa:', err);
    }
  }
}

async function onDesaChange() {
  const selectedDesVal = document.getElementById('filterDesa')?.value;
  const slsSelect = document.getElementById('filterSLS');
  if (!slsSelect) return;

  slsSelect.innerHTML = '<option value="">Semua SLS</option>';
  document.getElementById('filterSubSLS').innerHTML = '<option value="">Semua Sub-SLS</option>';

  if (selectedDesVal) {
    try {
      const { data, error } = await db
        .from('wilayah_sls')
        .select('kode_sls, nmsls')
        .eq('kode_desa', selectedDesVal)
        .order('nmsls');

      if (error) throw error;

      (data || []).forEach(sls => {
        const opt = document.createElement('option');
        opt.value = sls.kode_sls;
        opt.textContent = sls.nmsls;
        slsSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Error loading SLS:', err);
    }
  }
}

async function onSLSChange() {
  const selectedSLSVal = document.getElementById('filterSLS')?.value;
  const subSelect = document.getElementById('filterSubSLS');
  if (!subSelect) return;

  subSelect.innerHTML = '<option value="">Semua Sub-SLS</option>';

  if (selectedSLSVal) {
    try {
      const { data, error } = await db
        .from('wilayah_subsls')
        .select('kode_sls_gabungan, nmsubsls, kdsubsls')
        .eq('kode_sls', selectedSLSVal)
        .order('nmsubsls');

      if (error) throw error;

      (data || []).forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub.kode_sls_gabungan;
        opt.textContent = `${sub.nmsubsls} (${sub.kdsubsls})`;
        subSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Error loading subsls:', err);
    }
  }
}

async function loadKecamatanProgress() {
  const container = document.getElementById('kecProgressGrid');
  if (!container) return;

  container.innerHTML = Array(6).fill(0).map(() => `
    <div class="kec-progress-card" style="opacity:0.6">
      <div class="skeleton skeleton-text" style="width:70%;margin-bottom:0.4rem;height:12px"></div>
      <div class="skeleton skeleton-text" style="width:40%;height:10px;margin-bottom:0.4rem"></div>
      <div class="kec-progress-bar"><div class="kec-progress-fill" style="width:0%"></div></div>
    </div>
  `).join('');

  try {
    const { data, error } = await db.rpc('get_kecamatan_progress');
    if (error) throw error;
    kecProgressData = data || [];
    renderKecamatanProgress();
  } catch (err) {
    console.error('Error loading kecamatan progress:', err);
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:var(--error);font-size:0.8rem">Gagal memuat progres: ${err.message}</div>`;
  }
}

let currentKecPage = 0;
const kecPageSize = 5;

function prevKecPage() {
  if (currentKecPage > 0) {
    currentKecPage--;
    renderKecamatanProgress();
  }
}

function nextKecPage() {
  const maxPage = Math.ceil(kecProgressData.length / kecPageSize) - 1;
  if (currentKecPage < maxPage) {
    currentKecPage++;
    renderKecamatanProgress();
  }
}

function renderKecamatanProgress() {
  const container = document.getElementById('kecProgressGrid');
  if (!container) return;

  if (!kecProgressData || kecProgressData.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:1.5rem;color:var(--text-subtle);font-size:0.8rem">Tidak ada data progres wilayah</div>`;
    const nav = document.getElementById('kecNavControls');
    if (nav) nav.classList.add('hidden');
    return;
  }

  const isMobile = window.innerWidth <= 768;
  const isCollapsed = container.classList.contains('collapsed');
  const nav = document.getElementById('kecNavControls');

  let pageData = kecProgressData;
  if (isMobile) {
    if (nav && !isCollapsed) nav.classList.remove('hidden');
    const totalPages = Math.ceil(kecProgressData.length / kecPageSize);
    const maxPage = totalPages - 1;
    if (currentKecPage > maxPage) currentKecPage = maxPage;
    if (currentKecPage < 0) currentKecPage = 0;

    const start = currentKecPage * kecPageSize;
    pageData = kecProgressData.slice(start, start + kecPageSize);

    // Update indicator and buttons
    const ind = document.getElementById('kecPageIndicator');
    if (ind) ind.textContent = `${currentKecPage + 1}/${totalPages}`;
    
    const btnPrev = document.getElementById('btnKecPrev');
    const btnNext = document.getElementById('btnKecNext');
    if (btnPrev) btnPrev.disabled = currentKecPage === 0;
    if (btnNext) btnNext.disabled = currentKecPage === maxPage;
  } else {
    if (nav) nav.classList.add('hidden');
  }

  container.innerHTML = pageData.map(k => {
    const pct = parseFloat(k.persen_progress || 0);
    let colorClass = 'progress-red';
    if (pct >= 80) colorClass = 'progress-green';
    else if (pct >= 50) colorClass = 'progress-orange';

    const isActive = selectedKec === k.kode_kec;

    return `
      <div class="kec-progress-card ${isActive ? 'active-filter' : ''}" onclick="toggleKecFilter('${k.kode_kec}')">
        <div class="kec-progress-name" title="${escHtml(k.nmkec)}">${escHtml(k.nmkec)}</div>
        <div class="kec-progress-meta">
          <span>${pct.toFixed(1)}%</span>
          <span>${k.selesai_anomali} / ${k.total_anomali}</span>
        </div>
        <div class="kec-progress-bar">
          <div class="kec-progress-fill ${colorClass}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function toggleKecFilter(kodeKec) {
  const kecSelect = document.getElementById('filterKecamatan');
  if (!kecSelect) return;

  if (selectedKec === kodeKec) {
    kecSelect.value = '';
    selectedKec = '';
    selectedDes = '';
    selectedSLS = '';
    selectedSub = '';
  } else {
    kecSelect.value = kodeKec;
    selectedKec = kodeKec;
    selectedDes = '';
    selectedSLS = '';
    selectedSub = '';
  }

  await onKecamatanChange();
  applyFilters();
}

let kecProgressExpanded = false;

function toggleKecProgress() {
  kecProgressExpanded = !kecProgressExpanded;
  const grid = document.getElementById('kecProgressGrid');
  const btn = document.getElementById('btnToggleKecProgress');
  const icon = document.getElementById('toggleKecIcon');
  const nav = document.getElementById('kecNavControls');
  if (!grid || !btn) return;

  const isMobile = window.innerWidth <= 768;

  if (kecProgressExpanded) {
    grid.classList.remove('collapsed');
    btn.querySelector('span').textContent = 'Sembunyikan';
    if (icon) icon.style.transform = 'rotate(180deg)';
    if (isMobile && nav) nav.classList.remove('hidden');
  } else {
    grid.classList.add('collapsed');
    btn.querySelector('span').textContent = 'Tampilkan';
    if (icon) icon.style.transform = 'rotate(0deg)';
    if (nav) nav.classList.add('hidden');
  }
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

// Dropdown toggle logic
function toggleProfileDropdown(event) {
  event.stopPropagation();
  document.getElementById('profileDropdown')?.classList.toggle('open');
}

document.addEventListener('click', () => {
  document.getElementById('profileDropdown')?.classList.remove('open');
});

// Escape key listener for modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // 1. Detail Modal
    const detailModal = document.getElementById('detailModal');
    if (detailModal && detailModal.classList.contains('open')) {
      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      } else {
        detailModal.classList.remove('open');
        document.body.style.overflow = '';
      }
    }
    // 2. Wilayah Filter Modal
    const wilModal = document.getElementById('wilayahFilterModal');
    if (wilModal && wilModal.classList.contains('open')) {
      if (typeof closeWilayahFilterModal === 'function') {
        closeWilayahFilterModal();
      } else {
        wilModal.classList.remove('open');
      }
    }
    // 3. Login Modal
    const logModal = document.getElementById('loginModal');
    if (logModal && logModal.classList.contains('open')) {
      if (typeof closeLoginModal === 'function') {
        closeLoginModal();
      } else {
        logModal.classList.remove('open');
      }
    }
    // 4. Admin Name Modal
    document.getElementById('adminNameModal')?.classList.remove('open');
  }
});
