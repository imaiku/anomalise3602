// ============================================================
// ADMIN.JS — Super Admin Panel Logic
// ============================================================

let adminProfile = null;
let parsedKK = null;      // { rows, records }
let parsedUsaha = null;   // { rows, records }
let batchId = null;
let allUsers = [];
let editingRefId = null;

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

// ---- Init ----
async function initAdmin() {
  const session = await requireAuth(['superadmin', 'admin']);
  if (!session) return;
  adminProfile = session.profile;
  document.getElementById('adminName').textContent = getSessionName(adminProfile);

  // Load initial sections
  await loadBatchHistory();
  await loadAnomaliRef();
  await loadUsers();
  await loadUnassigned();
}

// ---- Sidebar Navigation ----
function showSection(sectionId) {
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  const panel = document.getElementById(`panel-${sectionId}`);
  const nav   = document.getElementById(`nav-${sectionId}`);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
}

// ============================================================
// UPLOAD SECTION
// ============================================================

function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add('drag-over');
}
function handleDragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove('drag-over');
}
function handleDrop(e, tipe) {
  e.preventDefault();
  const zoneId = tipe === 'kk' ? 'zoneKK' : 'zoneUsaha';
  document.getElementById(zoneId).classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file, tipe === 'kk' ? 'keluarga' : 'usaha');
}
function handleFileSelect(e, tipe) {
  const file = e.target.files[0];
  if (file) processFile(file, tipe === 'kk' ? 'keluarga' : 'usaha');
}

async function processFile(file, tipe) {
  const labelId = tipe === 'keluarga' ? 'kkLabel' : 'usahaLabel';
  const zoneId  = tipe === 'keluarga' ? 'zoneKK'  : 'zoneUsaha';
  const validId = tipe === 'keluarga' ? 'kkValidation' : 'usahaValidation';

  document.getElementById(labelId).textContent = file.name;
  document.getElementById(validId).innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows = await parseExcelFile(file);
    const result = validateExcel(rows, tipe);

    if (!result.valid) {
      document.getElementById(zoneId).classList.remove('has-file');
      document.getElementById(validId).innerHTML = `
        <div class="validation-errors">
          <strong>Validasi Gagal:</strong>
          <ul>${result.errors.map(e => `<li>${escAdmin(e)}</li>`).join('')}</ul>
        </div>`;
      if (tipe === 'keluarga') parsedKK = null;
      else parsedUsaha = null;
    } else {
      document.getElementById(zoneId).classList.add('has-file');
      const count = result.dataRows.length;
      document.getElementById(validId).innerHTML = `
        <div class="alert alert-success">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          <span>Validasi berhasil — ${count.toLocaleString('id')} baris data ditemukan</span>
        </div>`;
      const records = rowsToRecordsFull(rows, tipe, document.getElementById('tanggalData').value || new Date().toISOString().slice(0, 10));
      if (tipe === 'keluarga') parsedKK    = { rows, records };
      else                     parsedUsaha = { rows, records };
    }
  } catch (e) {
    document.getElementById(validId).innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        <span>${escAdmin(e.message)}</span>
      </div>`;
    if (tipe === 'keluarga') parsedKK = null;
    else parsedUsaha = null;
  }

  checkValidateBtn();
}

function checkValidateBtn() {
  const btn     = document.getElementById('validateBtn');
  const hint    = document.getElementById('validateHint');
  const tanggal = document.getElementById('tanggalData').value;
  const hasFile = parsedKK || parsedUsaha;
  btn.disabled  = !(hasFile && tanggal);
  hint.textContent = !tanggal ? 'Pilih tanggal data terlebih dahulu' :
                     !hasFile  ? 'Upload minimal 1 file Excel yang valid' :
                                 'Siap untuk dilanjutkan';
}

document.addEventListener('DOMContentLoaded', () => {
  const tanggalInput = document.getElementById('tanggalData');
  if (tanggalInput) tanggalInput.addEventListener('change', checkValidateBtn);
});

async function startValidation() {
  // Check SLS consistency if both files exist
  if (parsedKK && parsedUsaha) {
    const warnings = checkSLSConsistency(parsedKK.records, parsedUsaha.records);
    if (warnings.length > 0) {
      document.getElementById('consistencyWarnings').innerHTML = `
        <div class="alert alert-warning mb-4">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div>
            <strong>Peringatan Konsistensi SLS</strong>
            <ul style="margin:0.25rem 0 0 1rem;font-size:0.8rem">${warnings.slice(0, 5).map(w => `<li>${escAdmin(w)}</li>`).join('')}${warnings.length > 5 ? `<li>...dan ${warnings.length - 5} peringatan lainnya</li>` : ''}</ul>
          </div>
        </div>`;
    } else {
      document.getElementById('consistencyWarnings').innerHTML = '';
    }
  }

  const tanggal = document.getElementById('tanggalData').value;
  const kkCount    = parsedKK?.records.length || 0;
  const usahaCount = parsedUsaha?.records.length || 0;

  // Show step 2
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

  // Create batch record
  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .insert({
      tanggal_data:     tanggal,
      uploaded_by_nama: getSessionName(adminProfile),
      uploaded_by_id:   adminProfile.id,
      status:           'processing',
      jumlah_keluarga:  parsedKK?.records.length || 0,
      jumlah_usaha:     parsedUsaha?.records.length || 0
    })
    .select('id').single();

  if (batchErr) {
    showAdminToast('Gagal membuat batch: ' + batchErr.message, 'error');
    backToStep1(); return;
  }

  batchId = batch.id;
  const allRecords = [...(parsedKK?.records || []), ...(parsedUsaha?.records || [])];

  try {
    const results = await mergeRecords(allRecords, batchId, tanggal, (pct) => {
      document.getElementById('mergeProgress').style.width = pct + '%';
      document.getElementById('mergeStatus').textContent =
        pct < 80  ? `Memproses data... ${pct}%` :
        pct < 100 ? 'Menyelesaikan auto-resolve...' : 'Selesai!';
    });

    // Update batch status
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
          <div>${results.errors.length} baris gagal diproses. <ul style="margin:0.25rem 0 0 1rem;font-size:0.8rem">${results.errors.slice(0,5).map(e=>`<li>${escAdmin(e)}</li>`).join('')}</ul></div>
        </div>`);
    }

    showAdminToast('Merge berhasil!', 'success');
    await loadBatchHistory();
  } catch (e) {
    await db.from('upload_batches').update({ status: 'failed' }).eq('id', batchId);
    showAdminToast('Merge gagal: ' + e.message, 'error');
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
  ['zoneKK', 'zoneUsaha'].forEach(id => document.getElementById(id).classList.remove('has-file'));
  ['kkLabel', 'usahaLabel'].forEach(id => document.getElementById(id).textContent = 'Pilih atau seret file di sini');
  ['kkValidation', 'usahaValidation'].forEach(id => document.getElementById(id).innerHTML = '');
  document.getElementById('fileKK').value = '';
  document.getElementById('fileUsaha').value = '';
  document.getElementById('consistencyWarnings').innerHTML = '';
  ['uploadStep2','uploadStep3','uploadStep4'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('uploadStep1').classList.remove('hidden');
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

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-title">Belum ada riwayat upload</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(b => `
    <tr>
      <td><strong>${b.tanggal_data}</strong></td>
      <td>${escAdmin(b.uploaded_by_nama || '—')}</td>
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
  const tipe = document.getElementById('refTipeFilter')?.value || '';
  let query = db.from('anomali_ref').select('*').order('tipe').order('nomor');
  if (tipe) query = query.eq('tipe', tipe);

  const { data, error } = await query;
  const grid = document.getElementById('anomaliRefGrid');

  if (error) { grid.innerHTML = `<div style="color:var(--error)">Gagal memuat: ${error.message}</div>`; return; }

  if (!data || data.length === 0) {
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
          <button class="btn btn-ghost btn-icon btn-sm" onclick="openEditRefModal(${JSON.stringify(ref).split('"').join('&quot;')})" title="Edit">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteAnomaliRef(${ref.id})" title="Hapus" style="color:var(--error)">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
      <div style="font-weight:600;margin-bottom:0.25rem;font-size:0.875rem">${escAdmin(ref.nama)}</div>
      ${ref.penjelasan ? `<div style="font-size:0.8rem;color:var(--text-muted);line-height:1.5">${escAdmin(ref.penjelasan)}</div>` : ''}
    </div>`).join('');
}

function openAddRefModal() {
  editingRefId = null;
  document.getElementById('refModalTitle').textContent = 'Tambah Referensi Anomali';
  document.getElementById('refNomor').value = '';
  document.getElementById('refTipe').value = 'keluarga';
  document.getElementById('refNama').value = '';
  document.getElementById('refPenjelasan').value = '';
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
  const nomor     = parseInt(document.getElementById('refNomor').value);
  const tipe      = document.getElementById('refTipe').value;
  const nama      = document.getElementById('refNama').value.trim();
  const penjelas  = document.getElementById('refPenjelasan').value.trim();

  if (!nomor || !tipe || !nama) { showAdminToast('Nomor, tipe, dan nama wajib diisi', 'error'); return; }

  const payload = { nomor, tipe, nama, penjelasan: penjelas || null, updated_at: new Date().toISOString() };

  let error;
  if (editingRefId) {
    ({ error } = await db.from('anomali_ref').update(payload).eq('id', editingRefId));
  } else {
    ({ error } = await db.from('anomali_ref').insert(payload));
  }

  if (error) { showAdminToast('Gagal menyimpan: ' + error.message, 'error'); return; }

  showAdminToast('Referensi berhasil disimpan', 'success');
  closeRefModal();
  await loadAnomaliRef();
}

async function deleteAnomaliRef(id) {
  if (!confirm('Yakin hapus referensi ini?')) return;
  const { error } = await db.from('anomali_ref').delete().eq('id', id);
  if (error) { showAdminToast('Gagal menghapus: ' + error.message, 'error'); return; }
  showAdminToast('Referensi dihapus', 'success');
  await loadAnomaliRef();
}

// ============================================================
// USER MANAGEMENT
// ============================================================
async function loadUsers() {
  const { data, error } = await db
    .from('profiles')
    .select('id, sobatid, nama, role, email_ref, is_active')
    .in('role', ['ppl', 'pml'])
    .order('role').order('nama');

  if (error) { console.error(error); return; }
  allUsers = data || [];
  renderUsers(allUsers);
}

function filterUsers() {
  const search = document.getElementById('userSearch').value.toLowerCase();
  const role   = document.getElementById('userRoleFilter').value;
  const filtered = allUsers.filter(u =>
    (!role || u.role === role) &&
    (!search || u.nama.toLowerCase().includes(search) || (u.sobatid || '').toLowerCase().includes(search))
  );
  renderUsers(filtered);
}

async function renderUsers(users) {
  document.getElementById('userTableCount').textContent = `${users.length} pengguna`;
  const tbody = document.getElementById('userTableBody');
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">Tidak ada pengguna ditemukan</div></div></td></tr>`;
    return;
  }

  // Load SLS count for each user
  const userIds = users.map(u => u.id);
  const { data: slsData } = await db
    .from('user_sls')
    .select('user_id, kode_sls')
    .in('user_id', userIds)
    .eq('status', 'aktif');

  const slsMap = {};
  (slsData || []).forEach(s => {
    if (!slsMap[s.user_id]) slsMap[s.user_id] = 0;
    slsMap[s.user_id]++;
  });

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${escAdmin(u.nama)}</strong></td>
      <td class="mono">${escAdmin(u.sobatid || '—')}</td>
      <td><span class="type-badge type-${u.role === 'ppl' ? 'keluarga' : 'usaha'}">${u.role.toUpperCase()}</span></td>
      <td style="color:var(--text-muted)">${escAdmin(u.email_ref || '—')}</td>
      <td>${slsMap[u.id] || 0} SLS</td>
      <td>
        <span class="status-badge ${u.is_active ? 'status-kondisi' : 'status-clear'}">
          ${u.is_active ? 'Aktif' : 'Nonaktif'}
        </span>
      </td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="manageUserSLS('${u.id}','${escAdmin(u.nama)}')" title="Kelola SLS">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/></svg>
          SLS
        </button>
        <button class="btn btn-ghost btn-sm ${u.is_active ? 'text-error' : 'text-success'}" onclick="toggleUserStatus('${u.id}',${u.is_active})">
          ${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
      </td>
    </tr>`).join('');
}

function openAddUserModal() {
  document.getElementById('userSobatid').value = '';
  document.getElementById('userNIK').value = '';
  document.getElementById('userName').value = '';
  document.getElementById('userRole').value = 'ppl';
  document.getElementById('userEmail').value = '';
  document.getElementById('userFormError').classList.add('hidden');
  document.getElementById('userModal').classList.add('open');
}
function closeUserModal() { document.getElementById('userModal').classList.remove('open'); }

async function createUser() {
  const sobatid = document.getElementById('userSobatid').value.trim();
  const nik     = document.getElementById('userNIK').value.trim();
  const nama    = document.getElementById('userName').value.trim();
  const role    = document.getElementById('userRole').value;
  const email   = document.getElementById('userEmail').value.trim();

  if (!sobatid || !nik || !nama) {
    showUserError('Sobat ID, NIK, dan Nama wajib diisi');
    return;
  }
  if (!/^\d+$/.test(sobatid)) { showUserError('Sobat ID harus berupa angka'); return; }

  const btn = document.getElementById('createUserBtn');
  btn.disabled = true; btn.textContent = 'Membuat akun...';

  try {
    // Create auth user: email = sobatid@ppl.anomali.id, password = NIK
    const authEmail = `${sobatid}@ppl.anomali.id`;

    // Note: Creating users from client side requires admin access
    // This uses Supabase's signUp which creates the user
    const { data: signUpData, error: signUpErr } = await db.auth.admin?.createUser?.({
      email: authEmail, password: nik, email_confirm: true
    }) || await db.auth.signUp({ email: authEmail, password: nik });

    if (signUpErr) throw signUpErr;

    const userId = signUpData.user?.id;
    if (!userId) throw new Error('Gagal mendapatkan User ID dari Supabase');

    // Insert profile
    const { error: profileErr } = await db.from('profiles').insert({
      id: userId, sobatid, nama, role,
      email_ref: email || null,
      is_active: true
    });

    if (profileErr) throw profileErr;

    showAdminToast(`Akun ${nama} berhasil dibuat`, 'success');
    closeUserModal();
    await loadUsers();
  } catch (e) {
    showUserError(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Buat Akun';
  }
}

function showUserError(msg) {
  document.getElementById('userFormErrorText').textContent = msg;
  document.getElementById('userFormError').classList.remove('hidden');
}

async function toggleUserStatus(userId, currentActive) {
  const newStatus = !currentActive;
  const { error } = await db.from('profiles').update({ is_active: newStatus, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) { showAdminToast('Gagal mengubah status: ' + error.message, 'error'); return; }
  showAdminToast(newStatus ? 'Akun diaktifkan' : 'Akun dinonaktifkan', 'success');
  await loadUsers();
}

async function manageUserSLS(userId, nama) {
  // For now, show a prompt to add a SLS code
  const kode = prompt(`Tambah kode SLS untuk ${nama}:\n(Format 16 digit, contoh: 3602070001001900)`);
  if (!kode) return;
  if (!/^\d{16}$/.test(kode)) { showAdminToast('Kode SLS harus 16 digit angka', 'error'); return; }
  const { error } = await db.from('user_sls').upsert({ user_id: userId, kode_sls: kode, status: 'aktif' });
  if (error) { showAdminToast('Gagal menambah SLS: ' + error.message, 'error'); return; }
  showAdminToast('SLS berhasil ditambahkan', 'success');
  await loadUsers();
}

// ============================================================
// SLS TANPA PPL
// ============================================================
async function loadUnassigned() {
  const tbody = document.getElementById('unassignedBody');

  // Get all active SLS codes
  const { data: activeSLS } = await db.from('user_sls').select('kode_sls').eq('status', 'aktif');
  const assignedSLS = new Set((activeSLS || []).map(s => s.kode_sls));

  // Get distinct SLS from assignment_anomali that are not in assignedSLS
  const { data: rows, error } = await db
    .from('assignment_anomali')
    .select('assignment_id, kode_sls_gabungan, tipe, nama_entitas')
    .not('status', 'eq', 'tidak_terdeteksi_lagi')
    .limit(200);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--error)">Gagal: ${error.message}</td></tr>`;
    return;
  }

  const unassigned = (rows || []).filter(r => !assignedSLS.has(r.kode_sls_gabungan));
  if (unassigned.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">Semua SLS sudah terassign ke PPL</div></div></td></tr>`;
    return;
  }

  // Group by SLS
  const slsGroups = {};
  unassigned.forEach(r => {
    if (!slsGroups[r.kode_sls_gabungan]) slsGroups[r.kode_sls_gabungan] = [];
    slsGroups[r.kode_sls_gabungan].push(r);
  });

  tbody.innerHTML = Object.entries(slsGroups).slice(0, 100).map(([sls, rows]) => `
    <tr>
      <td class="mono" style="font-size:0.75rem">${rows[0].assignment_id.slice(0, 8)}... (+${rows.length})</td>
      <td><span class="chip">${sls}</span></td>
      <td>${[...new Set(rows.map(r => r.tipe))].map(t => `<span class="type-badge type-${t}">${t}</span>`).join(' ')}</td>
      <td>${escAdmin(rows[0].nama_entitas || '—')}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="assignSLStoPPL('${sls}')">
          Assign ke PPL
        </button>
      </td>
    </tr>`).join('');
}

async function assignSLStoPPL(kodeSLS) {
  // Load PPL list
  const { data: ppls } = await db.from('profiles').select('id, nama, sobatid').eq('role', 'ppl').eq('is_active', true).order('nama');
  if (!ppls || ppls.length === 0) { showAdminToast('Tidak ada PPL aktif', 'error'); return; }

  const pplChoices = ppls.map((p, i) => `${i + 1}. ${p.nama} (${p.sobatid})`).join('\n');
  const choice = prompt(`Pilih PPL untuk SLS ${kodeSLS}:\n\n${pplChoices}\n\nMasukkan nomor:`);
  if (!choice) return;

  const idx = parseInt(choice) - 1;
  if (idx < 0 || idx >= ppls.length) { showAdminToast('Pilihan tidak valid', 'error'); return; }

  const selectedPPL = ppls[idx];
  const { error } = await db.from('user_sls').upsert({ user_id: selectedPPL.id, kode_sls: kodeSLS, status: 'aktif' });
  if (error) { showAdminToast('Gagal assign: ' + error.message, 'error'); return; }

  showAdminToast(`SLS ${kodeSLS} berhasil di-assign ke ${selectedPPL.nama}`, 'success');
  await loadUnassigned();
}

// ============================================================
// HELPERS
// ============================================================
function escAdmin(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAdminToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const id = 'toast-' + Date.now();
  const icons = {
    success: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>',
    warning: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info:    '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };
  const t = document.createElement('div');
  t.id = id;
  t.className = `toast ${type}`;
  t.innerHTML = `${icons[type]||''}<span style="flex:1">${escAdmin(message)}</span><button class="toast-close" onclick="document.getElementById('${id}').remove()"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg></button>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ---- Bootstrap ----
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  (async () => {
    const session = await getSession();
    if (!session || !session.profile) { window.location.href = '/login.html'; return; }
    if (!['superadmin', 'admin'].includes(session.profile.role)) { window.location.href = '/dashboard.html'; return; }
    await initAdmin();
  })();
});
