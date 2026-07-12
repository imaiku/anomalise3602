// ============================================================
// ADMIN.JS — Super Admin Panel Logic
// Depends on: config.js, utils.js, auth.js, upload.js, import.js
// ============================================================

let adminProfile = null;
let parsedKK     = null;   // { rows, records }
let parsedUsaha  = null;   // { rows, records }
let batchId      = null;
let allUsers     = [];
let filteredUsers = [];
let currentUserPage = 1;
let userPageSize    = 25;
let editingRefId = null;

// ============================================================
// INIT & NAVIGATION
// ============================================================
async function initAdmin() {
  const session = await requireAuth(['superadmin', 'admin']);
  if (!session) return;
  adminProfile = session.profile;
  document.getElementById('adminName').textContent = getSessionName(adminProfile);

  await loadBatchHistory();
  await loadAnomaliRef();
  await loadUsers();
  await loadUnassigned();
}

function showSection(sectionId) {
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`panel-${sectionId}`)?.classList.add('active');
  document.getElementById(`nav-${sectionId}`)?.classList.add('active');
}

// ============================================================
// FILE UPLOAD — ANOMALI DATA
// ============================================================
function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId)?.classList.add('drag-over');
}
function handleDragLeave(zoneId) {
  document.getElementById(zoneId)?.classList.remove('drag-over');
}
function handleDrop(e, tipe) {
  e.preventDefault();
  const zoneId = tipe === 'kk' ? 'zoneKK' : 'zoneUsaha';
  document.getElementById(zoneId)?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file, tipe === 'kk' ? 'keluarga' : 'usaha');
}
function handleFileSelect(e, tipe) {
  const file = e.target.files[0];
  if (file) processFile(file, tipe === 'kk' ? 'keluarga' : 'usaha');
}

async function processFile(file, tipe) {
  const isKK    = tipe === 'keluarga';
  const labelId = isKK ? 'kkLabel'       : 'usahaLabel';
  const zoneId  = isKK ? 'zoneKK'        : 'zoneUsaha';
  const validId = isKK ? 'kkValidation'  : 'usahaValidation';

  document.getElementById(labelId).textContent = file.name;
  document.getElementById(validId).innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows   = await parseExcelFile(file);
    const result = validateExcel(rows, tipe);

    if (!result.valid) {
      document.getElementById(zoneId).classList.remove('has-file');
      renderValidationResult(validId, result);
      if (isKK) parsedKK = null; else parsedUsaha = null;
    } else {
      document.getElementById(zoneId).classList.add('has-file');
      document.getElementById(validId).innerHTML = `
        <div class="alert alert-success">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          <span>Validasi berhasil — ${result.dataRows.length.toLocaleString('id')} baris data ditemukan</span>
        </div>`;
      const tanggal = document.getElementById('tanggalData').value || new Date().toISOString().slice(0, 10);
      const records = rowsToRecordsFull(rows, tipe, tanggal);
      if (isKK) parsedKK    = { rows, records };
      else      parsedUsaha = { rows, records };
    }
  } catch (e) {
    document.getElementById(validId).innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        <span>${escHtml(e.message)}</span>
      </div>`;
    if (isKK) parsedKK = null; else parsedUsaha = null;
  }

  checkValidateBtn();
}

function checkValidateBtn() {
  const btn     = document.getElementById('validateBtn');
  const hint    = document.getElementById('validateHint');
  const tanggal = document.getElementById('tanggalData')?.value;
  const hasFile = parsedKK || parsedUsaha;
  btn.disabled  = !(hasFile && tanggal);
  hint.textContent = !tanggal   ? 'Pilih tanggal data terlebih dahulu' :
                     !hasFile   ? 'Upload minimal 1 file Excel yang valid' :
                                  'Siap untuk dilanjutkan';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tanggalData')?.addEventListener('change', checkValidateBtn);
});

async function startValidation() {
  if (parsedKK && parsedUsaha) {
    const warnings = checkSLSConsistency(parsedKK.records, parsedUsaha.records);
    document.getElementById('consistencyWarnings').innerHTML = warnings.length > 0
      ? `<div class="alert alert-warning mb-4">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div>
            <strong>Peringatan Konsistensi SLS</strong>
            <ul style="margin:0.25rem 0 0 1rem;font-size:0.8rem">
              ${warnings.slice(0, 5).map(w => `<li>${escHtml(w)}</li>`).join('')}
              ${warnings.length > 5 ? `<li>...dan ${warnings.length - 5} peringatan lainnya</li>` : ''}
            </ul>
          </div>
        </div>`
      : '';
  }

  const tanggal    = document.getElementById('tanggalData').value;
  const kkCount    = parsedKK?.records.length    || 0;
  const usahaCount = parsedUsaha?.records.length || 0;

  document.getElementById('uploadStep1').classList.add('hidden');
  setStep(2);

  document.getElementById('previewSummary').innerHTML = `
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Tanggal Data</div>
      <div style="font-weight:700;font-size:1.1rem">${tanggal}</div>
    </div>
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Anomali Keluarga</div>
      <div style="font-weight:700;font-size:1.1rem;color:var(--primary)">${kkCount.toLocaleString('id')} baris</div>
    </div>
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Anomali Usaha</div>
      <div style="font-weight:700;font-size:1.1rem;color:var(--primary)">${usahaCount.toLocaleString('id')} baris</div>
    </div>`;

  document.getElementById('uploadStep2').classList.remove('hidden');
}

async function startMerge() {
  document.getElementById('uploadStep2').classList.add('hidden');
  document.getElementById('uploadStep3').classList.remove('hidden');
  setStep(3);

  const tanggal = document.getElementById('tanggalData').value;
  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .insert({
      tanggal_data:     tanggal,
      uploaded_by_nama: getSessionName(adminProfile),
      uploaded_by_id:   adminProfile.id,
      status:           'processing',
      jumlah_keluarga:  parsedKK?.records.length    || 0,
      jumlah_usaha:     parsedUsaha?.records.length || 0
    })
    .select('id').single();

  if (batchErr) {
    showToast('Gagal membuat batch: ' + batchErr.message, 'error');
    backToStep1(); return;
  }

  batchId = batch.id;
  const allRecords = [...(parsedKK?.records || []), ...(parsedUsaha?.records || [])];

  try {
    const results = await mergeRecords(allRecords, batchId, tanggal, pct => {
      document.getElementById('mergeProgress').style.width = pct + '%';
      document.getElementById('mergeStatus').textContent =
        pct < 80  ? `Memproses data... ${pct}%` :
        pct < 100 ? 'Menyelesaikan auto-resolve...' : 'Selesai!';
    });

    await db.from('upload_batches').update({ status: 'completed' }).eq('id', batchId);

    document.getElementById('uploadStep3').classList.add('hidden');
    document.getElementById('uploadStep4').classList.remove('hidden');
    setStep(4);

    document.getElementById('mergeResults').innerHTML = `
      <div style="text-align:center">
        <div style="font-size:1.5rem;font-weight:700;color:var(--primary)">${results.inserted.toLocaleString('id')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">Baru ditambahkan</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:1.5rem;font-weight:700">${results.updated.toLocaleString('id')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">Diperbarui</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:1.5rem;font-weight:700;color:var(--warning)">${results.reopened.toLocaleString('id')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">Re-open</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-subtle)">${results.resolved.toLocaleString('id')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">Auto-resolved</div>
      </div>`;

    if (results.errors.length > 0) {
      document.getElementById('mergeResults').insertAdjacentHTML('afterend',
        `<div class="alert alert-warning mt-3">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div>${results.errors.length} baris gagal diproses.
            <ul style="margin:0.25rem 0 0 1rem;font-size:0.8rem">
              ${results.errors.slice(0, 5).map(e => `<li>${escHtml(e)}</li>`).join('')}
            </ul>
          </div>
        </div>`);
    }

    showToast('Merge berhasil!', 'success');
    await loadBatchHistory();
  } catch (e) {
    await db.from('upload_batches').update({ status: 'failed' }).eq('id', batchId);
    showToast('Merge gagal: ' + e.message, 'error');
    document.getElementById('mergeStatus').textContent = 'Terjadi kesalahan: ' + e.message;
  }
}

function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}`);
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
}

function backToStep1() {
  document.getElementById('uploadStep2').classList.add('hidden');
  document.getElementById('uploadStep1').classList.remove('hidden');
  setStep(1);
}

function resetUpload() {
  parsedKK = null; parsedUsaha = null; batchId = null;
  ['zoneKK', 'zoneUsaha'].forEach(id => document.getElementById(id)?.classList.remove('has-file'));
  ['kkLabel', 'usahaLabel'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).textContent = 'Pilih atau seret file di sini'; });
  ['kkValidation', 'usahaValidation', 'consistencyWarnings'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).innerHTML = ''; });
  ['fileKK', 'fileUsaha'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = ''; });
  ['uploadStep2', 'uploadStep3', 'uploadStep4'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('uploadStep1')?.classList.remove('hidden');
  setStep(1);
}

// ============================================================
// BATCH HISTORY
// ============================================================
async function loadBatchHistory() {
  const { data, error } = await db
    .from('upload_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const tbody = document.getElementById('historyTableBody');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--error)">Gagal memuat: ${error.message}</td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-title">Belum ada riwayat upload</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(b => `
    <tr>
      <td><strong>${b.tanggal_data}</strong></td>
      <td>${escHtml(b.uploaded_by_nama || '—')}</td>
      <td>${b.jumlah_keluarga?.toLocaleString('id') || 0}</td>
      <td>${b.jumlah_usaha?.toLocaleString('id') || 0}</td>
      <td style="color:var(--text-muted);font-size:0.8rem">${new Date(b.created_at).toLocaleString('id-ID', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
      <td><span class="status-badge ${b.status === 'completed' ? 'status-kondisi' : b.status === 'failed' ? 'status-reopen' : 'status-pending'}">${b.status}</span></td>
    </tr>`).join('');
}

// ============================================================
// ANOMALI REF (CMS)
// ============================================================
async function loadAnomaliRef() {
  const tipe  = document.getElementById('refTipeFilter')?.value || '';
  let query   = db.from('anomali_ref').select('*').order('tipe').order('nomor');
  if (tipe) query = query.eq('tipe', tipe);

  const { data, error } = await query;
  const grid = document.getElementById('anomaliRefGrid');

  if (error) { grid.innerHTML = `<div style="color:var(--error)">Gagal memuat: ${error.message}</div>`; return; }
  if (!data?.length) {
    grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-state-title">Belum ada referensi anomali</div><div class="empty-state-sub">Tambah referensi untuk menampilkan penjelasan di panel tindak lanjut</div></div></div>`;
    return;
  }

  grid.innerHTML = data.map(ref => `
    <div class="anomali-ref-card">
      <div class="anomali-ref-header">
        <div>
          <span class="anomali-ref-num">#${ref.nomor}</span>
          <span class="type-badge type-${ref.tipe}" style="margin-left:0.5rem">${ref.tipe}</span>
        </div>
        <div style="display:flex;gap:0.35rem">
          <button class="btn btn-ghost btn-icon btn-sm" onclick='openEditRefModal(${JSON.stringify(ref)})' title="Edit">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteAnomaliRef(${ref.id})" title="Hapus" style="color:var(--error)">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
      <div style="font-weight:600;margin-bottom:0.25rem;font-size:0.875rem">${escHtml(ref.nama)}</div>
      ${ref.penjelasan ? `<div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">${escHtml(ref.penjelasan)}</div>` : ''}
    </div>`).join('');
}

function openAddRefModal() {
  editingRefId = null;
  document.getElementById('refModalTitle').textContent = 'Tambah Referensi Anomali';
  ['refNomor', 'refNama', 'refPenjelasan'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('refTipe').value = 'keluarga';
  document.getElementById('refModal').classList.add('open');
}

function openEditRefModal(ref) {
  editingRefId = ref.id;
  document.getElementById('refModalTitle').textContent = 'Edit Referensi Anomali';
  document.getElementById('refNomor').value      = ref.nomor;
  document.getElementById('refTipe').value       = ref.tipe;
  document.getElementById('refNama').value       = ref.nama;
  document.getElementById('refPenjelasan').value = ref.penjelasan || '';
  document.getElementById('refModal').classList.add('open');
}

function closeRefModal() { document.getElementById('refModal').classList.remove('open'); }

async function saveAnomaliRef() {
  const nomor   = parseInt(document.getElementById('refNomor').value);
  const tipe    = document.getElementById('refTipe').value;
  const nama    = document.getElementById('refNama').value.trim();
  const penjelas = document.getElementById('refPenjelasan').value.trim();

  if (!nomor || !tipe || !nama) { showToast('Nomor, tipe, dan nama wajib diisi', 'error'); return; }

  const payload = { nomor, tipe, nama, penjelasan: penjelas || null, updated_at: new Date().toISOString() };
  const { error } = editingRefId
    ? await db.from('anomali_ref').update(payload).eq('id', editingRefId)
    : await db.from('anomali_ref').insert(payload);

  if (error) { showToast('Gagal menyimpan: ' + error.message, 'error'); return; }
  showToast('Referensi berhasil disimpan', 'success');
  closeRefModal();
  await loadAnomaliRef();
}

async function deleteAnomaliRef(id) {
  if (!confirm('Yakin hapus referensi ini?')) return;
  const { error } = await db.from('anomali_ref').delete().eq('id', id);
  if (error) { showToast('Gagal menghapus: ' + error.message, 'error'); return; }
  showToast('Referensi dihapus', 'success');
  await loadAnomaliRef();
}

// ============================================================
// USER MANAGEMENT
// ============================================================
// ============================================================
// USER MANAGEMENT
// ============================================================
async function loadUsers() {
  let all = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await db
      .from('profiles')
      .select('id, sobatid, nama, role, email_ref, is_active')
      .in('role', ['ppl', 'pml'])
      .order('role').order('nama')
      .range(from, from + step - 1);

    if (error) { console.error(error); break; }
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      all = all.concat(data);
      if (data.length < step) {
        hasMore = false;
      } else {
        from += step;
      }
    }
  }

  allUsers = all;
  filterUsers();
}

function filterUsers() {
  const search = document.getElementById('userSearch').value.toLowerCase();
  const role   = document.getElementById('userRoleFilter').value;
  filteredUsers = allUsers.filter(u =>
    (!role   || u.role === role) &&
    (!search || u.nama.toLowerCase().includes(search) || (u.sobatid || '').toLowerCase().includes(search))
  );
  currentUserPage = 1;
  renderUsers();
}

async function renderUsers() {
  const total = filteredUsers.length;
  let pageData = filteredUsers;
  
  if (userPageSize !== 'all') {
    const start = (currentUserPage - 1) * parseInt(userPageSize);
    pageData = filteredUsers.slice(start, start + parseInt(userPageSize));
  }

  const pmlCount = allUsers.filter(u => u.role === 'pml').length;
  const pplCount = allUsers.filter(u => u.role === 'ppl').length;
  document.getElementById('userTableCount').textContent = `Total: ${allUsers.length} pengguna (${pplCount} PPL, ${pmlCount} PML) | Menampilkan ${pageData.length} data`;

  const tbody = document.getElementById('userTableBody');
  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">Tidak ada pengguna ditemukan</div></div></td></tr>`;
    const pag = document.getElementById('userPagination');
    if (pag) pag.innerHTML = '';
    return;
  }

  let slsData = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls')
      .select('user_id, kode_sls')
      .eq('status', 'aktif')
      .range(fromSls, fromSls + 999);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) {
      hasMoreSls = false;
    } else {
      slsData = slsData.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    }
  }

  let relData = [];
  let fromRel = 0;
  let hasMoreRel = true;
  while (hasMoreRel) {
    const { data, error } = await db.from('pml_ppl')
      .select('pml_id, ppl_id')
      .range(fromRel, fromRel + 999);
    if (error) { console.error(error); break; }
    if (!data || data.length === 0) {
      hasMoreRel = false;
    } else {
      relData = relData.concat(data);
      if (data.length < 1000) hasMoreRel = false;
      else fromRel += 1000;
    }
  }

  const pplSlsMap = {};
  (slsData || []).forEach(s => {
    if (!pplSlsMap[s.user_id]) pplSlsMap[s.user_id] = new Set();
    pplSlsMap[s.user_id].add(s.kode_sls);
  });

  const pmlPplsMap = {};
  (relData || []).forEach(r => {
    if (!pmlPplsMap[r.pml_id]) pmlPplsMap[r.pml_id] = new Set();
    pmlPplsMap[r.pml_id].add(r.ppl_id);
  });

  tbody.innerHTML = pageData.map(u => {
    let slsCountVal = 0;
    if (u.role === 'ppl') {
      slsCountVal = pplSlsMap[u.id]?.size || 0;
    } else if (u.role === 'pml') {
      const supervised = pmlPplsMap[u.id];
      if (supervised) {
        const uniqueSls = new Set();
        supervised.forEach(pplId => {
          pplSlsMap[pplId]?.forEach(s => uniqueSls.add(s));
        });
        slsCountVal = uniqueSls.size;
      }
    }

    return `
      <tr>
        <td><strong>${escHtml(u.nama)}</strong></td>
        <td class="mono">${escHtml(u.sobatid || '—')}</td>
        <td><span class="type-badge type-${u.role === 'ppl' ? 'keluarga' : u.role === 'pml' ? 'usaha' : 'keduanya'}">${u.role.toUpperCase()}</span></td>
        <td style="color:var(--text-muted)">${escHtml(u.email_ref || '—')}</td>
        <td><span class="chip">${slsCountVal} SLS</span></td>
        <td><span class="status-badge ${u.is_active ? 'status-kondisi' : 'status-clear'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="manageUserSLS('${u.id}','${escHtml(u.nama)}')" title="Kelola SLS">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/></svg>
            SLS
          </button>
          <button class="btn btn-ghost btn-sm ${u.is_active ? 'text-error' : 'text-success'}" onclick="toggleUserStatus('${u.id}',${u.is_active})">
            ${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </td>
      </tr>`;
  }).join('');

  renderUserPagination();
}

function renderUserPagination() {
  const pag = document.getElementById('userPagination');
  if (!pag) return;

  if (userPageSize === 'all') {
    pag.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(filteredUsers.length / parseInt(userPageSize));
  if (totalPages <= 1) {
    pag.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" onclick="goUserPage(${currentUserPage - 1})" ${currentUserPage === 1 ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  </button>`;

  const delta = 3;
  const range = [];
  for (let i = Math.max(1, currentUserPage - delta); i <= Math.min(totalPages, currentUserPage + delta); i++) {
    range.push(i);
  }

  if (range[0] > 1) {
    html += `<button class="page-btn" onclick="goUserPage(1)">1</button>`;
    if (range[0] > 2) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
  }

  range.forEach(p => {
    html += `<button class="page-btn ${p === currentUserPage ? 'active' : ''}" onclick="goUserPage(${p})">${p}</button>`;
  });

  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
    html += `<button class="page-btn" onclick="goUserPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="page-btn" onclick="goUserPage(${currentUserPage + 1})" ${currentUserPage === totalPages ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  </button>`;

  pag.innerHTML = html;
}

function goUserPage(p) {
  const totalPages = Math.ceil(filteredUsers.length / (userPageSize === 'all' ? 1 : parseInt(userPageSize)));
  if (p < 1 || p > totalPages) return;
  currentUserPage = p;
  renderUsers();
}

function changeUserPageSize() {
  userPageSize = document.getElementById('userPageSizeSelect').value;
  currentUserPage = 1;
  renderUsers();
}

function openAddUserModal() {
  ['userSobatid', 'userNIK', 'userName', 'userEmail'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('userRole').value = 'ppl';
  document.getElementById('userFormError').classList.add('hidden');
  document.getElementById('userModal').classList.add('open');
}
function closeUserModal() { document.getElementById('userModal').classList.remove('open'); }

function showUserError(msg) {
  document.getElementById('userFormErrorText').textContent = msg;
  document.getElementById('userFormError').classList.remove('hidden');
}

async function createUser() {
  const sobatid = document.getElementById('userSobatid').value.trim();
  const nik     = document.getElementById('userNIK').value.trim();
  const nama    = document.getElementById('userName').value.trim();
  const role    = document.getElementById('userRole').value;
  const email   = document.getElementById('userEmail').value.trim();

  if (!sobatid || !nik || !nama) { showUserError('Sobat ID, NIK, dan Nama wajib diisi'); return; }
  if (!/^\d+$/.test(sobatid))    { showUserError('Sobat ID harus berupa angka'); return; }

  const btn = document.getElementById('createUserBtn');
  btn.disabled = true; btn.textContent = 'Membuat akun...';

  try {
    const payload = [{
      sobatid,
      nik,
      nama,
      role,
      email: email || ''
    }];

    const { data, error } = await db.rpc('register_users_batch', { p_users: payload });

    if (error) {
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        throw new Error('Fungsi register_users_batch belum ditambahkan di database. Harap jalankan script SQL terbaru di editor SQL Supabase Anda.');
      }
      throw error;
    }

    if (data.fail_count > 0) {
      throw new Error(data.errors[0] || 'Gagal membuat akun');
    }

    showToast(`Akun ${nama} berhasil dibuat`, 'success');
    closeUserModal();
    await loadUsers();
  } catch (e) {
    showUserError(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Buat Akun';
  }
}

async function toggleUserStatus(userId, currentActive) {
  const { error } = await db.from('profiles')
    .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) { showToast('Gagal mengubah status: ' + error.message, 'error'); return; }
  showToast(!currentActive ? 'Akun diaktifkan' : 'Akun dinonaktifkan', 'success');
  await loadUsers();
}

async function manageUserSLS(userId, nama) {
  const kode = prompt(`Tambah kode SLS untuk ${nama}:\n(Format 16 digit, contoh: 3602070001001900)`);
  if (!kode) return;
  if (!/^\d{16}$/.test(kode)) { showToast('Kode SLS harus 16 digit angka', 'error'); return; }
  const { error } = await db.from('user_sls').upsert({ user_id: userId, kode_sls: kode, status: 'aktif' });
  if (error) { showToast('Gagal menambah SLS: ' + error.message, 'error'); return; }
  showToast('SLS berhasil ditambahkan', 'success');
  await loadUsers();
}

// ============================================================
// SLS TANPA PPL
// ============================================================
async function loadUnassigned() {
  const tbody = document.getElementById('unassignedBody');

  const { data: activeSLS } = await db.from('user_sls').select('kode_sls').eq('status', 'aktif');
  const assignedSet = new Set((activeSLS || []).map(s => s.kode_sls));

  const { data: rows, error } = await db
    .from('assignment_anomali')
    .select('assignment_id, kode_sls_gabungan, tipe, nama_entitas')
    .not('status', 'eq', 'tidak_terdeteksi_lagi')
    .limit(200);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--error)">Gagal: ${error.message}</td></tr>`;
    return;
  }

  const unassigned = (rows || []).filter(r => !assignedSet.has(r.kode_sls_gabungan));
  if (unassigned.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">Semua SLS sudah terassign ke PPL</div></div></td></tr>`;
    return;
  }

  // Group by SLS
  const groups = {};
  unassigned.forEach(r => {
    if (!groups[r.kode_sls_gabungan]) groups[r.kode_sls_gabungan] = [];
    groups[r.kode_sls_gabungan].push(r);
  });

  tbody.innerHTML = Object.entries(groups).slice(0, 100).map(([sls, rs]) => `
    <tr>
      <td class="mono" style="font-size:0.75rem">${rs[0].assignment_id.slice(0, 8)}... (+${rs.length})</td>
      <td><span class="chip">${sls}</span></td>
      <td>${[...new Set(rs.map(r => r.tipe))].map(t => `<span class="type-badge type-${t}">${t}</span>`).join(' ')}</td>
      <td>${escHtml(rs[0].nama_entitas || '—')}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="assignSLStoPPL('${sls}')">Assign ke PPL</button>
      </td>
    </tr>`).join('');
}

async function assignSLStoPPL(kodeSLS) {
  const { data: ppls } = await db.from('profiles').select('id, nama, sobatid').eq('role', 'ppl').eq('is_active', true).order('nama');
  if (!ppls?.length) { showToast('Tidak ada PPL aktif', 'error'); return; }

  const choice = prompt(`Pilih PPL untuk SLS ${kodeSLS}:\n\n${ppls.map((p, i) => `${i + 1}. ${p.nama} (${p.sobatid})`).join('\n')}\n\nMasukkan nomor:`);
  if (!choice) return;

  const idx = parseInt(choice) - 1;
  if (idx < 0 || idx >= ppls.length) { showToast('Pilihan tidak valid', 'error'); return; }

  const { error } = await db.from('user_sls').upsert({ user_id: ppls[idx].id, kode_sls: kodeSLS, status: 'aktif' });
  if (error) { showToast('Gagal assign: ' + error.message, 'error'); return; }

  showToast(`SLS ${kodeSLS} berhasil di-assign ke ${ppls[idx].nama}`, 'success');
  await loadUnassigned();
}

// ============================================================
// BOOTSTRAP
// ============================================================
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    const session = await getSession();
    if (!session || !session.profile) { window.location.href = '/login.html'; return; }
    if (!['superadmin', 'admin'].includes(session.profile.role)) { window.location.href = '/dashboard.html'; return; }
    await initAdmin();
  })();
});
