// ============================================================
// ADMIN.JS — Super Admin Panel Logic
// Depends on: config.js, utils.js, auth.js, upload.js, import.js
// ============================================================

let adminProfile = null;
let parsedKK = null;   // { rows, records }
let parsedUsaha = null;   // { rows, records }
let batchId = null;
let allUsers = [];
let filteredUsers = [];
let currentUserPage = 1;
let userPageSize = 25;
let userSortField = 'nama';
let userSortDir = 'asc';
let editingRefId = null;

// Wilayah state variables
let allWilayah = [];
let filteredWilayah = [];
let currentWilayahPage = 1;
let wilayahPageSize = 25;
let wilayahSortField = 'nmkec';
let wilayahSortDir = 'asc';
let parsedWilayahExcel = null;

// ============================================================
// INIT & NAVIGATION
// ============================================================
async function initAdmin() {
  const session = await requireAuth(['superadmin', 'admin']);
  if (!session) return;
  adminProfile = session.profile;
  document.getElementById('adminName').textContent = getSessionName(adminProfile);

  // Load section based on URL Hash (default to 'upload' or 'history' depending on role)
  let initialSection = window.location.hash.substring(1) || 'upload';
  if (adminProfile.role === 'admin') {
    const forbidden = ['upload', 'unassigned', 'import-sls', 'import-users'];
    if (forbidden.includes(initialSection)) {
      initialSection = 'history';
    }

    // Hide forbidden navigation items
    document.getElementById('nav-upload')?.classList.add('hidden');
    document.getElementById('nav-unassigned')?.classList.add('hidden');
    document.getElementById('nav-import-sls')?.classList.add('hidden');

    // Hide superadmin-only buttons (Import Wilayah, Tambah Pengguna, Import Massal)
    document.querySelectorAll('.btn-superadmin-only').forEach(btn => btn.classList.add('hidden'));

    // Hide user actions column header
    document.querySelectorAll('.col-aksi-user').forEach(el => el.classList.add('hidden'));
  }

  showSection(initialSection, false);

  // Listen to browser Back/Forward or manual Hash changes
  window.addEventListener('hashchange', () => {
    const currentSection = window.location.hash.substring(1) || (adminProfile.role === 'admin' ? 'history' : 'upload');
    showSection(currentSection, false);
  });

  await loadBatchHistory();
  await loadAnomaliRef();
  await loadUsers();
  await loadUnassigned();
  await loadWilayah();
  await loadBAPPKecamatanFilter();
}

function showSection(sectionId, updateHash = true) {
  // Prevent admin from visiting forbidden sections
  if (adminProfile && adminProfile.role === 'admin') {
    const forbidden = ['upload', 'unassigned', 'import-sls', 'import-users'];
    if (forbidden.includes(sectionId)) {
      sectionId = 'history';
    }
  }

  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`panel-${sectionId}`)?.classList.add('active');
  document.getElementById(`nav-${sectionId}`)?.classList.add('active');

  if (sectionId === 'users') {
    loadUsers();
  }

  if (sectionId === 'bapp') {
    loadBAPPData();
  }

  if (updateHash) {
    window.location.hash = sectionId;
  }
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
  const isKK = tipe === 'keluarga';
  const labelId = isKK ? 'kkLabel' : 'usahaLabel';
  const zoneId = isKK ? 'zoneKK' : 'zoneUsaha';
  const validId = isKK ? 'kkValidation' : 'usahaValidation';

  document.getElementById(labelId).textContent = file.name;
  document.getElementById(validId).innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows = await parseExcelFile(file);
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
      if (isKK) parsedKK = { rows, records };
      else parsedUsaha = { rows, records };
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
  const btn = document.getElementById('validateBtn');
  const hint = document.getElementById('validateHint');
  const tanggal = document.getElementById('tanggalData')?.value;
  const hasFile = parsedKK || parsedUsaha;
  btn.disabled = !(hasFile && tanggal);
  hint.textContent = !tanggal ? 'Pilih tanggal data terlebih dahulu' :
    !hasFile ? 'Upload minimal 1 file Excel yang valid' :
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

  const tanggal = document.getElementById('tanggalData').value;
  const kkCount = parsedKK?.records.length || 0;
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
      tanggal_data: tanggal,
      uploaded_by_nama: getSessionName(adminProfile),
      uploaded_by_id: adminProfile.id,
      status: 'processing',
      jumlah_keluarga: parsedKK?.records.length || 0,
      jumlah_usaha: parsedUsaha?.records.length || 0
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
        pct < 80 ? `Memproses data... ${pct}%` :
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
    await checkMissingReferences(allRecords);
  } catch (e) {
    await db.from('upload_batches').update({ status: 'failed' }).eq('id', batchId);
    showToast('Merge gagal: ' + e.message, 'error');
    document.getElementById('mergeStatus').textContent = 'Terjadi kesalahan: ' + e.message;
  }
}

async function checkMissingReferences(allRecords) {
  // Query all references that do not have explanations filled out yet
  const { data: emptyRefs, error } = await db
    .from('anomali_ref')
    .select('id, tipe, nomor, nama, penjelasan')
    .or('penjelasan.is.null, penjelasan.eq.""');

  if (error) {
    console.error('Gagal memeriksa penjelasan referensi anomali:', error);
    return;
  }

  // Filter emptyRefs to show only the ones that were present in the uploaded file (allRecords)
  const uploadedKeys = new Set(allRecords.map(r => `${r.tipe}|${r.nomor_anomali}`));

  const missing = (emptyRefs || []).filter(r => uploadedKeys.has(`${r.tipe}|${r.nomor}`));

  const warnDiv = document.getElementById('newAnomaliesWarning');
  if (!warnDiv) return;

  if (missing.length === 0) {
    warnDiv.classList.add('hidden');
    warnDiv.innerHTML = '';
    return;
  }

  warnDiv.classList.remove('hidden');
  warnDiv.innerHTML = `
    <div class="alert alert-warning" style="display:block;border-left:4px solid var(--warning);padding:1rem">
      <div style="font-weight:600;margin-bottom:0.5rem;display:flex;align-items:center;gap:0.5rem">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--warning)"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        Terdeteksi ${missing.length} Anomali Baru (Belum Memiliki Panduan Solusi)
      </div>
      <div style="font-size:0.8125rem;color:var(--text-subtle);margin-bottom:0.75rem">
        Anomali berikut ditemukan dalam file Excel Anda namun belum memiliki penjelasan teknis/solusi di database. Silakan lengkapi secepatnya agar PPL mendapatkan panduan penanganannya.
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;background:var(--bg-card);padding:0.75rem;border-radius:var(--radius-md);border:1px solid var(--border);max-height:200px;overflow-y:auto">
        ${missing.map(m => `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;font-size:0.8125rem;border-bottom:1px solid var(--border);padding-bottom:0.4rem;margin-bottom:0.4rem">
            <div style="flex:1;text-align:left">
              <span class="type-badge type-${m.tipe}" style="font-size:0.7rem;padding:0.1rem 0.35rem">${m.tipe.toUpperCase()} ${m.nomor}</span>
              <span style="font-weight:500;margin-left:0.25rem">${escHtml(m.nama)}</span>
            </div>
            <button class="btn btn-secondary btn-sm" onclick='openEditRefModal(${JSON.stringify(m)})' style="font-size:0.75rem;padding:0.25rem 0.5rem;white-space:nowrap">
              + Lengkapi Panduan
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
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
  const newAnomWarn = document.getElementById('newAnomaliesWarning');
  if (newAnomWarn) {
    newAnomWarn.classList.add('hidden');
    newAnomWarn.innerHTML = '';
  }
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
      <td style="color:var(--text-muted);font-size:0.8rem">${new Date(b.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
      <td><span class="status-badge ${b.status === 'completed' ? 'status-kondisi' : b.status === 'failed' ? 'status-reopen' : 'status-pending'}">${b.status}</span></td>
    </tr>`).join('');
}

// ============================================================
// ANOMALI REF (CMS)
// ============================================================
async function loadAnomaliRef() {
  const tipe = document.getElementById('refTipeFilter')?.value || '';
  let query = db.from('anomali_ref').select('*').order('tipe').order('nomor');
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
  document.getElementById('refNomor').value = ref.nomor;
  document.getElementById('refTipe').value = ref.tipe;
  document.getElementById('refNama').value = ref.nama;
  document.getElementById('refPenjelasan').value = ref.penjelasan || '';
  document.getElementById('refModal').classList.add('open');
}

function closeRefModal() { document.getElementById('refModal').classList.remove('open'); }

async function saveAnomaliRef() {
  const nomor = parseInt(document.getElementById('refNomor').value);
  const tipe = document.getElementById('refTipe').value;
  const nama = document.getElementById('refNama').value.trim();
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

async function loadUsers() {
  let all = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  const isAdminRole = adminProfile && adminProfile.role === 'admin';
  document.getElementById('userTableBody').innerHTML = Array(5).fill(0).map(() => `
    <tr>
      <td><div class="skeleton skeleton-text" style="width: 140px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 80px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 50px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 160px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 100px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 60px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 60px; text-align: center; margin: 0 auto;"></div></td>
      <td><div class="skeleton skeleton-text" style="width: 60px;"></div></td>
      ${!isAdminRole ? `
      <td>
        <div style="display:flex;gap:0.35rem">
          <div class="skeleton skeleton-text" style="width: 60px; height: 26px; border-radius: var(--radius-md);"></div>
          <div class="skeleton skeleton-text" style="width: 90px; height: 26px; border-radius: var(--radius-md);"></div>
        </div>
      </td>` : ''}
    </tr>
  `).join('');

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

  // Fetch anomaly counts by SLS from database
  const { data: anomalyCounts, error: acError } = await db.rpc('get_anomaly_counts_by_sls');
  if (acError) console.error('Error fetching anomaly counts:', acError);

  const anomalyMap = {}; // kode_sls_gabungan -> { keluarga: number, usaha: number }
  (anomalyCounts || []).forEach(item => {
    const code = item.kode_sls_gabungan;
    if (!anomalyMap[code]) anomalyMap[code] = { keluarga: 0, usaha: 0 };
    if (item.tipe === 'keluarga') anomalyMap[code].keluarga += parseInt(item.total_anomali);
    else if (item.tipe === 'usaha') anomalyMap[code].usaha += parseInt(item.total_anomali);
  });

  // Fetch all kecamatan to map names
  const { data: kecList, error: kecErr } = await db.from('wilayah_kec').select('kode_kec, nmkec');
  const kecMap = {};
  if (!kecErr && kecList) {
    kecList.forEach(k => {
      kecMap[k.kode_kec] = k.nmkec;
    });
  }

  // Pass 1: Calculate PPL anomaly counts, kecamatan and store in a temporary map
  const pplAnomalyCounts = {};
  all.forEach(u => {
    if (u.role === 'ppl') {
      u.slsCount = pplSlsMap[u.id]?.size || 0;
      let count = 0;
      let kecName = '—';
      if (pplSlsMap[u.id] && pplSlsMap[u.id].size > 0) {
        const firstSls = [...pplSlsMap[u.id]][0];
        const kecCode = firstSls.slice(0, 7);
        kecName = kecMap[kecCode] || '—';
      }
      u.kecamatan = kecName;
      pplSlsMap[u.id]?.forEach(code => {
        count += anomalyMap[code]?.keluarga || 0;
      });
      u.anomalyCount = count;
      pplAnomalyCounts[u.id] = count;
    }
  });

  // Pass 2: Calculate PML anomaly counts as sum of supervised PPL counts
  all.forEach(u => {
    if (u.role === 'pml') {
      const supervised = pmlPplsMap[u.id];
      const uniqueSls = new Set();
      let count = 0;
      if (supervised) {
        supervised.forEach(pplId => {
          count += pplAnomalyCounts[pplId] || 0;
          pplSlsMap[pplId]?.forEach(s => uniqueSls.add(s));
        });
      }
      u.slsCount = uniqueSls.size;
      u.anomalyCount = count;
      let kecName = '—';
      if (uniqueSls.size > 0) {
        const firstSls = [...uniqueSls][0];
        const kecCode = firstSls.slice(0, 7);
        kecName = kecMap[kecCode] || '—';
      }
      u.kecamatan = kecName;
    } else if (u.role !== 'ppl') {
      u.slsCount = 0;
      u.anomalyCount = 0;
      u.kecamatan = '—';
    }
  });

  allUsers = all;
  filterUsers();
}

function filterUsers() {
  const search = document.getElementById('userSearch').value.toLowerCase();
  const role = document.getElementById('userRoleFilter').value;
  filteredUsers = allUsers.filter(u =>
    (!role || u.role === role) &&
    (!search ||
      u.nama.toLowerCase().includes(search) ||
      (u.sobatid || '').toLowerCase().includes(search) ||
      (u.email_ref || '').toLowerCase().includes(search))
  );
  sortUsersData();
  currentUserPage = 1;
  renderUsers();
}

function sortUsers(field) {
  userSortDir = userSortField === field ? (userSortDir === 'asc' ? 'desc' : 'asc') : 'asc';
  userSortField = field;

  document.querySelectorAll('th span.sort-icon').forEach(span => span.textContent = '⇅');
  const activeIcon = document.getElementById(`sort-${field}`);
  if (activeIcon) activeIcon.textContent = userSortDir === 'asc' ? '▲' : '▼';

  sortUsersData();
  currentUserPage = 1;
  renderUsers();
}

function sortUsersData() {
  filteredUsers.sort((a, b) => {
    let va, vb;
    switch (userSortField) {
      case 'nama': va = a.nama.toLowerCase(); vb = b.nama.toLowerCase(); break;
      case 'sobatid': va = a.sobatid || ''; vb = b.sobatid || ''; break;
      case 'role': va = a.role; vb = b.role; break;
      case 'email': va = (a.email_ref || '').toLowerCase(); vb = (b.email_ref || '').toLowerCase(); break;
      case 'kecamatan': va = (a.kecamatan || '').toLowerCase(); vb = (b.kecamatan || '').toLowerCase(); break;
      case 'sls': va = a.slsCount; vb = b.slsCount; break;
      case 'anomaly_count': va = a.anomalyCount || 0; vb = b.anomalyCount || 0; break;
      case 'is_active': va = a.is_active ? 1 : 0; vb = b.is_active ? 1 : 0; break;
      default: va = a.nama.toLowerCase(); vb = b.nama.toLowerCase();
    }
    if (va < vb) return userSortDir === 'asc' ? -1 : 1;
    if (va > vb) return userSortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderUsers() {
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
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">Tidak ada pengguna ditemukan</div></div></td></tr>`;
    const pag = document.getElementById('userPagination');
    if (pag) pag.innerHTML = '';
    return;
  }

  const isAdminRole = adminProfile && adminProfile.role === 'admin';
  tbody.innerHTML = pageData.map(u => `
    <tr>
      <td><strong>${escHtml(u.nama)}</strong></td>
      <td class="mono">${escHtml(u.sobatid || '—')}</td>
      <td><span class="type-badge type-${u.role === 'ppl' ? 'keluarga' : u.role === 'pml' ? 'usaha' : 'keduanya'}">${u.role.toUpperCase()}</span></td>
      <td style="color:var(--text-muted)">${escHtml(u.email_ref || '—')}</td>
      <td style="color:var(--text-muted)">${escHtml(u.kecamatan || '—')}</td>
      <td><span class="chip">${u.slsCount} SLS</span></td>
      <td style="text-align:center"><strong>${u.anomalyCount || 0}</strong></td>
      <td><span class="status-badge ${u.is_active ? 'status-kondisi' : 'status-clear'}">${u.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
      ${!isAdminRole ? `
      <td style="white-space:nowrap;display:flex;gap:0.35rem">
        <button class="btn btn-secondary btn-sm" onclick="manageUserSLS('${u.id}','${escHtml(u.nama)}')" title="Kelola SLS" ${u.role === 'pml' ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/></svg>
          SLS
        </button>
        <button class="btn btn-secondary btn-sm ${u.is_active ? 'text-error' : 'text-success'}" onclick="toggleUserStatus('${u.id}',${u.is_active})">
          ${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
      </td>` : ''}
    </tr>`).join('');

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
  const nik = document.getElementById('userNIK').value.trim();
  const nama = document.getElementById('userName').value.trim();
  const role = document.getElementById('userRole').value;
  const email = document.getElementById('userEmail').value.trim();

  if (!sobatid || !nik || !nama) { showUserError('Sobat ID, NIK, dan Nama wajib diisi'); return; }
  if (!/^\d+$/.test(sobatid)) { showUserError('Sobat ID harus berupa angka'); return; }

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
let allUnassignedGroups = [];
let currentUnassignedPage = 1;
let unassignedPageSize = 25;
let unassignedSortField = 'kode_sls';
let unassignedSortDir = 'asc';

async function loadUnassigned() {
  const tbody = document.getElementById('unassignedBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></td></tr>`;

  const { data: rows, error } = await db.rpc('get_unassigned_sls_summary');

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--error)">Gagal: ${error.message}</td></tr>`;
    return;
  }

  allUnassignedGroups = rows || [];
  sortUnassignedData();
  currentUnassignedPage = 1;
  renderUnassigned();
}

function renderUnassigned() {
  const tbody = document.getElementById('unassignedBody');
  if (!tbody) return;

  if (allUnassignedGroups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">Semua SLS sudah terassign ke PPL</div></div></td></tr>`;
    const pag = document.getElementById('unassignedPagination');
    if (pag) pag.innerHTML = '';
    return;
  }

  let pageData = allUnassignedGroups;
  if (unassignedPageSize !== 'all') {
    const start = (currentUnassignedPage - 1) * parseInt(unassignedPageSize);
    pageData = allUnassignedGroups.slice(start, start + parseInt(unassignedPageSize));
  }

  tbody.innerHTML = pageData.map(r => {
    const types = (r.tipe || '').split(', ').map(t => `<span class="type-badge type-${t.trim()}">${t.trim()}</span>`).join(' ');
    return `
    <tr>
      <td class="mono" style="font-size:0.75rem">${r.assignment_id ? r.assignment_id.slice(0, 8) : '—'}... (+${r.total_anomali})</td>
      <td><span class="chip">${r.kode_sls_gabungan}</span></td>
      <td>${types}</td>
      <td>${escHtml(r.nama_entitas || '—')}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="assignSLStoPPL('${r.kode_sls_gabungan}')">Assign ke PPL</button>
      </td>
    </tr>`;
  }).join('');

  renderUnassignedPagination();
}

function changeUnassignedPageSize() {
  unassignedPageSize = document.getElementById('unassignedPageSizeSelect').value;
  currentUnassignedPage = 1;
  renderUnassigned();
}

function goUnassignedPage(page) {
  currentUnassignedPage = page;
  renderUnassigned();
}

function renderUnassignedPagination() {
  const pag = document.getElementById('unassignedPagination');
  if (!pag) return;
  if (unassignedPageSize === 'all') { pag.innerHTML = ''; return; }

  const totalPages = Math.ceil(allUnassignedGroups.length / parseInt(unassignedPageSize));
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goUnassignedPage(${currentUnassignedPage - 1})" ${currentUnassignedPage === 1 ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  </button>`;

  const delta = 3;
  const range = [];
  for (let i = Math.max(1, currentUnassignedPage - delta); i <= Math.min(totalPages, currentUnassignedPage + delta); i++) {
    range.push(i);
  }

  if (range[0] > 1) {
    html += `<button class="page-btn" onclick="goUnassignedPage(1)">1</button>`;
    if (range[0] > 2) html += `<span style="padding:0 0.25rem;color:var(--text-muted)">...</span>`;
  }

  range.forEach(p => {
    html += `<button class="page-btn ${p === currentUnassignedPage ? 'active' : ''}" onclick="goUnassignedPage(${p})">${p}</button>`;
  });

  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) html += `<span style="padding:0 0.25rem;color:var(--text-muted)">...</span>`;
    html += `<button class="page-btn" onclick="goUnassignedPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="page-btn" onclick="goUnassignedPage(${currentUnassignedPage + 1})" ${currentUnassignedPage === totalPages ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6 6-6"/></svg>
  </button>`;

  pag.innerHTML = html;
}

function sortUnassigned(field) {
  unassignedSortDir = unassignedSortField === field ? (unassignedSortDir === 'asc' ? 'desc' : 'asc') : 'asc';
  unassignedSortField = field;

  document.querySelectorAll('th span[id^="sort-unassigned-"]').forEach(span => span.textContent = '⇅');
  const activeIcon = document.getElementById(`sort-unassigned-${field === 'assignment_id' ? 'id' : field === 'kode_sls' ? 'sls' : field === 'tipe' ? 'tipe' : 'name'}`);
  if (activeIcon) activeIcon.textContent = unassignedSortDir === 'asc' ? '▲' : '▼';

  sortUnassignedData();
  currentUnassignedPage = 1;
  renderUnassigned();
}

function sortUnassignedData() {
  allUnassignedGroups.sort((a, b) => {
    let va, vb;
    if (unassignedSortField === 'kode_sls') {
      va = a.kode_sls_gabungan;
      vb = b.kode_sls_gabungan;
    } else if (unassignedSortField === 'assignment_id') {
      va = a.assignment_id || '';
      vb = b.assignment_id || '';
    } else if (unassignedSortField === 'tipe') {
      va = a.tipe || '';
      vb = b.tipe || '';
    } else if (unassignedSortField === 'nama_entitas') {
      va = a.nama_entitas || '';
      vb = b.nama_entitas || '';
    }

    va = typeof va === 'string' ? va.toLowerCase() : va;
    vb = typeof vb === 'string' ? vb.toLowerCase() : vb;

    if (va < vb) return unassignedSortDir === 'asc' ? -1 : 1;
    if (va > vb) return unassignedSortDir === 'asc' ? 1 : -1;
    return 0;
  });
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
// MASTER WILAYAH
// ============================================================
async function loadWilayah() {
  const tbody = document.getElementById('wilayahTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></td></tr>`;

  let all = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await db
      .from('master_wilayah')
      .select('kode_sls_gabungan, nmkec, nmdesa, kdsls, kdsubsls, nmsls')
      .order('nmkec').order('nmdesa')
      .range(from, from + step - 1);

    if (error) { console.error('Error loading wilayah:', error); break; }
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      all = all.concat(data);
      if (data.length < step) hasMore = false;
      else from += step;
    }
  }

  allWilayah = all;
  filterWilayah();
}

function filterWilayah() {
  const search = document.getElementById('wilayahSearch').value.toLowerCase();
  filteredWilayah = allWilayah.filter(w =>
    !search ||
    w.nmkec.toLowerCase().includes(search) ||
    w.nmdesa.toLowerCase().includes(search) ||
    w.kode_sls_gabungan.includes(search) ||
    (w.kdsls || '').includes(search) ||
    (w.kdsubsls || '').includes(search) ||
    (w.nmsls || '').toLowerCase().includes(search)
  );
  sortWilayahData();
  currentWilayahPage = 1;
  renderWilayah();
}

function sortWilayah(field) {
  wilayahSortDir = wilayahSortField === field ? (wilayahSortDir === 'asc' ? 'desc' : 'asc') : 'asc';
  wilayahSortField = field;

  document.querySelectorAll('th span[id^="sort-wil-"]').forEach(span => span.textContent = '⇅');
  const activeIcon = document.getElementById(`sort-wil-${field === 'kode_sls_gabungan' ? 'kode' : field}`);
  if (activeIcon) activeIcon.textContent = wilayahSortDir === 'asc' ? '▲' : '▼';

  sortWilayahData();
  currentWilayahPage = 1;
  renderWilayah();
}

function sortWilayahData() {
  filteredWilayah.sort((a, b) => {
    let va = a[wilayahSortField] || '';
    let vb = b[wilayahSortField] || '';
    va = typeof va === 'string' ? va.toLowerCase() : va;
    vb = typeof vb === 'string' ? vb.toLowerCase() : vb;

    if (va < vb) return wilayahSortDir === 'asc' ? -1 : 1;
    if (va > vb) return wilayahSortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderWilayah() {
  const total = filteredWilayah.length;
  let pageData = filteredWilayah;

  if (wilayahPageSize !== 'all') {
    const start = (currentWilayahPage - 1) * parseInt(wilayahPageSize);
    pageData = filteredWilayah.slice(start, start + parseInt(wilayahPageSize));
  }

  document.getElementById('wilayahTableCount').textContent = `Total: ${filteredWilayah.length} wilayah | Menampilkan ${pageData.length} data`;

  const tbody = document.getElementById('wilayahTableBody');
  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-title">Tidak ada wilayah ditemukan</div></div></td></tr>`;
    const pag = document.getElementById('wilayahPagination');
    if (pag) pag.innerHTML = '';
    return;
  }

  tbody.innerHTML = pageData.map(w => `
    <tr>
      <td><strong>${escHtml(w.nmkec)}</strong></td>
      <td>${escHtml(w.nmdesa)}</td>
      <td class="mono">${escHtml(w.kdsls || '—')}</td>
      <td class="mono">${escHtml(w.kdsubsls || '—')}</td>
      <td class="mono">${escHtml(w.kode_sls_gabungan)}</td>
      <td style="color:var(--text-muted)">${escHtml(w.nmsls || '—')}</td>
    </tr>`).join('');

  renderWilayahPagination();
}

function changeWilayahPageSize() {
  wilayahPageSize = document.getElementById('wilayahPageSizeSelect').value;
  currentWilayahPage = 1;
  renderWilayah();
}

function goWilayahPage(page) {
  currentWilayahPage = page;
  renderWilayah();
}

function renderWilayahPagination() {
  const pag = document.getElementById('wilayahPagination');
  if (!pag) return;
  if (wilayahPageSize === 'all') { pag.innerHTML = ''; return; }

  const totalPages = Math.ceil(filteredWilayah.length / parseInt(wilayahPageSize));
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  let html = `<button class="page-btn" onclick="goWilayahPage(${currentWilayahPage - 1})" ${currentWilayahPage === 1 ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
  </button>`;

  const delta = 3;
  const range = [];
  for (let i = Math.max(1, currentWilayahPage - delta); i <= Math.min(totalPages, currentWilayahPage + delta); i++) {
    range.push(i);
  }

  if (range[0] > 1) {
    html += `<button class="page-btn" onclick="goWilayahPage(1)">1</button>`;
    if (range[0] > 2) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
  }

  range.forEach(i => {
    html += `<button class="page-btn ${i === currentWilayahPage ? 'active' : ''}" onclick="goWilayahPage(${i})">${i}</button>`;
  });

  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) html += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
    html += `<button class="page-btn" onclick="goWilayahPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="page-btn" onclick="goWilayahPage(${currentWilayahPage + 1})" ${currentWilayahPage === totalPages ? 'disabled' : ''}>
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
  </button>`;

  pag.innerHTML = html;
}

function openImportWilayahModal() {
  document.getElementById('importWilayahModal').classList.add('open');
  document.getElementById('fileWilayah').value = '';
  document.getElementById('wilayahImportLabel').textContent = 'Pilih atau seret file di sini';
  document.getElementById('wilayahValidation').innerHTML = '';
  document.getElementById('uploadWilayahBtn').disabled = true;
  parsedWilayahExcel = null;
}

function closeImportWilayahModal() {
  document.getElementById('importWilayahModal').classList.remove('open');
}

function handleWilayahDrop(e) {
  e.preventDefault();
  document.getElementById('zoneWilayah')?.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) processWilayahFile(file);
}

function handleWilayahFileSelect(e) {
  const file = e.target.files[0];
  if (file) processWilayahFile(file);
}

async function processWilayahFile(file) {
  document.getElementById('wilayahImportLabel').textContent = file.name;
  const validation = document.getElementById('wilayahValidation');
  validation.innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows = await parseExcelFile(file);
    if (!rows || rows.length < 2) {
      validation.innerHTML = '<div class="alert alert-error" style="padding:0.5rem;font-size:0.8rem">File tidak memiliki cukup baris</div>';
      return;
    }

    const headers = rows[0].map(h => (h || '').toString().toLowerCase().trim());
    const required = ['kdprov', 'kdkab', 'kdkec', 'kddesa', 'kdsls', 'kdsubsls', 'nmkec', 'nmdesa'];
    const missing = required.filter(h => !headers.includes(h));

    if (missing.length > 0) {
      validation.innerHTML = `<div class="alert alert-error" style="padding:0.5rem;font-size:0.8rem">Header kolom tidak lengkap. Kurang: ${missing.join(', ')}</div>`;
      return;
    }

    const headerIndices = {};
    headers.forEach((h, i) => headerIndices[h] = i);

    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0 || row[0] === null) continue;

      const getValue = (field) => {
        const idx = headerIndices[field];
        const val = row[idx];
        return val !== undefined && val !== null ? val.toString().trim() : '';
      };

      const kdprov = getValue('kdprov').padStart(2, '0');
      const kdkab = getValue('kdkab').padStart(2, '0');
      const kdkec = getValue('kdkec').padStart(3, '0');
      const kddesa = getValue('kddesa').padStart(3, '0');
      const kdsls = getValue('kdsls').padStart(4, '0');
      const kdsubsls = getValue('kdsubsls').padStart(2, '0');

      const nmkec = getValue('nmkec').toUpperCase();
      const nmdesa = getValue('nmdesa').toUpperCase();

      const nmprov = getValue('nmprov') || 'BANTEN';
      const nmkab = getValue('nmkab') || 'LEBAK';
      const nmsls = getValue('nmsls') || `SLS ${kdsls}`;
      const nmsubsls = getValue('nmsubsls') || nmsls;

      const idsubsls = getValue('idsubsls_25_2');
      const kode_sls_gabungan = idsubsls || (kdprov + kdkab + kdkec + kddesa + kdsls + kdsubsls);

      records.push({
        kode_sls_gabungan,
        kdprov, kdkab, kdkec, kddesa, kdsls, kdsubsls,
        nmprov, nmkab, nmkec, nmdesa, nmsls, nmsubsls
      });
    }

    parsedWilayahExcel = records;
    validation.innerHTML = `<div class="alert alert-success" style="padding:0.5rem;font-size:0.8rem;margin-bottom:0">Valid! Terdeteksi ${records.length} baris wilayah siap diimpor.</div>`;
    document.getElementById('uploadWilayahBtn').disabled = false;
  } catch (err) {
    console.error(err);
    validation.innerHTML = `<div class="alert alert-error" style="padding:0.5rem;font-size:0.8rem">Gagal membaca/memproses file: ${err.message}</div>`;
  }
}

async function uploadMasterWilayah() {
  if (!parsedWilayahExcel || parsedWilayahExcel.length === 0) return;

  const btn = document.getElementById('uploadWilayahBtn');
  btn.disabled = true;
  btn.textContent = 'Mengupload...';

  try {
    const chunkSize = 500;
    for (let i = 0; i < parsedWilayahExcel.length; i += chunkSize) {
      const chunk = parsedWilayahExcel.slice(i, i + chunkSize);
      const { error } = await db.rpc('import_master_wilayah_batch', { p_records: chunk });
      if (error) throw error;
    }

    showToast('Master Wilayah berhasil diupload!', 'success');
    closeImportWilayahModal();
    await loadWilayah();
  } catch (err) {
    console.error(err);
    showToast('Gagal upload Master Wilayah: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Upload Master Wilayah';
  }
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
    if (typeof closeRefModal === 'function') closeRefModal();
    if (typeof closeUserModal === 'function') closeUserModal();
    if (typeof closeImportWilayahModal === 'function') closeImportWilayahModal();
    if (typeof closeOverwriteModal === 'function') closeOverwriteModal();
  }
});

function exportUsersToExcel() {
  if (!allUsers || allUsers.length === 0) {
    showToast('Tidak ada data pengguna untuk diexport', 'error');
    return;
  }

  // Format data: Nama | Kecamatan | Petugas | SLS | JML Anomali
  const dataToExport = allUsers.map(u => ({
    'Nama': u.nama,
    'Kecamatan': u.kecamatan || '—',
    'Petugas': u.role.toUpperCase(),
    'SLS': u.slsCount ? `${u.slsCount} SLS` : '0 SLS',
    'JML Anomali': u.anomalyCount || 0
  }));

  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    XLSX.utils.book_append_sheet(wb, ws, 'Kelola Pengguna');
    XLSX.writeFile(wb, 'kelola_pengguna.xlsx');
    showToast('Pengguna berhasil diexport ke Excel!', 'success');
  } catch (err) {
    console.error('Export Excel error:', err);
    showToast('Gagal export Excel: ' + err.message, 'error');
  }
}

// ============================================================
// BAPP (CETAK PDF) MANAGEMENT LOGIC
// ============================================================
let allBappUploads = [];
let filteredBappUploads = [];

// Load Kecamatan to BAPP filter
async function loadBAPPKecamatanFilter() {
  try {
    const { data, error } = await db.from('wilayah_kec').select('kode_kec, nmkec').order('nmkec');
    if (error) throw error;

    const filterSelect = document.getElementById('bappKecamatanFilter');
    if (!filterSelect) return;

    // Clear and keep default option
    filterSelect.innerHTML = '<option value="">Semua Kecamatan</option>';
    data.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k.kode_kec;
      opt.textContent = `${k.kode_kec} - ${k.nmkec}`;
      filterSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading BAPP kecamatan filter:', err);
  }
}

// Load BAPP data from database
async function loadBAPPData() {
  const tbody = document.getElementById('bappTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></td></tr>';
  }

  try {
    const { data, error } = await db
      .from('bapp_uploads')
      .select('*, profiles:profile_id(nama, role, sobatid), wilayah_kec:kode_kec(nmkec)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allBappUploads = data || [];
    filterBAPP();
  } catch (err) {
    console.error('Error loading BAPP data:', err);
    showToast('Gagal memuat data BAPP: ' + err.message, 'error');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--error)">Gagal memuat: ${err.message}</td></tr>`;
    }
  }
}

// Filter BAPP data locally
function filterBAPP() {
  const kecVal = document.getElementById('bappKecamatanFilter')?.value || '';
  const roleVal = document.getElementById('bappRoleFilter')?.value || '';
  const timeStartVal = document.getElementById('bappTimeStart')?.value || '';
  const timeEndVal = document.getElementById('bappTimeEnd')?.value || '';

  filteredBappUploads = allBappUploads.filter(b => {
    // Filter Kecamatan
    if (kecVal && b.kode_kec !== kecVal) return false;

    // Filter Role
    const role = b.profiles?.role || '';
    if (roleVal && role !== roleVal) return false;

    // Filter Range Waktu Upload
    if (timeStartVal) {
      const startLimit = new Date(timeStartVal).getTime();
      const uploadTime = new Date(b.created_at).getTime();
      if (uploadTime < startLimit) return false;
    }
    if (timeEndVal) {
      const endLimit = new Date(timeEndVal).getTime();
      const uploadTime = new Date(b.created_at).getTime();
      if (uploadTime > endLimit) return false;
    }

    return true;
  });

  renderBAPPTable();
}

// Render BAPP Table Rows
function renderBAPPTable() {
  const tbody = document.getElementById('bappTableBody');
  const countEl = document.getElementById('bappTableCount');
  if (!tbody) return;

  // Reset select-all checkbox
  const selectAllCheckbox = document.getElementById('selectAllBapp');
  if (selectAllCheckbox) selectAllCheckbox.checked = false;

  if (countEl) {
    countEl.textContent = `Total: ${filteredBappUploads.length} petugas`;
  }

  if (filteredBappUploads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data upload screenshot Fasih yang cocok</td></tr>';
    updateSelectedBappCount();
    return;
  }

  tbody.innerHTML = filteredBappUploads.map(b => {
    const timeText = formatDate(b.created_at, true);
    const nama = b.profiles?.nama || '—';
    const sobatid = b.profiles?.sobatid || '—';
    const role = b.profiles?.role ? b.profiles.role.toUpperCase() : '—';
    const kecamatan = b.wilayah_kec?.nmkec || '—';

    return `
      <tr>
        <td style="text-align:center">
          <input type="checkbox" class="bapp-row-checkbox" value="${b.id}" onchange="updateSelectedBappCount()">
        </td>
        <td style="font-weight:600">${escHtml(nama)}</td>
        <td style="font-family:monospace">${escHtml(sobatid)}</td>
        <td><span class="role-badge role-${role.toLowerCase()}">${role}</span></td>
        <td>${escHtml(kecamatan)}</td>
        <td style="color:var(--text-muted)">${timeText}</td>
        <td style="text-align:center">
          <button class="btn btn-secondary btn-sm" onclick="printSingleBAPP('${b.id}')" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Cetak PDF
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateSelectedBappCount();
}

// Select All Handler
function toggleSelectAllBapp(checked) {
  document.querySelectorAll('.bapp-row-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  updateSelectedBappCount();
}

// Update selected count and show/hide batch print button
function updateSelectedBappCount() {
  const checkboxes = document.querySelectorAll('.bapp-row-checkbox:checked');
  const count = checkboxes.length;

  const countSpan = document.getElementById('selectedBappCount');
  const printBtn = document.getElementById('btnPrintSelected');

  if (countSpan) countSpan.textContent = count;
  if (printBtn) {
    printBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

// Print single BAPP by ID
function printSingleBAPP(id) {
  const b = allBappUploads.find(item => item.id === id);
  if (b) printBAPP([b]);
}

// Print all selected BAPPs
function printSelectedBAPP() {
  const checkedIds = Array.from(document.querySelectorAll('.bapp-row-checkbox:checked')).map(cb => cb.value);
  const selectedRows = allBappUploads.filter(b => checkedIds.includes(b.id));

  if (selectedRows.length > 0) {
    printBAPP(selectedRows);
  }
}

// Generate PDF Page and trigger Print dialog
function printBAPP(rows) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Gagal membuka jendela cetak. Pastikan pop-up dibolehkan!', 'error');
    return;
  }

  const pagesHtml = rows.map((row, idx) => {
    const namaPetugas = row.profiles?.nama || '.........................................';
    const isLast = idx === rows.length - 1;

    return `
      <div class="bapp-page ${isLast ? '' : 'page-break'}">
        <div class="page-number">-4-</div>
        
        <div class="section-title">II. BUKTI PENCAPAIAN PEKERJAAN</div>
        
        <div class="screenshot-container">
          <div class="screenshot-img-wrapper">
            <img class="screenshot-img" src="${row.screenshot}" alt="Screenshot Bukti Kerja">
          </div>
        </div>
        
        <div class="signature-container">
          <div class="signature-box" style="text-align: left; padding-left: 10mm;">
            <div>PIHAK KEDUA,</div>
            <div style="height: 5rem;"></div>
            <div class="signature-name">${escHtml(namaPetugas)}</div>
          </div>
          
          <div class="signature-box" style="text-align: right; padding-right: 10mm;">
            <div>PIHAK PERTAMA,</div>
            <div style="height: 5rem;"></div>
            <div class="signature-name">YULIAN SARWO EDI</div>
          </div>
          
          <div class="signature-row-2">
            <div class="signature-box" style="text-align: center;">
              <div>Menyetujui,</div>
              <div>Pejabat Pembuat Komitmen</div>
              <div style="height: 5rem;"></div>
              <div class="signature-name">NING SRI LESTARI</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <title>Cetak Lampiran BAPP - Termin I</title>
      <style>
        @media print {
          @page {
            size: A4 landscape;
            margin: 0; /* Menghilangkan Header (Title/Timestamp) & Footer (URL) bawaan browser */
          }
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          .no-print {
            display: none;
          }
        }
        body {
          font-family: 'Times New Roman', Times, serif;
          font-size: 11pt;
          line-height: 1.3;
          color: #000;
          margin: 15mm 20mm 15mm 20mm; /* Pindahkan margin kertas ke body */
          padding: 0;
          background-color: #fff;
        }
        .bapp-page {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          min-height: 180mm; /* Fits inside printable area of A4 Landscape */
        }
        .page-number {
          text-align: center;
          margin-bottom: 1rem;
          font-size: 11pt;
        }
        .section-title {
          font-weight: bold;
          font-size: 12pt;
          margin-bottom: 1rem;
        }
        .screenshot-container {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0.5rem 0;
        }
        .screenshot-img-wrapper {
          border: 1px solid #000;
          padding: 3px;
          background: #fff;
          display: inline-block;
          box-sizing: border-box;
        }
        .screenshot-img {
          width: 80mm;
          height: 80mm;
          object-fit: cover;
          object-position: top;
          display: block;
        }
        .signature-container {
          margin-top: auto;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem 2rem;
          font-size: 11pt;
          padding-top: 0.5rem;
        }
        .signature-row-2 {
          grid-column: 1 / -1;
          display: flex;
          justify-content: center;
          margin-top: 0.25rem;
        }
        .signature-box {
          display: inline-block;
        }
        .signature-name {
          font-weight: bold;
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      ${pagesHtml}
      <script>
        // Trigger print once everything has loaded
        window.addEventListener('DOMContentLoaded', () => {
          // Wait briefly for images to render
          setTimeout(() => {
            window.print();
            // Close tab after print dialog completes
            window.onafterprint = () => window.close();
          }, 500);
        });
      <\/script>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

