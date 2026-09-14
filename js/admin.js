// ============================================================
// ADMIN.JS — Super Admin Panel Logic
// Depends on: config.js, utils.js, auth.js, upload.js, import.js
// ============================================================
let adminProfile = null;
let parsedData = null;   // { rows, records, warnings }
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
  if (adminProfile && adminProfile.role === 'superadmin') {
    initPresence();
  }
}

// ============================================================
// REALTIME PRESENCE
// ============================================================
let presenceChannel = null;

async function initPresence() {
  const panel = document.getElementById('presencePanel');
  if (panel) panel.style.display = '';

  const displayName = getSessionName(adminProfile);

  // Interval per role (ms)
  const INTERVAL_MS = {
    admin: 1 * 60 * 1000,
    superadmin: 5 * 60 * 1000,
    pml: 60 * 60 * 1000,
    ppl: 60 * 60 * 1000,
  };
  const intervalMs = INTERVAL_MS[adminProfile.role] ?? (5 * 60 * 1000);

  try {
    await db.rpc('upsert_last_seen', {
      p_display_name: displayName,
      p_role: adminProfile.role
    });
  } catch (err) {
    console.error('Error upserting last_seen:', err);
  }

  setInterval(async () => {
    try {
      await db.rpc('upsert_last_seen', {
        p_display_name: displayName,
        p_role: adminProfile.role
      });
    } catch (err) {
      console.error('Error periodic upserting last_seen:', err);
    }
  }, intervalMs);

  presenceChannel = db.channel('presence:anomali', {
    config: { presence: { key: adminProfile.id } }
  });

  const updatePresenceUI = async () => {
    const history = await loadLastSeenHistory();
    renderUnifiedPresence(presenceChannel.presenceState(), history);
  };

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      updatePresenceUI();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          nama: displayName,
          role: adminProfile.role,
          joined_at: new Date().toISOString()
        });
        updatePresenceUI();
      }
    });
}

async function loadLastSeenHistory() {
  try {
    const { data, error } = await db
      .from('user_last_seen')
      .select('display_name, role, last_seen')
      .order('last_seen', { ascending: false })
      .limit(10);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching user_last_seen history:', err);
    return [];
  }
}

function renderUnifiedPresence(presenceState, historyRows) {
  const list = document.getElementById('presenceList');
  const countEl = document.getElementById('presenceCount');
  if (!list) return;

  const onlineUsers = Object.values(presenceState).flat();
  const onlineKeys = new Set(onlineUsers.map(u => `${u.nama}|${u.role}`));
  if (countEl) countEl.textContent = onlineUsers.length;

  const unifiedMap = new Map();

  // Masukkan data history terlebih dahulu (max 10)
  historyRows.forEach(row => {
    const key = `${row.display_name}|${row.role}`;
    unifiedMap.set(key, {
      nama: row.display_name,
      role: row.role,
      last_seen: row.last_seen,
      isOnline: onlineKeys.has(key)
    });
  });

  // Jika ada user online yang belum ada di history, tambahkan
  onlineUsers.forEach(u => {
    const key = `${u.nama}|${u.role}`;
    if (!unifiedMap.has(key)) {
      unifiedMap.set(key, {
        nama: u.nama,
        role: u.role,
        last_seen: u.joined_at,
        isOnline: true
      });
    } else {
      unifiedMap.get(key).isOnline = true;
    }
  });

  let unifiedList = Array.from(unifiedMap.values());
  unifiedList.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
  unifiedList = unifiedList.slice(0, 10);

  const ROLE_COLORS = {
    superadmin: { bg: '#7c3aed', text: '#fff' },
    admin: { bg: '#ea580c', text: '#fff' },
    pml: { bg: '#0284c7', text: '#fff' },
    ppl: { bg: '#16a34a', text: '#fff' },
  };

  const now = Date.now();
  list.innerHTML = unifiedList.map(u => {
    const color = ROLE_COLORS[u.role] || { bg: '#64748b', text: '#fff' };
    const initials = (u.nama || '?').substring(0, 2).toUpperCase();
    const diffMin = Math.floor((now - new Date(u.last_seen)) / 60000);
    const timeLabel = u.isOnline ? 'online'
      : diffMin < 1 ? 'baru saja'
        : diffMin < 60 ? `${diffMin} mnt lalu`
          : diffMin < 1440 ? `${Math.floor(diffMin / 60)} jam lalu`
            : `${Math.floor(diffMin / 1440)} hari lalu`;

    return `
      <div class="presence-user-item" style="opacity:${u.isOnline ? 1 : 0.65}">
        <div class="presence-avatar" style="background:${color.bg};color:${color.text}">
          ${initials}
          ${u.isOnline ? '<span style="position:absolute;bottom:-1px;right:-1px;width:7px;height:7px;background:#22c55e;border-radius:50%;border:1px solid var(--bg-card)"></span>' : ''}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.nama || 'Unknown'}</div>
          <div style="display:flex;align-items:center;gap:0.3rem;margin-top:1px">
            <span class="presence-role-badge" style="background:${color.bg};color:${color.text}">${u.role}</span>
            <span style="color:${u.isOnline ? '#22c55e' : 'var(--text-muted)'};font-size:0.62rem">${timeLabel}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
function showSection(sectionId, updateHash = true) {
  // Prevent admin from visiting forbidden sections
  if (adminProfile && adminProfile.role === 'admin') {
    const forbidden = ['upload', 'unassigned', 'import-sls', 'import-users', 'import-capaian'];
    if (forbidden.includes(sectionId)) {
      sectionId = 'history';
    }
  }

  // Redirect legacy #bapp section to Berkas SE panel with BAPP modal
  if (sectionId === 'bapp') {
    showSection('berkas-lainnya', false);
    switchBerkasTab('termin1');
    openBappModal();
    if (updateHash) window.location.hash = 'berkas-lainnya';
    return;
  }

  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`panel-${sectionId}`)?.classList.add('active');
  document.getElementById(`nav-${sectionId}`)?.classList.add('active');
  if (sectionId === 'users') {
    loadUsers();
  }
  if (sectionId === 'kelola-petugas-sls') {
    if (typeof loadKelolaData === 'function') loadKelolaData();
  }
  if (sectionId === 'berkas-lainnya') {
    (async () => {
      try {
        const { count } = await db.from('user_sls_termin2').select('*', { count: 'exact', head: true });
        if (count && count > 0) updateSnapshotBtnState(true);
      } catch (e) { }
    })();
  }

  if (updateHash) {
    window.location.hash = sectionId;
  }
}

// ============================================================
// BERKAS SE TABS & BAPP MODAL HELPERS
// ============================================================
function switchBerkasTab(tabId) {
  document.querySelectorAll('.berkas-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.berkas-tab-content').forEach(content => content.classList.remove('active'));

  const selectedBtn = document.getElementById(`tab-btn-${tabId}`);
  const selectedContent = document.getElementById(`berkas-tab-${tabId}`);

  if (selectedBtn) selectedBtn.classList.add('active');
  if (selectedContent) selectedContent.classList.add('active');
}

let currentBappTermin = 1;

function openBappModal() {
  currentBappTermin = 1;
  const modal = document.getElementById('bappModal');
  const title = document.querySelector('#bappModal .bottom-sheet-title');
  const sub = document.querySelector('#bappModal .bottom-sheet-header div div:nth-child(2)');
  if (title) title.textContent = 'Tabel BAPP Pencairan Termin I';
  if (sub) sub.textContent = 'Pantau, filter, dan cetak PDF BAPP Termin I seluruh petugas.';

  if (modal) {
    modal.classList.add('open');
    const tbody = document.getElementById('bappTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 0.5rem"></div>Memuat data BAPP Termin I...</td></tr>`;
    }
    setTimeout(() => {
      loadBAPPData();
    }, 50);
  }
}

function refreshCurrentBapp() {
  if (currentBappTermin === 2) {
    loadBAPPT2Data();
  } else {
    loadBAPPData();
  }
}

function closeBappModal() {
  const modal = document.getElementById('bappModal');
  if (modal) {
    modal.classList.remove('open');
  }
}
// ============================================================
// FILE UPLOAD — ANOMALI DATA (FORMAT GABUNGAN)
// ============================================================
function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId)?.classList.add('drag-over');
}
function handleDragLeave(zoneId) {
  document.getElementById(zoneId)?.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('zoneAnomali')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}
async function processFile(file) {
  const labelEl = document.getElementById('anomaliLabel');
  const zoneEl = document.getElementById('zoneAnomali');
  const validEl = document.getElementById('anomaliValidation');
  const warnEl = document.getElementById('anomaliWarnings');
  if (labelEl) labelEl.textContent = file.name;
  if (validEl) validEl.innerHTML = '<div class="chip">Memvalidasi...</div>';
  if (warnEl) warnEl.innerHTML = '';
  try {
    const rows = await parseExcelFile(file);
    const result = validateExcel(rows);
    if (!result.valid) {
      zoneEl?.classList.remove('has-file');
      renderValidationResult('anomaliValidation', result);
      parsedData = null;
    } else {
      zoneEl?.classList.add('has-file');
      // Convert rows to records (may generate warnings)
      const tanggal = document.getElementById('tanggalData').value || new Date().toISOString().slice(0, 10);
      const { records, warnings: convWarnings } = rowsToRecordsFull(rows, tanggal);
      const kkCount = records.filter(r => r.tipe === 'keluarga').length;
      const usahaCount = records.filter(r => r.tipe === 'usaha').length;
      validEl.innerHTML = `
        <div class="alert alert-success">
          <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          <span>Validasi berhasil — ${result.dataRows.length.toLocaleString('id')} baris data, ${records.length.toLocaleString('id')} record anomali (${kkCount} keluarga, ${usahaCount} usaha)</span>
        </div>`;
      parsedData = { rows, records };
      // Tampilkan warnings (validasi + konversi) jika ada
      const allWarnings = [...(result.warnings || []), ...(convWarnings || [])];
      if (allWarnings.length > 0 && warnEl) {
        warnEl.innerHTML = `
          <div class="alert alert-warning" style="display:block;border-left:4px solid var(--warning);padding:0.75rem 1rem;margin-top:0.5rem">
            <div style="font-weight:600;margin-bottom:0.4rem;display:flex;align-items:center;gap:0.35rem">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--warning)"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              Peringatan (${allWarnings.length})
            </div>
            <ul style="margin:0 0 0 1.25rem;font-size:0.8rem;max-height:280px;overflow-y:auto;padding:0">
              ${allWarnings.map(w => `<li style="margin-bottom:0.25rem">${escHtml(w)}</li>`).join('')}
            </ul>
          </div>`;
      }
    }
  } catch (e) {
    validEl.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        <span>${escHtml(e.message)}</span>
      </div>`;
    parsedData = null;
  }
  checkValidateBtn();
}
function checkValidateBtn() {
  const btn = document.getElementById('validateBtn');
  const hint = document.getElementById('validateHint');
  const tanggal = document.getElementById('tanggalData')?.value;
  const hasFile = parsedData && parsedData.records.length > 0;
  btn.disabled = !(hasFile && tanggal);
  hint.textContent = !tanggal ? 'Pilih tanggal data terlebih dahulu' :
    !hasFile ? 'Upload file Excel anomali gabungan yang valid' :
      'Siap untuk dilanjutkan';
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tanggalData')?.addEventListener('change', checkValidateBtn);
});
async function startValidation() {
  if (!parsedData || !parsedData.records.length) return;
  const tanggal = document.getElementById('tanggalData').value;
  const allRecords = parsedData.records;
  const kkCount = allRecords.filter(r => r.tipe === 'keluarga').length;
  const usahaCount = allRecords.filter(r => r.tipe === 'usaha').length;
  const uniqueAssignments = new Set(allRecords.map(r => r.assignment_id)).size;
  document.getElementById('uploadStep1').classList.add('hidden');
  setStep(2);
  document.getElementById('previewSummary').innerHTML = `
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Tanggal Data</div>
      <div style="font-weight:700;font-size:1.1rem">${tanggal}</div>
    </div>
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Total Record Anomali</div>
      <div style="font-weight:700;font-size:1.1rem;color:var(--primary)">${allRecords.length.toLocaleString('id')} record</div>
      <div style="font-size:0.725rem;color:var(--text-muted)">${uniqueAssignments.toLocaleString('id')} assignment unik</div>
    </div>
    <div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.25rem">Rincian per Tipe</div>
      <div style="font-size:0.875rem;font-weight:600">${kkCount.toLocaleString('id')} keluarga · ${usahaCount.toLocaleString('id')} usaha</div>
    </div>`;
  document.getElementById('uploadStep2').classList.remove('hidden');
}
async function startMerge() {
  if (!parsedData || !parsedData.records.length) return;
  document.getElementById('uploadStep2').classList.add('hidden');
  document.getElementById('uploadStep3').classList.remove('hidden');
  setStep(3);
  const tanggal = document.getElementById('tanggalData').value;
  const allRecords = parsedData.records;
  const kkCount = allRecords.filter(r => r.tipe === 'keluarga').length;
  const usahaCount = allRecords.filter(r => r.tipe === 'usaha').length;
  const { data: batch, error: batchErr } = await db
    .from('upload_batches')
    .insert({
      tanggal_data: tanggal,
      uploaded_by_nama: getSessionName(adminProfile),
      uploaded_by_id: adminProfile.id,
      status: 'processing',
      jumlah_keluarga: kkCount,
      jumlah_usaha: usahaCount
    })
    .select('id').single();
  if (batchErr) {
    showToast('Gagal membuat batch: ' + batchErr.message, 'error');
    backToStep1(); return;
  }
  batchId = batch.id;
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
  parsedData = null; batchId = null;
  const newAnomWarn = document.getElementById('newAnomaliesWarning');
  if (newAnomWarn) {
    newAnomWarn.classList.add('hidden');
    newAnomWarn.innerHTML = '';
  }
  document.getElementById('zoneAnomali')?.classList.remove('has-file');
  const labelEl = document.getElementById('anomaliLabel');
  if (labelEl) labelEl.textContent = 'Pilih atau seret file di sini';
  ['anomaliValidation', 'anomaliWarnings'].forEach(id => { if (document.getElementById(id)) document.getElementById(id).innerHTML = ''; });
  const fileEl = document.getElementById('fileAnomali');
  if (fileEl) fileEl.value = '';
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--error)">Gagal memuat: ${error.message}</td></tr>`;
    return;
  }
  if (!data?.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">Belum ada riwayat upload</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(b => {
    const isCompleted = b.status === 'completed';
    const rollbackBtn = isCompleted
      ? `<button class="btn btn-danger btn-sm" onclick="triggerRollback('${b.id}')" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; line-height: 1;">Rollback</button>`
      : `<span style="color:var(--text-muted)">—</span>`;
    return `
      <tr>
        <td><strong>${b.tanggal_data}</strong></td>
        <td>${escHtml(b.uploaded_by_nama || '—')}</td>
        <td>${b.jumlah_keluarga?.toLocaleString('id') || 0}</td>
        <td>${b.jumlah_usaha?.toLocaleString('id') || 0}</td>
        <td style="color:var(--text-muted);font-size:0.8rem">${new Date(b.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td><span class="status-badge ${b.status === 'completed' ? 'status-kondisi' : b.status === 'failed' ? 'status-reopen' : 'status-pending'}">${b.status}</span></td>
        <td>${rollbackBtn}</td>
      </tr>`;
  }).join('');
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
      .select('id, sobatid, nik, nama, role, email_ref, is_active')
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
  tbody.innerHTML = pageData.map(u => {
    const safeNama = u.nama.replace(/'/g, "\\'");
    return `
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
          <button class="btn btn-secondary btn-sm" onclick="manageUserSLS('${u.id}','${safeNama}')" title="Kelola SLS" ${u.role === 'pml' ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M15 21h4a2 2 0 0 0 2-2v-4"/></svg>
            SLS
          </button>
          <button class="btn btn-secondary btn-sm ${u.is_active ? 'text-error' : 'text-success'}" onclick="toggleUserStatus('${u.id}',${u.is_active})">
            ${u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        </td>` : ''}
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

function checkPPLEligibility(totalCapaian, totalTarget, coverage, totalSls) {
  const pct = totalTarget > 0 ? (totalCapaian / totalTarget) : 0;
  const minCoverage = Math.ceil(totalSls * 0.4);
  return {
    pctEligible: pct >= 0.4,
    coverageEligible: coverage >= minCoverage,
    eligible: pct >= 0.4 && coverage >= minCoverage,
    pct,
    minCoverage
  };
}

async function generateCapaianReportData(gelombang = 1) {
  // 1. Fetch profiles (ppl, pml)
  let profiles = [];
  let fromProf = 0;
  let hasMoreProf = true;
  while (hasMoreProf) {
    const { data, error } = await db.from('profiles')
      .select('id, sobatid, nama, email_ref, role')
      .in('role', ['ppl', 'pml'])
      .eq('is_active', true)
      .range(fromProf, fromProf + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreProf = false;
    } else {
      profiles = profiles.concat(data);
      if (data.length < 1000) hasMoreProf = false;
      else fromProf += 1000;
    }
  }

  // 2. Fetch pml_ppl mapping
  let relations = [];
  let fromRel = 0;
  let hasMoreRel = true;
  while (hasMoreRel) {
    const { data, error } = await db.from('pml_ppl')
      .select('pml_id, ppl_id')
      .range(fromRel, fromRel + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreRel = false;
    } else {
      relations = relations.concat(data);
      if (data.length < 1000) hasMoreRel = false;
      else fromRel += 1000;
    }
  }

  // 3. Fetch active user_sls
  let userSls = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls')
      .select('user_id, kode_sls')
      .eq('status', 'aktif')
      .range(fromSls, fromSls + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreSls = false;
    } else {
      userSls = userSls.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    }
  }

  // 4. Fetch wilayah_subsls targets
  let subsls = [];
  let fromSub = 0;
  let hasMoreSub = true;
  while (hasMoreSub) {
    const { data, error } = await db.from('wilayah_subsls')
      .select('kode_sls_gabungan, target')
      .range(fromSub, fromSub + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreSub = false;
    } else {
      subsls = subsls.concat(data);
      if (data.length < 1000) hasMoreSub = false;
      else fromSub += 1000;
    }
  }

  // 5. Fetch capaian
  let achievements = [];
  let fromCap = 0;
  let hasMoreCap = true;
  while (hasMoreCap) {
    const { data, error } = await db.from('capaian')
      .select('*')
      .range(fromCap, fromCap + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreCap = false;
    } else {
      achievements = achievements.concat(data);
      if (data.length < 1000) hasMoreCap = false;
      else fromCap += 1000;
    }
  }

  // 6. Fetch active honorarium holds for Termin 1
  let holdsRaw = [];
  try {
    const { data: holdData, error: holdErr } = await db.from('honorarium_hold')
      .select('user_id, gelombang, termin')
      .eq('is_active', true);
    if (!holdErr && holdData) {
      holdsRaw = holdData.filter(h => h.termin === 1 || h.termin === null || h.termin === undefined);
    } else {
      const { data: fallbackData } = await db.from('honorarium_hold').select('user_id, gelombang').eq('is_active', true);
      if (fallbackData) holdsRaw = fallbackData;
    }
  } catch (e) {
    console.warn('Gagal memuat honorarium_hold:', e);
  }
  // Build a Set: key = "userId:gelombang" or "userId:all" if gelombang is null
  const holdSet = new Set();
  holdsRaw.forEach(h => {
    if (h.gelombang === null || h.gelombang === undefined) {
      // Hold berlaku untuk semua gelombang
      holdSet.add(`${h.user_id}:1`);
      holdSet.add(`${h.user_id}:2`);
      holdSet.add(`${h.user_id}:3`);
      holdSet.add(`${h.user_id}:4`);
    } else {
      holdSet.add(`${h.user_id}:${h.gelombang}`);
    }
  });

  const isOnHold = (userId, gel) => holdSet.has(`${userId}:${gel}`);

  // Map targets & achievements by kode_sls_gabungan
  const targetMap = {};
  subsls.forEach(s => {
    targetMap[s.kode_sls_gabungan] = parseInt(s.target) || 0;
  });

  const realisasiMapG1 = {};
  const realisasiMapG2 = {};
  const realisasiMapG3 = {};
  const realisasiMapG4 = {};
  achievements.forEach(a => {
    realisasiMapG1[a.kode_sls_gabungan] = parseInt(a.capaian1) || 0;
    realisasiMapG2[a.kode_sls_gabungan] = parseInt(a.capaian1_g2) || 0;
    realisasiMapG3[a.kode_sls_gabungan] = parseInt(a.capaian1_g3 || 0) || 0;
    realisasiMapG4[a.kode_sls_gabungan] = parseInt(a.capaian1_g4) || 0;
  });

  // Map profile by id for quick lookup
  const profileMap = {};
  profiles.forEach(p => {
    profileMap[p.id] = p;
  });

  // Group PPLs by PML
  const pmlToPpl = {};
  relations.forEach(r => {
    if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = new Set();
    pmlToPpl[r.pml_id].add(r.ppl_id);
  });

  // Find PPLs that might not have a PML assigned
  const allPplIds = new Set(profiles.filter(p => p.role === 'ppl').map(p => p.id));
  const mappedPplIds = new Set(relations.map(r => r.ppl_id));
  const unmappedPplIds = [...allPplIds].filter(id => !mappedPplIds.has(id));

  // Map user_sls by user_id
  const userSlsMap = {};
  userSls.forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  const resolveSlsCodes = (codes) => {
    const resolved = [];
    (codes || []).forEach(code => {
      if (code && code.length === 14) {
        const matches = subsls.filter(s => s.kode_sls_gabungan.startsWith(code)).map(s => s.kode_sls_gabungan);
        if (matches.length > 0) {
          resolved.push(...matches);
        } else {
          resolved.push(code + '00');
        }
      } else if (code) {
        resolved.push(code);
      }
    });
    return Array.from(new Set(resolved));
  };

  // Helpers to get kecamatan code for sorting
  const getProfileKec = (id) => {
    const codes = resolveSlsCodes(userSlsMap[id] || []);
    return (codes.length > 0 && codes[0].length >= 7) ? codes[0].substring(4, 7) : '';
  };
  const getPmlKec = (pmlId) => {
    const pplIds = Array.from(pmlToPpl[pmlId] || []);
    for (const pplId of pplIds) {
      const kec = getProfileKec(pplId);
      if (kec) return kec;
    }
    return '';
  };

  const getPplStatus = (pplId, gel) => {
    const slsCodes = resolveSlsCodes(userSlsMap[pplId] || []);
    let pplTargetSum = 0;
    let pplRealisasiSum = 0;
    let pplCoverage = 0;
    let map = realisasiMapG1;
    if (gel === 2) map = realisasiMapG2;
    if (gel === 3) map = realisasiMapG3;
    if (gel === 4) map = realisasiMapG4;

    slsCodes.forEach(code => {
      pplTargetSum += targetMap[code] || 0;
      const real = map[code] || 0;
      pplRealisasiSum += real;
      if (real > 0) pplCoverage++;
    });
    const base = checkPPLEligibility(pplRealisasiSum, pplTargetSum, pplCoverage, slsCodes.length);
    // Honor hold override: if on hold, force not eligible
    if (isOnHold(pplId, gel)) {
      return { ...base, eligible: false, onHold: true };
    }
    return { ...base, onHold: false };
  };

  const pmls = profiles.filter(p => p.role === 'pml');
  const excelRows = [];
  const rowTypes = [];

  const addPplRows = (pplId, pmlName, pmlEmail) => {
    const ppl = profileMap[pplId];
    if (!ppl) return { targetSum: 0, realisasiSum: 0 };

    const slsCodes = resolveSlsCodes(userSlsMap[pplId] || []);
    const gStatus = getPplStatus(pplId, gelombang);
    const gStatusG1 = getPplStatus(pplId, 1);
    const gStatusG2 = getPplStatus(pplId, 2);
    const gStatusG3 = getPplStatus(pplId, 3);

    // Filtering rules for LK Beban Kerja:
    // Gelombang 2: ONLY include if G2 eligible and NOT G1 eligible
    if (gelombang === 2 && (!gStatusG2.eligible || gStatusG1.eligible)) {
      return { targetSum: 0, realisasiSum: 0, skipped: true };
    }
    // Gelombang 3: ONLY include if G3 eligible and NOT G1/G2 eligible
    if (gelombang === 3 && (!gStatusG3.eligible || gStatusG1.eligible || gStatusG2.eligible)) {
      return { targetSum: 0, realisasiSum: 0, skipped: true };
    }
    // Gelombang 4: ONLY include if G4 eligible and NOT G1/G2/G3 eligible
    if (gelombang === 4 && (!gStatus.eligible || gStatusG1.eligible || gStatusG2.eligible || gStatusG3.eligible)) {
      return { targetSum: 0, realisasiSum: 0, skipped: true };
    }

    const isNotEligibleG1 = (gelombang === 1 && !gStatusG1.eligible);

    let pplTargetSum = 0;
    let pplRealisasiSum = 0;
    let pplCoverage = 0;

    let currentRealisasiMap = realisasiMapG1;
    if (gelombang === 2) currentRealisasiMap = realisasiMapG2;
    if (gelombang === 3) currentRealisasiMap = realisasiMapG3;
    if (gelombang === 4) currentRealisasiMap = realisasiMapG4;

    const sortedSls = [...slsCodes].sort();

    if (sortedSls.length === 0) {
      excelRows.push({
        'Nama PML': pmlName,
        'Email PML': pmlEmail || '—',
        'Nama PPL': ppl.nama,
        'Email PPL': ppl.email_ref || '—',
        'Kode Kec': '—',
        'Kode Desa': '—',
        'Kode SLS+SubSLS': '—',
        'Target': 0,
        'Realisasi': 0,
        'Persentase': '0.00%',
        'Coverage': '0/0',
        'Min Coverage': '0',
        'Eligible': '✗'
      });
      rowTypes.push(isNotEligibleG1 ? 'not_eligible_g1' : 'data');
    } else {
      sortedSls.forEach(code => {
        let kec = '—';
        let des = '—';
        let slsSub = '—';
        if (code.length >= 16) {
          kec = code.substring(4, 7);
          des = code.substring(7, 10);
          slsSub = code.substring(10, 16);
        }
        const target = targetMap[code] || 0;
        const realisasi = currentRealisasiMap[code] || 0;
        pplTargetSum += target;
        pplRealisasiSum += realisasi;
        if (realisasi > 0) pplCoverage++;

        const pctVal = target > 0 ? (realisasi / target) * 100 : 0;
        const pct = pctVal.toFixed(2) + '%';

        excelRows.push({
          'Nama PML': pmlName,
          'Email PML': pmlEmail || '—',
          'Nama PPL': ppl.nama,
          'Email PPL': ppl.email_ref || '—',
          'Kode Kec': kec,
          'Kode Desa': des,
          'Kode SLS+SubSLS': slsSub,
          'Target': target,
          'Realisasi': realisasi,
          'Persentase': pct,
          'Coverage': '',
          'Min Coverage': '',
          'Eligible': ''
        });
        rowTypes.push(isNotEligibleG1 ? 'not_eligible_g1' : 'data');
      });
    }

    const pplPct = pplTargetSum > 0 ? ((pplRealisasiSum / pplTargetSum) * 100).toFixed(2) + '%' : '0.00%';
    const eligibility = checkPPLEligibility(pplRealisasiSum, pplTargetSum, pplCoverage, slsCodes.length);

    excelRows.push({
      'Nama PML': `SUB TOTAL PPL: ${ppl.nama}`,
      'Email PML': '',
      'Nama PPL': '',
      'Email PPL': '',
      'Kode Kec': '',
      'Kode Desa': '',
      'Kode SLS+SubSLS': '',
      'Target': pplTargetSum,
      'Realisasi': pplRealisasiSum,
      'Persentase': pplPct,
      'Coverage': `${pplCoverage}/${slsCodes.length}`,
      'Min Coverage': `≥ ${eligibility.minCoverage}`,
      'Eligible': eligibility.eligible ? '✓' : '✗'
    });
    rowTypes.push(isNotEligibleG1 ? 'not_eligible_g1' : 'subtotal_ppl');

    return { targetSum: pplTargetSum, realisasiSum: pplRealisasiSum, skipped: false };
  };

  let grandTotalTarget = 0;
  let grandTotalRealisasi = 0;
  const renderedPplIds = new Set();

  // Sort PMLs by Kode Kecamatan (asc), then by Nama PML (asc)
  pmls.sort((a, b) => {
    const kecA = getPmlKec(a.id) || '999';
    const kecB = getPmlKec(b.id) || '999';
    if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
    return (a.nama || '').localeCompare(b.nama || '', undefined, { sensitivity: 'base' });
  }).forEach(pml => {
    const pplIds = Array.from(pmlToPpl[pml.id] || []);
    if (pplIds.length === 0) return;

    let pmlTargetSum = 0;
    let pmlRealisasiSum = 0;
    let hasVisiblePpl = false;

    // Sort PPLs by Kode Kecamatan (asc), then by Nama PPL (asc)
    const sortedPplIds = pplIds
      .filter(id => profileMap[id])
      .sort((a, b) => {
        const kecA = getProfileKec(a) || '999';
        const kecB = getProfileKec(b) || '999';
        if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
        return (profileMap[a].nama || '').localeCompare(profileMap[b].nama || '', undefined, { sensitivity: 'base' });
      });

    sortedPplIds.forEach(id => {
      if (renderedPplIds.has(id)) return;
      renderedPplIds.add(id);
      const { targetSum, realisasiSum, skipped } = addPplRows(id, pml.nama, pml.email_ref);
      if (!skipped) {
        pmlTargetSum += targetSum;
        pmlRealisasiSum += realisasiSum;
        hasVisiblePpl = true;
      }
    });

    if (hasVisiblePpl) {
      const subtotalPct = pmlTargetSum > 0 ? ((pmlRealisasiSum / pmlTargetSum) * 100).toFixed(2) + '%' : '0.00%';
      excelRows.push({
        'Nama PML': `SUB TOTAL PML: ${pml.nama}`,
        'Email PML': '',
        'Nama PPL': '',
        'Email PPL': '',
        'Kode Kec': '',
        'Kode Desa': '',
        'Kode SLS+SubSLS': '',
        'Target': pmlTargetSum,
        'Realisasi': pmlRealisasiSum,
        'Persentase': subtotalPct,
        'Coverage': '',
        'Min Coverage': '',
        'Eligible': ''
      });
      rowTypes.push('subtotal_pml');

      grandTotalTarget += pmlTargetSum;
      grandTotalRealisasi += pmlRealisasiSum;
    }
  });

  if (unmappedPplIds.length > 0) {
    let unmappedTargetSum = 0;
    let unmappedRealisasiSum = 0;
    let hasVisibleUnmapped = false;

    const sortedUnmapped = unmappedPplIds
      .filter(id => profileMap[id])
      .sort((a, b) => {
        const kecA = getProfileKec(a) || '999';
        const kecB = getProfileKec(b) || '999';
        if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
        return (profileMap[a].nama || '').localeCompare(profileMap[b].nama || '', undefined, { sensitivity: 'base' });
      });

    sortedUnmapped.forEach(id => {
      const { targetSum, realisasiSum, skipped } = addPplRows(id, 'TANPA PML', '');
      if (!skipped) {
        unmappedTargetSum += targetSum;
        unmappedRealisasiSum += realisasiSum;
        hasVisibleUnmapped = true;
      }
    });

    if (hasVisibleUnmapped) {
      const subtotalPct = unmappedTargetSum > 0 ? ((unmappedRealisasiSum / unmappedTargetSum) * 100).toFixed(2) + '%' : '0.00%';
      excelRows.push({
        'Nama PML': 'SUB TOTAL TANPA PML',
        'Email PML': '',
        'Nama PPL': '',
        'Email PPL': '',
        'Kode Kec': '',
        'Kode Desa': '',
        'Kode SLS+SubSLS': '',
        'Target': unmappedTargetSum,
        'Realisasi': unmappedRealisasiSum,
        'Persentase': subtotalPct,
        'Coverage': '',
        'Min Coverage': '',
        'Eligible': ''
      });
      rowTypes.push('subtotal_pml');

      grandTotalTarget += unmappedTargetSum;
      grandTotalRealisasi += unmappedRealisasiSum;
    }
  }

  const grandPct = grandTotalTarget > 0 ? ((grandTotalRealisasi / grandTotalTarget) * 100).toFixed(2) + '%' : '0.00%';
  excelRows.push({
    'Nama PML': 'TOTAL KABUPATEN',
    'Email PML': '',
    'Nama PPL': '',
    'Email PPL': '',
    'Kode Kec': '',
    'Kode Desa': '',
    'Kode SLS+SubSLS': '',
    'Target': grandTotalTarget,
    'Realisasi': grandTotalRealisasi,
    'Persentase': grandPct,
    'Coverage': '',
    'Min Coverage': '',
    'Eligible': ''
  });
  rowTypes.push('grand_total');

  return { excelRows, rowTypes };
}

async function exportCapaianToExcel(gelombang = 1) {
  showToast(`Memproses data untuk ekspor Excel Gelombang ${gelombang}...`, 'info');
  try {
    const { excelRows, rowTypes } = await generateCapaianReportData(gelombang);

    // Generate worksheet and workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);

    // Apply styles to subtotal and total rows
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const type = rowTypes[R - 1];
      if (!type || type === 'data') continue;

      let cellStyle = {};
      if (type === 'not_eligible_g1') {
        cellStyle = {
          fill: { fgColor: { rgb: "FCE4D6" } }, // Soft red/rose background
          font: { bold: true, color: { rgb: "C00000" } }, // Red font
          border: {
            top: { style: "thin", color: { rgb: "F4B084" } },
            bottom: { style: "thin", color: { rgb: "F4B084" } }
          }
        };
      } else if (type === 'subtotal_ppl') {
        cellStyle = {
          fill: { fgColor: { rgb: "FFF2CC" } }, // Soft warm gold/yellow
          font: { bold: true, color: { rgb: "333333" } },
          border: {
            top: { style: "thin", color: { rgb: "D9D9D9" } },
            bottom: { style: "thin", color: { rgb: "D9D9D9" } }
          }
        };
      } else if (type === 'subtotal_pml') {
        cellStyle = {
          fill: { fgColor: { rgb: "D9E1F2" } }, // Soft blue
          font: { bold: true, color: { rgb: "1F4E78" } },
          border: {
            top: { style: "thin", color: { rgb: "A6B9D8" } },
            bottom: { style: "double", color: { rgb: "1F4E78" } }
          }
        };
      } else if (type === 'grand_total') {
        cellStyle = {
          fill: { fgColor: { rgb: "C6E0B4" } }, // Soft green
          font: { bold: true, color: { rgb: "375623" } },
          border: {
            top: { style: "thin", color: { rgb: "7F7F7F" } },
            bottom: { style: "double", color: { rgb: "375623" } }
          }
        };
      }

      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
        if (!ws[cellRef]) {
          ws[cellRef] = { t: 's', v: '' };
        }
        ws[cellRef].s = cellStyle;
      }
    }

    // Auto-fit column widths
    const cols = [];
    const headers = Object.keys(excelRows[0] || {});
    headers.forEach(h => {
      cols.push({ wch: Math.max(h.length + 3, 10) });
    });
    excelRows.forEach(row => {
      headers.forEach((h, colIndex) => {
        const val = row[h] ? row[h].toString() : '';
        if (val.length + 3 > cols[colIndex].wch) {
          cols[colIndex].wch = val.length + 3;
        }
      });
    });
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, `LK Gelombang ${gelombang}`);
    XLSX.writeFile(wb, `lk_beban_kerja_gelombang_${gelombang}.xlsx`);
    showToast('Ekspor Excel berhasil!', 'success');
  } catch (err) {
    console.error('Export Excel error:', err);
    showToast('Gagal ekspor Excel: ' + err.message, 'error');
  }
}

let previewLkAllRows = [];
let previewLkRowTypes = [];
let previewLkCurrentPage = 1;
let previewLkPageSize = 25;
let previewLkGelombang = 1;

async function previewCapaian(gelombang = 1) {
  showToast(`Memproses data preview Gelombang ${gelombang}...`, 'info');
  previewLkGelombang = gelombang;
  previewLkCurrentPage = 1;

  // Set title in modal
  const titleEl = document.getElementById('previewLkTitle');
  if (titleEl) titleEl.textContent = `Preview LK Beban Kerja - Gelombang ${gelombang}`;

  // Clear search input
  const searchInput = document.getElementById('previewLkSearch');
  if (searchInput) searchInput.value = '';

  try {
    const { excelRows, rowTypes } = await generateCapaianReportData(gelombang);
    previewLkAllRows = excelRows;
    previewLkRowTypes = rowTypes;

    filterPreviewLk();

    const modal = document.getElementById('previewLkModal');
    if (modal) {
      modal.classList.add('open');
    }
  } catch (err) {
    console.error('Preview error:', err);
    showToast('Gagal menampilkan preview: ' + err.message, 'error');
  }
}

function filterPreviewLk() {
  const search = document.getElementById('previewLkSearch')?.value.toLowerCase() || '';
  const filtered = [];
  const filteredTypes = [];

  previewLkAllRows.forEach((row, i) => {
    // Search fields
    const match = !search ||
      (row['Nama PML'] || '').toLowerCase().includes(search) ||
      (row['Email PML'] || '').toLowerCase().includes(search) ||
      (row['Nama PPL'] || '').toLowerCase().includes(search) ||
      (row['Email PPL'] || '').toLowerCase().includes(search) ||
      (row['Kode Kec'] || '').toLowerCase().includes(search) ||
      (row['Kode Desa'] || '').toLowerCase().includes(search) ||
      (row['Kode SLS+SubSLS'] || '').toLowerCase().includes(search);

    if (match) {
      filtered.push(row);
      filteredTypes.push(previewLkRowTypes[i]);
    }
  });

  const countEl = document.getElementById('previewLkCount');
  if (countEl) countEl.textContent = `Total: ${filtered.length} baris`;

  renderPreviewLkTable(filtered, filteredTypes);
}

function renderPreviewLkTable(data, types) {
  const tbody = document.getElementById('previewLkTableBody');
  const pag = document.getElementById('previewLkPagination');
  if (!tbody) return;

  const isTermin2 = data.length > 0 && data[0]['Prelist'] !== undefined;
  const thead = document.querySelector('#previewLkTable thead');
  if (thead) {
    if (isTermin2) {
      thead.innerHTML = `
        <tr>
          <th>Nama PML</th>
          <th>Email PML</th>
          <th>Nama PPL</th>
          <th>Email PPL</th>
          <th style="text-align:center">Kec</th>
          <th style="text-align:center">Desa</th>
          <th style="text-align:center">SLS+SubSLS</th>
          <th style="text-align:right">Prelist</th>
          <th style="text-align:right">Baru</th>
          <th style="text-align:right">Hasil Verif</th>
          <th style="text-align:right">Target SLS</th>
          <th style="text-align:center">SLS Selesai (%)</th>
        </tr>
      `;
    } else {
      thead.innerHTML = `
        <tr>
          <th>Nama PML</th>
          <th>Email PML</th>
          <th>Nama PPL</th>
          <th>Email PPL</th>
          <th style="text-align:center">Kec</th>
          <th style="text-align:center">Desa</th>
          <th style="text-align:center">SLS+SubSLS</th>
          <th style="text-align:right">Target</th>
          <th style="text-align:right">Realisasi</th>
          <th style="text-align:right">Persentase</th>
          <th style="text-align:center">Coverage SLS</th>
          <th style="text-align:center">Min Coverage</th>
          <th style="text-align:center">Eligible</th>
        </tr>
      `;
    }
  }

  if (data.length === 0) {
    const colspan = isTermin2 ? 12 : 13;
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data ditemukan</td></tr>`;
    if (pag) pag.innerHTML = '';
    return;
  }

  let displayData = data;
  let displayTypes = types;
  const pageSize = previewLkPageSize === 'all' ? data.length : parseInt(previewLkPageSize);
  const totalPages = Math.ceil(data.length / pageSize);

  if (previewLkPageSize !== 'all') {
    if (previewLkCurrentPage > totalPages) previewLkCurrentPage = totalPages;
    if (previewLkCurrentPage < 1) previewLkCurrentPage = 1;
    const start = (previewLkCurrentPage - 1) * pageSize;
    displayData = data.slice(start, start + pageSize);
    displayTypes = types.slice(start, start + pageSize);
  }

  tbody.innerHTML = displayData.map((row, i) => {
    const type = displayTypes[i];
    let styleAttr = '';

    if (type === 'not_eligible_g1') {
      styleAttr = 'background-color:rgba(239, 68, 68, 0.12); color:#ef4444; font-weight:bold;';
    } else if (type === 'subtotal_ppl') {
      styleAttr = 'background-color:#FFF2CC; font-weight:bold;';
    } else if (type === 'subtotal_pml') {
      styleAttr = 'background-color:#D9E1F2; font-weight:bold; color:#1F4E78;';
    } else if (type === 'grand_total') {
      styleAttr = 'background-color:#C6E0B4; font-weight:bold; color:#375623;';
    }

    if (isTermin2) {
      const pctVal = row['SLS Selesai (%)'] || '';
      const is100 = pctVal === '100%' || pctVal === '100.00%';
      return `
        <tr style="${styleAttr}">
          <td>${escHtml(row['Nama PML'] || '')}</td>
          <td>${escHtml(row['Email PML'] || '')}</td>
          <td>${escHtml(row['Nama PPL'] || '')}</td>
          <td>${escHtml(row['Email PPL'] || '')}</td>
          <td style="text-align:center">${escHtml(row['Kode Kec'] || '')}</td>
          <td style="text-align:center">${escHtml(row['Kode Desa'] || '')}</td>
          <td style="text-align:center">${escHtml(row['Kode SLS+SubSLS'] || '')}</td>
          <td style="text-align:right">${row['Prelist'] !== undefined && row['Prelist'] !== '' ? Number(row['Prelist']).toLocaleString('id-ID') : ''}</td>
          <td style="text-align:right">${row['Baru'] !== undefined && row['Baru'] !== '' ? Number(row['Baru']).toLocaleString('id-ID') : ''}</td>
          <td style="text-align:right; font-weight: 600; color: #0284c7">${row['Hasil Verif'] !== undefined && row['Hasil Verif'] !== '' ? Number(row['Hasil Verif']).toLocaleString('id-ID') : ''}</td>
          <td style="text-align:right">${row['Target SLS'] !== undefined && row['Target SLS'] !== '' ? Number(row['Target SLS']).toLocaleString('id-ID') : ''}</td>
          <td style="text-align:center; font-weight: bold; color: ${is100 ? '#16a34a' : 'inherit'}">${escHtml(pctVal)}</td>
        </tr>
      `;
    }

    return `
      <tr style="${styleAttr}">
        <td>${escHtml(row['Nama PML'] || '')}</td>
        <td>${escHtml(row['Email PML'] || '')}</td>
        <td>${escHtml(row['Nama PPL'] || '')}</td>
        <td>${escHtml(row['Email PPL'] || '')}</td>
        <td style="text-align:center">${escHtml(row['Kode Kec'] || '')}</td>
        <td style="text-align:center">${escHtml(row['Kode Desa'] || '')}</td>
        <td style="text-align:center">${escHtml(row['Kode SLS+SubSLS'] || '')}</td>
        <td style="text-align:right">${row['Target'] !== undefined ? row['Target'] : ''}</td>
        <td style="text-align:right">${row['Realisasi'] !== undefined ? row['Realisasi'] : ''}</td>
        <td style="text-align:right">${escHtml(row['Persentase'] || '')}</td>
        <td style="text-align:center; font-weight: bold;">${escHtml(row['Coverage'] || '')}</td>
        <td style="text-align:center; font-weight: bold;">${escHtml(row['Min Coverage'] || '')}</td>
        <td style="text-align:center; font-weight: bold; color: ${row['Eligible'] === '✓' ? '#10b981' : row['Eligible'] === '✗' ? '#ef4444' : ''}">${escHtml(row['Eligible'] || '')}</td>
      </tr>
    `;
  }).join('');

  // Draw Pagination
  if (!pag) return;
  if (totalPages <= 1) {
    pag.innerHTML = '';
  } else {
    let btnHtml = '';
    btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewLkPage(${previewLkCurrentPage - 1})" ${previewLkCurrentPage === 1 ? 'disabled' : ''} style="padding:0.2rem 0.4rem;min-width:28px">←</button>`;

    let startPage = Math.max(1, previewLkCurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    if (startPage > 1) {
      btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewLkPage(1)" style="padding:0.2rem 0.4rem;min-width:28px">1</button>`;
      if (startPage > 2) btnHtml += `<span style="padding:0.2rem;color:var(--text-muted)">...</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
      btnHtml += `<button class="btn btn-sm ${i === previewLkCurrentPage ? 'btn-primary' : 'btn-secondary'}" onclick="goToPreviewLkPage(${i})" style="padding:0.2rem 0.4rem;min-width:28px">${i}</button>`;
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) btnHtml += `<span style="padding:0.2rem;color:var(--text-muted)">...</span>`;
      btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewLkPage(${totalPages})" style="padding:0.2rem 0.4rem;min-width:28px">${totalPages}</button>`;
    }
    btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewLkPage(${previewLkCurrentPage + 1})" ${previewLkCurrentPage === totalPages ? 'disabled' : ''} style="padding:0.2rem 0.4rem;min-width:28px">→</button>`;
    pag.innerHTML = btnHtml;
  }
}

function changePreviewLkPageSize() {
  previewLkPageSize = document.getElementById('previewLkPageSizeSelect').value;
  previewLkCurrentPage = 1;
  filterPreviewLk();
}

function goToPreviewLkPage(page) {
  previewLkCurrentPage = page;
  filterPreviewLk();
}

function closePreviewLkModal() {
  const modal = document.getElementById('previewLkModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

// ============================================================
// BAPP (CETAK PDF) MANAGEMENT LOGIC
// ============================================================
let allBappUploads = [];
let filteredBappUploads = [];
let currentBappPage = 1;
let bappPageSize = 10;
let totalBappDbCount = 0;
let bappSortField = 'nama';
let bappSortDir = 'asc';

let bappEligibilityMap = {
  1: new Set(),
  2: new Set(),
  3: new Set(),
  4: new Set()
};
let isBappEligibilityLoaded = false;

let bappEligibilityMapT2 = {
  1: new Set(),
  2: new Set(),
  3: new Set(),
  4: new Set()
};
let isBappEligibilityLoadedT2 = false;

// Fungsi untuk memuat dan menghitung kelayakan (eligibility) PPL & PML untuk tiap gelombang
async function loadBappEligibilityData(force = false) {
  if (isBappEligibilityLoaded && !force) return;
  try {
    // 1. Ambil relasi pml_ppl
    let relations = [];
    let fromRel = 0;
    let hasMoreRel = true;
    while (hasMoreRel) {
      const { data, error } = await db.from('pml_ppl')
        .select('pml_id, ppl_id')
        .range(fromRel, fromRel + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreRel = false;
      else {
        relations = relations.concat(data);
        if (data.length < 1000) hasMoreRel = false;
        else fromRel += 1000;
      }
    }

    // 2. Ambil user_sls aktif
    let userSls = [];
    let fromSls = 0;
    let hasMoreSls = true;
    while (hasMoreSls) {
      const { data, error } = await db.from('user_sls')
        .select('user_id, kode_sls')
        .eq('status', 'aktif')
        .range(fromSls, fromSls + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreSls = false;
      else {
        userSls = userSls.concat(data);
        if (data.length < 1000) hasMoreSls = false;
        else fromSls += 1000;
      }
    }

    // 3. Ambil target dari wilayah_subsls
    let subsls = [];
    let fromSub = 0;
    let hasMoreSub = true;
    while (hasMoreSub) {
      const { data, error } = await db.from('wilayah_subsls')
        .select('kode_sls_gabungan, target')
        .range(fromSub, fromSub + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreSub = false;
      else {
        subsls = subsls.concat(data);
        if (data.length < 1000) hasMoreSub = false;
        else fromSub += 1000;
      }
    }

    // 4. Ambil capaian realisasi
    let achievements = [];
    let fromCap = 0;
    let hasMoreCap = true;
    while (hasMoreCap) {
      const { data, error } = await db.from('capaian')
        .select('*')
        .range(fromCap, fromCap + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreCap = false;
      else {
        achievements = achievements.concat(data);
        if (data.length < 1000) hasMoreCap = false;
        else fromCap += 1000;
      }
    }

    // 5. Ambil active honorarium holds
    let holdsRaw = [];
    try {
      const { data: holdData } = await db.from('honorarium_hold')
        .select('user_id, gelombang')
        .eq('is_active', true);
      if (holdData) holdsRaw = holdData;
    } catch (e) {
      console.warn('Gagal memuat honorarium_hold:', e);
    }

    const holdSet = new Set();
    holdsRaw.forEach(h => {
      if (h.gelombang === null || h.gelombang === undefined) {
        // Hold berlaku untuk semua gelombang
        holdSet.add(`${h.user_id}:1`);
        holdSet.add(`${h.user_id}:2`);
        holdSet.add(`${h.user_id}:3`);
        holdSet.add(`${h.user_id}:4`);
      } else {
        holdSet.add(`${h.user_id}:${h.gelombang}`);
      }
    });

    const isOnHold = (userId, gel) => holdSet.has(`${userId}:${gel}`);

    // Map targets & achievements by kode_sls_gabungan
    const targetMap = {};
    subsls.forEach(s => {
      targetMap[s.kode_sls_gabungan] = parseInt(s.target) || 0;
    });

    const realisasiMapG1 = {};
    const realisasiMapG2 = {};
    const realisasiMapG3 = {};
    const realisasiMapG4 = {};
    const realisasiPmlMapG1 = {};
    const realisasiPmlMapG2 = {};
    const realisasiPmlMapG3 = {};
    const realisasiPmlMapG4 = {};
    achievements.forEach(a => {
      realisasiMapG1[a.kode_sls_gabungan] = parseInt(a.capaian1) || 0;
      realisasiMapG2[a.kode_sls_gabungan] = parseInt(a.capaian1_g2) || 0;
      realisasiMapG3[a.kode_sls_gabungan] = parseInt(a.capaian1_g3 || 0) || 0;
      realisasiMapG4[a.kode_sls_gabungan] = parseInt(a.capaian1_g4) || 0;
      realisasiPmlMapG1[a.kode_sls_gabungan] = parseInt(a.capaian1_pml) || 0;
      realisasiPmlMapG2[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g2) || 0;
      realisasiPmlMapG3[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g3 || 0) || 0;
      realisasiPmlMapG4[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g4) || 0;
    });

    // Map user_sls by user_id
    const userSlsMap = {};
    userSls.forEach(us => {
      if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
      userSlsMap[us.user_id].push(us.kode_sls);
    });

    const resolveSlsCodes = (codes) => {
      const resolved = [];
      (codes || []).forEach(code => {
        if (code && code.length === 14) {
          const matches = subsls.filter(s => s.kode_sls_gabungan.startsWith(code)).map(s => s.kode_sls_gabungan);
          if (matches.length > 0) {
            resolved.push(...matches);
          } else {
            resolved.push(code + '00');
          }
        } else if (code) {
          resolved.push(code);
        }
      });
      return Array.from(new Set(resolved));
    };

    // PML-PPL relations map
    const pmlToPpl = {};
    relations.forEach(r => {
      if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = new Set();
      pmlToPpl[r.pml_id].add(r.ppl_id);
    });

    // Check PPL eligibility for a wave
    const getPplStatus = (pplId, gel) => {
      const slsCodes = resolveSlsCodes(userSlsMap[pplId] || []);
      let pplTargetSum = 0;
      let pplRealisasiSum = 0;
      let pplCoverage = 0;
      let map = realisasiMapG1;
      if (gel === 2) map = realisasiMapG2;
      if (gel === 3) map = realisasiMapG3;
      if (gel === 4) map = realisasiMapG4;

      slsCodes.forEach(code => {
        pplTargetSum += targetMap[code] || 0;
        const real = map[code] || 0;
        pplRealisasiSum += real;
        if (real > 0) pplCoverage++;
      });
      const base = checkPPLEligibility(pplRealisasiSum, pplTargetSum, pplCoverage, slsCodes.length);
      if (isOnHold(pplId, gel)) {
        return { ...base, eligible: false, onHold: true };
      }
      return { ...base, onHold: false };
    };

    // Fetch active profiles if allUsers array is not yet loaded
    let userProfiles = (allUsers && allUsers.length > 0) ? allUsers : [];
    if (userProfiles.length === 0) {
      let fromProf = 0;
      let hasMoreProf = true;
      while (hasMoreProf) {
        const { data, error } = await db.from('profiles')
          .select('id, sobatid, nama, email_ref, role')
          .in('role', ['ppl', 'pml'])
          .eq('is_active', true)
          .range(fromProf, fromProf + 999);
        if (error) throw error;
        if (!data || data.length === 0) hasMoreProf = false;
        else {
          userProfiles = userProfiles.concat(data);
          if (data.length < 1000) hasMoreProf = false;
          else fromProf += 1000;
        }
      }
    }

    // Reset and clear existing bappEligibilityMap sets before re-calculating
    [1, 2, 3, 4].forEach(g => {
      if (!bappEligibilityMap[g]) bappEligibilityMap[g] = new Set();
      else bappEligibilityMap[g].clear();
    });

    // Calculate eligibility for PPLs and PMLs exclusively per wave
    [1, 2, 3, 4].forEach(gel => {
      const eligibleSet = bappEligibilityMap[gel];

      // Calculate PPLs
      userProfiles.forEach(u => {
        if (u.role === 'ppl') {
          const status1 = getPplStatus(u.id, 1);
          const status2 = getPplStatus(u.id, 2);
          const status3 = getPplStatus(u.id, 3);
          const status4 = getPplStatus(u.id, 4);

          if (gel === 1 && status1.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 2 && status2.eligible && !status1.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 3 && status3.eligible && !status1.eligible && !status2.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 4 && status4.eligible && !status1.eligible && !status2.eligible && !status3.eligible) {
            eligibleSet.add(u.id);
          }
        }
      });

      // Calculate PMLs
      userProfiles.forEach(u => {
        if (u.role === 'pml') {
          const supervised = pmlToPpl[u.id];
          const getPmlGelEligibility = (g) => {
            let pmlTargetSum = 0;
            let pmlRealisasiSum = 0;
            let visitedPml = 0;
            let totalPmlSls = 0;
            let map = realisasiPmlMapG1;
            if (g === 2) map = realisasiPmlMapG2;
            if (g === 3) map = realisasiPmlMapG3;
            if (g === 4) map = realisasiPmlMapG4;

            const allSlsSet = new Set(userSlsMap[u.id] || []);
            if (supervised) {
              supervised.forEach(pplId => {
                const slsCodes = userSlsMap[pplId] || [];
                slsCodes.forEach(code => allSlsSet.add(code));
              });
            }

            allSlsSet.forEach(code => {
              totalPmlSls++;
              pmlTargetSum += targetMap[code] || 0;
              const real = map[code] || 0;
              pmlRealisasiSum += real;
              if (real > 0) visitedPml++;
            });

            const pct = pmlTargetSum > 0 ? (pmlRealisasiSum / pmlTargetSum) : 0;
            const minCoverage = Math.ceil(totalPmlSls * 0.4);
            const eligible = (pct >= 0.4) && (visitedPml >= minCoverage);
            return eligible && !isOnHold(u.id, g);
          };

          const pmlG1 = getPmlGelEligibility(1);
          const pmlG2 = getPmlGelEligibility(2);
          const pmlG3 = getPmlGelEligibility(3);
          const pmlG4 = getPmlGelEligibility(4);

          if (gel === 1 && pmlG1) {
            eligibleSet.add(u.id);
          } else if (gel === 2 && pmlG2 && !pmlG1) {
            eligibleSet.add(u.id);
          } else if (gel === 3 && pmlG3 && !pmlG1 && !pmlG2) {
            eligibleSet.add(u.id);
          } else if (gel === 4 && pmlG4 && !pmlG1 && !pmlG2 && !pmlG3) {
            eligibleSet.add(u.id);
          }
        }
      });
    });

    isBappEligibilityLoaded = true;
  } catch (err) {
    console.error('Gagal memproses data kelayakan BAPP:', err);
  }
}

// Fungsi untuk memuat dan menghitung kelayakan (eligibility) PPL & PML Termin 2
async function loadBappEligibilityDataT2(force = false) {
  if (isBappEligibilityLoadedT2 && !force) return;
  try {
    let relations = [];
    let fromRel = 0;
    let hasMoreRel = true;
    while (hasMoreRel) {
      const { data, error } = await db.from('pml_ppl')
        .select('pml_id, ppl_id')
        .range(fromRel, fromRel + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreRel = false;
      else {
        relations = relations.concat(data);
        if (data.length < 1000) hasMoreRel = false;
        else fromRel += 1000;
      }
    }

    let userSlsT2 = [];
    let fromSls = 0;
    let hasMoreSls = true;
    while (hasMoreSls) {
      const { data, error } = await db.from('user_sls_termin2')
        .select('user_id, kode_sls, user_id_asal')
        .eq('status', 'aktif')
        .range(fromSls, fromSls + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreSls = false;
      else {
        userSlsT2 = userSlsT2.concat(data);
        if (data.length < 1000) hasMoreSls = false;
        else fromSls += 1000;
      }
    }

    let capaianT2List = [];
    let fromCap = 0;
    let hasMoreCap = true;
    while (hasMoreCap) {
      const { data, error } = await db.from('capaian_termin2')
        .select('*')
        .range(fromCap, fromCap + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMoreCap = false;
      else {
        capaianT2List = capaianT2List.concat(data);
        if (data.length < 1000) hasMoreCap = false;
        else fromCap += 1000;
      }
    }

    let holdsRaw = [];
    try {
      const { data: holdData } = await db.from('honorarium_hold')
        .select('user_id, gelombang')
        .eq('is_active', true);
      if (holdData) holdsRaw = holdData;
    } catch (e) {
      console.warn('Gagal memuat honorarium_hold:', e);
    }

    const holdSet = new Set();
    holdsRaw.forEach(h => {
      if (h.gelombang === null || h.gelombang === undefined) {
        holdSet.add(`${h.user_id}:1`);
        holdSet.add(`${h.user_id}:2`);
        holdSet.add(`${h.user_id}:3`);
        holdSet.add(`${h.user_id}:4`);
      } else {
        holdSet.add(`${h.user_id}:${h.gelombang}`);
      }
    });

    const isOnHold = (userId, gel) => holdSet.has(`${userId}:${gel}`);

    const targetMap = {};
    const slsSelesaiMapG1 = {};
    const slsSelesaiMapG2 = {};
    const slsSelesaiMapG3 = {};
    const slsSelesaiMapG4 = {};
    capaianT2List.forEach(c => {
      const code = String(c.kode_subsls || '').trim();
      targetMap[code] = parseInt(c.targetsls) || 0;
      slsSelesaiMapG1[code] = parseFloat(c.sls_selesai1 ?? c.sls_selesai ?? 0) || 0;
      slsSelesaiMapG2[code] = parseFloat(c.sls_selesai2 ?? 0) || 0;
      slsSelesaiMapG3[code] = parseFloat(c.sls_selesai3 ?? 0) || 0;
      slsSelesaiMapG4[code] = parseFloat(c.sls_selesai4 ?? 0) || 0;
    });

    const userSlsMap = {};
    const userAsalMap = {};
    userSlsT2.forEach(us => {
      if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
      userSlsMap[us.user_id].push(String(us.kode_sls).trim());
      if (us.user_id_asal) userAsalMap[us.user_id] = us.user_id_asal;
    });

    const pmlToPpl = {};
    const pplToPml = {};
    relations.forEach(r => {
      if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = new Set();
      pmlToPpl[r.pml_id].add(r.ppl_id);
      pplToPml[r.ppl_id] = r.pml_id;
    });

    // Hubungkan replacement PPL ke PML pembinanya
    Object.keys(userAsalMap).forEach(pplId => {
      const asalId = userAsalMap[pplId];
      const pmlId = pplToPml[asalId];
      if (pmlId && pmlToPpl[pmlId]) {
        pmlToPpl[pmlId].add(pplId);
      }
    });

    const getPplStatusT2 = (pplId, gel) => {
      const slsCodes = userSlsMap[pplId] || [];
      if (slsCodes.length === 0) return { eligible: false, onHold: false };

      let map = slsSelesaiMapG1;
      if (gel === 2) map = slsSelesaiMapG2;
      if (gel === 3) map = slsSelesaiMapG3;
      if (gel === 4) map = slsSelesaiMapG4;

      let allSelesai = true;
      slsCodes.forEach(code => {
        const pct = map[code] ?? 0;
        if (pct < 100) allSelesai = false;
      });

      if (isOnHold(pplId, gel)) {
        return { eligible: false, onHold: true };
      }
      return { eligible: allSelesai, onHold: false };
    };

    let userProfiles = (allUsers && allUsers.length > 0) ? allUsers : [];
    if (userProfiles.length === 0) {
      let fromProf = 0;
      let hasMoreProf = true;
      while (hasMoreProf) {
        const { data, error } = await db.from('profiles')
          .select('id, sobatid, nama, email_ref, role')
          .in('role', ['ppl', 'pml'])
          .eq('is_active', true)
          .range(fromProf, fromProf + 999);
        if (error) throw error;
        if (!data || data.length === 0) hasMoreProf = false;
        else {
          userProfiles = userProfiles.concat(data);
          if (data.length < 1000) hasMoreProf = false;
          else fromProf += 1000;
        }
      }
    }

    [1, 2, 3, 4].forEach(g => {
      if (!bappEligibilityMapT2[g]) bappEligibilityMapT2[g] = new Set();
      else bappEligibilityMapT2[g].clear();
    });

    [1, 2, 3, 4].forEach(gel => {
      const eligibleSet = bappEligibilityMapT2[gel];

      userProfiles.forEach(u => {
        if (u.role === 'ppl') {
          const status1 = getPplStatusT2(u.id, 1);
          const status2 = getPplStatusT2(u.id, 2);
          const status3 = getPplStatusT2(u.id, 3);
          const status4 = getPplStatusT2(u.id, 4);

          if (gel === 1 && status1.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 2 && status2.eligible && !status1.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 3 && status3.eligible && !status1.eligible && !status2.eligible) {
            eligibleSet.add(u.id);
          } else if (gel === 4 && status4.eligible && !status1.eligible && !status2.eligible && !status3.eligible) {
            eligibleSet.add(u.id);
          }
        }
      });

      // Calculate PMLs (Termin 2)
      userProfiles.forEach(u => {
        if (u.role === 'pml') {
          const supervised = Array.from(pmlToPpl[u.id] || []);
          const getPmlGelEligibility = (g) => {
            if (isOnHold(u.id, g)) return false;

            if (supervised.length > 0) {
              const allPplEligible = supervised.every(pid => {
                const status = getPplStatusT2(pid, g);
                return status.eligible;
              });
              return allPplEligible;
            }

            const allSlsSet = new Set(userSlsMap[u.id] || []);
            if (allSlsSet.size === 0) return false;

            let map = slsSelesaiMapG1;
            if (g === 2) map = slsSelesaiMapG2;
            if (g === 3) map = slsSelesaiMapG3;
            if (g === 4) map = slsSelesaiMapG4;

            let allSelesai = true;
            allSlsSet.forEach(code => {
              const pct = map[code] ?? 0;
              if (pct < 100) allSelesai = false;
            });
            return allSelesai;
          };

          const pmlG1 = getPmlGelEligibility(1);
          const pmlG2 = getPmlGelEligibility(2);
          const pmlG3 = getPmlGelEligibility(3);
          const pmlG4 = getPmlGelEligibility(4);

          if (gel === 1 && pmlG1) {
            eligibleSet.add(u.id);
          } else if (gel === 2 && pmlG2 && !pmlG1) {
            eligibleSet.add(u.id);
          } else if (gel === 3 && pmlG3 && !pmlG1 && !pmlG2) {
            eligibleSet.add(u.id);
          } else if (gel === 4 && pmlG4 && !pmlG1 && !pmlG2 && !pmlG3) {
            eligibleSet.add(u.id);
          }
        }
      });
    });

    isBappEligibilityLoadedT2 = true;
  } catch (err) {
    console.error('Gagal memproses data kelayakan BAPP T2:', err);
  }
}

// Modal open/close & refresh handlers for BAPP
function openBappModal() {
  currentBappTermin = 1;
  const modal = document.getElementById('bappModal');
  const title = document.querySelector('#bappModal .bottom-sheet-title');
  const sub = document.querySelector('#bappModal .bottom-sheet-header div div:nth-child(2)');
  if (title) title.textContent = 'Tabel BAPP Pencairan Termin I';
  if (sub) sub.textContent = 'Pantau, filter, dan cetak PDF BAPP Termin I seluruh petugas.';

  if (modal) {
    modal.classList.add('open');
    loadBAPPKecamatanFilter();
    loadBAPPData();
  }
}

async function openBappModalT2() {
  currentBappTermin = 2;
  const modal = document.getElementById('bappModal');
  const title = document.querySelector('#bappModal .bottom-sheet-title');
  const sub = document.querySelector('#bappModal .bottom-sheet-header div div:nth-child(2)');
  if (title) title.textContent = 'Tabel BAPP Pencairan Termin II';
  if (sub) sub.textContent = 'Pantau, filter, dan cetak PDF BAPP Termin II seluruh petugas.';

  if (modal) {
    modal.classList.add('open');
    loadBAPPKecamatanFilter();
    loadBAPPData();
  }
}

function closeBappModal() {
  const modal = document.getElementById('bappModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

function refreshCurrentBapp() {
  loadBAPPData();
}

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
    // Jalankan kalkulasi kelayakan gelombang di memori
    if (currentBappTermin === 2) {
      if (typeof loadBappEligibilityDataT2 === 'function') {
        await loadBappEligibilityDataT2();
      }
    } else {
      await loadBappEligibilityData();
    }

    const tableName = currentBappTermin === 2 ? 'bapp_uploads_t2' : 'bapp_uploads';
    const selectCols = currentBappTermin === 2
      ? 'id, profile_id, kode_kec, crop_top, crop_bottom, crop_top_uninstall, crop_bottom_uninstall, created_at, profiles:profile_id(nama, role, nik, sobatid), wilayah_kec:kode_kec(nmkec)'
      : 'id, profile_id, kode_kec, crop_top, crop_bottom, created_at, profiles:profile_id(nama, role, nik, sobatid), wilayah_kec:kode_kec(nmkec)';

    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    let totalCount = 0;
    while (hasMore) {
      const { data, error, count } = await db
        .from(tableName)
        .select(selectCols, { count: page === 0 ? 'exact' : 'none' })
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      if (page === 0) {
        totalCount = count || 0;
      }
      if (data && data.length > 0) {
        allData = allData.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    allBappUploads = allData;
    totalBappDbCount = totalCount || allBappUploads.length;
    currentBappPage = 1;
    filterBAPP();
  } catch (err) {
    console.error('Error loading BAPP data:', err);
    showToast('Gagal memuat data BAPP: ' + err.message, 'error');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--error)">Gagal memuat: ${err.message}</td></tr>`;
    }
  } finally {
    const spinner = tbody ? tbody.querySelector('.spinner') : null;
    if (spinner) spinner.remove();
  }
}
// Fungsi pembantu OCR latar belakang tanpa mengganggu interaksi pengguna
function runSilentOcrAutoDetect(imageSrc) {
  return new Promise((resolve, reject) => {
    if (!window.Tesseract) {
      return reject('Library Tesseract tidak tersedia');
    }
    Tesseract.recognize(
      imageSrc,
      'eng'
    ).then(({ data: { lines } }) => {
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        const h = img.naturalHeight;
        let topY = null;
        let bottomY = null;
        for (const line of lines) {
          const text = line.text.toLowerCase();
          if (topY === null && (text.includes('silakan') || text.includes('sensus') || text.includes('ekonomi') || text.includes('pilih') || text.includes('fasih'))) {
            topY = line.bbox.y0;
          }
          if (text.includes('selesai') || text.includes('pencacah') || text.includes('pengawas') || text.includes('hari lagi') || text.includes('hari')) {
            if (bottomY === null || line.bbox.y1 > bottomY) {
              bottomY = line.bbox.y1;
            }
          }
        }
        const finalTop = topY !== null ? Math.max(0, topY - 15) / h * 100 : 12.5;
        const finalBottom = bottomY !== null ? Math.min(h, bottomY + 30) / h * 100 : 46.5;
        resolve({ top: parseFloat(finalTop.toFixed(1)), bottom: parseFloat(finalBottom.toFixed(1)) });
      };
      img.onerror = () => reject('Gagal memproses gambar');
    }).catch(err => reject(err));
  });
}

// OCR Khusus Uninstall FASIH (Google Play Store):
// - Batas atas: deteksi "fasih" / "direktorat sistem informasi statistik" lalu kurangi 25px
// - Batas bawah: skala 1:1 (tinggi crop = lebar gambar)
function runSilentOcrAutoDetectUninstall(imageSrc) {
  return new Promise((resolve, reject) => {
    if (!window.Tesseract) {
      return reject('Library Tesseract tidak tersedia');
    }
    Tesseract.recognize(
      imageSrc,
      'eng'
    ).then(({ data: { lines } }) => {
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        let topY = null;
        for (const line of lines) {
          const text = line.text.toLowerCase();
          if (text.includes('fasih') || text.includes('direktorat sistem informasi statistik') || text.includes('statistik') || text.includes('instal') || text.includes('install')) {
            if (topY === null || line.bbox.y0 < topY) {
              topY = line.bbox.y0;
            }
          }
        }
        const startY = topY !== null ? Math.max(0, topY - 55) : (h * 0.08);
        const cropHeight = Math.min(w, h - startY);
        const endY = startY + cropHeight;

        const finalTop = (startY / h) * 100;
        const finalBottom = (endY / h) * 100;
        resolve({ top: parseFloat(finalTop.toFixed(1)), bottom: parseFloat(finalBottom.toFixed(1)) });
      };
      img.onerror = () => reject('Gagal memproses gambar');
    }).catch(err => reject(err));
  });
}
// Filter BAPP data locally
function filterBAPP() {
  const kecVal = document.getElementById('bappKecamatanFilter')?.value || '';
  const roleVal = document.getElementById('bappRoleFilter')?.value || '';
  const gelVal = document.getElementById('bappGelombangFilter')?.value || '';
  const timeStartVal = document.getElementById('bappTimeStart')?.value || '';
  const timeEndVal = document.getElementById('bappTimeEnd')?.value || '';
  const searchVal = document.getElementById('bappSearchName')?.value?.toLowerCase() || '';

  const activeEligibility = currentBappTermin === 2 ? bappEligibilityMapT2 : bappEligibilityMap;

  filteredBappUploads = allBappUploads.filter(b => {
    // Filter Kecamatan
    if (kecVal && b.kode_kec !== kecVal) return false;
    // Filter Role
    const role = b.profiles?.role || '';
    if (roleVal && role !== roleVal) return false;
    // Filter Gelombang (Menampilkan yang eligible saja)
    if (gelVal) {
      const eligibleSet = activeEligibility[parseInt(gelVal)];
      const pid = b.profile_id || b.id;
      if (!eligibleSet || !eligibleSet.has(pid)) return false;
    }
    // Filter Range Waktu Upload
    if (timeStartVal) {
      const startLimit = new Date(timeStartVal + 'T00:00:00').getTime();
      const uploadTime = new Date(b.created_at).getTime();
      if (uploadTime < startLimit) return false;
    }
    if (timeEndVal) {
      const endLimit = new Date(timeEndVal + 'T23:59:59').getTime();
      const uploadTime = new Date(b.created_at).getTime();
      if (uploadTime > endLimit) return false;
    }
    // Filter Search Name
    const nama = b.profiles?.nama || '';
    if (searchVal && !nama.toLowerCase().includes(searchVal)) return false;
    return true;
  });
  sortBappData();
  currentBappPage = 1;
  renderBAPPTable();
}
// Sort BAPP data array in memory
function sortBappData() {
  filteredBappUploads.sort((a, b) => {
    let va, vb;
    if (bappSortField === 'created_at') {
      va = new Date(a.created_at || 0).getTime();
      vb = new Date(b.created_at || 0).getTime();
    } else {
      va = (a.profiles?.nama || '').toLowerCase();
      vb = (b.profiles?.nama || '').toLowerCase();
    }
    if (va < vb) return bappSortDir === 'asc' ? -1 : 1;
    if (va > vb) return bappSortDir === 'asc' ? 1 : -1;
    return 0;
  });
}
// Trigger sorting from table headers
function sortBapp(field) {
  bappSortDir = bappSortField === field ? (bappSortDir === 'asc' ? 'desc' : 'asc') : 'asc';
  bappSortField = field;
  // Reset sort icons in BAPP table header
  document.querySelectorAll('th span.bapp-sort-icon').forEach(span => span.textContent = '⇅');
  const activeIcon = document.getElementById(`sort-bapp-${field}`);
  if (activeIcon) activeIcon.textContent = bappSortDir === 'asc' ? '▲' : '▼';
  sortBappData();
  currentBappPage = 1;
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
  const total = filteredBappUploads.length;
  let pageData = filteredBappUploads;
  if (bappPageSize !== 'all') {
    const start = (currentBappPage - 1) * parseInt(bappPageSize);
    pageData = filteredBappUploads.slice(start, start + parseInt(bappPageSize));
  }
  if (countEl) {
    if (total === allBappUploads.length) {
      countEl.textContent = `Total: ${total} petugas`;
    } else {
      countEl.textContent = `Menampilkan ${total} dari ${allBappUploads.length} petugas`;
    }
  }
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada BAPP yang cocok</td></tr>';
    updateSelectedBappCount();
    const pag = document.getElementById('bappPagination');
    if (pag) pag.innerHTML = '';
    return;
  }
  tbody.innerHTML = pageData.map(b => {
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
        <td style="text-align:center;white-space:nowrap;display:flex;gap:0.35rem;justify-content:center">
          <button class="btn btn-secondary btn-sm" onclick="showScreenshot('${b.id}')" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Lihat Bukti
          </button>
          <button class="btn btn-secondary btn-sm" onclick="editBappCrop('${b.id}')" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
            Edit Crop
          </button>
          <button class="btn btn-secondary btn-sm" onclick="printSingleBAPP('${b.id}')" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.25rem 0.5rem">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Cetak PDF
          </button>
        </td>
      </tr>
    `;
  }).join('');
  updateSelectedBappCount();
  renderBappPagination();
}
// Select All Handler
function toggleSelectAllBapp(checked) {
  document.querySelectorAll('.bapp-row-checkbox').forEach(cb => {
    cb.checked = checked;
  });
  updateSelectedBappCount();
}
function changeBappPageSize() {
  bappPageSize = document.getElementById('bappPageSizeSelect').value;
  currentBappPage = 1;
  renderBAPPTable();
}
function goBappPage(p) {
  const totalPages = Math.ceil(filteredBappUploads.length / parseInt(bappPageSize));
  if (p < 1 || p > totalPages) return;
  currentBappPage = p;
  renderBAPPTable();
}
function renderBappPagination() {
  const pag = document.getElementById('bappPagination');
  if (!pag) return;
  if (bappPageSize === 'all') {
    pag.innerHTML = '';
    return;
  }
  const total = filteredBappUploads.length;
  const totalPages = Math.ceil(total / parseInt(bappPageSize));
  if (totalPages <= 1) {
    pag.innerHTML = '';
    return;
  }
  const firstBtn = `<button class="page-btn" onclick="goBappPage(1)" ${currentBappPage === 1 ? 'disabled' : ''} title="Halaman pertama"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/></svg></button>`;
  const prevBtn = `<button class="page-btn" onclick="goBappPage(${currentBappPage - 1})" ${currentBappPage === 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>`;
  const nextBtn = `<button class="page-btn" onclick="goBappPage(${currentBappPage + 1})" ${currentBappPage === totalPages ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>`;
  const lastBtn = `<button class="page-btn" onclick="goBappPage(${totalPages})" ${currentBappPage === totalPages ? 'disabled' : ''} title="Halaman terakhir"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m13 17 5-5-5-5"/><path d="m6 17 5-5-5-5"/></svg></button>`;
  const range = [];
  for (let i = Math.max(1, currentBappPage - 3); i <= Math.min(totalPages, currentBappPage + 3); i++) range.push(i);
  let pageButtons = '';
  if (range[0] > 1) {
    pageButtons += `<button class="page-btn" onclick="goBappPage(1)">1</button>`;
    if (range[0] > 2) pageButtons += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
  }
  range.forEach(p => {
    pageButtons += `<button class="page-btn ${p === currentBappPage ? 'active' : ''}" onclick="goBappPage(${p})">${p}</button>`;
  });
  if (range[range.length - 1] < totalPages) {
    if (range[range.length - 1] < totalPages - 1) pageButtons += `<span style="padding:0 0.25rem;color:var(--text-subtle)">...</span>`;
    pageButtons += `<button class="page-btn" onclick="goBappPage(${totalPages})">${totalPages}</button>`;
  }
  pag.innerHTML = firstBtn + prevBtn + pageButtons + nextBtn + lastBtn;
}
// Screenshot preview and download features
async function showScreenshot(id) {
  const item = allBappUploads.find(b => b.id === id);
  if (!item) return;

  const table = currentBappTermin === 2 ? 'bapp_uploads_t2' : 'bapp_uploads';

  if (!item.screenshot && (!item.screenshot_uninstall || currentBappTermin === 1)) {
    showToast('Memuat screenshot...', 'info');
    try {
      const selectCols = currentBappTermin === 2 ? 'id, screenshot, screenshot_uninstall' : 'id, screenshot';
      const { data, error } = await db
        .from(table)
        .select(selectCols)
        .eq('id', id)
        .single();
      if (error || !data) throw error || new Error('Data tidak ditemukan');
      item.screenshot = data.screenshot;
      if (currentBappTermin === 2) {
        item.screenshot_uninstall = data.screenshot_uninstall;
      }
    } catch (err) {
      console.error(err);
      showToast('Gagal memuat screenshot: ' + err.message, 'error');
      return;
    }
  }

  const modalBody = document.getElementById('screenshotModalBody');
  const modalFooter = document.getElementById('screenshotModalFooter');
  const title = document.getElementById('screenshotModalTitle');
  const modal = document.getElementById('screenshotModal');

  const nama = item.profiles?.nama || 'Petugas';
  const termText = currentBappTermin === 2 ? 'Termin II' : 'Termin I';

  if (title) title.textContent = `Screenshot BAPP ${termText} — ${nama}`;

  if (currentBappTermin === 2 && (item.screenshot || item.screenshot_uninstall)) {
    if (modalBody) {
      modalBody.innerHTML = `
        <div style="display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap">
          <div style="flex:1 1 320px;max-width:420px;text-align:center;background:rgba(255,255,255,0.03);padding:1rem;border-radius:var(--radius-lg);border:1px solid var(--border)">
            <h4 style="margin:0 0 0.75rem 0;font-size:0.95rem;color:var(--text);font-weight:600">1. Bukti Capaian FASIH</h4>
            ${item.screenshot ? `<img src="${item.screenshot}" alt="Bukti Capaian FASIH" style="width:100%;max-height:55vh;object-fit:contain;border-radius:var(--radius-md);border:1px solid var(--border)">` : `<p style="color:var(--text-muted);font-style:italic;padding:2rem 0">Belum diunggah</p>`}
            ${item.screenshot ? `<div style="margin-top:0.75rem"><a href="${item.screenshot}" download="bukti-capaian-fasih-${nama.replace(/\s+/g, '-').toLowerCase()}.png" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:0.35rem;text-decoration:none"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>Download Bukti Capaian</a></div>` : ''}
          </div>
          <div style="flex:1 1 320px;max-width:420px;text-align:center;background:rgba(255,255,255,0.03);padding:1rem;border-radius:var(--radius-lg);border:1px solid var(--border)">
            <h4 style="margin:0 0 0.75rem 0;font-size:0.95rem;color:var(--text);font-weight:600">2. Bukti Uninstall FASIH</h4>
            ${item.screenshot_uninstall ? `<img src="${item.screenshot_uninstall}" alt="Bukti Uninstall FASIH" style="width:100%;max-height:55vh;object-fit:contain;border-radius:var(--radius-md);border:1px solid var(--border)">` : `<p style="color:var(--text-muted);font-style:italic;padding:2rem 0">Belum diunggah</p>`}
            ${item.screenshot_uninstall ? `<div style="margin-top:0.75rem"><a href="${item.screenshot_uninstall}" download="bukti-uninstall-fasih-${nama.replace(/\s+/g, '-').toLowerCase()}.png" class="btn btn-primary btn-sm" style="display:inline-flex;align-items:center;gap:0.35rem;text-decoration:none"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>Download Bukti Uninstall</a></div>` : ''}
          </div>
        </div>
      `;
    }
    if (modalFooter) {
      modalFooter.innerHTML = `<button class="btn btn-secondary" onclick="closeScreenshotModal()">Tutup</button>`;
    }
  } else {
    if (modalBody) {
      modalBody.innerHTML = `<img id="screenshotPreviewImage" src="${item.screenshot || ''}" alt="Screenshot BAPP" style="max-width:100%;max-height:70vh;border-radius:var(--radius-md);border:1px solid var(--border);box-shadow:var(--shadow-sm);object-fit:contain">`;
    }
    if (modalFooter) {
      modalFooter.innerHTML = `
        <button class="btn btn-secondary" onclick="closeScreenshotModal()">Tutup</button>
        <a id="screenshotDownloadBtn" href="${item.screenshot || ''}" download="screenshot-bapp-${nama.replace(/\s+/g, '-').toLowerCase()}.png" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:0.25rem;text-decoration:none">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
          Download Gambar
        </a>
      `;
    }
  }

  if (modal) modal.classList.add('open');
}
// Close screenshot preview modal
function closeScreenshotModal() {
  const modal = document.getElementById('screenshotModal');
  if (modal) modal.classList.remove('open');
}
function updateSelectedBappCount() {
  const checkboxes = document.querySelectorAll('.bapp-row-checkbox:checked');
  const count = checkboxes.length;
  const countSpan = document.getElementById('selectedBappCount');
  const printBtn = document.getElementById('btnPrintSelected');
  const ocrBtn = document.getElementById('btnOcrSelected');
  const ocrCountSpan = document.getElementById('selectedOcrCount');
  if (countSpan) countSpan.textContent = count;
  if (ocrCountSpan) ocrCountSpan.textContent = count;

  if (printBtn) {
    printBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (ocrBtn) {
    ocrBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

async function runOcrSelected() {
  const checkedIds = Array.from(document.querySelectorAll('.bapp-row-checkbox:checked')).map(cb => cb.value);
  const selectedRows = allBappUploads.filter(b => checkedIds.includes(b.id));
  if (selectedRows.length === 0) {
    showToast('Pilih setidaknya satu baris untuk OCR.', 'warning');
    return;
  }

  const table = currentBappTermin === 2 ? 'bapp_uploads_t2' : 'bapp_uploads';
  const ocrBtn = document.getElementById('btnOcrSelected');
  const originalText = ocrBtn ? ocrBtn.innerHTML : 'OCR Terpilih';
  if (ocrBtn) {
    ocrBtn.disabled = true;
    ocrBtn.innerHTML = 'Memproses OCR...';
  }

  loadTesseract(async () => {
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1e293b;
        border: 1px solid #38bdf8;
        color: #f8fafc;
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        z-index: 99999;
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: system-ui, sans-serif;
        font-weight: 500;
        transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }
    // Tarik screenshot yang belum di-load untuk ID terpilih sekaligus (batch query)
    const missingIds = selectedRows.filter(r => !r.screenshot || (currentBappTermin === 2 && r.screenshot_uninstall === undefined)).map(r => r.id);
    if (missingIds.length > 0) {
      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengunduh gambar BAPP...`;
      try {
        const selectCols = currentBappTermin === 2 ? 'id, screenshot, screenshot_uninstall' : 'id, screenshot';
        const chunkSize = 100;
        for (let i = 0; i < missingIds.length; i += chunkSize) {
          const sliceIds = missingIds.slice(i, i + chunkSize);
          const { data, error } = await db
            .from(table)
            .select(selectCols)
            .in('id', sliceIds);
          if (error) throw error;
          (data || []).forEach(item => {
            const found = allBappUploads.find(x => x.id === item.id);
            if (found) {
              found.screenshot = item.screenshot;
              if (currentBappTermin === 2) found.screenshot_uninstall = item.screenshot_uninstall;
            }
          });
        }
      } catch (err) {
        console.error(err);
        showToast('Gagal mengunduh gambar: ' + err.message, 'error');
        indicator.remove();
        if (ocrBtn) {
          ocrBtn.disabled = false;
          ocrBtn.innerHTML = originalText;
        }
        return;
      }
    }
    for (let i = 0; i < selectedRows.length; i++) {
      const b = selectedRows[i];
      indicator.innerHTML = `
        <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
        Memindai OCR BAPP (${i + 1}/${selectedRows.length})...
      `;
      try {
        const updatePayload = {};
        if (b.screenshot) {
          const resultCap = await runSilentOcrAutoDetect(b.screenshot);
          if (resultCap) {
            updatePayload.crop_top = resultCap.top;
            updatePayload.crop_bottom = resultCap.bottom;
            b.crop_top = resultCap.top;
            b.crop_bottom = resultCap.bottom;
          }
        }
        if (currentBappTermin === 2 && b.screenshot_uninstall) {
          const resultUn = await runSilentOcrAutoDetectUninstall(b.screenshot_uninstall);
          if (resultUn) {
            updatePayload.crop_top_uninstall = resultUn.top;
            updatePayload.crop_bottom_uninstall = resultUn.bottom;
            b.crop_top_uninstall = resultUn.top;
            b.crop_bottom_uninstall = resultUn.bottom;
          }
        }

        if (Object.keys(updatePayload).length > 0) {
          const { error } = await db
            .from(table)
            .update(updatePayload)
            .eq('id', b.id);
          if (error) throw error;
        }
      } catch (err) {
        console.error('Silent OCR forced auto-detect failed for ID: ' + b.id, err);
      }
    }
    indicator.style.borderColor = '#10b981';
    indicator.style.color = '#10b981';
    indicator.innerHTML = '✓ Pindai Ulang OCR Selesai!';
    setTimeout(() => {
      indicator.remove();
      filterBAPP(); // Re-render rekap tabel admin
      if (ocrBtn) {
        ocrBtn.disabled = false;
        ocrBtn.innerHTML = originalText;
      }
      // Reset pilihan checkbox
      document.querySelectorAll('.bapp-row-checkbox').forEach(cb => cb.checked = false);
      const checkAll = document.getElementById('selectAllBapp');
      if (checkAll) checkAll.checked = false;
      updateSelectedBappCount();
    }, 2000);
  });
}
// Alias untuk tombol di admin.html
window.ocrSelectedBAPP = runOcrSelected;
window.runOcrSelected = runOcrSelected;

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
// Fungsi helper untuk memuat Tesseract.js secara dinamis lewat CDN jika belum termuat
function loadTesseract(callback) {
  if (window.Tesseract) {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  script.onload = callback;
  script.onerror = () => {
    showToast('Gagal memuat library OCR Tesseract', 'error');
  };
  document.head.appendChild(script);
}
// Fungsi untuk menganalisis teks screenshot secara otomatis menggunakan Tesseract OCR
function runOcrAutoDetect(imageSrc, rangeTop, rangeBottom, labelTop, labelBottom, overlayTop, overlayBottom, statusBar) {
  if (!window.Tesseract) {
    statusBar.style.background = 'rgba(239, 68, 68, 0.1)';
    statusBar.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    statusBar.style.color = '#ef4444';
    statusBar.textContent = 'Gagal mendeteksi: Library OCR tidak termuat.';
    return;
  }
  Tesseract.recognize(
    imageSrc,
    'eng', // Menggunakan kamus bahasa Inggris (sangat cepat & handal untuk mengenali tulisan UI digital)
    {
      logger: m => {
        if (m.status === 'recognizing') {
          statusBar.innerHTML = `<span class="spinner" style="width:10px;height:10px;border-width:2px;display:inline-block;margin-right:6px"></span> Menganalisis teks: ${Math.round(m.progress * 100)}%`;
        }
      }
    }
  ).then(({ data: { lines } }) => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const h = img.naturalHeight;
      let topY = null;
      let bottomY = null;
      for (const line of lines) {
        const text = line.text.toLowerCase();
        // Deteksi batas atas: cari baris yang mengandung 'silakan', 'sensus', 'ekonomi', 'pilih', 'fasih'
        if (topY === null && (text.includes('silakan') || text.includes('sensus') || text.includes('ekonomi') || text.includes('pilih') || text.includes('fasih'))) {
          topY = line.bbox.y0;
        }
        // Deteksi batas bawah: cari baris yang mengandung 'selesai', 'pencacah', 'pengawas', 'hari lagi', atau 'hari'
        if (text.includes('selesai') || text.includes('pencacah') || text.includes('pengawas') || text.includes('hari lagi') || text.includes('hari')) {
          if (bottomY === null || line.bbox.y1 > bottomY) {
            bottomY = line.bbox.y1;
          }
        }
      }
      let finalTop = 12.5;
      let finalBottom = 46.5;
      if (topY !== null) {
        // Berikan padding 15px ke atas
        const paddedTop = Math.max(0, topY - 15);
        finalTop = (paddedTop / h) * 100;
      }
      if (bottomY !== null) {
        // Berikan padding 30px ke bawah
        const paddedBottom = Math.min(h, bottomY + 30);
        finalBottom = (paddedBottom / h) * 100;
      }
      // Update UI slider & overlay
      rangeTop.value = finalTop.toFixed(1);
      rangeBottom.value = finalBottom.toFixed(1);
      labelTop.textContent = finalTop.toFixed(1) + '%';
      labelBottom.textContent = finalBottom.toFixed(1) + '%';
      overlayTop.style.height = finalTop.toFixed(1) + '%';
      overlayBottom.style.height = (100 - finalBottom).toFixed(1) + '%';
      statusBar.style.background = 'rgba(16, 185, 129, 0.1)';
      statusBar.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      statusBar.style.color = '#10b981';
      statusBar.innerHTML = '✓ OCR Berhasil! Batas krop otomatis disesuaikan.';
    };
  }).catch(err => {
    console.error(err);
    statusBar.style.background = 'rgba(239, 68, 68, 0.1)';
    statusBar.style.borderColor = 'rgba(239, 68, 68, 0.2)';
    statusBar.style.color = '#ef4444';
    statusBar.textContent = 'Gagal mendeteksi teks secara otomatis. Silakan atur manual.';
  });
}
// Edit BAPP Crop Settings visually with live preview overlays (Supports Capaian & Uninstall in Termin 2)
async function editBappCrop(id) {
  const b = allBappUploads.find(item => item.id === id);
  if (!b) return;
  const table = currentBappTermin === 2 ? 'bapp_uploads_t2' : 'bapp_uploads';

  if (!b.screenshot || (currentBappTermin === 2 && b.screenshot_uninstall === undefined)) {
    showToast('Memuat gambar screenshot...', 'info');
    try {
      const selectCols = currentBappTermin === 2 ? 'screenshot, screenshot_uninstall' : 'screenshot';
      const { data, error } = await db
        .from(table)
        .select(selectCols)
        .eq('id', id)
        .single();
      if (error || !data) throw error || new Error('Screenshot tidak ditemukan di database');
      b.screenshot = data.screenshot;
      if (currentBappTermin === 2) {
        b.screenshot_uninstall = data.screenshot_uninstall;
      }
    } catch (err) {
      console.error(err);
      showToast('Gagal memuat screenshot: ' + err.message, 'error');
      return;
    }
  }

  let activeTab = 'capaian'; // 'capaian' | 'uninstall'

  const cropState = {
    capaian: {
      src: b.screenshot || '',
      top: (b.crop_top !== undefined && b.crop_top !== null) ? parseFloat(b.crop_top) : 12.5,
      bottom: (b.crop_bottom !== undefined && b.crop_bottom !== null) ? parseFloat(b.crop_bottom) : 46.5
    },
    uninstall: {
      src: b.screenshot_uninstall || '',
      top: (b.crop_top_uninstall !== undefined && b.crop_top_uninstall !== null) ? parseFloat(b.crop_top_uninstall) : 12.0,
      bottom: (b.crop_bottom_uninstall !== undefined && b.crop_bottom_uninstall !== null) ? parseFloat(b.crop_bottom_uninstall) : 57.0
    }
  };

  const modalId = 'bapp-crop-editor-modal';
  let modal = document.getElementById(modalId);
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = modalId;
  modal.style = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(15, 23, 42, 0.8); backdrop-filter: blur(8px);
    display: flex; justify-content: center; align-items: center;
    z-index: 10000; font-family: system-ui, -apple-system, sans-serif;
  `;

  const tabsHtml = currentBappTermin === 2 ? `
    <div style="display: flex; width: 100%; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
      <button id="tab-btn-capaian" style="
        flex: 1; padding: 8px 12px; border-radius: 8px; border: none; font-weight: 600; font-size: 0.85rem; cursor: pointer;
        background: #38bdf8; color: #0f172a; transition: all 0.2s;
      ">1. Bukti Capaian (BAPP)</button>
      <button id="tab-btn-uninstall" style="
        flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); font-weight: 600; font-size: 0.85rem; cursor: pointer;
        background: transparent; color: #94a3b8; transition: all 0.2s;
      ">2. Bukti Uninstall (BAST)</button>
    </div>
  ` : '';

  modal.innerHTML = `
    <div style="
      background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;
      padding: 24px; width: 480px; color: #f8fafc; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      display: flex; flex-direction: column; align-items: center; max-height: 92vh; overflow-y: auto;
    ">
      <h3 style="margin-top: 0; margin-bottom: 4px; font-size: 1.25rem; font-weight: 600; color: #ffffff; width: 100%;">Sesuaikan Potong Bukti</h3>
      <p style="font-size: 0.82rem; color: #94a3b8; margin-bottom: 14px; width: 100%; line-height: 1.4;">
        Bagian terang adalah area yang akan dicetak di PDF. Geser slider untuk menyesuaikan batas potong.
      </p>

      ${tabsHtml}
      
      <!-- OCR Status Bar -->
      <div id="ocr-status-bar" style="
        width: 100%; padding: 8px 12px; border-radius: 8px; background: rgba(56, 189, 248, 0.1);
        border: 1px solid rgba(56, 189, 248, 0.2); color: #38bdf8; font-size: 0.8rem;
        text-align: center; margin-bottom: 14px; font-weight: 500; transition: all 0.3s ease; display: none;
      ">
        <span class="spinner" style="width:10px;height:10px;border-width:2px;display:inline-block;margin-right:6px"></span>
        Memproses OCR...
      </div>
      
      <!-- Container Visual Preview -->
      <div id="preview-container" style="
        position: relative; width: 240px; height: 360px; border: 2px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px; overflow: hidden; background: #0f172a; margin-bottom: 16px;
        display: flex; justify-content: center; align-items: flex-start;
      ">
        <img id="preview-img" src="${cropState.capaian.src}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;" />
        <div id="no-img-text" style="display: none; position: absolute; top: 45%; font-size: 0.8rem; color: #94a3b8; font-style: italic;">[Gambar Tidak Tersedia]</div>
        
        <!-- Shaded top overlay -->
        <div id="crop-overlay-top" style="
          position: absolute; top: 0; left: 0; right: 0; height: ${cropState.capaian.top}%;
          background: rgba(15, 23, 42, 0.75); border-bottom: 2px dashed #ef4444; box-sizing: border-box; transition: height 0.05s ease-out;
        "></div>
        
        <!-- Shaded bottom overlay -->
        <div id="crop-overlay-bottom" style="
          position: absolute; bottom: 0; left: 0; right: 0; height: ${100 - cropState.capaian.bottom}%;
          background: rgba(15, 23, 42, 0.75); border-top: 2px dashed #ef4444; box-sizing: border-box; transition: height 0.05s ease-out;
        "></div>
      </div>
      
      <!-- Sliders -->
      <div style="width: 100%; margin-bottom: 16px;">
        <!-- Batas Atas -->
        <div style="margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 4px;">
            <span style="color: #cbd5e1;">Batas Atas (Mulai Crop)</span>
            <span id="label-top" style="color: #38bdf8; font-weight: 700;">${cropState.capaian.top}%</span>
          </div>
          <input type="range" id="range-top" min="0" max="100" step="0.5" value="${cropState.capaian.top}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;">
        </div>
        
        <!-- Batas Bawah -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 4px;">
            <span style="color: #cbd5e1;">Batas Bawah (Akhir Crop)</span>
            <span id="label-bottom" style="color: #38bdf8; font-weight: 700;">${cropState.capaian.bottom}%</span>
          </div>
          <input type="range" id="range-bottom" min="0" max="100" step="0.5" value="${cropState.capaian.bottom}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;">
        </div>

        <button id="btn-editor-auto" style="
          width: 100%; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3);
          color: #38bdf8; padding: 7px 12px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer;
        ">🔍 Potong Otomatis (OCR)</button>
      </div>
      
      <!-- Action Buttons -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; width: 100%;">
        <button id="btn-editor-cancel" style="
          background: transparent; border: 1px solid rgba(255,255,255,0.1); padding: 7px 14px;
          border-radius: 6px; color: white; cursor: pointer; font-size: 0.85rem;
        ">Batal</button>
        <button id="btn-editor-save" style="
          background: #38bdf8; border: none; padding: 7px 16px; border-radius: 6px;
          color: #0f172a; font-weight: 600; cursor: pointer; font-size: 0.85rem;
        ">Simpan Perubahan</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const previewImg = modal.querySelector('#preview-img');
  const noImgText = modal.querySelector('#no-img-text');
  const rangeTop = modal.querySelector('#range-top');
  const rangeBottom = modal.querySelector('#range-bottom');
  const labelTop = modal.querySelector('#label-top');
  const labelBottom = modal.querySelector('#label-bottom');
  const overlayTop = modal.querySelector('#crop-overlay-top');
  const overlayBottom = modal.querySelector('#crop-overlay-bottom');
  const ocrStatus = modal.querySelector('#ocr-status-bar');

  const updateModalView = () => {
    const cur = cropState[activeTab];
    if (cur.src) {
      previewImg.src = cur.src;
      previewImg.style.display = 'block';
      noImgText.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      noImgText.style.display = 'block';
    }
    rangeTop.value = cur.top;
    rangeBottom.value = cur.bottom;
    labelTop.textContent = cur.top.toFixed(1) + '%';
    labelBottom.textContent = cur.bottom.toFixed(1) + '%';
    overlayTop.style.height = cur.top + '%';
    overlayBottom.style.height = (100 - cur.bottom) + '%';
  };

  // Tab switching
  const tabCap = modal.querySelector('#tab-btn-capaian');
  const tabUn = modal.querySelector('#tab-btn-uninstall');
  if (tabCap && tabUn) {
    tabCap.onclick = () => {
      activeTab = 'capaian';
      tabCap.style.background = '#38bdf8';
      tabCap.style.color = '#0f172a';
      tabCap.style.border = 'none';
      tabUn.style.background = 'transparent';
      tabUn.style.color = '#94a3b8';
      tabUn.style.border = '1px solid rgba(255,255,255,0.1)';
      updateModalView();
    };
    tabUn.onclick = () => {
      activeTab = 'uninstall';
      tabUn.style.background = '#38bdf8';
      tabUn.style.color = '#0f172a';
      tabUn.style.border = 'none';
      tabCap.style.background = 'transparent';
      tabCap.style.color = '#94a3b8';
      tabCap.style.border = '1px solid rgba(255,255,255,0.1)';
      updateModalView();
    };
  }

  // Deteksi krop otomatis manual lewat tombol "Potong Otomatis"
  if (modal.querySelector('#btn-editor-auto')) {
    modal.querySelector('#btn-editor-auto').onclick = () => {
      const cur = cropState[activeTab];
      if (!cur.src) {
        showToast('Gambar tidak tersedia untuk OCR', 'warning');
        return;
      }
      ocrStatus.style.display = 'block';
      ocrStatus.style.background = 'rgba(56, 189, 248, 0.1)';
      ocrStatus.style.borderColor = 'rgba(56, 189, 248, 0.2)';
      ocrStatus.style.color = '#38bdf8';
      ocrStatus.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px;display:inline-block;margin-right:6px"></span> Menjalankan OCR...';

      loadTesseract(async () => {
        try {
          let res = null;
          if (activeTab === 'uninstall') {
            res = await runSilentOcrAutoDetectUninstall(cur.src);
          } else {
            res = await runSilentOcrAutoDetect(cur.src);
          }
          if (res) {
            cur.top = res.top;
            cur.bottom = res.bottom;
            updateModalView();
            ocrStatus.style.background = 'rgba(16, 185, 129, 0.1)';
            ocrStatus.style.borderColor = 'rgba(16, 185, 129, 0.2)';
            ocrStatus.style.color = '#10b981';
            ocrStatus.innerHTML = '✓ OCR Berhasil! Batas krop otomatis disesuaikan.';
          }
        } catch (err) {
          ocrStatus.style.background = 'rgba(239, 68, 68, 0.1)';
          ocrStatus.style.borderColor = 'rgba(239, 68, 68, 0.2)';
          ocrStatus.style.color = '#ef4444';
          ocrStatus.textContent = 'Gagal mendeteksi teks: ' + (err.message || err);
        }
      });
    };
  }

  // Real-time slider update
  rangeTop.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (activeTab === 'uninstall') {
      // Kunci skala 1:1 untuk Uninstall
      const cur = cropState.uninstall;
      const imgElem = new Image();
      imgElem.src = cur.src;
      let ratioPercent = 45.0; // fallback standard 9:20 / 9:16 aspect ratio
      if (imgElem.naturalWidth && imgElem.naturalHeight) {
        ratioPercent = (imgElem.naturalWidth / imgElem.naturalHeight) * 100;
      }
      if (val + ratioPercent > 100) {
        val = 100 - ratioPercent;
        rangeTop.value = val;
      }
      cur.top = val;
      cur.bottom = val + ratioPercent;
      rangeBottom.value = cur.bottom;
      labelTop.textContent = cur.top.toFixed(1) + '%';
      labelBottom.textContent = cur.bottom.toFixed(1) + '%';
      overlayTop.style.height = cur.top + '%';
      overlayBottom.style.height = (100 - cur.bottom) + '%';
    } else {
      if (val >= parseFloat(rangeBottom.value)) {
        val = parseFloat(rangeBottom.value) - 0.5;
        rangeTop.value = val;
      }
      cropState[activeTab].top = val;
      labelTop.textContent = val.toFixed(1) + '%';
      overlayTop.style.height = val + '%';
    }
  });

  rangeBottom.addEventListener('input', (e) => {
    if (activeTab === 'uninstall') {
      // Kunci 1:1: Jika slider bawah digeser, geser batas atas agar tetap 1:1
      const cur = cropState.uninstall;
      const imgElem = new Image();
      imgElem.src = cur.src;
      let ratioPercent = 45.0;
      if (imgElem.naturalWidth && imgElem.naturalHeight) {
        ratioPercent = (imgElem.naturalWidth / imgElem.naturalHeight) * 100;
      }
      let bVal = parseFloat(e.target.value);
      if (bVal - ratioPercent < 0) {
        bVal = ratioPercent;
        rangeBottom.value = bVal;
      }
      cur.bottom = bVal;
      cur.top = bVal - ratioPercent;
      rangeTop.value = cur.top;
      labelTop.textContent = cur.top.toFixed(1) + '%';
      labelBottom.textContent = cur.bottom.toFixed(1) + '%';
      overlayTop.style.height = cur.top + '%';
      overlayBottom.style.height = (100 - cur.bottom) + '%';
    } else {
      let val = parseFloat(e.target.value);
      if (val <= parseFloat(rangeTop.value)) {
        val = parseFloat(rangeTop.value) + 0.5;
        rangeBottom.value = val;
      }
      cropState[activeTab].bottom = val;
      labelBottom.textContent = val.toFixed(1) + '%';
      overlayBottom.style.height = (100 - val) + '%';
    }
  });

  modal.querySelector('#btn-editor-cancel').onclick = () => modal.remove();
  modal.querySelector('#btn-editor-save').onclick = async () => {
    const saveBtn = modal.querySelector('#btn-editor-save');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.innerHTML = 'Menyimpan...';

    const updatePayload = {
      crop_top: cropState.capaian.top,
      crop_bottom: cropState.capaian.bottom
    };
    if (currentBappTermin === 2) {
      updatePayload.crop_top_uninstall = cropState.uninstall.top;
      updatePayload.crop_bottom_uninstall = cropState.uninstall.bottom;
    }

    try {
      const { error } = await db
        .from(table)
        .update(updatePayload)
        .eq('id', id);
      if (error) throw error;

      b.crop_top = cropState.capaian.top;
      b.crop_bottom = cropState.capaian.bottom;
      if (currentBappTermin === 2) {
        b.crop_top_uninstall = cropState.uninstall.top;
        b.crop_bottom_uninstall = cropState.uninstall.bottom;
      }

      showToast('Batas pemotongan berhasil disimpan!', 'success');
      modal.remove();
      filterBAPP();
    } catch (err) {
      console.error('Error saving crop offsets:', err);
      showToast('Gagal menyimpan: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  };
}

function loadJsPDF(callback) {
  if (window.jspdf) {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  script.onload = callback;
  script.onerror = () => {
    showToast('Gagal memuat library jsPDF', 'error');
  };
  document.head.appendChild(script);
}

const TANGGAL_TERBILANG_BAPP_T2 = {
  1: "Jumat, tanggal sebelas, bulan September, tahun dua ribu dua puluh enam (11-09-2026)",
  2: "Senin, tanggal empat belas, bulan September, tahun dua ribu dua puluh enam (14-09-2026)",
  3: "Selasa, tanggal lima belas, bulan September, tahun dua ribu dua puluh enam (15-09-2026)",
  4: "Rabu, tanggal enam belas, bulan September, tahun dua ribu dua puluh enam (16-09-2026)"
};

function drawRichJustifiedText(pdf, text, x, y, maxWidth, lineHeight) {
  const isBoldWord = (w) => {
    const clean = (w || '').toUpperCase().replace(/[^A-Z]/g, '');
    return clean === 'PIHAK' || clean === 'PERTAMA' || clean === 'KEDUA' || clean === 'PARA' || clean === 'BELAH';
  };

  const lines = pdf.splitTextToSize(text, maxWidth);
  lines.forEach((line, lineIdx) => {
    const currentY = y + lineIdx * lineHeight;
    const isLastLine = lineIdx === lines.length - 1;
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1 || isLastLine) {
      let curX = x;
      words.forEach(w => {
        const bold = isBoldWord(w);
        pdf.setFont("Bookman", bold ? "bold" : "normal");
        pdf.text(w, curX, currentY);
        curX += pdf.getTextWidth(w) + pdf.getTextWidth(' ');
      });
      pdf.setFont("Bookman", "normal");
      return;
    }

    let wordsWidth = 0;
    words.forEach(w => {
      const bold = isBoldWord(w);
      pdf.setFont("Bookman", bold ? "bold" : "normal");
      wordsWidth += pdf.getTextWidth(w);
    });

    const remainingSpace = maxWidth - wordsWidth;
    const wordSpacing = (words.length > 1) ? (remainingSpace / (words.length - 1)) : 0;

    let curX = x;
    words.forEach((w) => {
      const bold = isBoldWord(w);
      pdf.setFont("Bookman", bold ? "bold" : "normal");
      pdf.text(w, curX, currentY);
      curX += pdf.getTextWidth(w) + wordSpacing;
    });
    pdf.setFont("Bookman", "normal");
  });
  return lines.length;
}

async function buildBappT2SingleDocument(pdf, r, ttdYulianBase64, ttdNingBase64, gelombang, noSuratMap, userSlsData, capaianMap, pmlPplMap) {
  const userProfile = (allUsers || []).find(u => u.id === (r.profile_id || r.id) || (u.sobatid && String(u.sobatid).trim() === String(r.profiles?.sobatid).trim())) || {};
  const role = r.profiles?.role || userProfile.role || 'ppl';
  const isPml = role === 'pml';
  const nama = (r.profiles?.nama || userProfile.nama || '.........................................').trim();
  const sobatid = String(r.profiles?.sobatid || userProfile.sobatid || '').trim();
  const profileId = r.profile_id || userProfile.id || r.id;

  const noEntry = (noSuratMap && noSuratMap[sobatid]) || {};
  const nik = r.profiles?.nik || userProfile.nik || noEntry?.nik || '';
  const spkNo = noEntry.no_spk || '......./SPK/3602/2026';

  let bappNo = noEntry.no_sp_pemeriksaan_t2 || '';
  if (!bappNo) {
    const rawNo = noEntry.no_spk || noEntry.no_sp_pemeriksaan_t1 || '';
    const match = rawNo.match(/\b(\d+)\b/) || rawNo.match(/B-(\d+)/i) || rawNo.match(/^B-([^\/]+)/i);
    const num = match ? match[1] : '';
    bappNo = num ? `B-${num}/BAPP-II-SE2026/3602/09/2026` : `.../BAPP-II-SE2026/3602/09/2026`;
  }

  let kecamatan = r.wilayah_kec?.nmkec || '';
  if (!kecamatan && r.kode_kec) {
    const matchKec = (allWilayah || []).find(w => w.kode_sls_gabungan && w.kode_sls_gabungan.substring(4, 7) === r.kode_kec);
    if (matchKec) kecamatan = matchKec.nmkec;
  }
  if (!kecamatan) {
    kecamatan = userProfile.kecamatan || '';
  }
  const cleanKec = kecamatan ? kecamatan.trim() : '';

  const roleTitleWithKec = isPml
    ? (cleanKec ? `Pemeriksa Lapangan Sensus Ekonomi 2026 Kecamatan ${cleanKec}` : "Pemeriksa Lapangan Sensus Ekonomi 2026")
    : (cleanKec ? `Petugas Lapangan Sensus Ekonomi 2026 Kecamatan ${cleanKec}` : "Petugas Lapangan Sensus Ekonomi 2026");

  // Hitung total SLS yang ditugaskan
  let totalSls = 0;
  if (isPml) {
    const supervisedPpls = (pmlPplMap && pmlPplMap[profileId]) ? Array.from(pmlPplMap[profileId]) : [];
    if (supervisedPpls.length > 0) {
      const pmlSls = (userSlsData || []).filter(s => supervisedPpls.includes(s.user_id));
      totalSls = pmlSls.length;
    } else {
      const pmlOwnSls = (userSlsData || []).filter(s => s.user_id === profileId);
      totalSls = pmlOwnSls.length;
    }
  } else {
    const pSls = (userSlsData || []).filter(s => s.user_id === profileId);
    totalSls = pSls.length;
  }

  // Target = total target * 0.6 pembulatan ke bawah, realisasi = target
  const targetCount = totalSls > 0 ? Math.floor(totalSls * 0.6) : 0;
  const realisasiCount = targetCount;

  // --- HALAMAN 1 (PORTRAIT A4) ---
  pdf.setLineHeightFactor(1.0);
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("BERITA ACARA PEMERIKSAAN HASIL PEKERJAAN TERMIN II", 105, 23, { align: "center" });
  if (isPml) {
    pdf.text("PEMERIKSA LAPANGAN", 105, 29, { align: "center" });
    pdf.text("SENSUS EKONOMI 2026", 105, 35, { align: "center" });
  } else {
    pdf.text("PETUGAS LAPANGAN", 105, 29, { align: "center" });
    pdf.text("SENSUS EKONOMI 2026", 105, 35, { align: "center" });
  }

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${bappNo}`, 105, 42, { align: "center" });

  let y = 52;
  const dateSpelled = TANGGAL_TERBILANG_BAPP_T2[gelombang] || TANGGAL_TERBILANG_BAPP_T2[1];
  const intro = `Pada hari ini ${dateSpelled}, berdasarkan Perjanjian Kerja pada Badan Pusat Statistik Kabupaten Lebak Nomor: ${spkNo} , bertempat di Lebak, kami yang bertanda tangan di bawah ini:`;
  const introLines = drawRichJustifiedText(pdf, intro, 25, y, 160, 5);
  y += introLines * 5 + 3;

  const labelX = 30;
  const colonX = 52;
  const valueX = 56;
  const lh = 5;

  pdf.text("1.", 25, y);
  pdf.text("Nama", labelX, y); pdf.text(":", colonX, y); pdf.text("YULIAN SARWO EDI", valueX, y); y += lh;
  pdf.text("NIP", labelX, y); pdf.text(":", colonX, y); pdf.text("197707101999121001", valueX, y); y += lh;
  const wrapJab1 = pdf.splitTextToSize("Ketua Tim Pelaksana Sensus Ekonomi 2026 BPS Kabupaten Lebak", 185 - valueX);
  pdf.text("Jabatan", labelX, y); pdf.text(":", colonX, y); pdf.text(wrapJab1, valueX, y);
  y += wrapJab1.length * lh;

  pdf.text("dalam hal ini mewakili:", labelX, y); y += lh;
  pdf.text("Nama", labelX, y); pdf.text(":", colonX, y); pdf.text("NING SRI LESTARI", valueX, y); y += lh;
  pdf.text("NIP", labelX, y); pdf.text(":", colonX, y); pdf.text("198107062002122002", valueX, y); y += lh;
  const pihak1Teks = "PPK BPS Kabupaten Lebak, selanjutnya disebut sebagai PIHAK PERTAMA.";
  const wrapPPK = pdf.splitTextToSize(pihak1Teks, 185 - valueX);
  pdf.text("Jabatan", labelX, y); pdf.text(":", colonX, y);
  drawRichJustifiedText(pdf, pihak1Teks, valueX, y, 185 - valueX, lh);
  y += wrapPPK.length * lh + 2;

  pdf.text("2.", 25, y);
  pdf.text("Nama", labelX, y); pdf.text(":", colonX, y); pdf.text((nama || "").toUpperCase(), valueX, y); y += lh;
  pdf.text("NIK", labelX, y); pdf.text(":", colonX, y); pdf.text(nik || ".....................................", valueX, y); y += lh;
  const wrapJab2 = pdf.splitTextToSize(roleTitleWithKec, 185 - valueX);
  pdf.text("Jabatan", labelX, y); pdf.text(":", colonX, y); pdf.text(wrapJab2, valueX, y);
  y += wrapJab2.length * lh;
  const pihak2Teks = "bertindak untuk dan atas namanya sendiri, selanjutnya disebut sebagai PIHAK KEDUA.";
  const wrapPihak2 = pdf.splitTextToSize(pihak2Teks, 185 - labelX);
  drawRichJustifiedText(pdf, pihak2Teks, labelX, y, 185 - labelX, lh);
  y += wrapPihak2.length * lh + 3;

  pdf.text("Dengan ini menyatakan:", 25, y);
  y += 5;

  const klausa = isPml ? [
    `PIHAK KEDUA telah melaksanakan pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${spkNo}, sesuai dengan target pekerjaan termin II yang ditetapkan sebesar ${targetCount || jmlSls} SLS/Sub-SLS.`,
    `PIHAK KEDUA telah menyelesaikan pekerjaan termin II Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 berdasarkan hasil pemeriksaan dan evaluasi pekerjaan sebagaimana tercantum dalam lampiran.`,
    `Berdasarkan angka 2 tersebut di atas, PIHAK KEDUA menyerahkan hasil pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 kepada PIHAK PERTAMA, dan PIHAK PERTAMA menerima hasil pekerjaan tersebut yang telah sesuai dengan seharusnya;`,
    `Pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 sebagaimana dimaksud dalam angka 3, berupa dokumen pemeriksaan hasil Pendataan Lapangan Sensus Ekonomi 2026, sejumlah ${realisasiCount || targetCount || jmlSls} SLS/Sub-SLS.`,
    `Pekerjaan pemeriksaan sebagaimana dimaksud pada angka 4 yang memerlukan pemeriksaan lanjutan, akan dilakukan pengecekan, perubahan, dan/atau kunjungan kembali ke lapangan merujuk pada perjanjian yang ditandatangani oleh PARA PIHAK.`
  ] : [
    `PIHAK KEDUA telah melaksanakan pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${spkNo}, sesuai dengan target pekerjaan termin II yang ditetapkan sebesar ${targetCount || jmlSls} SLS/Sub-SLS.`,
    `PIHAK KEDUA telah menyelesaikan pekerjaan termin II Pendataan Lapangan Sensus Ekonomi 2026 berdasarkan hasil pemeriksaan dan evaluasi pekerjaan sebagaimana tercantum dalam lampiran.`,
    `Berdasarkan angka 2 tersebut di atas, PIHAK KEDUA menyerahkan hasil pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 kepada PIHAK PERTAMA, dan PIHAK PERTAMA menerima hasil pekerjaan tersebut yang telah sesuai dengan seharusnya;`,
    `Hasil pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 sebagaimana dimaksud dalam angka 3, berupa dokumen hasil Pendataan Lapangan Sensus Ekonomi 2026, sejumlah ${realisasiCount || targetCount || jmlSls} SLS/Sub-SLS.`,
    `Hasil pekerjaan pendataan sebagaimana dimaksud pada angka 4 yang memerlukan pemeriksaan lanjutan, akan dilakukan pengecekan, perubahan, dan/atau kunjungan kembali ke lapangan merujuk pada perjanjian yang ditandatangani oleh PARA PIHAK.`
  ];

  const textWidth = 185 - 33;
  klausa.forEach((teks, idx) => {
    const linesCount = pdf.splitTextToSize(teks, textWidth).length;
    pdf.text(`${idx + 1}.`, 25, y);
    drawRichJustifiedText(pdf, teks, 33, y, textWidth, 4.5);
    y += linesCount * 4.5 + 1.5;
  });

  // --- HALAMAN 2 (PORTRAIT A4 PENUTUP & TTD) ---
  pdf.addPage('a4', 'portrait');

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('-2-', 105, 12, { align: 'center' });

  let y2 = 25;
  const penutup = "Demikian Berita Acara ini dibuat dengan sebenarnya dalam rangkap 2 (dua) dan menjadi sah berlaku setelah ditandatangani oleh KEDUA BELAH PIHAK.";
  const penutupLinesCount = drawRichJustifiedText(pdf, penutup, 25, y2, 160, 5);
  y2 += penutupLinesCount * 5 + 15;

  const ttdY = y2;
  pdf.text("PIHAK KEDUA,", 55, ttdY, { align: "center" });
  pdf.text("PIHAK PERTAMA,", 155, ttdY, { align: "center" });
  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', 145, ttdY + 6, 20, 28);
  }
  pdf.text(`(${nama || ""})`.toUpperCase(), 55, ttdY + 34, { align: "center" });
  pdf.text("(YULIAN SARWO EDI)", 155, ttdY + 34, { align: "center" });

  // --- HALAMAN 3 (LANDSCAPE A4 LAMPIRAN I - TABEL URAIAN) ---
  pdf.addPage('a4', 'landscape');
  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('-3-', 148.5, 12, { align: 'center' });

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('LAMPIRAN', 148.5, 22, { align: 'center' });
  pdf.text('BERITA ACARA PEMERIKSAAN PEKERJAAN TERMIN II', 148.5, 27, { align: 'center' });
  const lampRoleTitle = isPml ? "PEMERIKSA LAPANGAN SENSUS EKONOMI 2026" : "PETUGAS LAPANGAN SENSUS EKONOMI 2026";
  pdf.text(lampRoleTitle, 148.5, 32, { align: 'center' });
  pdf.text('PADA BADAN PUSAT STATISTIK KABUPATEN LEBAK', 148.5, 37, { align: 'center' });
  pdf.text(`NOMOR: ${bappNo}`, 148.5, 42, { align: 'center' });

  pdf.text('I. DAFTAR URAIAN PEKERJAAN, WAKTU PENYELESAIAN, TARGET PEKERJAAN, REALISASI PEKERJAAN DAN NILAI PERJANJIAN', 20, 50);

  // --- TABEL URAIAN PEKERJAAN (LANDSCAPE) ---
  const tX = 20;
  const tY = 54;
  const colW = [72, 38, 52, 50, 45]; // total = 257mm (from X=20 to X=277)

  pdf.setFont('Bookman', 'normal');

  // Header baris 1 & 2
  // Col 0: Uraian Pekerjaan (span 2 row, h=14)
  pdf.rect(tX, tY, colW[0], 14);
  pdf.text("Uraian Pekerjaan", tX + colW[0] / 2, tY + 8, { align: "center" });

  // Col 1: Waktu Penyelesaian (span 2 row, h=14)
  pdf.rect(tX + colW[0], tY, colW[1], 14);
  const wrapWaktu = pdf.splitTextToSize("Waktu Penyelesaian", colW[1] - 4);
  pdf.text(wrapWaktu, tX + colW[0] + colW[1] / 2, tY + 6, { align: "center" });

  // Col 2: Target Pekerjaan (header atas h=7)
  pdf.rect(tX + colW[0] + colW[1], tY, colW[2], 7);
  pdf.text("Target Pekerjaan", tX + colW[0] + colW[1] + colW[2] / 2, tY + 5, { align: "center" });
  // Sub-kolom Target: Presentase (22mm) & Volume (30mm)
  pdf.rect(tX + colW[0] + colW[1], tY + 7, 22, 7);
  pdf.text("Presentase", tX + colW[0] + colW[1] + 11, tY + 11.5, { align: "center" });
  pdf.rect(tX + colW[0] + colW[1] + 22, tY + 7, 30, 7);
  pdf.text("Volume", tX + colW[0] + colW[1] + 22 + 15, tY + 11.5, { align: "center" });

  // Col 3: Realisasi Pekerjaan (span 2 row, h=14)
  const xCol3 = tX + colW[0] + colW[1] + colW[2];
  pdf.rect(xCol3, tY, colW[3], 14);
  const wrapReal = pdf.splitTextToSize("Realisasi Pekerjaan", colW[3] - 4);
  pdf.text(wrapReal, xCol3 + colW[3] / 2, tY + 6, { align: "center" });

  // Col 4: Nilai Perjanjian (span 2 row, h=14)
  const xCol4 = xCol3 + colW[3];
  pdf.rect(xCol4, tY, colW[4], 14);
  const wrapNilai = pdf.splitTextToSize("Nilai Perjanjian", colW[4] - 4);
  pdf.text(wrapNilai, xCol4 + colW[4] / 2, tY + 6, { align: "center" });

  // Baris Nomor Kolom (1) s/d (6) h=5
  const numY = tY + 14;
  pdf.setFont('Bookman', 'normal');
  pdf.rect(tX, numY, colW[0], 5);
  pdf.text("(1)", tX + colW[0] / 2, numY + 3.5, { align: "center" });

  pdf.rect(tX + colW[0], numY, colW[1], 5);
  pdf.text("(2)", tX + colW[0] + colW[1] / 2, numY + 3.5, { align: "center" });

  pdf.rect(tX + colW[0] + colW[1], numY, 22, 5);
  pdf.text("(3)", tX + colW[0] + colW[1] + 11, numY + 3.5, { align: "center" });

  pdf.rect(tX + colW[0] + colW[1] + 22, numY, 30, 5);
  pdf.text("(4)", tX + colW[0] + colW[1] + 22 + 15, numY + 3.5, { align: "center" });

  pdf.rect(xCol3, numY, colW[3], 5);
  pdf.text("(5)", xCol3 + colW[3] / 2, numY + 3.5, { align: "center" });

  pdf.rect(xCol4, numY, colW[4], 5);
  pdf.text("(6)", xCol4 + colW[4] / 2, numY + 3.5, { align: "center" });

  // Baris Isi Data (h=18)
  const dataY = numY + 5;
  const dataH = 18;

  // (1) Uraian
  pdf.rect(tX, dataY, colW[0], dataH);
  const uraianTeks = isPml
    ? "Melakukan pemeriksaan hasil pendataan Petugas Lapangan door to door Sensus Ekonomi 2026 termin II"
    : "Melakukan pendataan lapangan door to door Sensus Ekonomi 2026 termin II";
  const wrapUraian = pdf.splitTextToSize(uraianTeks, colW[0] - 6);
  pdf.text(wrapUraian, tX + 3, dataY + 5);

  // (2) Waktu
  pdf.rect(tX + colW[0], dataY, colW[1], dataH);
  const wrapWaktuVal = pdf.splitTextToSize("16 Juli - 31 Agustus 2026", colW[1] - 4);
  pdf.text(wrapWaktuVal, tX + colW[0] + colW[1] / 2, dataY + 8, { align: "center" });

  // (3) Presentase Target
  pdf.rect(tX + colW[0] + colW[1], dataY, 22, dataH);
  pdf.text("60%", tX + colW[0] + colW[1] + 11, dataY + 9, { align: "center" });

  // (4) Volume Target
  pdf.rect(tX + colW[0] + colW[1] + 22, dataY, 30, dataH);
  const wrapVolTgt = pdf.splitTextToSize(`${targetCount || jmlSls}\nSLS/Sub-SLS`, 28);
  pdf.text(wrapVolTgt, tX + colW[0] + colW[1] + 22 + 15, dataY + 7, { align: "center" });

  // (5) Realisasi Pekerjaan
  pdf.rect(xCol3, dataY, colW[3], dataH);
  const realisasiTeks = `Telah mencapai target pekerjaan sebesar ${realisasiCount || targetCount || jmlSls} SLS/Sub-SLS`;
  const wrapRealVal = pdf.splitTextToSize(realisasiTeks, colW[3] - 6);
  pdf.text(wrapRealVal, xCol3 + 3, dataY + 6);

  // (6) Nilai Perjanjian (Nominal Baris Data)
  pdf.rect(xCol4, dataY, colW[4], dataH);
  const nilaiNominal = isPml ? "Rp 7.339.500,00" : "Rp 6.966.000,00";
  const nilaiTerbilang = isPml
    ? "Terbilang: Tujuh juta tiga ratus tiga puluh sembilan ribu lima ratus rupiah"
    : "Terbilang: Enam juta Sembilan ratus enam puluh enam ribu rupiah";
  pdf.text(nilaiNominal, xCol4 + colW[4] / 2, dataY + 9, { align: "center" });

  // Baris Terakhir (Span Kolom 1-5 berisi Terbilang, Kolom 6 berisi Nominal)
  const botRowY = dataY + dataH;
  const botRowH = 9;
  const span1to5W = colW[0] + colW[1] + colW[2] + colW[3];

  pdf.rect(tX, botRowY, span1to5W, botRowH);
  pdf.text(nilaiTerbilang, tX + 3, botRowY + 6);

  pdf.rect(xCol4, botRowY, colW[4], botRowH);
  pdf.text(nilaiNominal, xCol4 + colW[4] / 2, botRowY + 6, { align: "center" });

  // --- HALAMAN 4 (LANDSCAPE A4 LAMPIRAN II - BUKTI PENCAPAIAN) ---
  pdf.addPage('a4', 'landscape');

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('-4-', 148.5, 12, { align: 'center' });

  pdf.setFontSize(11);
  pdf.text('II. BUKTI PENCAPAIAN PEKERJAAN KECAMATAN ' + (cleanKec ? cleanKec.toUpperCase() : '.........................'), 20, 22);

  const prepareCroppedImage = (src, topOff, botOff) => {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const topOffset = (topOff !== undefined && topOff !== null) ? parseFloat(topOff) : 12.5;
        const bottomOffset = (botOff !== undefined && botOff !== null) ? parseFloat(botOff) : 46.5;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const origW = img.naturalWidth;
        const origH = img.naturalHeight;
        const cropHeightPercent = Math.max(5, bottomOffset - topOffset);
        const cropHeight = origH * (cropHeightPercent / 100);
        const startY = origH * (topOffset / 100);
        canvas.width = origW;
        canvas.height = cropHeight;
        ctx.drawImage(img, 0, startY, origW, cropHeight, 0, 0, origW, cropHeight);
        const croppedBase64 = canvas.toDataURL('image/png');
        const ratio = (origH / origW) * (cropHeightPercent / 100);
        resolve({ base64: croppedBase64, ratio: ratio });
      };
      img.onerror = () => resolve(null);
    });
  };

  if (r.screenshot) {
    const res = await prepareCroppedImage(r.screenshot, r.crop_top, r.crop_bottom);
    if (res) {
      const maxW = 160.0;
      const maxH = 80.0;
      let imgHeight = maxH;
      let imgWidth = imgHeight / res.ratio;
      if (imgWidth > maxW) {
        imgWidth = maxW;
        imgHeight = imgWidth * res.ratio;
      }
      const imgX = (297 - imgWidth) / 2;
      const imgY = 28.0;
      pdf.addImage(res.base64, 'PNG', imgX, imgY, imgWidth, imgHeight);
      pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
    }
  } else {
    const imgHeight = 60.0;
    const imgWidth = 80.0;
    const imgX = (297 - imgWidth) / 2;
    const imgY = 28.0;
    pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
    pdf.setFont('Bookman', 'italic');
    pdf.setFontSize(10);
    pdf.text('[Bukti Screenshot Tidak Tersedia]', 148.5, imgY + 30, { align: 'center' });
  }

  // --- TANDA TANGAN 3 PIHAK LAMPIRAN II (HALAMAN 4) ---
  const sigY2 = 120.0;
  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('PIHAK KEDUA,', 70, sigY2, { align: 'center' });
  pdf.text('PIHAK PERTAMA,', 227, sigY2, { align: 'center' });

  if (ttdYulianBase64) {
    const ttdX = 177.5 + (100 - 20) / 2;
    pdf.addImage(ttdYulianBase64, 'PNG', ttdX, sigY2 + 0, 20, 30);
  }
  if (ttdNingBase64) {
    const ttdX = 87 + (100 - 32) / 2;
    pdf.addImage(ttdNingBase64, 'PNG', ttdX, sigY2 + 38, 50, 25);
  }

  pdf.text(`(${nama || ""})`.toUpperCase(), 70, sigY2 + 25, { align: 'center' });
  pdf.text('(YULIAN SARWO EDI)', 227, sigY2 + 25, { align: 'center' });

  pdf.text('Menyetujui,', 148.5, sigY2 + 33, { align: 'center' });
  pdf.text('Pejabat Pembuat Komitmen', 148.5, sigY2 + 38, { align: 'center' });
  pdf.text('(NING SRI LESTARI)', 148.5, sigY2 + 63, { align: 'center' });
}

function printBAPP(rows) {
  if (!rows || rows.length === 0) {
    showToast('Tidak ada BAPP yang dipilih', 'error');
    return;
  }

  // Sort rows by kode_kec, then by role, then by nama
  const sortedRows = [...rows].sort((a, b) => {
    const kecA = a.kode_kec || '';
    const kecB = b.kode_kec || '';
    const compKec = kecA.localeCompare(kecB);
    if (compKec !== 0) return compKec;

    const roleA = a.profiles?.role || '';
    const roleB = b.profiles?.role || '';
    const compRole = roleA.localeCompare(roleB);
    if (compRole !== 0) return compRole;

    const nameA = a.profiles?.nama || '';
    const nameB = b.profiles?.nama || '';
    return nameA.localeCompare(nameB);
  });

  const table = currentBappTermin === 2 ? 'bapp_uploads_t2' : 'bapp_uploads';

  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }
    const missingIds = sortedRows.filter(r => !r.screenshot || (currentBappTermin === 2 && r.screenshot_uninstall === undefined)).map(r => r.id);
    if (missingIds.length > 0) {
      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengunduh gambar BAPP...`;
      try {
        const selectCols = currentBappTermin === 2 ? 'id, screenshot, screenshot_uninstall' : 'id, screenshot';
        const chunkSize = 100;
        for (let i = 0; i < missingIds.length; i += chunkSize) {
          const sliceIds = missingIds.slice(i, i + chunkSize);
          const { data, error } = await db
            .from(table)
            .select(selectCols)
            .in('id', sliceIds);
          if (error) throw error;
          (data || []).forEach(item => {
            const found = allBappUploads.find(x => x.id === item.id);
            if (found) {
              found.screenshot = item.screenshot;
              if (currentBappTermin === 2) found.screenshot_uninstall = item.screenshot_uninstall;
            }
            const rowItem = sortedRows.find(x => x.id === item.id);
            if (rowItem) {
              rowItem.screenshot = item.screenshot;
              if (currentBappTermin === 2) rowItem.screenshot_uninstall = item.screenshot_uninstall;
            }
          });
        }
      } catch (err) {
        console.error(err);
        showToast('Gagal mengunduh gambar: ' + err.message, 'error');
        indicator.remove();
        return;
      }
    }
    let noSuratMap = {};
    let userSlsData = [];
    let capaianMap = {};
    let pmlPplMap = {};
    const gelVal = document.getElementById('bappGelombangFilter')?.value || '1';
    const activeGelombang = parseInt(gelVal) || 1;

    if (currentBappTermin === 2) {
      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat referensi BAPP Termin 2...`;
      try {
        const sobatIds = sortedRows.map(r => {
          const uProf = (allUsers || []).find(u => u.id === (r.profile_id || r.id));
          return String(r.profiles?.sobatid || uProf?.sobatid || '').trim();
        }).filter(Boolean);
        if (sobatIds.length > 0) {
          const chunkSize = 100;
          for (let i = 0; i < sobatIds.length; i += chunkSize) {
            const sliceIds = sobatIds.slice(i, i + chunkSize);
            const { data } = await db.from('no_surat_se').select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2').in('sobatid', sliceIds);
            (data || []).forEach(n => { noSuratMap[String(n.sobatid).trim()] = n; });
          }
        }

        // Ambil semua SLS termin 2 aktif
        let fromSls = 0;
        let hasMoreSls = true;
        while (hasMoreSls) {
          const { data: slsData, error: slsErr } = await db.from('user_sls_termin2')
            .select('user_id, kode_sls, user_id_asal')
            .eq('status', 'aktif')
            .range(fromSls, fromSls + 999);
          if (slsErr) throw slsErr;
          if (slsData && slsData.length > 0) {
            userSlsData = userSlsData.concat(slsData);
            if (slsData.length < 1000) hasMoreSls = false;
            else fromSls += 1000;
          } else {
            hasMoreSls = false;
          }
        }

        // Ambil relasi PML -> PPL
        let fromRel = 0;
        let hasMoreRel = true;
        while (hasMoreRel) {
          const { data: relData, error: relErr } = await db.from('pml_ppl')
            .select('pml_id, ppl_id')
            .range(fromRel, fromRel + 999);
          if (relErr) throw relErr;
          if (relData && relData.length > 0) {
            relData.forEach(r => {
              if (!pmlPplMap[r.pml_id]) pmlPplMap[r.pml_id] = new Set();
              pmlPplMap[r.pml_id].add(r.ppl_id);
            });
            if (relData.length < 1000) hasMoreRel = false;
            else fromRel += 1000;
          } else {
            hasMoreRel = false;
          }
        }
      } catch (err) {
        console.error("Gagal load referensi T2:", err);
      }
    }

    try {
      const orientationPdf = currentBappTermin === 2 ? 'portrait' : 'landscape';
      const pdf = new jsPDF({
        orientation: orientationPdf,
        unit: 'mm',
        format: 'a4'
      });
      if (currentBappTermin === 2) {
        await registerBookmanFont(pdf);
      }
      const loadImgAsBase64 = (url) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.src = url;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = () => {
            resolve(null);
          };
        });
      };
      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
      const ttdNingBase64 = await loadImgAsBase64('assets/ttd/ning sl.png') || await loadImgAsBase64('assets/ning_sri_lestari.png');

      for (let i = 0; i < sortedRows.length; i++) {
        const r = sortedRows[i];
        indicator.innerHTML = `
          <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
          Membuat Halaman PDF BAPP (${i + 1}/${sortedRows.length})...
        `;

        if (currentBappTermin === 2) {
          if (i > 0) {
            pdf.addPage('a4', 'portrait');
          }
          await buildBappT2SingleDocument(pdf, r, ttdYulianBase64, ttdNingBase64, activeGelombang, noSuratMap, userSlsData, capaianMap, pmlPplMap);
        } else {
          // --- Termin 1 Landscape Code (Unchanged) ---
          if (i > 0) {
            pdf.addPage('a4', 'landscape');
          }
          const nama = r.profiles?.nama || '.........................................';
          const kecamatan = r.wilayah_kec?.nmkec || '.........................................';

          pdf.setFont('times', 'normal');
          pdf.setFontSize(11);
          pdf.text('-4-', 148.5, 12, { align: 'center' });
          pdf.setFont('times', 'bold');
          pdf.setFontSize(12);
          pdf.text('II. BUKTI PENCAPAIAN PEKERJAAN KECAMATAN ' + kecamatan.toUpperCase(), 20, 20);

          // Helper function to prepare cropped image
          const prepareCroppedImage = (src, topOff, botOff) => {
            return new Promise((resolve) => {
              if (!src) return resolve(null);
              const img = new Image();
              img.src = src;
              img.onload = () => {
                const topOffset = (topOff !== undefined && topOff !== null) ? parseFloat(topOff) : 12.5;
                const bottomOffset = (botOff !== undefined && botOff !== null) ? parseFloat(botOff) : 46.5;
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const origW = img.naturalWidth;
                const origH = img.naturalHeight;
                const cropHeightPercent = Math.max(5, bottomOffset - topOffset);
                const cropHeight = origH * (cropHeightPercent / 100);
                const startY = origH * (topOffset / 100);
                canvas.width = origW;
                canvas.height = cropHeight;
                ctx.drawImage(img, 0, startY, origW, cropHeight, 0, 0, origW, cropHeight);
                const croppedBase64 = canvas.toDataURL('image/png');
                const ratio = (origH / origW) * (cropHeightPercent / 100);
                resolve({ base64: croppedBase64, ratio: ratio });
              };
              img.onerror = () => resolve(null);
            });
          };

          if (r.screenshot) {
            const res = await prepareCroppedImage(r.screenshot, r.crop_top, r.crop_bottom);
            if (res) {
              const imgHeight = 60.0;
              const imgWidth = imgHeight / res.ratio;
              const imgX = (297 - imgWidth) / 2;
              const imgY = 28.0;
              pdf.addImage(res.base64, 'PNG', imgX, imgY, imgWidth, imgHeight);
              pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
            }
          } else {
            const imgHeight = 60.0;
            const imgWidth = 80.0;
            const imgX = (297 - imgWidth) / 2;
            const imgY = 28.0;
            pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
            pdf.setFont('times', 'italic');
            pdf.setFontSize(10);
            pdf.text('[Bukti Screenshot Tidak Tersedia]', 148.5, imgY + 30, { align: 'center' });
          }

          const sigY = 120.0;
          pdf.setFont('times', 'normal');
          pdf.setFontSize(11);
          pdf.text('PIHAK KEDUA,', 70, sigY, { align: 'center' });
          pdf.text('PIHAK PERTAMA,', 227, sigY, { align: 'center' });
          if (ttdYulianBase64) {
            const ttdX = 177.5 + (100 - 20) / 2;
            pdf.addImage(ttdYulianBase64, 'PNG', ttdX, sigY + 0, 20, 30);
          }
          if (ttdNingBase64) {
            const ttdX = 87 + (100 - 32) / 2;
            pdf.addImage(ttdNingBase64, 'PNG', ttdX, sigY + 38, 50, 25);
          }
          pdf.setFont('times', 'bold');
          pdf.text(nama, 70, sigY + 25, { align: 'center' });
          const leftWidth = pdf.getTextWidth(nama);
          pdf.setLineWidth(0.3);
          pdf.line(70 - leftWidth / 2, sigY + 26, 70 + leftWidth / 2, sigY + 26);
          pdf.text('YULIAN SARWO EDI', 227, sigY + 25, { align: 'center' });
          const rightWidth = pdf.getTextWidth('YULIAN SARWO EDI');
          pdf.line(227 - rightWidth / 2, sigY + 26, 227 + rightWidth / 2, sigY + 26);
          pdf.setFont('times', 'normal');
          pdf.text('Menyetujui,', 148.5, sigY + 33, { align: 'center' });
          pdf.text('Pejabat Pembuat Komitmen', 148.5, sigY + 38, { align: 'center' });
          pdf.setFont('times', 'bold');
          pdf.text('NING SRI LESTARI', 148.5, sigY + 63, { align: 'center' });
          const ppkWidth = pdf.getTextWidth('NING SRI LESTARI');
          pdf.line(148.5 - ppkWidth / 2, sigY + 64, 148.5 + ppkWidth / 2, sigY + 64);
        }
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Berhasil membuat PDF!';
      openPdfSafely(pdf, `BAPP_${currentBappTermin === 2 ? 'Termin2' : 'Termin1'}.pdf`);
      setTimeout(() => {
        indicator.remove();
      }, 2000);
    } catch (err) {
      console.error('Error generating BAPP PDF:', err);
      showToast('Gagal membuat PDF: ' + err.message, 'error');
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

async function triggerRollback(batchId) {
  if (!confirm('Apakah Anda yakin ingin membatalkan (rollback) seluruh data dari upload batch ini? Tindakan ini akan menghapus record baru dan mengembalikan status record yang diperbarui.')) {
    return;
  }
  showToast('Memproses rollback batch...', 'info');
  try {
    const { data, error } = await db.rpc('rollback_upload_batch', { p_batch_id: batchId });
    if (error) throw error;
    showToast(`Rollback berhasil! ${data.deleted_count} data dihapus, ${data.reverted_count} data dikembalikan.`, 'success');
    await loadBatchHistory();
  } catch (err) {
    showToast('Gagal memproses rollback: ' + err.message, 'error');
    console.error(err);
  }
}

// ============================================================
// SP PEMERIKSAAN TERMIN I
// ============================================================
let allPMLData = [];
let spTermin1CurrentPage = 1;
let spTermin1PageSize = 25;
let spTermin1SortConfig = { key: 'nama', dir: 'asc' };
let selectedSPTermin1Ids = new Set(); // menyimpan sobatid PML yang dipilih

async function loadSPTermin1Data() {
  const tbody = document.getElementById('spTerm1TableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem"><span class="spinner" style="width:24px;height:24px;border-width:3px"></span><div style="margin-top:0.5rem;color:var(--text-muted)">Memuat data PML...</div></td></tr>';
  try {
    if (!allUsers || allUsers.length === 0) {
      await loadUsers();
    }
    // Fill Kecamatan dropdown
    const filterSelect = document.getElementById('spTermin1KecamatanFilter');
    if (filterSelect && filterSelect.options.length <= 1) {
      filterSelect.innerHTML = '<option value="">Semua Kecamatan</option>';
      const uniqueKec = new Set();
      allUsers.forEach(u => {
        if (u.kecamatan && u.kecamatan !== '—') uniqueKec.add(u.kecamatan);
      });
      const sortedKec = Array.from(uniqueKec).sort();
      sortedKec.forEach(k => {
        filterSelect.innerHTML += `<option value="${escHtml(k)}">${escHtml(k)}</option>`;
      });
    }

    const pmls = allUsers.filter(u => u.role === 'pml' && u.is_active);
    const activeGelombang = parseInt(document.getElementById('spTermin1GelombangFilter')?.value || '1');

    let pmlCapaianMap = {};
    try {
      const { data: capData, error: capErr } = await db.rpc('get_all_pml_capaian');
      if (!capErr && capData) {
        capData.forEach(c => {
          if (c.pml_id) {
            pmlCapaianMap[c.pml_id] = {
              target: parseInt(c.total_target) || 0,
              capaian: parseInt(c.total_capaian) || 0,
              capaian_g2: parseInt(c.total_capaian_g2) || 0,
              capaian_g3: parseInt(c.total_capaian_g3) || 0,
              capaian_g4: parseInt(c.total_capaian_g4) || 0
            };
          }
        });
      }
    } catch (e) {
      console.warn('Gagal memuat detail capaian PML:', e);
    }

    let noSurats = [];
    let fromNoSurat = 0;
    let hasMoreNoSurat = true;
    const stepNoSurat = 1000;
    while (hasMoreNoSurat) {
      const { data, error } = await db
        .from('no_surat_se')
        .select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2')
        .range(fromNoSurat, fromNoSurat + stepNoSurat - 1);
      if (error) throw error;
      if (!data || data.length === 0) {
        hasMoreNoSurat = false;
      } else {
        noSurats = noSurats.concat(data);
        if (data.length < stepNoSurat) {
          hasMoreNoSurat = false;
        } else {
          fromNoSurat += stepNoSurat;
        }
      }
    }
    const noSuratMap = {};
    noSurats.forEach(n => {
      if (n.sobatid) {
        noSuratMap[String(n.sobatid).trim()] = n;
      }
    });

    const checkPMLEligibility = (totalCapaian, totalTarget) => {
      const pct = totalTarget > 0 ? (totalCapaian / totalTarget) : 0;
      return { eligible: pct >= 0.4, pct };
    };

    allPMLData = pmls.map(p => {
      const key = String(p.sobatid || '').trim();
      const capInfo = pmlCapaianMap[p.id] || { target: 0, capaian: 0, capaian_g2: 0, capaian_g3: 0, capaian_g4: 0 };

      let realisasi = capInfo.capaian;
      if (activeGelombang === 2) realisasi = capInfo.capaian_g2;
      else if (activeGelombang === 3) realisasi = capInfo.capaian_g3;
      else if (activeGelombang === 4) realisasi = capInfo.capaian_g4;
      const pctVal = capInfo.target > 0 ? (realisasi / capInfo.target) * 100 : 0;
      const pct = pctVal.toFixed(2) + '%';

      // Check eligibility per wave for proper filtering
      const g1Status = checkPMLEligibility(capInfo.capaian, capInfo.target);
      const g2Status = checkPMLEligibility(capInfo.capaian_g2, capInfo.target);
      const g3Status = checkPMLEligibility(capInfo.capaian_g3, capInfo.target);

      return {
        ...p,
        no_spk: noSuratMap[key]?.no_spk || '',
        no_sp_pemeriksaan_t1: noSuratMap[key]?.no_sp_pemeriksaan_t1 || '',
        no_sp_pemeriksaan_t2: noSuratMap[key]?.no_sp_pemeriksaan_t2 || '',
        total_target: capInfo.target,
        total_capaian: realisasi,
        capaian_pct: pctVal,
        capaian_label: `${realisasi}/${capInfo.target} (${pct})`,
        g1_eligible: g1Status.eligible,
        g2_eligible: g2Status.eligible,
        g3_eligible: g3Status.eligible
      };
    });

    // Filter mutually exclusive per gelombang
    if (activeGelombang === 2) {
      allPMLData = allPMLData.filter(p => !p.g1_eligible);
    } else if (activeGelombang === 3) {
      allPMLData = allPMLData.filter(p => !p.g1_eligible && !p.g2_eligible);
    } else if (activeGelombang === 4) {
      allPMLData = allPMLData.filter(p => !p.g1_eligible && !p.g2_eligible && !p.g3_eligible);
    }

    filterSPTermin1();
  } catch (err) {
    showToast('Gagal memuat data SP Termin I: ' + err.message, 'error');
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger)">Gagal memuat: ${escHtml(err.message)}</td></tr>`;
  }
}
function filterSPTermin1() {
  const search = document.getElementById('spTerm1Search')?.value.toLowerCase() || '';
  const kec = document.getElementById('spTerm1KecamatanFilter')?.value || '';
  let filtered = allPMLData.filter(p => {
    const matchSearch = (p.nama || '').toLowerCase().includes(search) ||
      (p.sobatid || '').toLowerCase().includes(search);
    const matchKec = kec ? p.kecamatan === kec : true;
    return matchSearch && matchKec;
  });
  // Sort
  filtered.sort((a, b) => {
    let valA = a[spTermin1SortConfig.key];
    let valB = b[spTermin1SortConfig.key];
    if (typeof valA === 'number' && typeof valB === 'number') {
      return spTermin1SortConfig.dir === 'asc' ? valA - valB : valB - valA;
    }
    valA = (valA || '').toString().toLowerCase();
    valB = (valB || '').toString().toLowerCase();
    if (valA < valB) return spTermin1SortConfig.dir === 'asc' ? -1 : 1;
    if (valA > valB) return spTermin1SortConfig.dir === 'asc' ? 1 : -1;
    return 0;
  });
  const countEl = document.getElementById('spTerm1TableCount');
  if (countEl) countEl.textContent = `Total: ${filtered.length} PML`;
  renderSPTermin1Table(filtered);
}
function sortSPTermin1(key) {
  if (spTermin1SortConfig.key === key) {
    spTermin1SortConfig.dir = spTermin1SortConfig.dir === 'asc' ? 'desc' : 'asc';
  } else {
    spTermin1SortConfig.key = key;
    spTermin1SortConfig.dir = 'asc';
  }
  document.querySelectorAll('.sp-sort-icon').forEach(el => el.style.opacity = '0.1');
  const icon = document.getElementById(`sort-sp-${key}`);
  if (icon) {
    icon.style.opacity = '0.8';
    icon.textContent = spTermin1SortConfig.dir === 'asc' ? '▲' : '▼';
  }
  filterSPTermin1();
}
function renderSPTermin1Table(data) {
  const tbody = document.getElementById('spTerm1TableBody');
  const pag = document.getElementById('spTerm1Pagination');
  if (!tbody) return;
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data PML</td></tr>';
    if (pag) pag.innerHTML = '';
    return;
  }
  let displayData = data;
  const totalPages = spTermin1PageSize === 'all' ? 1 : Math.ceil(data.length / spTermin1PageSize);
  if (spTermin1PageSize !== 'all') {
    if (spTermin1CurrentPage > totalPages) spTermin1CurrentPage = totalPages;
    if (spTermin1CurrentPage < 1) spTermin1CurrentPage = 1;
    const start = (spTermin1CurrentPage - 1) * spTermin1PageSize;
    displayData = data.slice(start, start + parseInt(spTermin1PageSize));
  }
  tbody.innerHTML = displayData.map(p => {
    const isSelected = selectedSPTermin1Ids.has(p.sobatid);
    const canPrint = !!p.no_sp_pemeriksaan_t1;
    return `
    <tr class="${isSelected ? 'row-selected' : ''}" style="${isSelected ? 'background:rgba(16,185,129,0.06)' : ''}">
      <td style="text-align:center">
        <input type="checkbox" class="sp-row-checkbox" data-sobatid="${p.sobatid}"
          onchange="toggleSPTermin1Row(this)"
          ${isSelected ? 'checked' : ''}
          ${!canPrint ? 'disabled title="Isi nomor surat dulu"' : ''}
          style="cursor:${canPrint ? 'pointer' : 'not-allowed'};width:15px;height:15px">
      </td>
      <td><strong>${escHtml(p.nama)}</strong></td>
      <td style="color:var(--text-muted)">${escHtml(p.kecamatan || '—')}</td>
      <td>
        ${p.no_spk ? `<span class="badge" style="background:rgba(56,189,248,0.1);color:var(--primary);border:1px solid rgba(56,189,248,0.3)">${escHtml(p.no_spk)}</span>` : `<span style="color:var(--text-subtle);font-style:italic">Belum diisi</span>`}
      </td>
      <td>
        ${p.no_sp_pemeriksaan_t1 ? `<span class="badge" style="background:rgba(16,185,129,0.1);color:#10b981;border:1px solid rgba(16,185,129,0.3)">${escHtml(p.no_sp_pemeriksaan_t1)}</span>` : `<span style="color:var(--text-subtle);font-style:italic">Belum diisi</span>`}
      </td>
      <td style="text-align:center">
        <span style="font-weight:600;color:var(--text-strong)">${escHtml(p.capaian_label || '0/0 (0.00%)')}</span>
      </td>
      <td style="text-align:center">
        <div style="display:flex;gap:0.5rem;justify-content:center">
          ${(adminProfile && adminProfile.role === 'superadmin') ? `<button class="btn btn-secondary btn-sm" onclick="openNoSuratModal('${p.sobatid}')" style="padding:0.25rem 0.5rem;font-size:0.75rem">Edit Nomor</button>` : ''}
          <button class="btn btn-primary btn-sm" onclick="printSPTermin1('${p.id}', '${p.sobatid}')" style="padding:0.25rem 0.5rem;font-size:0.75rem" ${!canPrint ? 'disabled title="Isi No Surat Termin I terlebih dahulu"' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            Cetak PDF
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
  // Sync select-all checkbox state
  const selectAll = document.getElementById('spTerm1SelectAll');
  if (selectAll) {
    const checkable = displayData.filter(p => p.no_sp_pemeriksaan_t1);
    const checkedCount = displayData.filter(p => selectedSPTermin1Ids.has(p.sobatid)).length;
    selectAll.checked = checkable.length > 0 && checkedCount === checkable.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkable.length;
  }
  if (totalPages <= 1) {
    pag.innerHTML = '';
  } else {
    let btnHtml = '';
    btnHtml += `<button class="btn btn-secondary" onclick="goToSPTermin1Page(${spTermin1CurrentPage - 1})" ${spTermin1CurrentPage === 1 ? 'disabled' : ''} style="padding:0.25rem 0.5rem;min-width:30px">←</button>`;
    let startPage = Math.max(1, spTermin1CurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
    if (startPage > 1) {
      btnHtml += `<button class="btn btn-secondary" onclick="goToSPTermin1Page(1)" style="padding:0.25rem 0.5rem;min-width:30px">1</button>`;
      if (startPage > 2) btnHtml += `<span style="padding:0.25rem;color:var(--text-muted)">...</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
      btnHtml += `<button class="btn ${i === spTermin1CurrentPage ? 'btn-primary' : 'btn-secondary'}" onclick="goToSPTermin1Page(${i})" style="padding:0.25rem 0.5rem;min-width:30px">${i}</button>`;
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) btnHtml += `<span style="padding:0.25rem;color:var(--text-muted)">...</span>`;
      btnHtml += `<button class="btn btn-secondary" onclick="goToSPTermin1Page(${totalPages})" style="padding:0.25rem 0.5rem;min-width:30px">${totalPages}</button>`;
    }
    btnHtml += `<button class="btn btn-secondary" onclick="goToSPTermin1Page(${spTermin1CurrentPage + 1})" ${spTermin1CurrentPage === totalPages ? 'disabled' : ''} style="padding:0.25rem 0.5rem;min-width:30px">→</button>`;
    pag.innerHTML = btnHtml;
  }
}
function changeSPTermin1PageSize() {
  spTermin1PageSize = document.getElementById('spTerm1PageSizeSelect').value;
  spTermin1CurrentPage = 1;
  filterSPTermin1();
}
function goToSPTermin1Page(page) {
  spTermin1CurrentPage = page;
  filterSPTermin1();
}
// ---- Multi-select helpers ----
function toggleSPTermin1Row(checkbox) {
  const sobatid = checkbox.dataset.sobatid;
  if (checkbox.checked) {
    selectedSPTermin1Ids.add(sobatid);
  } else {
    selectedSPTermin1Ids.delete(sobatid);
  }
  updateSPTermin1SelectionUI();
}
function toggleSelectAllSPTermin1(selectAllEl) {
  const checkboxes = document.querySelectorAll('.sp-row-checkbox:not(:disabled)');
  checkboxes.forEach(cb => {
    const sobatid = cb.dataset.sobatid;
    if (selectAllEl.checked) {
      selectedSPTermin1Ids.add(sobatid);
      cb.checked = true;
    } else {
      selectedSPTermin1Ids.delete(sobatid);
      cb.checked = false;
    }
  });
  updateSPTermin1SelectionUI();
}
function updateSPTermin1SelectionUI() {
  const count = selectedSPTermin1Ids.size;
  const btn = document.getElementById('spTerm1PrintSelectedBtn');
  const label = document.getElementById('spTerm1PrintSelectedLabel');
  if (btn) {
    btn.style.display = count > 0 ? 'flex' : 'none';
    label.textContent = `Cetak Terpilih (${count})`;
  }
}
function openNoSuratModal(sobatid) {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  const pml = allPMLData.find(p => p.sobatid === sobatid);
  if (!pml) return;
  document.getElementById('noSuratSobatid').value = sobatid;
  document.getElementById('inputNoSpk').value = pml.no_spk || '';
  document.getElementById('inputNoSpTerm1').value = pml.no_sp_pemeriksaan_t1 || '';
  document.getElementById('inputNoSpTerm2').value = pml.no_sp_pemeriksaan_t2 || '';
  document.getElementById('noSuratModal').classList.add('open');
}
function closeNoSuratModal() {
  document.getElementById('noSuratModal').classList.remove('open');
}

async function saveNoSurat() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  const sobatid = document.getElementById('noSuratSobatid').value;
  const noSpk = document.getElementById('inputNoSpk').value.trim();
  const noSpTerm1 = document.getElementById('inputNoSpTerm1').value.trim();
  const noSpTerm2 = document.getElementById('inputNoSpTerm2').value.trim();
  try {
    const { error } = await db.from('no_surat_se').upsert({
      sobatid: sobatid,
      no_spk: noSpk,
      no_sp_pemeriksaan_t1: noSpTerm1,
      no_sp_pemeriksaan_t2: noSpTerm2,
      updated_at: new Date().toISOString()
    }, { onConflict: 'sobatid' });
    if (error) throw error;
    showToast('Nomor surat berhasil disimpan', 'success');
    closeNoSuratModal();
    // Update state local and refresh table
    const pml = allPMLData.find(p => p.sobatid === sobatid);
    if (pml) {
      pml.no_spk = noSpk;
      pml.no_sp_pemeriksaan_t1 = noSpTerm1;
      pml.no_sp_pemeriksaan_t2 = noSpTerm2;
      filterSPTermin1();
    }
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
}
// Fitur Batch Upload Nomor Surat
let parsedNoSuratExcel = null;
function openUploadNoSuratModal() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengupload nomor surat.', 'warning');
    return;
  }
  document.getElementById('fileNoSurat').value = '';
  parsedNoSuratExcel = null;
  const validation = document.getElementById('noSuratValidation');
  validation.innerHTML = '';
  validation.className = 'mt-2';
  document.getElementById('noSuratImportLabel').innerHTML = 'Pilih atau seret file Excel di sini';
  document.getElementById('uploadNoSuratBtn').disabled = true;
  document.getElementById('uploadNoSuratModal').classList.add('open');
}
function closeUploadNoSuratModal() {
  document.getElementById('uploadNoSuratModal').classList.remove('open');
}
function downloadNoSuratTemplate() {
  const ws = window.XLSX.utils.aoa_to_sheet([
    ['Sobat ID', 'No SPK', 'No SP Termin 1', 'No SP Termin 2']
  ]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Nomor Surat");
  window.XLSX.writeFile(wb, "template_nomor_surat.xlsx");
}
function handleNoSuratDrop(e) {
  e.preventDefault();
  document.getElementById('zoneNoSurat').classList.remove('drag-over');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    document.getElementById('fileNoSurat').files = e.dataTransfer.files;
    readNoSuratExcel(file);
  }
}
function handleNoSuratFileSelect(e) {
  if (e.target.files.length > 0) {
    readNoSuratExcel(e.target.files[0]);
  }
}
async function readNoSuratExcel(file) {
  try {
    const rows = await parseExcelFile(file);
    if (!rows || rows.length < 2) {
      throw new Error('File Excel kosong atau tidak memiliki data.');
    }
    parsedNoSuratExcel = rows;

    // Check required columns
    const headers = rows[0].map(h => (h || '').toString().toLowerCase().trim());
    const hasSobat = headers.some(h => h === 'sobat id' || h === 'sobatid');
    const hasSpk = headers.some(h => h.includes('spk'));
    const hasT1 = headers.some(h => h.includes('termin 1') || h.includes('t1'));
    const hasT2 = headers.some(h => h.includes('termin 2') || h.includes('t2'));
    // Count non-empty records (excluding header)
    const recordsCount = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== '')).length;
    document.getElementById('noSuratImportLabel').innerHTML = `
      <div style="font-weight:600;color:var(--text-strong)">${file.name}</div>
      <div style="font-size:0.875rem;color:var(--text-muted)">${recordsCount} baris data ditemukan</div>
    `;
    const validation = document.getElementById('noSuratValidation');
    if (!hasSobat) {
      validation.innerHTML = 'Kolom "Sobat ID" tidak ditemukan dalam file.';
      validation.className = 'mt-2 validation-error';
      document.getElementById('uploadNoSuratBtn').disabled = true;
    } else if (!hasSpk && !hasT1 && !hasT2) {
      validation.innerHTML = 'File minimal harus memiliki salah satu kolom nomor (No SPK, No SP Termin 1, atau No SP Termin 2).';
      validation.className = 'mt-2 validation-error';
      document.getElementById('uploadNoSuratBtn').disabled = true;
    } else {
      // Validate that Sobat IDs exist in our registered users
      const sobatIdx = headers.findIndex(h => h === 'sobat id' || h === 'sobatid');
      const registeredSobatIds = new Set(allUsers.map(u => String(u.sobatid || '').trim()));
      const invalidSobatIds = [];
      rows.slice(1).forEach((r, idx) => {
        if (r && r.some(c => c !== null && c !== '')) {
          const sid = String(r[sobatIdx] || '').trim();
          if (sid && !registeredSobatIds.has(sid)) {
            invalidSobatIds.push(sid);
          }
        }
      });
      if (invalidSobatIds.length > 0) {
        const displayLimit = 5;
        const listText = invalidSobatIds.slice(0, displayLimit).join(', ');
        const suffix = invalidSobatIds.length > displayLimit ? ` dan ${invalidSobatIds.length - displayLimit} lainnya...` : '';
        validation.innerHTML = `
          <div style="margin-top:0.5rem;padding:0.75rem;border-radius:var(--radius-md);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:var(--warning);font-size:0.85rem">
            <strong style="display:block;margin-bottom:4px">⚠️ ${invalidSobatIds.length} Sobat ID tidak terdaftar:</strong>
            <span style="font-family:monospace;word-break:break-all">${escHtml(listText)}${suffix}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);display:block;margin-top:6px">* Baris dengan ID di atas akan otomatis dilewati saat impor.</span>
          </div>
        `;
      } else {
        validation.innerHTML = '<span style="color:#10b981">✓ Format file valid</span>';
      }
      validation.className = 'mt-2';
      document.getElementById('uploadNoSuratBtn').disabled = false;
    }
  } catch (err) {
    document.getElementById('noSuratValidation').innerHTML = err.message;
    document.getElementById('noSuratValidation').className = 'mt-2 validation-error';
    document.getElementById('uploadNoSuratBtn').disabled = true;
  }
}
async function processNoSuratImport() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengupload nomor surat.', 'warning');
    return;
  }
  if (!parsedNoSuratExcel || parsedNoSuratExcel.length < 2) return;
  const headers = parsedNoSuratExcel[0];
  const dataRows = parsedNoSuratExcel.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
  if (dataRows.length === 0) return;
  const btn = document.getElementById('uploadNoSuratBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> Memproses...';
  btn.disabled = true;
  try {
    const headerMap = {};
    headers.forEach((h, idx) => {
      const hd = (h || '').toString().toLowerCase().trim();
      if (hd === 'sobat id' || hd === 'sobatid') headerMap.sobatid = idx;
      else if (hd.includes('spk')) headerMap.spk = idx;
      else if (hd.includes('termin 1') || hd.includes('t1')) headerMap.t1 = idx;
      else if (hd.includes('termin 2') || hd.includes('t2')) headerMap.t2 = idx;
    });
    if (headerMap.sobatid === undefined) {
      throw new Error('Kolom Sobat ID tidak ditemukan.');
    }
    const registeredSobatIds = new Set(allUsers.map(u => String(u.sobatid || '').trim()));
    const toUpsert = [];
    dataRows.forEach(row => {
      const sid = row[headerMap.sobatid];
      if (sid !== null && sid !== undefined && sid !== '') {
        const sidStr = sid.toString().trim();
        if (registeredSobatIds.has(sidStr)) {
          const item = { sobatid: sidStr, updated_at: new Date().toISOString() };
          if (headerMap.spk !== undefined && row[headerMap.spk] !== null && row[headerMap.spk] !== undefined) {
            item.no_spk = row[headerMap.spk].toString().trim();
          }
          if (headerMap.t1 !== undefined && row[headerMap.t1] !== null && row[headerMap.t1] !== undefined) {
            item.no_sp_pemeriksaan_t1 = row[headerMap.t1].toString().trim();
          }
          if (headerMap.t2 !== undefined && row[headerMap.t2] !== null && row[headerMap.t2] !== undefined) {
            item.no_sp_pemeriksaan_t2 = row[headerMap.t2].toString().trim();
          }
          toUpsert.push(item);
        }
      }
    });
    // Bulk upsert to Supabase
    if (toUpsert.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < toUpsert.length; i += chunkSize) {
        const chunk = toUpsert.slice(i, i + chunkSize);
        const { error } = await db.from('no_surat_se').upsert(chunk, { onConflict: 'sobatid' });
        if (error) throw error;
      }
      showToast(`Berhasil menyimpan ${toUpsert.length} data nomor surat!`, 'success');
    } else {
      showToast('Tidak ada data nomor surat valid yang dapat diimpor.', 'warning');
    }
    closeUploadNoSuratModal();
    loadSPTermin1Data(); // Refresh data
  } catch (err) {
    showToast('Gagal upload batch: ' + err.message, 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
let _bookmanNormalBase64 = null;
let _bookmanBoldBase64 = null;

async function registerBookmanFont(pdf) {
  try {
    if (!_bookmanNormalBase64 || !_bookmanBoldBase64) {
      const [normalRes, boldRes] = await Promise.all([
        fetch('font/BOOKOS-normal.js'),
        fetch('font/BOOKOSB-bold.js')
      ]);
      if (normalRes.ok && boldRes.ok) {
        const [normalText, boldText] = await Promise.all([
          normalRes.text(),
          boldRes.text()
        ]);
        const extractFont = (text) => {
          const match = text.match(/var\s+font\s*=\s*['"]([^'"]+)['"]/);
          return match ? match[1] : null;
        };
        _bookmanNormalBase64 = extractFont(normalText);
        _bookmanBoldBase64 = extractFont(boldText);
      }
    }

    if (_bookmanNormalBase64 && _bookmanBoldBase64) {
      pdf.addFileToVFS("BOOKOS.ttf", _bookmanNormalBase64);
      pdf.addFont("BOOKOS.ttf", "Bookman", "normal");
      pdf.addFileToVFS("BOOKOSB.ttf", _bookmanBoldBase64);
      pdf.addFont("BOOKOSB.ttf", "Bookman", "bold");
    }
  } catch (e) {
    console.warn('Gagal memuat font Bookman custom, beralih ke font standar:', e);
  }
}

function openPdfSafely(pdf, filename = 'document.pdf') {
  try {
    const blobUrl = pdf.output('bloburl');
    const win = window.open(blobUrl, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
      // Pop-up blocked: trigger download or iframe fallback
      const link = document.createElement('a');
      link.href = blobUrl;
      link.target = '_blank';
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => link.remove(), 100);
    }
  } catch (err) {
    console.warn('openPdfSafely failed, fallback to pdf.save:', err);
    pdf.save(filename);
  }
}

function loadImgAsBase64(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      resolve(null);
    };
  });
}

function printSPTermin1(pmlId, sobatid) {
  const pml = allPMLData.find(p => p.sobatid === sobatid);
  if (!pml || !pml.no_sp_pemeriksaan_t1) {
    showToast('Nomor SP Pemeriksaan Termin I belum diisi', 'error');
    return;
  }
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Menyiapkan Surat Pernyataan...`;
      // Fetch rekap data via RPC
      const { data: rekapData, error: rpcErr } = await db.rpc('get_rekapitulasi_pml', { p_pml_id: pmlId });
      if (rpcErr) throw rpcErr;

      // Load Yulian's signature
      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      buildSPTermin1Pages(pdf, pml, rekapData, false, ttdYulianBase64);
      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Berhasil membuat PDF Surat Pernyataan!';
      window.open(pdf.output('bloburl'), '_blank');
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}
// Batch print: cetak semua PML yang dipilih dalam satu PDF
async function printSelectedSPTermin1() {
  const ids = Array.from(selectedSPTermin1Ids);
  if (ids.length === 0) return;
  const pmls = allPMLData.filter(p => ids.includes(p.sobatid) && p.no_sp_pemeriksaan_t1);
  if (pmls.length === 0) {
    showToast('Tidak ada PML terpilih yang memiliki Nomor SP Termin I', 'error');
    return;
  }
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500;
      `;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      // Load Yulian's signature once for batch
      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let idx = 0; idx < pmls.length; idx++) {
        const pml = pmls[idx];
        indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Membuat surat ${idx + 1}/${pmls.length}: ${pml.nama}...`;
        if (idx > 0) pdf.addPage('a4', 'portrait');
        const { data: rekapData, error: rpcErr } = await db.rpc('get_rekapitulasi_pml', { p_pml_id: pml.id });
        if (rpcErr) throw rpcErr;
        buildSPTermin1Pages(pdf, pml, rekapData, idx > 0, ttdYulianBase64);
      }
      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = `✓ PDF batch ${pmls.length} PML berhasil dibuat!`;
      window.open(pdf.output('bloburl'), '_blank');
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      indicator.style.borderColor = '#ef4444';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

// Wrapper alias for printSelectedTermin1
async function printSelectedTermin1() {
  await printSelectedSPTermin1();
}

async function fetchSuperEvaluasiT1Data(gelombang = 1) {
  // 1. Fetch profiles (ppl, pml)
  let profiles = [];
  let fromProf = 0;
  let hasMoreProf = true;
  while (hasMoreProf) {
    const { data, error } = await db.from('profiles')
      .select('id, sobatid, nama, email_ref, role')
      .in('role', ['ppl', 'pml'])
      .eq('is_active', true)
      .range(fromProf, fromProf + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreProf = false;
    } else {
      profiles = profiles.concat(data);
      if (data.length < 1000) hasMoreProf = false;
      else fromProf += 1000;
    }
  }

  // 2. Fetch pml_ppl mapping
  let relations = [];
  let fromRel = 0;
  let hasMoreRel = true;
  while (hasMoreRel) {
    const { data, error } = await db.from('pml_ppl')
      .select('pml_id, ppl_id')
      .range(fromRel, fromRel + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreRel = false;
    } else {
      relations = relations.concat(data);
      if (data.length < 1000) hasMoreRel = false;
      else fromRel += 1000;
    }
  }

  // 3. Fetch active user_sls
  let userSls = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls')
      .select('user_id, kode_sls')
      .eq('status', 'aktif')
      .range(fromSls, fromSls + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreSls = false;
    } else {
      userSls = userSls.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    }
  }

  // 4. Fetch wilayah_subsls targets
  let subsls = [];
  let fromSub = 0;
  let hasMoreSub = true;
  while (hasMoreSub) {
    const { data, error } = await db.from('wilayah_subsls')
      .select('kode_sls_gabungan, target')
      .range(fromSub, fromSub + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreSub = false;
    } else {
      subsls = subsls.concat(data);
      if (data.length < 1000) hasMoreSub = false;
      else fromSub += 1000;
    }
  }

  // 5. Fetch all capaian columns (G1, G2, G3)
  let achievements = [];
  let fromCap = 0;
  let hasMoreCap = true;
  while (hasMoreCap) {
    const { data, error } = await db.from('capaian')
      .select('*')
      .range(fromCap, fromCap + 999);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMoreCap = false;
    } else {
      achievements = achievements.concat(data);
      if (data.length < 1000) hasMoreCap = false;
      else fromCap += 1000;
    }
  }

  // Fetch active honorarium holds
  let holdsRawSE = [];
  try {
    const { data: holdData } = await db.from('honorarium_hold')
      .select('user_id, gelombang')
      .eq('is_active', true);
    if (holdData) holdsRawSE = holdData;
  } catch (e) {
    console.warn('Gagal memuat honorarium_hold (SE):', e);
  }
  const holdSetSE = new Set();
  holdsRawSE.forEach(h => {
    if (h.gelombang === null || h.gelombang === undefined) {
      holdSetSE.add(`${h.user_id}:1`);
      holdSetSE.add(`${h.user_id}:2`);
      holdSetSE.add(`${h.user_id}:3`);
      holdSetSE.add(`${h.user_id}:4`);
    } else {
      holdSetSE.add(`${h.user_id}:${h.gelombang}`);
    }
  });
  const isOnHoldSE = (userId, gel) => holdSetSE.has(`${userId}:${gel}`);

  // Map targets & achievements by SLS
  const targetMap = {};
  subsls.forEach(s => {
    targetMap[s.kode_sls_gabungan] = parseInt(s.target) || 0;
  });

  const capaianPplG1Map = {};
  const capaianPmlG1Map = {};
  const capaianPplG2Map = {};
  const capaianPmlG2Map = {};
  const capaianPplG3Map = {};
  const capaianPmlG3Map = {};
  const capaianPplG4Map = {};
  const capaianPmlG4Map = {};

  achievements.forEach(a => {
    capaianPplG1Map[a.kode_sls_gabungan] = parseInt(a.capaian1) || 0;
    capaianPmlG1Map[a.kode_sls_gabungan] = parseInt(a.capaian1_pml) || 0;
    capaianPplG2Map[a.kode_sls_gabungan] = parseInt(a.capaian1_g2) || 0;
    capaianPmlG2Map[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g2) || 0;
    capaianPplG3Map[a.kode_sls_gabungan] = parseInt(a.capaian1_g3 || 0) || 0;
    capaianPmlG3Map[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g3 || 0) || 0;
    capaianPplG4Map[a.kode_sls_gabungan] = parseInt(a.capaian1_g4) || 0;
    capaianPmlG4Map[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g4) || 0;
  });

  // Map user_sls by user_id
  const userSlsMap = {};
  userSls.forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  const resolveSlsCodes = (codes) => {
    const resolved = [];
    (codes || []).forEach(code => {
      if (code && code.length === 14) {
        const matches = subsls.filter(s => s.kode_sls_gabungan.startsWith(code)).map(s => s.kode_sls_gabungan);
        if (matches.length > 0) {
          resolved.push(...matches);
        } else {
          resolved.push(code + '00');
        }
      } else if (code) {
        resolved.push(code);
      }
    });
    return Array.from(new Set(resolved));
  };

  // Profile map & relation lookup for PPL -> PML pairing
  const profileMap = {};
  profiles.forEach(p => { profileMap[p.id] = p; });

  const pplToPml = {};
  const pmlToPpl = {};
  relations.forEach(r => {
    pplToPml[r.ppl_id] = r.pml_id;
    if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = [];
    pmlToPpl[r.pml_id].push(r.ppl_id);
  });

  // Calculate G1, G2, G3, G4 target, realisasi, and coverage for each profile
  let reportData = [];

  profiles.forEach(p => {
    let target = 0;
    let realisasiG1 = 0;
    let realisasiG2 = 0;
    let realisasiG3 = 0;
    let realisasiG4 = 0;

    if (p.role === 'ppl') {
      const pmlId = pplToPml[p.id];
      const pmlProf = pmlId ? profileMap[pmlId] : null;
      const namaPml = pmlProf ? (pmlProf.nama || '').toUpperCase() : '';
      const emailPml = pmlProf ? (pmlProf.email_ref || '') : '';
      const namaPpl = (p.nama || '').toUpperCase();
      const emailPpl = p.email_ref || '';

      const codes = resolveSlsCodes(userSlsMap[p.id] || []);
      let kdkec = '';
      if (codes.length > 0) {
        kdkec = codes[0].substring(4, 7);
      }

      const desaSet = new Set();
      let visitedG1 = 0;
      let visitedG2 = 0;
      let visitedG3 = 0;
      let visitedG4 = 0;

      codes.forEach(code => {
        if (code.length >= 10) {
          desaSet.add(code.substring(7, 10));
        }
        const cap1 = capaianPplG1Map[code] || 0;
        const cap2 = capaianPplG2Map[code] || 0;
        const cap3 = capaianPplG3Map[code] || 0;
        const cap4 = capaianPplG4Map[code] || 0;

        target += targetMap[code] || 0;
        realisasiG1 += cap1;
        realisasiG2 += cap2;
        realisasiG3 += cap3;
        realisasiG4 += cap4;

        if (cap1 > 0) visitedG1++;
        if (cap2 > 0) visitedG2++;
        if (cap3 > 0) visitedG3++;
        if (cap4 > 0) visitedG4++;
      });

      const kddesa = Array.from(desaSet).sort().join(',');
      const kdsls = codes.map(c => c.length >= 6 ? c.slice(-6) : c).join(',');

      const pctG1 = target > 0 ? (realisasiG1 / target) : 0;
      const pctG2 = target > 0 ? (realisasiG2 / target) : 0;
      const pctG3 = target > 0 ? (realisasiG3 / target) : 0;
      const pctG4 = target > 0 ? (realisasiG4 / target) : 0;

      const coverageG1 = codes.length > 0 ? (visitedG1 / codes.length) : 0;
      const coverageG2 = codes.length > 0 ? (visitedG2 / codes.length) : 0;
      const coverageG3 = codes.length > 0 ? (visitedG3 / codes.length) : 0;
      const coverageG4 = codes.length > 0 ? (visitedG4 / codes.length) : 0;

      const isG1EligibleNumeric = (pctG1 >= 0.4) && (coverageG1 >= 0.4);
      const isG2EligibleNumeric = (pctG2 >= 0.4) && (coverageG2 >= 0.4);
      const isG3EligibleNumeric = (pctG3 >= 0.4) && (coverageG3 >= 0.4);
      const isG4EligibleNumeric = (pctG4 >= 0.4) && (coverageG4 >= 0.4);
      // Apply honorarium hold override
      const isG1Eligible = isG1EligibleNumeric && !isOnHoldSE(p.id, 1);
      const isG2Eligible = isG2EligibleNumeric && !isOnHoldSE(p.id, 2);
      const isG3Eligible = isG3EligibleNumeric && !isOnHoldSE(p.id, 3);
      const isG4Eligible = isG4EligibleNumeric && !isOnHoldSE(p.id, 4);

      let chosenReal = realisasiG1;
      if (gelombang === 2) chosenReal = realisasiG2;
      if (gelombang === 3) chosenReal = realisasiG3;
      if (gelombang === 4) chosenReal = realisasiG4;

      reportData.push({
        nama_pml: namaPml,
        email_pml: emailPml,
        nama_ppl: namaPpl,
        email_ppl: emailPpl,
        nama: p.nama,
        kdkec,
        kddesa,
        kdsls,
        jabatan: "PPL",
        target,
        realisasi: chosenReal,
        isG1Eligible,
        isG2Eligible,
        isG3Eligible,
        isG4Eligible
      });
    } else if (p.role === 'pml') {
      const namaPml = (p.nama || '').toUpperCase();
      const emailPml = p.email_ref || '';
      const namaPpl = (p.nama || '').toUpperCase();
      const emailPpl = p.email_ref || '';

      const supervisedPpls = pmlToPpl[p.id] || [];
      let kdkec = '';
      let totalPmlSls = 0;
      let visitedPmlG1 = 0;
      let visitedPmlG2 = 0;
      let visitedPmlG3 = 0;
      let visitedPmlG4 = 0;

      const allSlsSet = new Set(userSlsMap[p.id] || []);
      supervisedPpls.forEach(pplId => {
        const codes = userSlsMap[pplId] || [];
        codes.forEach(code => allSlsSet.add(code));
      });

      const pmlCodes = Array.from(allSlsSet);
      const desaSet = new Set();

      pmlCodes.forEach(code => {
        if (code.length >= 7 && !kdkec) {
          kdkec = code.substring(4, 7);
        }
        if (code.length >= 10) {
          desaSet.add(code.substring(7, 10));
        }
        totalPmlSls++;
        const cap1 = capaianPmlG1Map[code] || 0;
        const cap2 = capaianPmlG2Map[code] || 0;
        const cap3 = capaianPmlG3Map[code] || 0;
        const cap4 = capaianPmlG4Map[code] || 0;

        target += targetMap[code] || 0;
        realisasiG1 += cap1;
        realisasiG2 += cap2;
        realisasiG3 += cap3;
        realisasiG4 += cap4;

        if (cap1 > 0) visitedPmlG1++;
        if (cap2 > 0) visitedPmlG2++;
        if (cap3 > 0) visitedPmlG3++;
        if (cap4 > 0) visitedPmlG4++;
      });

      const kddesa = Array.from(desaSet).sort().join(',');
      const kdsls = pmlCodes.map(c => c.length >= 6 ? c.slice(-6) : c).join(',');

      const pctG1 = target > 0 ? (realisasiG1 / target) : 0;
      const pctG2 = target > 0 ? (realisasiG2 / target) : 0;
      const pctG3 = target > 0 ? (realisasiG3 / target) : 0;
      const pctG4 = target > 0 ? (realisasiG4 / target) : 0;

      const minCov = Math.ceil(totalPmlSls * 0.4);

      // PML eligibility requires BOTH capaian_pml/target >= 40% AND PML coverage >= CEIL(total_sls * 0.4)
      const isG1EligibleNumericPml = (pctG1 >= 0.4) && (visitedPmlG1 >= minCov);
      const isG2EligibleNumericPml = (pctG2 >= 0.4) && (visitedPmlG2 >= minCov);
      const isG3EligibleNumericPml = (pctG3 >= 0.4) && (visitedPmlG3 >= minCov);
      const isG4EligibleNumericPml = (pctG4 >= 0.4) && (visitedPmlG4 >= minCov);
      // Apply honorarium hold override
      const isG1Eligible = isG1EligibleNumericPml && !isOnHoldSE(p.id, 1);
      const isG2Eligible = isG2EligibleNumericPml && !isOnHoldSE(p.id, 2);
      const isG3Eligible = isG3EligibleNumericPml && !isOnHoldSE(p.id, 3);
      const isG4Eligible = isG4EligibleNumericPml && !isOnHoldSE(p.id, 4);

      let chosenReal = realisasiG1;
      if (gelombang === 2) chosenReal = realisasiG2;
      if (gelombang === 3) chosenReal = realisasiG3;
      if (gelombang === 4) chosenReal = realisasiG4;

      reportData.push({
        nama_pml: namaPml,
        email_pml: emailPml,
        nama_ppl: namaPpl,
        email_ppl: emailPpl,
        nama: p.nama,
        kdkec,
        kddesa,
        kdsls,
        jabatan: "PML",
        target,
        realisasi: chosenReal,
        isG1Eligible,
        isG2Eligible,
        isG3Eligible,
        isG4Eligible
      });
    }
  });

  // Filtering rules:
  // Gelombang 1: Must be G1 eligible
  // Gelombang 2: Must NOT be G1 eligible AND must be G2 eligible
  // Gelombang 3: Must NOT be G1 eligible AND Must NOT be G2 eligible AND must be G3 eligible
  // Gelombang 4: Must NOT be G1, G2, G3 eligible AND must be G4 eligible
  if (gelombang === 1) {
    reportData = reportData.filter(item => item.isG1Eligible);
  } else if (gelombang === 2) {
    reportData = reportData.filter(item => !item.isG1Eligible && item.isG2Eligible);
  } else if (gelombang === 3) {
    reportData = reportData.filter(item => !item.isG1Eligible && !item.isG2Eligible && item.isG3Eligible);
  } else if (gelombang === 4) {
    reportData = reportData.filter(item => !item.isG1Eligible && !item.isG2Eligible && !item.isG3Eligible && item.isG4Eligible);
  }

  // Sort by role (PPL first, then PML), then by kdkec, then by nama
  reportData.sort((a, b) => {
    if (a.jabatan !== b.jabatan) {
      return a.jabatan === 'PPL' ? -1 : 1;
    }
    const kecA = (a.kdkec || '').toString();
    const kecB = (b.kdkec || '').toString();
    if (kecA !== kecB) {
      return kecA.localeCompare(kecB);
    }
    return (a.nama_ppl || a.nama || '').localeCompare(b.nama_ppl || b.nama || '');
  });

  return reportData;
}

function printSuperEvaluasiT1(isDownload = false, gelombang = 1) {
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data G${gelombang}...`;

      // Data statis/identitas penandatangan
      const dummyPml = {
        nama: "YULIAN SARWO EDI",
        nik: "1234567890123456",
        kecamatan: "Rangkasbitung",
        no_sp_pemeriksaan_t1: "001/SE2026/SP-PEM/01/2026",
        no_spk: "001/SPK/BPS/2026"
      };

      // Mengambil data riil dari database berdasar Gelombang (1, 2, atau 3)
      const rekapData = await fetchSuperEvaluasiT1Data(gelombang);

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      buildSuperEvaluasiT1Pages(pdf, dummyPml, rekapData, false, ttdYulianBase64, gelombang);

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = `✓ Berhasil membuat PDF Super Evaluasi T1 G${gelombang}!`;

      if (isDownload) {
        pdf.save(`super_evaluasi_t1_g${gelombang}.pdf`);
      } else {
        window.open(pdf.output('bloburl'), '_blank');
      }

      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

function buildSuperEvaluasiT1Pages(pdf, pml, rekapData, addedBefore, ttdYulianBase64, gelombang = 1) {
  let tanggalText = "16 Juli 2026";
  if (gelombang === 2) tanggalText = "23 Juli 2026";
  if (gelombang === 3) tanggalText = "28 Juli 2026";
  if (gelombang === 4) tanggalText = "10 Agustus 2026";

  let nomorSuratStr = "B-909/SPer-I-SE2026/3602/07/2026";
  if (gelombang === 2) nomorSuratStr = "B-.../...-SE2026/3602/07/2026";
  if (gelombang === 3) nomorSuratStr = "B-.../...-SE2026/3602/07/2026";
  if (gelombang === 4) nomorSuratStr = "B-.../...-SE2026/3602/07/2026";

  pdf.setLineHeightFactor(1.0);
  const M = 25;
  const W = 160;
  const MR = 185;
  const lh = 5;

  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN", 105, 30, { align: "center" });
  pdf.text("EVALUASI PELAKSANAAN SENSUS EKONOMI 2026 TERMIN I", 105, 36, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${nomorSuratStr}`, 105, 44, { align: "center" });

  let y = 56;
  pdf.text("Yang bertanda tangan di bawah ini:", M, y);
  y += 8;

  const labelX = 30;
  const colonX = 62;
  const valueX = 66;

  const identitas = [
    ["Nama", "Eka Yulyani S.Si., M.Geog."],
    ["NIK", "196807261991012001"],
    ["Jabatan", "Kepala Badan Pusat Statistik Kabupaten Lebak Provinsi Banten"]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], MR - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 3;
  pdf.text("Dengan ini menyatakan:", M, y);
  y += 6;

  const poin = [
    `bahwa telah melakukan monitoring dan evaluasi secara berjenjang, serta bertanggung jawab terhadap pelaksanaan hasil pekerjaan petugas lapangan dan pemeriksa lapangan Sensus Ekonomi 2026, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan petugas lapangan dan pemeriksa lapangan Sensus Ekonomi 2026 sebagaimana dimaksud pada angka 1 tercantum dalam lampiran;`,
    `bahwa berdasarkan hasil monitoring dan evaluasi sebagaimana dimaksud pada angka 1 dan angka 2, petugas lapangan dan pemeriksa lapangan Sensus Ekonomi 2026 dapat diberikan honorarium termin I sesuai Perjanjian Kerja Petugas.`
  ];

  const numX = M;
  const textX = M + 8;
  const textWidth = MR - textX;

  poin.forEach((teks, i) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${i + 1}.`, numX, y);
    drawJustifiedText(pdf, teks, textX, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup =
    "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";

  const penutupLines = pdf.splitTextToSize(penutup, W);
  drawJustifiedText(pdf, penutup, M, y, W, 5);
  y += penutupLines.length * 5 + 10;

  y += 20;
  pdf.text(`Lebak, ${tanggalText}`, 152, y, { align: "center" });
  pdf.text("Yang membuat pernyataan,", 152, y + lh, { align: "center" });

  pdf.text(`(Eka Yulyani S.Si., M.Geog.)`, 152, y + 30, { align: "center" });

  //==================================================
  // HALAMAN 2 — LAMPIRAN TABEL PETUGAS
  //==================================================
  pdf.addPage("a4", "landscape");
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  let pageNum = 2;
  pdf.text(`-${pageNum}-`, 148.5, 12, { align: "center" });

  const kopLamp = [
    "Lampiran",
    "Surat Pernyataan Evaluasi Pelaksanaan",
    "Sensus Ekonomi 2026 Termin I",
    `Nomor: ${nomorSuratStr}`
  ];

  let kopY = 20;
  kopLamp.forEach(line => {
    pdf.text(line, 170, kopY, { align: "left" });
    kopY += 5;
  });

  pdf.text("Daftar Hasil Evaluasi Pelaksanaan Pekerjaan Petugas Sensus Ekonomi 2026 Termin I", 148.5, kopY + 6, { align: "center" });

  const rows = rekapData || [];

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(10);

  const headsText = [
    'No',
    'Nama Petugas Lapangan',
    'Kode\nKecamatan',
    'Jabatan',
    'Target\nPrelist',
    'Realisasi Hasil\nPendataan\n(Usaha+Keluarga)',
    'Presentase (%)'
  ];

  let colW = headsText.map(h => {
    const lines = h.split('\n');
    let maxW = 0;
    lines.forEach(l => {
      maxW = Math.max(maxW, pdf.getTextWidth(l));
    });
    return Math.ceil(maxW) + 8;
  });

  rows.forEach((row, i) => {
    const tgt = parseInt(row.target) || 0;
    const real = parseInt(row.realisasi) || 0;
    const pct = row.persentase || (tgt > 0 ? ((real / tgt) * 100).toFixed(2) + '%' : '0.00%');

    const vals = [
      String(i + 1),
      (row.nama || "").toUpperCase(),
      row.kdkec || "",
      row.jabatan || "",
      String(tgt),
      String(real),
      pct
    ];

    vals.forEach((v, idx) => {
      const neededW = Math.ceil(pdf.getTextWidth(v)) + 8;
      colW[idx] = Math.max(colW[idx], neededW);
    });
  });

  colW[1] = Math.min(colW[1], 100);

  const totalTableWidth = colW.reduce((sum, w) => sum + w, 0);
  const tX = 148.5 - totalTableWidth / 2;
  const rH = 8;
  let tY = kopY + 14;

  const drawTableHeader = (y) => {
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(11);
    const heads = [
      ['No', 1],
      ['Nama Petugas Lapangan', 1],
      ['Kode\nKecamatan', 1],
      ['Jabatan', 1],
      ['Target\nPrelist', 1],
      ['Realisasi Hasil\nPendataan\n(Usaha+Keluarga)', 1],
      ['Presentase (%)', 1]
    ];
    let cx = tX;
    const hH = rH * 2;
    colW.forEach((w, ci) => {
      pdf.rect(cx, y, w, hH);
      const lines = heads[ci][0].split('\n');
      const textY = y + (hH - lines.length * 5) / 2 + 4;
      lines.forEach((ln, li) => {
        pdf.text(ln, cx + w / 2, textY + li * 5, { align: 'center' });
      });
      cx += w;
    });

    const colNumY = y + hH;
    cx = tX;
    colW.forEach((w, ci) => {
      pdf.rect(cx, colNumY, w, rH * 0.8);
      pdf.text(`(${ci + 1})`, cx + w / 2, colNumY + 4.5, { align: 'center' });
      cx += w;
    });
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(12);
    return colNumY + rH * 0.8;
  };

  tY = drawTableHeader(tY);

  // Helper to draw summary row
  const drawSummaryRow = (label, targetVal, realisasiVal) => {
    if (tY > 175) {
      pdf.addPage("a4", "landscape");
      pageNum++;
      pdf.setFont("Bookman", "normal");
      pdf.setFontSize(12);
      pdf.text(`-${pageNum}-`, 148.5, 12, { align: "center" });
      tY = 20;
    }
    let cx = tX;
    const pct = targetVal > 0 ? ((realisasiVal / targetVal) * 100).toFixed(2) + '%' : '0.00%';
    pdf.setFont('Bookman', 'bold');
    pdf.setFontSize(10);
    const mergeW = colW[0] + colW[1] + colW[2] + colW[3];
    [
      label,
      "",
      "",
      "",
      String(targetVal),
      String(realisasiVal),
      pct
    ].forEach((val, ci) => {
      if (ci === 0) {
        pdf.rect(cx, tY, mergeW, rH);
        pdf.text(label, cx + 5, tY + 5);
        cx += mergeW;
      } else if (ci === 1 || ci === 2 || ci === 3) {
        // merged
      } else {
        pdf.rect(cx, tY, colW[ci], rH);
        pdf.text(val, cx + colW[ci] / 2, tY + 5, { align: 'center' });
        cx += colW[ci];
      }
    });
    tY += rH;
  };

  const pplRows = rows.filter(r => r.jabatan === 'PPL');
  const pmlRows = rows.filter(r => r.jabatan === 'PML');
  let globalIndex = 1;

  // 1. Render PPL Group
  let pplTgt = 0, pplReal = 0;
  pplRows.forEach(row => {
    if (tY > 175) {
      pdf.addPage("a4", "landscape");
      pageNum++;
      pdf.setFont("Bookman", "normal");
      pdf.setFontSize(12);
      pdf.text(`-${pageNum}-`, 148.5, 12, { align: "center" });
      tY = 20;
    }

    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(10);

    const isBlank = row.is_replacement_blank || row.target === '' || row.target === undefined;
    const tgt = isBlank ? '' : (parseInt(row.target) || 0);
    const real = isBlank ? '' : (parseInt(row.realisasi) || 0);
    const pct = isBlank ? '' : (row.persentase || (tgt > 0 ? ((real / tgt) * 100).toFixed(2) + '%' : '0.00%'));
    if (!isBlank) {
      pplTgt += (parseInt(row.target) || 0);
      pplReal += (parseInt(row.realisasi) || 0);
    }

    let cx = tX;
    [
      String(globalIndex++),
      (row.nama || "").toUpperCase(),
      row.kdkec || "",
      row.jabatan || "",
      String(tgt),
      String(real),
      pct
    ].forEach((val, ci) => {
      pdf.rect(cx, tY, colW[ci], rH);
      if (ci === 1) {
        const textLines = pdf.splitTextToSize(val, colW[ci] - 4);
        pdf.text(textLines[0] || val, cx + 2, tY + 5);
      } else {
        pdf.text(val, cx + colW[ci] / 2, tY + 5, { align: 'center' });
      }
      cx += colW[ci];
    });
    tY += rH;
  });

  if (pplRows.length > 0) {
    drawSummaryRow("Jumlah Capaian PPL", pplTgt, pplReal);
  }

  // 2. Render PML Group
  let pmlTgt = 0, pmlReal = 0;
  pmlRows.forEach(row => {
    if (tY > 175) {
      pdf.addPage("a4", "landscape");
      pageNum++;
      pdf.setFont("Bookman", "normal");
      pdf.setFontSize(12);
      pdf.text(`-${pageNum}-`, 148.5, 12, { align: "center" });
      tY = 20;
    }

    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(10);

    const isBlank = row.is_replacement_blank || row.target === '' || row.target === undefined;
    const tgt = isBlank ? '' : (parseInt(row.target) || 0);
    const real = isBlank ? '' : (parseInt(row.realisasi) || 0);
    const pct = isBlank ? '' : (row.persentase || (tgt > 0 ? ((real / tgt) * 100).toFixed(2) + '%' : '0.00%'));
    if (!isBlank) {
      pmlTgt += (parseInt(row.target) || 0);
      pmlReal += (parseInt(row.realisasi) || 0);
    }

    let cx = tX;
    [
      String(globalIndex++),
      (row.nama || "").toUpperCase(),
      row.kdkec || "",
      row.jabatan || "",
      String(tgt),
      String(real),
      pct
    ].forEach((val, ci) => {
      pdf.rect(cx, tY, colW[ci], rH);
      if (ci === 1) {
        const textLines = pdf.splitTextToSize(val, colW[ci] - 4);
        pdf.text(textLines[0] || val, cx + 2, tY + 5);
      } else {
        pdf.text(val, cx + colW[ci] / 2, tY + 5, { align: 'center' });
      }
      cx += colW[ci];
    });
    tY += rH;
  });

  if (pmlRows.length > 0) {
    drawSummaryRow("Jumlah Capaian PML", pmlTgt, pmlReal);
  }

  tY += 10;

  // Check page break for signature
  if (tY > 165) {
    pdf.addPage("a4", "landscape");
    pageNum++;
    pdf.setFont("Bookman", "normal");
    pdf.setFontSize(12);
    pdf.text(`-${pageNum}-`, 148.5, 12, { align: "center" });
    tY = 20;
  }

  // Draw signature under table
  const ttdX = 220;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(11);
  pdf.text("Yang membuat pernyataan,", ttdX, tY, { align: "center" });
  tY += 22;
  pdf.text("Eka Yulyani S.Si., M.Geog.", ttdX, tY, { align: "center" });
}

// ---------------------------------------------------------------
// Helper: draw justified text manually in jsPDF (for custom fonts)
// ---------------------------------------------------------------
function drawJustifiedText(pdf, text, x, y, maxWidth, lineHeight) {
  const lines = pdf.splitTextToSize(text, maxWidth);
  lines.forEach((line, lineIdx) => {
    const currentY = y + lineIdx * lineHeight;

    // Last line is left-aligned
    if (lineIdx === lines.length - 1) {
      pdf.text(line, x, currentY);
      return;
    }

    const words = line.trim().split(/\s+/);
    if (words.length <= 1) {
      pdf.text(line, x, currentY);
      return;
    }

    // Calculate total width of words
    let wordsWidth = 0;
    words.forEach(word => {
      wordsWidth += pdf.getTextWidth(word);
    });

    const remainingSpace = maxWidth - wordsWidth;
    const wordSpacing = remainingSpace / (words.length - 1);

    let currentX = x;
    words.forEach((word, wordIdx) => {
      pdf.text(word, currentX, currentY);
      currentX += pdf.getTextWidth(word) + wordSpacing;
    });
  });
}

// ---------------------------------------------------------------
// Helper: build 3-page SP Termin I for one PML onto existing pdf
// addedBefore = true means caller already added a new page
// ---------------------------------------------------------------
function buildSPTermin1Pages(pdf, pml, rekapData, addedBefore, ttdYulianBase64, gelombang = 1) {
  const tanggal = new Date().toLocaleDateString("id-ID", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const namaUpper = (pml.nama || '').toUpperCase();

  pdf.setLineHeightFactor(1.0);
  const M = 25;
  const W = 160;
  const MR = 185;
  const lh = 5;

  //==================================================
  // HALAMAN 1
  //==================================================
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN PENYELESAIAN", 105, 30, { align: "center" });
  pdf.text("PEMERIKSAAN LAPANGAN SENSUS EKONOMI 2026 TERMIN I", 105, 36, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${pml.no_sp_pemeriksaan_t1 || "......./SE2026/.../.../2026"}`, 105, 44, { align: "center" });

  //--------------------------------------------------
  // Identitas
  //--------------------------------------------------

  let y = 56;
  pdf.text("Yang bertanda tangan di bawah ini:", M, y);

  y += 8;

  const labelX = 30;
  const colonX = 62;
  const valueX = 66;

  const identitas = [
    ["Nama", pml.nama ? pml.nama.toUpperCase() : "....................................."],
    ["NIK", pml.nik || "....................................."],
    ["Jabatan", `Pemeriksa Lapangan Sensus Ekonomi 2026 Kecamatan ${pml.kecamatan || "..."}`]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], MR - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });
  y += 3;
  pdf.text("Dengan ini menyatakan:", M, y);
  y += 6;
  //--------------------------------------------------
  // Poin
  //--------------------------------------------------

  const poin = [
    `bahwa telah melaksanakan pekerjaan Pemeriksaan hasil Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${pml.no_spk || "..."}, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan Pemeriksaan Lapangan Sensus Ekonomi 2026 termin I telah diperiksa dan diketahui oleh Ketua Tim Pelaksana Sensus Ekonomi 2026 BPS Kabupaten Lebak;`,
    `bahwa hasil pekerjaan yang telah diselesaikan dan diperiksa sebagaimana dimaksud dalam angka 1 dan angka 2 tercantum dalam lampiran;`,
    `bahwa seluruh hasil pekerjaan termin I adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const numX = M;
  const textX = M + 8;
  const textWidth = MR - textX;

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.setLineHeightFactor(1.0);

  poin.forEach((teks, i) => {
    // Hitung jumlah baris hanya untuk menaikkan posisi Y
    const lines = pdf.splitTextToSize(teks, textWidth);

    // Nomor
    pdf.text(`${i + 1}.`, numX, y);

    // Isi poin (manual justify)
    drawJustifiedText(pdf, teks, textX, y, textWidth, 5);

    y += lines.length * 5;
  });

  //--------------------------------------------------
  // Penutup
  //--------------------------------------------------
  y += 2;
  const penutup =
    "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";

  const penutupLines = pdf.splitTextToSize(
    penutup,
    W
  );

  // Manual justify
  drawJustifiedText(pdf, penutup, M, y, W, 5);

  y += penutupLines.length * 5 + 10;
  //--------------------------------------------------
  // TTD
  //--------------------------------------------------
  const ttdX = 152;
  const dateStr = gelombang === 3 ? "Lebak, 28 Juli 2026" : (gelombang === 2 ? "Lebak, 23 Juli 2026" : "Lebak, 16 Juli 2026");
  pdf.text(dateStr, ttdX, y, { align: "center" });
  pdf.text("Yang membuat pernyataan,", ttdX, y + lh, { align: "center" });
  y += 28;
  pdf.text(`(${(pml.nama || "").toUpperCase()})`, ttdX, y, { align: "center" });
  //==================================================
  // HALAMAN 2 — LAMPIRAN
  //==================================================

  pdf.addPage("a4", "landscape");
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text("-2-", 148.5, 12, { align: "center" });
  const kopLamp = [
    "Lampiran",
    "Surat Pernyataan Penyelesaian Pemeriksaan",
    "Lapangan Sensus Ekonomi 2026 Termin I",
    `Nomor ${pml.no_sp_pemeriksaan_t1 || "..."}`
  ];

  let kopY = 20;
  kopLamp.forEach(line => {
    pdf.text(line, 170, kopY, { align: "left" });
    kopY += 5;
  });

  pdf.text("Daftar Hasil Pekerjaan Penyelesaian Pemeriksaan Lapangan Termin I", 148.5, kopY + 6, { align: "center" });
  // Dimensi kolom tabel
  const rows = (rekapData && rekapData.length > 0) ? rekapData : [];
  const headers = [
    "No",
    "Nama Petugas Lapangan",
    "Target Prelist",
    "Realisasi Hasil Pemeriksaan",
    "Presentase (%)"
  ];

  // Helper to pick realisasi according to wave
  const getRowReal = (row) => {
    if (gelombang === 2) return parseInt(row.total_capaian1_pml_g2 ?? row.total_capaian1_pml ?? 0) || 0;
    if (gelombang === 3) return parseInt(row.total_capaian1_pml_g3 ?? 0) || 0;
    if (gelombang === 4) return parseInt(row.total_capaian1_pml_g4 ?? 0) || 0;
    return parseInt(row.total_capaian1_pml ?? 0) || 0;
  };

  // Lebar awal berdasarkan judul
  let colW = headers.map(h => pdf.getTextWidth(h) + 8);

  // Cek seluruh isi
  rows.forEach((row, i) => {
    const isBlank = row.is_replacement_blank || row.target === '' || row.total_target === '';
    const tgt = isBlank ? '' : (parseInt(row.total_target ?? row.target) || 0);
    const real = isBlank ? '' : getRowReal(row);
    const pct = isBlank ? '' : (tgt > 0 ? ((real / tgt) * 100).toFixed(2) + "%" : "0.00%");

    const values = [
      String(i + 1),
      (row.nama_ppl || row.nama || "").toUpperCase(),
      String(tgt),
      String(real),
      pct
    ];

    values.forEach((v, idx) => {
      colW[idx] = Math.max(colW[idx], pdf.getTextWidth(v) + 8);
    });
  });

  const totalTableWidth = colW.reduce((sum, w) => sum + w, 0);
  const tX = 148.5 - totalTableWidth / 2;          // table start X (centered)
  const rH = 8;                                    // row height
  let tY = kopY + 10;

  // Fungsi gambar header
  const drawTableHeader = (y) => {
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(12);
    let cx = tX;
    // Row 1 (header text)
    const heads = [
      ['No', 1],
      ['Nama Petugas Lapangan', 1],
      ['Target\nPrelist', 1],
      ['Realisasi Hasil Pemeriksaan\n(Usaha+Keluarga)', 1],
      ['Presentase (%)', 1],
    ];
    // Draw all cells with multi-line text
    cx = tX;
    const hH = rH * 3; // header height (2 rows)
    colW.forEach((w, ci) => {
      pdf.rect(cx, y, w, hH);
      const lines = heads[ci][0].split('\n');
      const textY = y + (hH - lines.length * 5) / 2 + 4;
      lines.forEach((ln, li) => {
        pdf.text(ln, cx + w / 2, textY + li * 5, { align: 'center' });
      });
      cx += w;
    });
    // Column number row
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(10);
    const colNumY = y + hH;
    cx = tX;
    colW.forEach((w, ci) => {
      pdf.rect(cx, colNumY, w, rH * 0.8);
      pdf.text(`(${ci + 1})`, cx + w / 2, colNumY + 4.5, { align: 'center' });
      cx += w;
    });
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(12);
    return colNumY + rH * 0.8; // return Y after header
  };
  tY = drawTableHeader(tY);
  // Data rows
  let totalTgt = 0;
  let totalReal = 0;
  rows.forEach((row, i) => {
    if (tY > 175) {
      pdf.addPage('a4', 'l');
      pdf.setFont('Bookman', 'bold');
      pdf.setFontSize(11);
      pdf.text('-3-', 148.5, 12, { align: 'center' });
      tY = 20;
      tY = drawTableHeader(tY);
    }
    const isBlank = row.is_replacement_blank || row.target === '' || row.total_target === '';
    const tgt = isBlank ? '' : (parseInt(row.total_target ?? row.target) || 0);
    const real = isBlank ? '' : getRowReal(row);
    const pct = isBlank ? '' : (tgt > 0 ? ((real / tgt) * 100).toFixed(2) : '0.00');
    if (!isBlank) {
      totalTgt += (parseInt(row.total_target ?? row.target) || 0);
      totalReal += getRowReal(row);
    }
    let cx = tX;
    pdf.setFont('Bookman', 'normal');
    pdf.setFontSize(12);
    [
      (i + 1).toString(),
      (row.nama_ppl || row.nama || '-').toUpperCase(),
      tgt.toString(),
      real.toString(),
      pct ? pct + '%' : '',
    ].forEach((val, ci) => {
      pdf.rect(cx, tY, colW[ci], rH);
      if (ci === 1) {
        // left-align name
        const nameLines = pdf.splitTextToSize(val, colW[ci] - 2);
        pdf.text(nameLines[0] || val, cx + 2, tY + 5);
      } else {
        pdf.text(val, cx + colW[ci] / 2, tY + 5, { align: 'center' });
      }
      cx += colW[ci];
    });
    tY += rH;
  });
  // Jumlah row
  if (tY > 175) {
    pdf.addPage('a4', 'landscape');
    tY = 20;
  }
  const totalPct = totalTgt > 0 ? ((totalReal / totalTgt) * 100).toFixed(2) : '0.00';
  let cx = tX;
  ['Jumlah', '', totalTgt.toString(), totalReal.toString(), totalPct + '%'].forEach((val, ci) => {
    if (ci === 0) {
      pdf.rect(cx, tY, colW[0] + colW[1], rH);
      pdf.text('Jumlah', cx + (colW[0] + colW[1]) / 2, tY + 5, { align: 'left' });
      cx += colW[0] + colW[1];
    } else if (ci === 1) {
      // merged already
    } else {
      pdf.rect(cx, tY, colW[ci], rH);
      pdf.text(val, cx + colW[ci] / 2, tY + 5, { align: 'center' });
      cx += colW[ci];
    }
  });
  //==================================================
  // HALAMAN 3 — TANDA TANGAN
  //==================================================

  pdf.addPage("a4", "landscape");
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text("-3-", 148.5, 12, { align: "center" });

  const kiriX = 25;
  const kananX = 272;

  // Tinggi blok
  const topY = 48;

  //====================
  // kanan
  //====================
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text("Yang membuat pernyataan,", kananX - 40, topY, { align: "center" });
  const namaY = topY + 28;
  pdf.text(`(${namaUpper})`, kananX - 40, namaY, { align: "center" });

  //====================
  // kiri
  //====================
  pdf.setFont("Bookman", "normal");
  y = topY + 46;
  pdf.text("Mengetahui,", kiriX, y);
  y += 6;
  pdf.text("Ketua Tim Pelaksana Sensus Ekonomi 2026", kiriX, y);
  y += 6;
  pdf.text("Kabupaten Lebak", kiriX, y);

  // Konfigurasi ukuran dan posisi tanda tangan Yulian (Bisa di-custom)
  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', kiriX + 8, y, 20, 30);
  }

  // ruang tanda tangan
  y += 28;
  pdf.text("(YULIAN SARWO EDI)", kiriX, y);
  pdf.text("NIP.197707101999121001", kiriX, y + 6);
}

// =====================================================
// HONORARIUM HOLD MANAGEMENT
// =====================================================

let allProfilesForHold = [];
let currentHoldTermin = 1;

async function openHoldModal(termin = 1) {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Akses ditolak: Hanya Superadmin yang dapat mengelola hold honorarium.', 'error');
    return;
  }
  currentHoldTermin = (termin === 2) ? 2 : 1;
  updateHoldTerminUI();

  document.getElementById('holdModal').classList.add('open');

  // Load profiles for dropdown if not already loaded
  if (allProfilesForHold.length === 0) {
    try {
      // Use existing allUsers which already resolved and loaded the kecamatan for every user
      if (allUsers.length === 0) {
        await loadUsers();
      }
      allProfilesForHold = allUsers.filter(u => ['ppl', 'pml'].includes(u.role) && u.is_active);

      const dl = document.getElementById('holdUserList');
      if (dl) {
        dl.innerHTML = '';
        allProfilesForHold.forEach(p => {
          const kecName = p.kecamatan || '—';
          const label = `[${p.role.toUpperCase()}][${kecName}] ${p.nama}`;
          dl.innerHTML += `<option value="${escHtml(label)}">`;
        });
      }
    } catch (err) {
      showToast('Gagal memuat daftar petugas: ' + err.message, 'error');
    }
  }

  // Clear search input on modal open
  const searchInput = document.getElementById('holdUserSearch');
  if (searchInput) searchInput.value = '';

  await loadHoldList();
}

function updateHoldTerminUI() {
  const titleEl = document.getElementById('holdModalTitle');
  if (titleEl) {
    titleEl.textContent = `Kelola Hold Honorarium (Termin ${currentHoldTermin === 2 ? 'II' : 'I'})`;
  }
  const btnT1 = document.getElementById('btnHoldTermin1');
  const btnT2 = document.getElementById('btnHoldTermin2');
  if (btnT1 && btnT2) {
    if (currentHoldTermin === 2) {
      btnT1.style.background = 'transparent';
      btnT1.style.color = 'var(--text-muted)';
      btnT2.style.background = '#0ea5e9';
      btnT2.style.color = '#fff';
    } else {
      btnT1.style.background = 'var(--primary)';
      btnT1.style.color = '#fff';
      btnT2.style.background = 'transparent';
      btnT2.style.color = 'var(--text-muted)';
    }
  }
}

async function switchHoldTermin(termin) {
  currentHoldTermin = termin;
  updateHoldTerminUI();
  await loadHoldList();
}

function closeHoldModal() {
  document.getElementById('holdModal').classList.remove('open');
}

async function loadHoldList() {
  const tbody = document.getElementById('holdListBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Memuat data hold Termin ${currentHoldTermin === 2 ? 'II' : 'I'}...</td></tr>`;

  try {
    let query = db.from('honorarium_hold')
      .select('id, user_id, gelombang, termin, alasan, is_active, created_at, profiles!honorarium_hold_user_id_fkey(nama, role)')
      .order('created_at', { ascending: false });

    if (currentHoldTermin === 2) {
      query = query.eq('termin', 2);
    } else {
      query = query.or('termin.eq.1,termin.is.null');
    }

    const { data, error } = await query;
    if (error) {
      // Fallback jika kolom termin belum ada di schema database
      console.warn('Fallback loadHoldList tanpa kolom termin:', error.message);
      const { data: fallbackData, error: fbError } = await db.from('honorarium_hold')
        .select('id, user_id, gelombang, alasan, is_active, created_at, profiles!honorarium_hold_user_id_fkey(nama, role)')
        .order('created_at', { ascending: false });
      if (fbError) throw fbError;
      renderHoldTableRows(fallbackData || []);
      return;
    }

    renderHoldTableRows(data || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444">Error: ${escHtml(err.message)}</td></tr>`;
  }
}

function renderHoldTableRows(data) {
  const tbody = document.getElementById('holdListBody');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Belum ada data hold untuk Termin ${currentHoldTermin === 2 ? 'II' : 'I'}.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(h => {
    const profile = h.profiles;
    const namaText = profile ? `[${profile.role.toUpperCase()}] ${escHtml(profile.nama)}` : h.user_id;
    const gelText = h.gelombang ? `G${h.gelombang}` : 'Semua';
    const statusBadge = h.is_active
      ? '<span style="color:#ef4444;font-weight:bold">Aktif</span>'
      : '<span style="color:#10b981;font-weight:bold">Dicabut</span>';
    return `<tr>
      <td>${namaText}</td>
      <td style="text-align:center">${gelText}</td>
      <td>${escHtml(h.alasan)}</td>
      <td style="text-align:center">${statusBadge}</td>
      <td style="text-align:center">
        ${h.is_active
        ? `<button class="btn btn-danger btn-sm" onclick="releaseHold('${h.id}')">Cabut</button>`
        : '—'}
      </td>
    </tr>`;
  }).join('');
}

async function saveHold() {
  const searchVal = document.getElementById('holdUserSearch').value.trim();
  const gelombang = document.getElementById('holdGelombang').value;
  const alasan = document.getElementById('holdAlasan').value.trim();

  if (!searchVal) { showToast('Ketik dan pilih petugas terlebih dahulu.', 'error'); return; }

  // Resolve userId from full label input value
  const matched = allProfilesForHold.find(p => {
    const kecName = p.kecamatan || '—';
    const label = `[${p.role.toUpperCase()}][${kecName}] ${p.nama}`;
    return label === searchVal;
  });

  if (!matched) {
    showToast('Petugas tidak ditemukan. Pastikan Anda memilih dari daftar saran nama yang muncul.', 'error');
    return;
  }

  const userId = matched.id;
  if (!alasan) { showToast('Masukkan alasan penahanan.', 'error'); return; }

  try {
    const { data: { user } } = await db.auth.getUser();
    const payload = {
      user_id: userId,
      gelombang: gelombang ? parseInt(gelombang) : null,
      termin: currentHoldTermin,
      alasan,
      ditahan_oleh: user?.id || null,
      is_active: true
    };

    let { error } = await db.from('honorarium_hold').insert([payload]);
    if (error && error.message && error.message.includes('termin')) {
      // Fallback jika kolom termin belum dimigrasi
      delete payload.termin;
      const res = await db.from('honorarium_hold').insert([payload]);
      error = res.error;
    }
    if (error) throw error;

    showToast(`Hold honorarium Termin ${currentHoldTermin === 2 ? 'II' : 'I'} berhasil disimpan.`, 'success');
    document.getElementById('holdUserSearch').value = '';
    document.getElementById('holdGelombang').value = '';
    document.getElementById('holdAlasan').value = '';
    await loadHoldList();
  } catch (err) {
    showToast('Gagal menyimpan hold: ' + err.message, 'error');
  }
}

async function releaseHold(holdId) {
  if (!confirm('Apakah Anda yakin ingin mencabut hold ini?')) return;
  try {
    const { error } = await db.from('honorarium_hold')
      .update({ is_active: false })
      .eq('id', holdId);
    if (error) throw error;
    showToast('Hold berhasil dicabut.', 'success');
    await loadHoldList();
  } catch (err) {
    showToast('Gagal mencabut hold: ' + err.message, 'error');
  }
}

// =====================================================
// LAMPIRAN SUPER KEPALA T1
let previewSuperAllRows = [];
let previewSuperRowTypes = [];
let previewSuperCurrentPage = 1;
let previewSuperPageSize = 25;
let previewSuperGelombang = 1;

async function generateLampiranSuperKepalaData(gelombang = 1) {
  const rekapData = await fetchSuperEvaluasiT1Data(gelombang);

  const excelRows = [];
  const rowTypes = [];

  let globalIndex = 1;

  rekapData.forEach(row => {
    const tgt = parseInt(row.target) || 0;
    const real = parseInt(row.realisasi) || 0;
    const pct = tgt > 0 ? ((real / tgt) * 100).toFixed(2) + '%' : '0.00%';

    excelRows.push({
      'No': globalIndex++,
      'Nama PML': row.nama_pml || '',
      'email PML': row.email_pml || '',
      'Nama PPL': row.nama_ppl || '',
      'email PPL': row.email_ppl || '',
      'Kode Kec': row.kdkec || '',
      'Kode Desa': row.kddesa || '',
      'KodeSLS+SubSLS': row.kdsls || '',
      'Target': tgt,
      'Realisasi': real,
      'Persentase (%)': pct
    });
    rowTypes.push(row.jabatan === 'PPL' ? 'data_ppl' : 'data_pml');
  });

  return { excelRows, rowTypes };
}

async function previewSuperKepalaLampiran(gelombang = 1) {
  showToast(`Memproses data preview Lampiran G${gelombang}...`, 'info');
  previewSuperGelombang = gelombang;
  previewSuperCurrentPage = 1;

  const titleEl = document.getElementById('previewSuperTitle');
  if (titleEl) titleEl.textContent = `Preview Lampiran Super Kepala T1 - Gelombang ${gelombang}`;

  const searchInput = document.getElementById('previewSuperSearch');
  if (searchInput) searchInput.value = '';

  try {
    const { excelRows, rowTypes } = await generateLampiranSuperKepalaData(gelombang);
    previewSuperAllRows = excelRows;
    previewSuperRowTypes = rowTypes;

    filterPreviewSuper();

    const modal = document.getElementById('previewSuperModal');
    if (modal) {
      modal.classList.add('open');
    }
  } catch (err) {
    console.error('Lampiran preview error:', err);
    showToast('Gagal menampilkan preview: ' + err.message, 'error');
  }
}

function filterPreviewSuper() {
  const search = document.getElementById('previewSuperSearch')?.value.toLowerCase() || '';
  const filtered = [];
  const filteredTypes = [];

  previewSuperAllRows.forEach((row, i) => {
    const match = !search ||
      (row['Nama PML'] || '').toLowerCase().includes(search) ||
      (row['email PML'] || '').toLowerCase().includes(search) ||
      (row['Nama PPL'] || '').toLowerCase().includes(search) ||
      (row['email PPL'] || '').toLowerCase().includes(search) ||
      (row['Kode Kec'] || '').toLowerCase().includes(search) ||
      (row['Kode Desa'] || '').toLowerCase().includes(search) ||
      (row['KodeSLS+SubSLS'] || '').toLowerCase().includes(search);

    if (match) {
      filtered.push(row);
      filteredTypes.push(previewSuperRowTypes[i]);
    }
  });

  const countEl = document.getElementById('previewSuperCount');
  if (countEl) countEl.textContent = `Total: ${filtered.length} baris`;

  renderPreviewSuperTable(filtered, filteredTypes);
}

function renderPreviewSuperTable(data, types) {
  const tbody = document.getElementById('previewSuperTableBody');
  const pag = document.getElementById('previewSuperPagination');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--text-muted)">Tidak ada data ditemukan</td></tr>';
    if (pag) pag.innerHTML = '';
    return;
  }

  let displayData = data;
  let displayTypes = types;
  const pageSize = previewSuperPageSize === 'all' ? data.length : parseInt(previewSuperPageSize);
  const totalPages = Math.ceil(data.length / pageSize);

  if (previewSuperPageSize !== 'all') {
    if (previewSuperCurrentPage > totalPages) previewSuperCurrentPage = totalPages;
    if (previewSuperCurrentPage < 1) previewSuperCurrentPage = 1;
    const start = (previewSuperCurrentPage - 1) * pageSize;
    displayData = data.slice(start, start + pageSize);
    displayTypes = types.slice(start, start + pageSize);
  }

  tbody.innerHTML = displayData.map((row, i) => {
    return `
      <tr>
        <td style="text-align:center">${row['No'] || ''}</td>
        <td>${escHtml(row['Nama PML'] || '')}</td>
        <td>${escHtml(row['email PML'] || '')}</td>
        <td>${escHtml(row['Nama PPL'] || '')}</td>
        <td>${escHtml(row['email PPL'] || '')}</td>
        <td style="text-align:center">${escHtml(row['Kode Kec'] || '')}</td>
        <td style="text-align:center">${escHtml(row['Kode Desa'] || '')}</td>
        <td style="font-size:0.8rem; word-break:break-all">${escHtml(row['KodeSLS+SubSLS'] || '')}</td>
        <td style="text-align:right">${row['Target'] !== undefined ? row['Target'] : ''}</td>
        <td style="text-align:right">${row['Realisasi'] !== undefined ? row['Realisasi'] : ''}</td>
        <td style="text-align:right; font-weight: bold;">${escHtml(row['Persentase (%)'] || '')}</td>
      </tr>
    `;
  }).join('');

  if (!pag) return;
  if (totalPages <= 1) {
    pag.innerHTML = '';
  } else {
    let btnHtml = '';
    btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewSuperPage(${previewSuperCurrentPage - 1})" ${previewSuperCurrentPage === 1 ? 'disabled' : ''} style="padding:0.2rem 0.4rem;min-width:28px">←</button>`;

    let startPage = Math.max(1, previewSuperCurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    if (startPage > 1) {
      btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewSuperPage(1)" style="padding:0.2rem 0.4rem;min-width:28px">1</button>`;
      if (startPage > 2) btnHtml += `<span style="padding:0.2rem;color:var(--text-muted)">...</span>`;
    }
    for (let i = startPage; i <= endPage; i++) {
      btnHtml += `<button class="btn btn-sm ${i === previewSuperCurrentPage ? 'btn-primary' : 'btn-secondary'}" onclick="goToPreviewSuperPage(${i})" style="padding:0.2rem 0.4rem;min-width:28px">${i}</button>`;
    }
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) btnHtml += `<span style="padding:0.2rem;color:var(--text-muted)">...</span>`;
      btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewSuperPage(${totalPages})" style="padding:0.2rem 0.4rem;min-width:28px">${totalPages}</button>`;
    }
    btnHtml += `<button class="btn btn-secondary btn-sm" onclick="goToPreviewSuperPage(${previewSuperCurrentPage + 1})" ${previewSuperCurrentPage === totalPages ? 'disabled' : ''} style="padding:0.2rem 0.4rem;min-width:28px">→</button>`;
    pag.innerHTML = btnHtml;
  }
}

function changePreviewSuperPageSize() {
  previewSuperPageSize = document.getElementById('previewSuperPageSizeSelect').value;
  previewSuperCurrentPage = 1;
  filterPreviewSuper();
}

function goToPreviewSuperPage(page) {
  previewSuperCurrentPage = page;
  filterPreviewSuper();
}

function closePreviewSuperModal() {
  const modal = document.getElementById('previewSuperModal');
  if (modal) modal.classList.remove('open');
}

async function exportSuperKepalaLampiranToExcel(gelombang = 1) {
  showToast(`Mengekspor Lampiran Gelombang ${gelombang} ke Excel...`, 'info');
  try {
    const { excelRows } = await generateLampiranSuperKepalaData(gelombang);
    if (!excelRows || excelRows.length === 0) {
      showToast('Tidak ada data untuk diekspor', 'warning');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();

    // Auto-fit column widths
    const cols = [];
    const headers = Object.keys(excelRows[0] || {});
    headers.forEach(h => {
      cols.push({ wch: Math.max(h.length + 3, 10) });
    });
    excelRows.forEach(row => {
      headers.forEach((h, colIndex) => {
        const val = row[h] ? row[h].toString() : '';
        if (val.length + 3 > cols[colIndex].wch) {
          cols[colIndex].wch = val.length + 3;
        }
      });
    });
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, `Lampiran G${gelombang}`);
    XLSX.writeFile(wb, `lampiran_super_kepala_t1_gelombang_${gelombang}.xlsx`);
    showToast('Ekspor Excel Lampiran berhasil!', 'success');
  } catch (err) {
    console.error('Export Excel Lampiran error:', err);
    showToast('Gagal ekspor Excel: ' + err.message, 'error');
  }
}


let activePplNoSuratGelombang = 1;
let allEligiblePplNoSuratData = [];

async function openPplNoSuratModal(gelombang = 1) {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  activePplNoSuratGelombang = gelombang;

  const gelFilter = document.getElementById('pplNoSuratGelombangFilter');
  if (gelFilter) gelFilter.value = gelombang;

  const titleEl = document.getElementById('pplNoSuratTitle');
  if (titleEl) titleEl.textContent = `Input Nomor Surat Super PPL`;

  const kecFilter = document.getElementById('pplNoSuratKecamatanFilter');
  if (kecFilter && kecFilter.options.length <= 1) {
    kecFilter.innerHTML = '<option value="">Semua Kecamatan</option>';
    const uniqueKec = new Set();
    allUsers.forEach(u => {
      if (u.role === 'ppl' && u.kecamatan && u.kecamatan !== '—') {
        uniqueKec.add(u.kecamatan);
      }
    });
    Array.from(uniqueKec).sort().forEach(k => {
      kecFilter.innerHTML += `<option value="${escHtml(k)}">${escHtml(k)}</option>`;
    });
  }
  if (kecFilter) kecFilter.value = '';

  document.getElementById('pplNoSuratModal').classList.add('open');

  const tbody = document.getElementById('pplNoSuratTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem"><span class="spinner" style="width:20px;height:20px"></span> Memuat data PPL...</td></tr>';
  }

  try {
    await loadBappEligibilityData();

    const allActivePpls = allUsers.filter(u => u.role === 'ppl' && u.is_active);

    if (allActivePpls.length === 0) {
      allEligiblePplNoSuratData = [];
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Tidak ada data PPL aktif.</td></tr>';
      return;
    }

    const sobatids = allActivePpls.map(p => String(p.sobatid).trim());
    let noSuratMap = {};
    const dbChunkSize = 500;
    for (let i = 0; i < sobatids.length; i += dbChunkSize) {
      const chunk = sobatids.slice(i, i + dbChunkSize);
      const { data, error } = await db
        .from('no_surat_se')
        .select('sobatid, no_spk, no_sp_pemeriksaan_t1')
        .in('sobatid', chunk);

      if (error) throw error;
      if (data) {
        data.forEach(n => {
          noSuratMap[String(n.sobatid).trim()] = n;
        });
      }
    }

    allEligiblePplNoSuratData = allActivePpls.map(p => {
      const key = String(p.sobatid).trim();
      return {
        id: p.id,
        nama: p.nama,
        sobatid: p.sobatid,
        kecamatan: p.kecamatan || '—',
        no_spk: noSuratMap[key]?.no_spk || '',
        no_sp: noSuratMap[key]?.no_sp_pemeriksaan_t1 || '',
        is_edited: false
      };
    });

    filterPplNoSuratTable();
  } catch (err) {
    console.error('Error loading PPL no surat modal:', err);
    showToast('Gagal memuat data nomor surat PPL: ' + err.message, 'error');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--danger)">Error: ${escHtml(err.message)}</td></tr>`;
    }
  }
}

function updatePplNoSuratInMemory(sobatid, field, value) {
  const item = allEligiblePplNoSuratData.find(x => String(x.sobatid).trim() === String(sobatid).trim());
  if (item) {
    item[field] = value;
    item.is_edited = true;
  }
}

function filterPplNoSuratTable() {
  const gelValue = parseInt(document.getElementById('pplNoSuratGelombangFilter')?.value || '1');
  const kecValue = document.getElementById('pplNoSuratKecamatanFilter')?.value || '';

  const tbody = document.getElementById('pplNoSuratTableBody');
  if (!tbody) return;

  const eligibleIds = bappEligibilityMap[gelValue];
  if (!eligibleIds) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Data kelayakan gelombang tidak ditemukan.</td></tr>';
    return;
  }

  const filtered = allEligiblePplNoSuratData.filter(p => {
    const isEligible = eligibleIds.has(p.id);
    if (!isEligible) return false;
    if (kecValue && p.kecamatan !== kecValue) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:2rem">Tidak ada PPL yang eligible dengan kriteria ini.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    return `
      <tr>
        <td><strong>${escHtml(p.nama)}</strong><div style="font-size:0.75rem;color:var(--text-muted)">Sobat ID: ${escHtml(p.sobatid)}</div></td>
        <td style="text-align:center">${escHtml(p.kecamatan)}</td>
        <td>
          <input type="text" class="form-input" value="${escHtml(p.no_spk)}" oninput="updatePplNoSuratInMemory('${escHtml(p.sobatid)}', 'no_spk', this.value)" style="font-size:0.8rem;padding:0.25rem 0.5rem" placeholder="No. SPK">
        </td>
        <td>
          <input type="text" class="form-input" value="${escHtml(p.no_sp)}" oninput="updatePplNoSuratInMemory('${escHtml(p.sobatid)}', 'no_sp', this.value)" style="font-size:0.8rem;padding:0.25rem 0.5rem" placeholder="No. SP PPL">
        </td>
      </tr>
    `;
  }).join('');
}

function closePplNoSuratModal() {
  const modal = document.getElementById('pplNoSuratModal');
  if (modal) modal.classList.remove('open');
}

async function savePplNoSuratAll() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  const toUpsert = allEligiblePplNoSuratData
    .filter(p => p.is_edited)
    .map(p => ({
      sobatid: String(p.sobatid).trim(),
      no_spk: p.no_spk.trim(),
      no_sp_pemeriksaan_t1: p.no_sp.trim(), // reuse column
      updated_at: new Date().toISOString()
    }));

  if (toUpsert.length === 0) {
    showToast('Tidak ada perubahan untuk disimpan', 'info');
    closePplNoSuratModal();
    return;
  }

  showToast('Menyimpan nomor surat PPL...', 'info');
  try {
    const chunkSize = 500;
    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);
      const { error } = await db.from('no_surat_se').upsert(chunk, { onConflict: 'sobatid' });
      if (error) throw error;
    }
    showToast('Semua nomor surat PPL berhasil disimpan!', 'success');
    closePplNoSuratModal();

    // Refresh SP PML data if currently open, just in case
    if (typeof loadSPTermin1Data === 'function') {
      loadSPTermin1Data();
    }
  } catch (err) {
    console.error('Error saving PPL no surat:', err);
    showToast('Gagal menyimpan nomor surat PPL: ' + err.message, 'error');
  }
}

async function fetchSuperPPLData(gelombang = 1) {
  // 1. Fetch active profiles
  let profiles = [];
  let fromProf = 0;
  let hasMoreProf = true;
  while (hasMoreProf) {
    const { data, error } = await db.from('profiles')
      .select('id, sobatid, nama, email_ref, role, nik')
      .eq('role', 'ppl')
      .eq('is_active', true)
      .range(fromProf, fromProf + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreProf = false;
    else {
      profiles = profiles.concat(data);
      if (data.length < 1000) hasMoreProf = false;
      else fromProf += 1000;
    }
  }

  // 2. Fetch user_sls
  let userSls = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls')
      .select('user_id, kode_sls')
      .eq('status', 'aktif')
      .range(fromSls, fromSls + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreSls = false;
    else {
      userSls = userSls.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    }
  }

  // 3. Fetch wilayah_subsls targets
  let subsls = [];
  let fromSub = 0;
  let hasMoreSub = true;
  while (hasMoreSub) {
    const { data, error } = await db.from('wilayah_subsls')
      .select('kode_sls_gabungan, target')
      .range(fromSub, fromSub + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreSub = false;
    else {
      subsls = subsls.concat(data);
      if (data.length < 1000) hasMoreSub = false;
      else fromSub += 1000;
    }
  }

  // 4. Fetch achievements
  let achievements = [];
  let fromCap = 0;
  let hasMoreCap = true;
  while (hasMoreCap) {
    const { data, error } = await db.from('capaian')
      .select('*')
      .range(fromCap, fromCap + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreCap = false;
    else {
      achievements = achievements.concat(data);
      if (data.length < 1000) hasMoreCap = false;
      else fromCap += 1000;
    }
  }

  // Fetch no_surat_se
  let noSurats = [];
  let fromNo = 0;
  let hasMoreNo = true;
  while (hasMoreNo) {
    const { data, error } = await db.from('no_surat_se')
      .select('sobatid, no_spk, no_sp_pemeriksaan_t1')
      .range(fromNo, fromNo + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreNo = false;
    else {
      noSurats = noSurats.concat(data);
      if (data.length < 1000) hasMoreNo = false;
      else fromNo += 1000;
    }
  }
  const noSuratMap = {};
  noSurats.forEach(n => {
    if (n.sobatid) noSuratMap[String(n.sobatid).trim()] = n;
  });

  const targetMap = {};
  subsls.forEach(s => {
    targetMap[s.kode_sls_gabungan] = parseInt(s.target) || 0;
  });

  const realisasiMapG1 = {};
  const realisasiMapG2 = {};
  const realisasiMapG3 = {};
  achievements.forEach(a => {
    realisasiMapG1[a.kode_sls_gabungan] = parseInt(a.capaian1) || 0;
    realisasiMapG2[a.kode_sls_gabungan] = parseInt(a.capaian1_g2) || 0;
    realisasiMapG3[a.kode_sls_gabungan] = parseInt(a.capaian1_g3 || 0) || 0;
  });

  const userSlsMap = {};
  userSls.forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  const resolveSlsCodes = (codes) => {
    const resolved = [];
    (codes || []).forEach(code => {
      if (code && code.length === 14) {
        const matches = subsls.filter(s => s.kode_sls_gabungan.startsWith(code)).map(s => s.kode_sls_gabungan);
        if (matches.length > 0) {
          resolved.push(...matches);
        } else {
          resolved.push(code + '00');
        }
      } else if (code) {
        resolved.push(code);
      }
    });
    return Array.from(new Set(resolved));
  };

  // Ambil kelayakan gelombang secara mutually exclusive
  await loadBappEligibilityData(true);
  const eligibleIds = bappEligibilityMap[gelombang];

  const pplList = [];

  profiles.forEach(p => {
    // Hanya proses yang eligible di gelombang ini secara mutually exclusive
    if (!eligibleIds.has(p.id)) return;

    const codes = resolveSlsCodes(userSlsMap[p.id] || []);
    let kdkec = '';
    if (codes.length > 0) {
      kdkec = codes[0].substring(4, 7);
    }

    let targetSum = 0;
    let realisasiSum = 0;
    let map = realisasiMapG1;
    if (gelombang === 2) map = realisasiMapG2;
    if (gelombang === 3) map = realisasiMapG3;

    const slsList = [];

    codes.forEach(code => {
      const target = targetMap[code] || 0;
      const real = map[code] || 0;
      targetSum += target;
      realisasiSum += real;

      slsList.push({
        kode_sls: code,
        target,
        realisasi: real
      });
    });

    const key = String(p.sobatid).trim();
    const userInAll = allUsers.find(x => x.id === p.id);
    const kecName = userInAll?.kecamatan || '—';

    pplList.push({
      id: p.id,
      nama: p.nama,
      sobatid: p.sobatid,
      nik: p.nik || '',
      kdkec,
      kecamatan: kecName,
      no_spk: noSuratMap[key]?.no_spk || '',
      no_sp_pemeriksaan_t1: noSuratMap[key]?.no_sp_pemeriksaan_t1 || '', // reuse column
      target: targetSum,
      realisasi: realisasiSum,
      capaian_pct: targetSum > 0 ? (realisasiSum / targetSum) * 100 : 0,
      slsList
    });
  });

  pplList.sort((a, b) => {
    const compKec = (a.kdkec || '').localeCompare(b.kdkec || '');
    if (compKec !== 0) return compKec;
    return (a.nama || '').localeCompare(b.nama || '');
  });

  return pplList;
}

function printSuperPPL(gelombang = 1) {
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }

    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data PPL...`;

      const pplList = await fetchSuperPPLData(gelombang);

      if (pplList.length === 0) {
        showToast('Tidak ada PPL yang eligible di gelombang ini untuk dicetak.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pplList.length; i++) {
        const ppl = pplList[i];
        indicator.innerHTML = `
          <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
          Membuat Surat Pernyataan PPL (${i + 1}/${pplList.length})...
        `;

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        buildSuperPPLDocument(pdf, ppl, ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Berhasil membuat PDF Super PPL!';
      window.open(pdf.output('bloburl'), '_blank');
      setTimeout(() => { indicator.remove(); }, 2000);

    } catch (err) {
      console.error(err);
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

function buildSuperPPLDocument(pdf, ppl, ttdYulianBase64, gelombang = 1) {
  // ==========================================
  // HALAMAN 1 - SURAT PERNYATAAN & TANDA TANGAN
  // ==========================================
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN PENYELESAIAN", 105, 25, { align: "center" });
  pdf.text("PETUGAS LAPANGAN SENSUS EKONOMI 2026 TERMIN I", 105, 31, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${ppl.no_sp_pemeriksaan_t1 || "......./SE2026/.../.../2026"}`, 105, 38, { align: "center" });

  let y = 48;
  pdf.text("Yang bertanda tangan di bawah ini:", 25, y);

  y += 7;
  const labelX = 30;
  const colonX = 62;
  const valueX = 66;
  const lh = 5;

  const identitas = [
    ["Nama", (ppl.nama || "").toUpperCase()],
    ["NIK", ppl.nik || "....................................."],
    ["Jabatan", "Petugas Lapangan Sensus Ekonomi 2026"]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], 185 - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 2;
  pdf.text("Dengan ini menyatakan:", 25, y);
  y += 6;

  const poin = [
    `bahwa telah melaksanakan pekerjaan Petugas Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Petugas Nomor: ${ppl.no_spk || "....................................."}, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan Petugas Lapangan Sensus Ekonomi 2026 termin I yang telah diselesaikan sebanyak ${ppl.realisasi} usaha dan keluarga dengan presentase sebesar ${ppl.capaian_pct.toFixed(2)} persen dari ${ppl.target} usaha dan keluarga target prelist;`,
    `bahwa seluruh hasil pekerjaan termin I adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const textWidth = 185 - 33;
  poin.forEach((teks, idx) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${idx + 1}.`, 25, y);
    drawJustifiedText(pdf, teks, 33, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup = "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";
  const penutupLines = pdf.splitTextToSize(penutup, 160);
  drawJustifiedText(pdf, penutup, 25, y, 160, 5);
  y += penutupLines.length + 6;

  // Tanda Tangan (di Halaman 1 sesuai permintaan)
  const ttdY = y + 15;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);

  // Kanan: Yang membuat pernyataan (Petugas PPL)
  const ttdX = 155;
  const dateStr = gelombang === 3 ? "Lebak, 28 Juli 2026" : (gelombang === 2 ? "Lebak, 23 Juli 2026" : "Lebak, 16 Juli 2026");
  pdf.text(dateStr, ttdX, ttdY, { align: "center" });
  pdf.text("Yang membuat pernyataan,", ttdX, ttdY + 5, { align: "center" });
  pdf.text((ppl.nama || "").toUpperCase(), ttdX, ttdY + 33, { align: "center" });

  // Kiri: Ketua Tim Pelaksana (digeser ke bawah agar tidak bersinggungan)
  pdf.text("Mengetahui,", 25, ttdY + 40);
  pdf.text("Ketua Tim Pelaksana Sensus Ekonomi", 25, ttdY + 45);
  pdf.text("2026", 25, ttdY + 50);
  pdf.text("Kabupaten Lebak", 25, ttdY + 55);

  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', 30, ttdY + 56, 18, 25);
  }

  pdf.text("YULIAN SARWO EDI", 25, ttdY + 80);
  pdf.text("NIP. 197707101999121001", 25, ttdY + 85);
}

// =====================================================
// PREVIEW SUPER PPL (OPEN IN NEW TAB)
// =====================================================

function previewSuperPPL(gelombang = 1) {
  let indicator = document.getElementById('auto-crop-bg-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'auto-crop-bg-indicator';
    indicator.style = `
      position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
      color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
      font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
    `;
    document.body.appendChild(indicator);
  }

  indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

  loadJsPDF(async () => {
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data PPL...`;

      const pplList = await fetchSuperPPLData(gelombang);
      if (pplList.length === 0) {
        showToast('Tidak ada PPL yang eligible di gelombang ini.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pplList.length; i++) {
        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }
        buildSuperPPLDocument(pdf, pplList[i], ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Preview PDF siap!';

      window.open(pdf.output('bloburl'), '_blank');
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error('Failed to generate preview PDF:', err);
      showToast('Gagal membuat preview PDF: ' + err.message, 'error');
      indicator.remove();
    }
  });
}

function downloadSuperPPL(gelombang = 1) {
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }

    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data PPL...`;

      const pplList = await fetchSuperPPLData(gelombang);

      if (pplList.length === 0) {
        showToast('Tidak ada PPL yang eligible di gelombang ini untuk dicetak.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pplList.length; i++) {
        const ppl = pplList[i];
        indicator.innerHTML = `
          <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
          Membuat Surat Pernyataan PPL (${i + 1}/${pplList.length})...
        `;

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        buildSuperPPLDocument(pdf, ppl, ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Mengunduh PDF!';
      pdf.save(`super_ppl_gelombang_${gelombang}.pdf`);
      setTimeout(() => { indicator.remove(); }, 2000);

    } catch (err) {
      console.error(err);
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

// =====================================================
// SUPER PML FUNCTIONS (MATCHING SUPER PPL LOGIC)
// =====================================================

let activePmlNoSuratGelombang = 1;
let allEligiblePmlNoSuratData = [];

async function openPmlNoSuratModal(gelombang = 1) {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  activePmlNoSuratGelombang = gelombang;

  const gelFilter = document.getElementById('pmlNoSuratGelombangFilter');
  if (gelFilter) gelFilter.value = gelombang;

  const titleEl = document.getElementById('pmlNoSuratTitle');
  if (titleEl) titleEl.textContent = `Input Nomor Surat Super PML`;

  const kecFilter = document.getElementById('pmlNoSuratKecamatanFilter');
  if (kecFilter && kecFilter.options.length <= 1) {
    kecFilter.innerHTML = '<option value="">Semua Kecamatan</option>';
    const uniqueKec = new Set();
    allUsers.forEach(u => {
      if (u.role === 'pml' && u.kecamatan && u.kecamatan !== '—') {
        uniqueKec.add(u.kecamatan);
      }
    });
    Array.from(uniqueKec).sort().forEach(k => {
      kecFilter.innerHTML += `<option value="${escHtml(k)}">${escHtml(k)}</option>`;
    });
  }
  if (kecFilter) kecFilter.value = '';

  document.getElementById('pmlNoSuratModal').classList.add('open');

  const tbody = document.getElementById('pmlNoSuratTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem"><span class="spinner" style="width:20px;height:20px"></span> Memuat data PML...</td></tr>';
  }

  try {
    await loadBappEligibilityData();

    const allActivePmls = allUsers.filter(u => u.role === 'pml' && u.is_active);

    if (allActivePmls.length === 0) {
      allEligiblePmlNoSuratData = [];
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Tidak ada data PML aktif.</td></tr>';
      return;
    }

    const sobatids = allActivePmls.map(p => String(p.sobatid).trim());
    let noSuratMap = {};
    const dbChunkSize = 500;
    for (let i = 0; i < sobatids.length; i += dbChunkSize) {
      const chunk = sobatids.slice(i, i + dbChunkSize);
      const { data, error } = await db
        .from('no_surat_se')
        .select('sobatid, no_spk, no_sp_pemeriksaan_t1')
        .in('sobatid', chunk);

      if (error) throw error;
      if (data) {
        data.forEach(n => {
          noSuratMap[String(n.sobatid).trim()] = n;
        });
      }
    }

    allEligiblePmlNoSuratData = allActivePmls.map(p => {
      const key = String(p.sobatid).trim();
      return {
        id: p.id,
        nama: p.nama,
        sobatid: p.sobatid,
        kecamatan: p.kecamatan || '—',
        no_spk: noSuratMap[key]?.no_spk || '',
        no_sp: noSuratMap[key]?.no_sp_pemeriksaan_t1 || '',
        is_edited: false
      };
    });

    filterPmlNoSuratTable();
  } catch (err) {
    console.error('Error loading PML no surat modal:', err);
    showToast('Gagal memuat: ' + err.message, 'error');
  }
}

function closePmlNoSuratModal() {
  const modal = document.getElementById('pmlNoSuratModal');
  if (modal) modal.classList.remove('open');
}

function filterPmlNoSuratTable() {
  const tbody = document.getElementById('pmlNoSuratTableBody');
  if (!tbody) return;

  const gelFilter = document.getElementById('pmlNoSuratGelombangFilter');
  const gel = parseInt(gelFilter?.value || '1');
  activePmlNoSuratGelombang = gel;

  const kec = document.getElementById('pmlNoSuratKecamatanFilter')?.value || '';

  const eligibleIds = bappEligibilityMap[gel];

  let displayRows = allEligiblePmlNoSuratData.filter(p => eligibleIds.has(p.id));

  if (kec) {
    displayRows = displayRows.filter(p => p.kecamatan === kec);
  }

  // Sort by kecamatan, then by name
  displayRows.sort((a, b) => {
    const compKec = (a.kecamatan || '').localeCompare(b.kecamatan || '');
    if (compKec !== 0) return compKec;
    return (a.nama || '').localeCompare(b.nama || '');
  });

  if (displayRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Tidak ada data PML eligible di gelombang dan kecamatan terpilih.</td></tr>';
    return;
  }

  tbody.innerHTML = displayRows.map(p => {
    return `
      <tr>
        <td><strong>${escHtml(p.nama)}</strong><div style="font-size:0.75rem;color:var(--text-muted)">Sobat ID: ${escHtml(p.sobatid)}</div></td>
        <td style="text-align:center">${escHtml(p.kecamatan)}</td>
        <td>
          <input type="text" class="form-input" style="height:30px;padding:0.25rem;font-size:0.85rem;margin:0"
            value="${escHtml(p.no_spk)}" oninput="updatePmlNoSuratInMemory('${p.sobatid}', 'no_spk', this.value)">
        </td>
        <td>
          <input type="text" class="form-input" style="height:30px;padding:0.25rem;font-size:0.85rem;margin:0"
            value="${escHtml(p.no_sp)}" oninput="updatePmlNoSuratInMemory('${p.sobatid}', 'no_sp', this.value)">
        </td>
      </tr>
    `;
  }).join('');
}

function updatePmlNoSuratInMemory(sobatid, field, value) {
  const item = allEligiblePmlNoSuratData.find(x => String(x.sobatid).trim() === String(sobatid).trim());
  if (item) {
    item[field] = value.trim();
    item.is_edited = true;
  }
}

async function savePmlNoSuratAll() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  const editedItems = allEligiblePmlNoSuratData.filter(x => x.is_edited);
  if (editedItems.length === 0) {
    showToast('Tidak ada perubahan nomor surat yang disimpan.', 'info');
    closePmlNoSuratModal();
    return;
  }

  showToast('Menyimpan perubahan nomor surat PML...', 'info');
  try {
    const toUpsert = editedItems.map(x => ({
      sobatid: x.sobatid,
      no_spk: x.no_spk || null,
      no_sp_pemeriksaan_t1: x.no_sp || null,
      updated_at: new Date().toISOString()
    }));

    const chunkSize = 50;
    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);
      const { error } = await db.from('no_surat_se').upsert(chunk, { onConflict: 'sobatid' });
      if (error) throw error;
    }
    showToast('Semua nomor surat PML berhasil disimpan!', 'success');
    closePmlNoSuratModal();

    // Refresh PML data if currently open
    if (typeof loadSPTermin1Data === 'function') {
      loadSPTermin1Data();
    }
  } catch (err) {
    console.error('Error saving PML no surat:', err);
    showToast('Gagal menyimpan nomor surat PML: ' + err.message, 'error');
  }
}

async function fetchSuperPMLData(gelombang = 1) {
  // Fetch wilayah_subsls for resolving SLS codes
  let subsls = [];
  let fromSub = 0;
  let hasMoreSub = true;
  while (hasMoreSub) {
    const { data, error } = await db.from('wilayah_subsls')
      .select('kode_sls_gabungan')
      .range(fromSub, fromSub + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreSub = false;
    else {
      subsls = subsls.concat(data);
      if (data.length < 1000) hasMoreSub = false;
      else fromSub += 1000;
    }
  }

  const resolveSlsCodes = (codes) => {
    const resolved = [];
    (codes || []).forEach(code => {
      if (code && code.length === 14) {
        const matches = subsls.filter(s => s.kode_sls_gabungan.startsWith(code)).map(s => s.kode_sls_gabungan);
        if (matches.length > 0) {
          resolved.push(...matches);
        } else {
          resolved.push(code + '00');
        }
      } else if (code) {
        resolved.push(code);
      }
    });
    return Array.from(new Set(resolved));
  };

  // 1. Fetch active profiles
  let profiles = [];
  let fromProf = 0;
  let hasMoreProf = true;
  while (hasMoreProf) {
    const { data, error } = await db.from('profiles')
      .select('id, sobatid, nama, email_ref, role, nik')
      .eq('role', 'pml')
      .eq('is_active', true)
      .range(fromProf, fromProf + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreProf = false;
    else {
      profiles = profiles.concat(data);
      if (data.length < 1000) hasMoreProf = false;
      else fromProf += 1000;
    }
  }

  // Fetch no_surat_se
  let noSurats = [];
  let fromNo = 0;
  let hasMoreNo = true;
  while (hasMoreNo) {
    const { data, error } = await db.from('no_surat_se')
      .select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2')
      .range(fromNo, fromNo + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreNo = false;
    else {
      noSurats = noSurats.concat(data);
      if (data.length < 1000) hasMoreNo = false;
      else fromNo += 1000;
    }
  }
  const noSuratMap = {};
  noSurats.forEach(n => {
    if (n.sobatid) noSuratMap[String(n.sobatid).trim()] = n;
  });

  // Fetch active user_sls for mapping
  let userSls = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls')
      .select('user_id, kode_sls, status')
      .eq('status', 'aktif')
      .range(fromSls, fromSls + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreSls = false;
    else {
      userSls = userSls.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    }
  }

  const userSlsMap = {};
  userSls.forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  // Fetch achievements (capaian) to map G3 realisasi
  let achievements = [];
  let fromAch = 0;
  let hasMoreAch = true;
  while (hasMoreAch) {
    const { data, error } = await db.from('capaian')
      .select('kode_sls_gabungan, capaian1_pml_g3')
      .range(fromAch, fromAch + 999);
    if (error) throw error;
    if (!data || data.length === 0) hasMoreAch = false;
    else {
      achievements = achievements.concat(data);
      if (data.length < 1000) hasMoreAch = false;
      else fromAch += 1000;
    }
  }

  const realisasiPmlMapG3 = {};
  achievements.forEach(a => {
    realisasiPmlMapG3[a.kode_sls_gabungan] = parseInt(a.capaian1_pml_g3 || 0) || 0;
  });

  // Ambil kelayakan gelombang secara mutually exclusive
  await loadBappEligibilityData(true);
  const eligibleIds = bappEligibilityMap[gelombang];

  const pmlList = [];

  for (const p of profiles) {
    if (!eligibleIds.has(p.id)) continue;

    const key = String(p.sobatid).trim();
    const userInAll = allUsers.find(x => x.id === p.id);
    const kecName = userInAll?.kecamatan || '—';

    // Fetch rekap data for this PML
    let rekapData = [];
    try {
      const { data, error } = await db.rpc('get_rekapitulasi_pml', { p_pml_id: p.id });
      if (!error && data) rekapData = data;
    } catch (e) {
      console.warn('Gagal memuat rekap pml:', p.id, e);
    }

    let kdkec = '';
    // Enrich rekapData for Gelombang 3 & Gelombang 4 if total_capaian1_pml_g3 is not provided by RPC
    rekapData.forEach(row => {
      const pplProf = allUsers.find(u => u.role === 'ppl' && String(u.sobatid).trim() === String(row.sobatid_ppl).trim());
      if (pplProf) {
        const slsCodes = resolveSlsCodes(userSlsMap[pplProf.id] || []);
        if (slsCodes.length > 0 && !kdkec) {
          kdkec = slsCodes[0].substring(4, 7);
        }
        if (row.total_capaian1_pml_g3 === undefined || row.total_capaian1_pml_g3 === null) {
          let sumG3 = 0;
          slsCodes.forEach(code => {
            sumG3 += realisasiPmlMapG3[code] || 0;
          });
          row.total_capaian1_pml_g3 = sumG3;
        }
      }
    });

    pmlList.push({
      id: p.id,
      nama: p.nama,
      sobatid: p.sobatid,
      nik: p.nik || '',
      kdkec: kdkec,
      kecamatan: kecName,
      no_spk: noSuratMap[key]?.no_spk || '',
      no_sp_pemeriksaan_t1: noSuratMap[key]?.no_sp_pemeriksaan_t1 || '',
      no_sp_pemeriksaan_t2: noSuratMap[key]?.no_sp_pemeriksaan_t2 || '',
      rekapData
    });
  }

  // Sort by kdkec (kode kecamatan), then by name
  pmlList.sort((a, b) => {
    const compKec = (a.kdkec || '').localeCompare(b.kdkec || '');
    if (compKec !== 0) return compKec;
    return (a.nama || '').localeCompare(b.nama || '');
  });

  return pmlList;
}

function previewSuperPML(gelombang = 1) {
  let indicator = document.getElementById('auto-crop-bg-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'auto-crop-bg-indicator';
    indicator.style = `
      position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
      color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
      font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
    `;
    document.body.appendChild(indicator);
  }

  indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

  loadJsPDF(async () => {
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data PML...`;

      const pmlList = await fetchSuperPMLData(gelombang);
      if (pmlList.length === 0) {
        showToast('Tidak ada PML yang eligible di gelombang ini.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pmlList.length; i++) {
        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }
        buildSPTermin1Pages(pdf, pmlList[i], pmlList[i].rekapData, i > 0, ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Preview PDF siap!';

      window.open(pdf.output('bloburl'), '_blank');
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error('Failed to generate preview PDF:', err);
      showToast('Gagal membuat preview PDF: ' + err.message, 'error');
      indicator.remove();
    }
  });
}

function downloadSuperPML(gelombang = 1) {
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }

    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Mengambil data PML...`;

      const pmlList = await fetchSuperPMLData(gelombang);

      if (pmlList.length === 0) {
        showToast('Tidak ada PML yang eligible di gelombang ini untuk dicetak.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pmlList.length; i++) {
        const pml = pmlList[i];
        indicator.innerHTML = `
          <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span>
          Membuat Surat Pernyataan PML (${i + 1}/${pmlList.length})...
        `;

        if (i > 0) {
          pdf.addPage("a4", "portrait");
        }

        buildSPTermin1Pages(pdf, pml, pml.rekapData, i > 0, ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Mengunduh PDF!';
      pdf.save(`super_pml_gelombang_${gelombang}.pdf`);
      setTimeout(() => { indicator.remove(); }, 2000);

    } catch (err) {
      console.error(err);
      indicator.style.background = 'rgba(239, 68, 68, 0.1)';
      indicator.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

// ============================================================
// DOKUMEN UB T1 & MANAGEMENT PETUGAS UB LOGIC
// ============================================================

let ubPmlList = [];
let ubPplList = [];
let ubConfig = {
  nomor_surat_pml: '',
  nomor_surat_ppl: '',
  nomor_surat_kepala: '',
  nomor_surat_bapp: '',
  tanggal_surat: '31 Juli 2026'
};

function switchUBTab(tab) {
  const btnPML = document.getElementById('ubTabBtnPML');
  const btnPPL = document.getElementById('ubTabBtnPPL');
  const contentPML = document.getElementById('ubTabContentPML');
  const contentPPL = document.getElementById('ubTabContentPPL');

  if (!btnPML || !btnPPL || !contentPML || !contentPPL) return;

  if (tab === 'pml') {
    btnPML.className = 'btn btn-sm btn-primary';
    btnPPL.className = 'btn btn-sm btn-secondary';
    contentPML.style.display = 'flex';
    contentPPL.style.display = 'none';
  } else {
    btnPML.className = 'btn btn-sm btn-secondary';
    btnPPL.className = 'btn btn-sm btn-primary';
    contentPML.style.display = 'none';
    contentPPL.style.display = 'flex';
  }
}

async function openUBInputModal() {
  const modal = document.getElementById('ubInputModal');
  if (modal) modal.classList.add('open');
  switchUBTab('pml');

  try {
    // 1. Load UB config
    const { data: cfgData } = await db.from('dokumen_ub_config').select('*').limit(1);
    if (cfgData && cfgData.length > 0) {
      ubConfig = cfgData[0];
      const kepEl = document.getElementById('ubNoSuratKepala');
      const tglEl = document.getElementById('ubTanggalSurat');

      if (kepEl) kepEl.value = ubConfig.nomor_surat_kepala || '';
      if (tglEl) tglEl.value = ubConfig.tanggal_surat || '31 Juli 2026';
    } else {
      const tglEl = document.getElementById('ubTanggalSurat');
      if (tglEl) tglEl.value = '31 Juli 2026';
    }

    // 2. Load UB officers
    const { data: officers, error } = await db.from('petugas_ub').select('*').order('created_at', { ascending: true });
    if (error) throw error;

    if (officers && officers.length > 0) {
      ubPmlList = officers.filter(o => o.role === 'pml_ub');
      ubPplList = officers.filter(o => o.role === 'ppl_ub');
    } else {
      // Default initial templates (2 PML & 5 PPL if empty)
      ubPmlList = [
        { id: null, nama: '', sobat_id: '', nik: '', no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'pml_ub' },
        { id: null, nama: '', sobat_id: '', nik: '', no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'pml_ub' }
      ];
      ubPplList = [
        { id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' },
        { id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' },
        { id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' },
        { id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' },
        { id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' }
      ];
    }

    renderPmlUBTable();
    renderPplUBTable();
  } catch (err) {
    console.error('Error loading UB data:', err);
    showToast('Gagal memuat data petugas UB: ' + err.message, 'error');
  }
}

function closeUBInputModal() {
  const modal = document.getElementById('ubInputModal');
  if (modal) modal.classList.remove('open');
}

function loadTesseractScript() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Gagal memuat Tesseract.js'));
    document.head.appendChild(script);
  });
}

async function detectCropBoundsUB(imageSrc) {
  try {
    const Tesseract = await loadTesseractScript();
    const { data: { lines } } = await Tesseract.recognize(imageSrc, 'eng');
    const img = new Image();
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
      img.src = imageSrc;
    });

    const h = img.naturalHeight || 1000;
    let topY = null;
    let bottomY = null;

    for (const line of lines) {
      const text = line.text.toLowerCase();
      if (topY === null && (text.includes('silakan') || text.includes('sensus') || text.includes('ekonomi') || text.includes('pilih') || text.includes('progres') || text.includes('fasih') || text.includes('badan'))) {
        topY = line.bbox.y0;
      }
      if (text.includes('selesai') || text.includes('hari lagi') || text.includes('hari') || text.includes('capaian') || text.includes('total')) {
        bottomY = line.bbox.y1;
      }
    }

    const finalTop = topY !== null ? Math.max(0, topY - 15) / h * 100 : 12.5;
    const finalBottom = bottomY !== null ? Math.min(h, bottomY + 25) / h * 100 : 46.5;

    return { top: parseFloat(finalTop.toFixed(1)), bottom: parseFloat(finalBottom.toFixed(1)) };
  } catch (err) {
    console.warn('OCR Auto-detect UB warn:', err);
    return { top: 12.5, bottom: 46.5 };
  }
}

function handleUBScreenshotUpload(role, idx, input) {
  const file = input.files && input.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('File harus berupa gambar (PNG/JPG)!', 'error');
    return;
  }

  showToast(`Memproses & mengompresi screenshot ${role.toUpperCase()} #${idx + 1}...`, 'info');

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = async function () {
      // Kompresi & Resizing menggunakan HTML5 Canvas (Max Width: 650px, JPEG Quality: 0.5)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const MAX_WIDTH = 650;
      let targetWidth = img.width;
      let targetHeight = img.height;

      if (img.width > MAX_WIDTH) {
        targetWidth = MAX_WIDTH;
        targetHeight = Math.round((img.height * MAX_WIDTH) / img.width);
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const base64 = canvas.toDataURL('image/jpeg', 0.5);

      showToast(`Mendeteksi Teks & Batas Krop (OCR) ${role.toUpperCase()} #${idx + 1}...`, 'info');
      const bounds = await detectCropBoundsUB(base64);

      if (role === 'pml') {
        ubPmlList[idx].screenshot = base64;
        ubPmlList[idx].crop_top = bounds.top;
        ubPmlList[idx].crop_bottom = bounds.bottom;
        renderPmlUBTable();
      } else {
        ubPplList[idx].screenshot = base64;
        ubPplList[idx].crop_top = bounds.top;
        ubPplList[idx].crop_bottom = bounds.bottom;
        renderPplUBTable();
      }
      showToast(`Bukti screenshot ${role.toUpperCase()} #${idx + 1} berhasil di-OCR & dikompresi! (Top: ${bounds.top}%, Bottom: ${bounds.bottom}%)`, 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderPmlUBTable() {
  const container = document.getElementById('pmlUBContainer');
  if (!container) return;

  if (ubPmlList.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem">Belum ada data PML UB. Klik tombol "+ Tambah PML UB".</div>';
    return;
  }

  container.innerHTML = ubPmlList.map((p, idx) => `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:0.85rem;display:flex;flex-direction:column;gap:0.6rem">
      <!-- Baris 1: Header Petugas & Identitas (Nama, Sobat ID, NIK) -->
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--border);padding-bottom:0.5rem">
        <span style="font-weight:600;font-size:0.85rem;color:var(--primary)">PML UB #${idx + 1}</span>
        <button class="btn btn-danger btn-sm" style="padding:0.2rem 0.5rem;font-size:0.75rem" onclick="removePmlUBRow(${idx})">Hapus Petugas ✕</button>
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:0.6rem">
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">Nama PML UB</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.nama || '')}" placeholder="Nama Lengkap PML" oninput="ubPmlList[${idx}].nama = this.value; updatePmlDropdownOptions();">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">SOBAT ID</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.sobat_id || '')}" placeholder="Sobat ID" oninput="ubPmlList[${idx}].sobat_id = this.value">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">NIK</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.nik || '')}" placeholder="NIK" oninput="ubPmlList[${idx}].nik = this.value">
        </div>
      </div>

      <!-- Baris 2: Nomor Surat & Kinerja -->
      <div style="display:grid;grid-template-columns:1.2fr 1.2fr 1.2fr 80px 80px 1.2fr;gap:0.6rem;align-items:end">
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. SPK</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.no_spk || '')}" placeholder="No. SPK" oninput="ubPmlList[${idx}].no_spk = this.value">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. BAPP</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.no_bapp || '')}" placeholder="No. BAPP" oninput="ubPmlList[${idx}].no_bapp = this.value">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. Super</label>
          <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
            value="${escHtml(p.no_super || '')}" placeholder="No. Super" oninput="ubPmlList[${idx}].no_super = this.value">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block;text-align:center">Target</label>
          <input type="number" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.85rem;margin:0;text-align:center"
            value="${p.target ?? 0}" placeholder="Target" oninput="ubPmlList[${idx}].target = parseInt(this.value)|0">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block;text-align:center">Capaian</label>
          <input type="number" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.85rem;margin:0;text-align:center"
            value="${p.realisasi ?? 0}" placeholder="Capaian" oninput="ubPmlList[${idx}].realisasi = parseInt(this.value)|0">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">Bukti Screenshot</label>
          <input type="file" id="pmlScreenshot_${idx}" accept="image/*" style="display:none" onchange="handleUBScreenshotUpload('pml', ${idx}, this)">
          <button class="btn btn-secondary btn-sm" style="width:100%;height:34px;font-size:0.78rem" onclick="document.getElementById('pmlScreenshot_${idx}').click()">
            ${p.screenshot ? '✓ Ada Gambar' : '📷 Upload Gambar'}
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderPplUBTable() {
  const container = document.getElementById('pplUBContainer');
  if (!container) return;

  if (ubPplList.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem">Belum ada data PPL UB. Klik tombol "+ Tambah PPL UB".</div>';
    return;
  }

  container.innerHTML = ubPplList.map((p, idx) => {
    let pmlOptions = '<option value="">-- Pilih PML Penanggung Jawab --</option>';
    ubPmlList.forEach((pml, pmlIdx) => {
      const pmlName = pml.nama ? pml.nama : `PML UB ${pmlIdx + 1}`;
      const selected = (p.pml_idx === pmlIdx || p.pml_id === pml.id) ? 'selected' : '';
      pmlOptions += `<option value="${pmlIdx}" ${selected}>${escHtml(pmlName)}</option>`;
    });

    return `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:0.85rem;display:flex;flex-direction:column;gap:0.6rem">
        <!-- Baris 1: Header Petugas & Identitas (Nama, Sobat ID, NIK, PML) -->
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed var(--border);padding-bottom:0.5rem">
          <span style="font-weight:600;font-size:0.85rem;color:var(--primary)">PPL UB #${idx + 1}</span>
          <button class="btn btn-danger btn-sm" style="padding:0.2rem 0.5rem;font-size:0.75rem" onclick="removePplUBRow(${idx})">Hapus Petugas ✕</button>
        </div>

        <div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:0.6rem">
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">Nama PPL UB</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.nama || '')}" placeholder="Nama Lengkap PPL" oninput="ubPplList[${idx}].nama = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">SOBAT ID</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.sobat_id || '')}" placeholder="Sobat ID" oninput="ubPplList[${idx}].sobat_id = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">NIK</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.nik || '')}" placeholder="NIK" oninput="ubPplList[${idx}].nik = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">PML Penanggung Jawab</label>
            <select class="filter-select" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0;width:100%"
              onchange="ubPplList[${idx}].pml_idx = parseInt(this.value);">
              ${pmlOptions}
            </select>
          </div>
        </div>

        <!-- Baris 2: Nomor Surat & Kinerja -->
        <div style="display:grid;grid-template-columns:1.2fr 1.2fr 1.2fr 80px 80px 1.2fr;gap:0.6rem;align-items:end">
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. SPK</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.no_spk || '')}" placeholder="No. SPK" oninput="ubPplList[${idx}].no_spk = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. BAPP</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.no_bapp || '')}" placeholder="No. BAPP" oninput="ubPplList[${idx}].no_bapp = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">No. Super</label>
            <input type="text" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.82rem;margin:0"
              value="${escHtml(p.no_super || '')}" placeholder="No. Super" oninput="ubPplList[${idx}].no_super = this.value">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block;text-align:center">Target</label>
            <input type="number" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.85rem;margin:0;text-align:center"
              value="${p.target ?? 0}" placeholder="Target" oninput="ubPplList[${idx}].target = parseInt(this.value)|0">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block;text-align:center">Capaian</label>
            <input type="number" class="form-input" style="height:34px;padding:0.35rem 0.5rem;font-size:0.85rem;margin:0;text-align:center"
              value="${p.realisasi ?? 0}" placeholder="Capaian" oninput="ubPplList[${idx}].realisasi = parseInt(this.value)|0">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;display:block">Bukti Screenshot</label>
            <input type="file" id="pplScreenshot_${idx}" accept="image/*" style="display:none" onchange="handleUBScreenshotUpload('ppl', ${idx}, this)">
            <button class="btn btn-secondary btn-sm" style="width:100%;height:34px;font-size:0.78rem" onclick="document.getElementById('pplScreenshot_${idx}').click()">
              ${p.screenshot ? '✓ Ada Gambar' : '📷 Upload Gambar'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function updatePmlDropdownOptions() {
  renderPplUBTable();
}

function addPmlUBRow() {
  ubPmlList.push({ id: null, nama: '', sobat_id: '', nik: '', no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'pml_ub' });
  renderPmlUBTable();
  renderPplUBTable();
}

function removePmlUBRow(index) {
  ubPmlList.splice(index, 1);
  renderPmlUBTable();
  renderPplUBTable();
}

function addPplUBRow() {
  ubPplList.push({ id: null, nama: '', sobat_id: '', nik: '', pml_id: null, no_spk: '', no_bapp: '', no_super: '', target: 0, realisasi: 0, screenshot: null, role: 'ppl_ub' });
  renderPplUBTable();
}

function removePplUBRow(index) {
  ubPplList.splice(index, 1);
  renderPplUBTable();
}

async function saveUBDataAll() {
  showToast('Menyimpan data petugas & dokumen UB...', 'info');

  try {
    // 1. Clear existing petugas_ub and insert new ones
    await db.from('petugas_ub').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Insert PML UB first to get generated IDs
    const pmlToInsert = ubPmlList.map(p => ({
      nama: (p.nama || '').trim(),
      sobat_id: (p.sobat_id || '').trim(),
      nik: (p.nik || '').trim(),
      no_spk: (p.no_spk || '').trim(),
      no_bapp: (p.no_bapp || '').trim(),
      no_super: (p.no_super || '').trim(),
      target: parseInt(p.target) || 0,
      realisasi: parseInt(p.realisasi) || 0,
      screenshot: p.screenshot || null,
      crop_top: p.crop_top !== undefined ? p.crop_top : 12.5,
      crop_bottom: p.crop_bottom !== undefined ? p.crop_bottom : 46.5,
      role: 'pml_ub'
    })).filter(p => p.nama);

    let savedPmls = [];
    if (pmlToInsert.length > 0) {
      const { data, error } = await db.from('petugas_ub').insert(pmlToInsert).select();
      if (error) throw error;
      savedPmls = data || [];
    }

    // Insert PPL UB linked to saved PMLs
    const pplToInsert = ubPplList.map(p => {
      let assignedPmlId = null;
      if (p.pml_idx !== undefined && savedPmls[p.pml_idx]) {
        assignedPmlId = savedPmls[p.pml_idx].id;
      }
      return {
        nama: (p.nama || '').trim(),
        sobat_id: (p.sobat_id || '').trim(),
        nik: (p.nik || '').trim(),
        no_spk: (p.no_spk || '').trim(),
        no_bapp: (p.no_bapp || '').trim(),
        no_super: (p.no_super || '').trim(),
        target: parseInt(p.target) || 0,
        realisasi: parseInt(p.realisasi) || 0,
        screenshot: p.screenshot || null,
        crop_top: p.crop_top !== undefined ? p.crop_top : 12.5,
        crop_bottom: p.crop_bottom !== undefined ? p.crop_bottom : 46.5,
        role: 'ppl_ub',
        pml_id: assignedPmlId
      };
    }).filter(p => p.nama);

    if (pplToInsert.length > 0) {
      const { error } = await db.from('petugas_ub').insert(pplToInsert);
      if (error) throw error;
    }

    // 2. Save UB config
    const noSuratKepala = document.getElementById('ubNoSuratKepala')?.value.trim() || '';
    const tanggalSurat = document.getElementById('ubTanggalSurat')?.value.trim() || '31 Juli 2026';

    const configPayload = {
      nomor_surat_kepala: noSuratKepala,
      tanggal_surat: tanggalSurat,
      updated_at: new Date().toISOString()
    };

    if (ubConfig && ubConfig.id) {
      await db.from('dokumen_ub_config').update(configPayload).eq('id', ubConfig.id);
    } else {
      await db.from('dokumen_ub_config').insert([configPayload]);
    }

    showToast('Data Petugas & Konfigurasi Dokumen UB berhasil disimpan!', 'success');
    closeUBInputModal();
  } catch (err) {
    console.error('Error saving UB data:', err);
    showToast('Gagal menyimpan data UB: ' + err.message, 'error');
  }
}

// ------------------------------------------------------------
// UB DOCUMENT PREVIEW & DOWNLOAD FUNCTIONS
// ------------------------------------------------------------

// ------------------------------------------------------------
// UB DOCUMENT BUILDERS & GENERATOR FUNCTIONS
// ------------------------------------------------------------

function buildSuperPML_UB_Document(pdf, pml, pplsUnderPml, ttdYulianBase64) {
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN PENYELESAIAN", 105, 25, { align: "center" });
  pdf.text("PETUGAS PEMERIKSA LAPANGAN SENSUS EKONOMI 2026 TERMIN I", 105, 31, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${pml.no_super || "......./SE2026/.../.../2026"}`, 105, 38, { align: "center" });

  let y = 48;
  pdf.text("Yang bertanda tangan di bawah ini:", 25, y);

  y += 7;
  const labelX = 30;
  const colonX = 62;
  const valueX = 66;
  const lh = 5;

  const identitas = [
    ["Nama", (pml.nama || "").toUpperCase()],
    ["NIK", pml.nik || "....................................."],
    ["Jabatan", "Petugas Pemeriksa Lapangan Sensus Ekonomi 2026"]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], 185 - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 2;
  pdf.text("Dengan ini menyatakan:", 25, y);
  y += 6;

  const realisasi = pml.realisasi || 0;
  const target = pml.target || 0;
  const pct = target > 0 ? ((realisasi / target) * 100).toFixed(2) : '100.00';

  const poin = [
    `bahwa telah melaksanakan pekerjaan Petugas Pemeriksa Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Petugas Nomor: ${pml.no_spk || "....................................."}, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan dan pemeriksaan Petugas Pemeriksa Lapangan Sensus Ekonomi 2026 termin I yang telah diselesaikan sebanyak ${realisasi} UB dengan persentase sebesar ${pct} persen dari ${target} UB target prelist;`,
    `bahwa seluruh hasil pemeriksaan pekerjaan termin I adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const textWidth = 185 - 33;
  poin.forEach((teks, idx) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${idx + 1}.`, 25, y);
    drawJustifiedText(pdf, teks, 33, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup = "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";
  const penutupLines = pdf.splitTextToSize(penutup, 160);
  drawJustifiedText(pdf, penutup, 25, y, 160, 5);
  y += penutupLines.length + 6;

  const ttdY = y + 15;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);

  const ttdX = 155;
  pdf.text("Lebak, 23 Juli 2026", ttdX, ttdY, { align: "center" });
  pdf.text("Yang membuat pernyataan,", ttdX, ttdY + 5, { align: "center" });
  pdf.text((pml.nama || "").toUpperCase(), ttdX, ttdY + 33, { align: "center" });

  pdf.text("Mengetahui,", 25, ttdY + 40);
  pdf.text("Ketua Tim Pelaksana Sensus Ekonomi", 25, ttdY + 45);
  pdf.text("2026", 25, ttdY + 50);
  pdf.text("Kabupaten Lebak", 25, ttdY + 55);

  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', 30, ttdY + 56, 18, 25);
  }

  pdf.text("YULIAN SARWO EDI", 25, ttdY + 80);
  pdf.text("NIP. 197707101999121001", 25, ttdY + 85);
}

function buildSuperKepala_UB_Document(pdf, config, ttdYulianBase64) {
  pdf.setLineHeightFactor(1.0);
  const M = 25;
  const W = 160;

  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN KEPALA BPS KABUPATEN LEBAK", 105, 30, { align: "center" });
  pdf.text("PENYELESAIAN PELAKSANAAN SENSUS EKONOMI 2026 TERMIN I", 105, 36, { align: "center" });
  pdf.text("(PETUGAS USAHA BESAR)", 105, 42, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${config.nomor_surat_kepala || "B-003/3602/BAPP/07/2026"}`, 105, 50, { align: "center" });

  let y = 62;
  pdf.text("Yang bertanda tangan di bawah ini:", M, y);
  y += 8;

  const labelX = 30;
  const colonX = 62;
  const valueX = 66;

  const identitas = [
    ["Nama", "Eka Yulyani S.Si., M.Geog."],
    ["NIK", "196807261991012001"],
    ["Jabatan", "Kepala Badan Pusat Statistik Kabupaten Lebak Provinsi Banten"]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], 185 - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * 5;
  });

  y += 4;
  pdf.text("Dengan ini menyatakan bahwa:", M, y);
  y += 6;

  const poin = [
    `Seluruh Petugas Pemeriksa Lapangan (PML) dan Petugas Lapangan (PPL) Usaha Besar Sensus Ekonomi 2026 Badan Pusat Statistik Kabupaten Lebak telah menyelesaikan 100% target pendataan Lapangan Termin I.`,
    `Seluruh berkas dokumen hasil pendataan Usaha Besar telah diperiksa, disetujui, dan diunggah ke sistem database resmi BPS.`,
    `Pencairan honorarium petugas Usaha Besar Termin I dapat dilaksanakan sesuai ketentuan peraturan yang berlaku.`
  ];

  poin.forEach((teks, idx) => {
    const lines = pdf.splitTextToSize(teks, W - 8);
    pdf.text(`${idx + 1}.`, M, y);
    drawJustifiedText(pdf, teks, M + 8, y, W - 8, 5);
    y += lines.length * 5 + 2;
  });

  y += 4;
  const penutup = "Demikian Surat Pernyataan ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.";
  drawJustifiedText(pdf, penutup, M, y, W, 5);
  y += 18;

  const dateStr = config.tanggal_surat ? (config.tanggal_surat.includes('Lebak') ? config.tanggal_surat : `Lebak, ${config.tanggal_surat}`) : "Lebak, 23 Juli 2026";
  pdf.text(dateStr, 130, y);
  y += 6;
  pdf.text("Kepala Badan Pusat Statistik", 130, y);
  y += 5;
  pdf.text("Kabupaten Lebak", 130, y);
  y += 30;

  pdf.setFont("Bookman", "bold");
  pdf.text("EKA YULYANI S.Si., M.Geog.", 130, y);
  pdf.setFont("Bookman", "normal");
  y += 5;
  pdf.text("NIP. 196807261991012001", 130, y);
}

async function fetchUBOfficersData() {
  const { data: officers, error } = await db.from('petugas_ub').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  const { data: cfg } = await db.from('dokumen_ub_config').select('*').limit(1);
  const config = (cfg && cfg.length > 0) ? cfg[0] : { tanggal_surat: '31 Juli 2026' };
  return { officers: officers || [], config };
}

async function previewSuperPML_UB() {
  try {
    const { officers } = await fetchUBOfficersData();
    const pmls = officers.filter(o => o.role === 'pml_ub');

    if (pmls.length === 0) {
      showToast('Belum ada data PML UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Membuat preview Super PML UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      pmls.forEach((pml, idx) => {
        if (idx > 0) pdf.addPage('a4', 'portrait');
        const pplsUnderPml = officers.filter(o => o.role === 'ppl_ub' && o.pml_id === pml.id);
        buildSuperPML_UB_Document(pdf, pml, pplsUnderPml, ttdYulianBase64);
      });

      window.open(pdf.output('bloburl'), '_blank');
    });
  } catch (err) {
    showToast('Gagal membuat preview Super PML UB: ' + err.message, 'error');
  }
}

async function downloadSuperPML_UB() {
  try {
    const { officers } = await fetchUBOfficersData();
    const pmls = officers.filter(o => o.role === 'pml_ub');

    if (pmls.length === 0) {
      showToast('Belum ada data PML UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Mengunduh Super PML UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      pmls.forEach((pml, idx) => {
        if (idx > 0) pdf.addPage('a4', 'portrait');
        const pplsUnderPml = officers.filter(o => o.role === 'ppl_ub' && o.pml_id === pml.id);
        buildSuperPML_UB_Document(pdf, pml, pplsUnderPml, ttdYulianBase64);
      });

      pdf.save('super_pml_ub_termin1.pdf');
    });
  } catch (err) {
    showToast('Gagal mengunduh Super PML UB: ' + err.message, 'error');
  }
}

function buildSuperPPL_UB_Document(pdf, ppl, ttdYulianBase64) {
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN PENYELESAIAN", 105, 25, { align: "center" });
  pdf.text("PETUGAS LAPANGAN SENSUS EKONOMI 2026 TERMIN I", 105, 31, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${ppl.no_super || "......./SE2026/.../.../2026"}`, 105, 38, { align: "center" });

  let y = 48;
  pdf.text("Yang bertanda tangan di bawah ini:", 25, y);

  y += 7;
  const labelX = 30;
  const colonX = 62;
  const valueX = 66;
  const lh = 5;

  const identitas = [
    ["Nama", (ppl.nama || "").toUpperCase()],
    ["NIK", ppl.nik || "....................................."],
    ["Jabatan", "Petugas Lapangan Sensus Ekonomi 2026"]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], 185 - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 2;
  pdf.text("Dengan ini menyatakan:", 25, y);
  y += 6;

  const realisasi = ppl.realisasi || 0;
  const target = ppl.target || 0;
  const pct = target > 0 ? ((realisasi / target) * 100).toFixed(2) : '100.00';

  const poin = [
    `bahwa telah melaksanakan pekerjaan Petugas Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Petugas Nomor: ${ppl.no_spk || "....................................."}, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan Petugas Lapangan Sensus Ekonomi 2026 termin I yang telah diselesaikan sebanyak ${realisasi} UB dengan persentase sebesar ${pct} persen dari ${target} UB target prelist;`,
    `bahwa seluruh hasil pekerjaan termin I adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const textWidth = 185 - 33;
  poin.forEach((teks, idx) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${idx + 1}.`, 25, y);
    drawJustifiedText(pdf, teks, 33, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup = "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";
  const penutupLines = pdf.splitTextToSize(penutup, 160);
  drawJustifiedText(pdf, penutup, 25, y, 160, 5);
  y += penutupLines.length + 6;

  const ttdY = y + 15;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);

  const ttdX = 155;
  pdf.text("Lebak, 23 Juli 2026", ttdX, ttdY, { align: "center" });
  pdf.text("Yang membuat pernyataan,", ttdX, ttdY + 5, { align: "center" });
  pdf.text((ppl.nama || "").toUpperCase(), ttdX, ttdY + 33, { align: "center" });

  pdf.text("Mengetahui,", 25, ttdY + 40);
  pdf.text("Ketua Tim Pelaksana Sensus Ekonomi", 25, ttdY + 45);
  pdf.text("2026", 25, ttdY + 50);
  pdf.text("Kabupaten Lebak", 25, ttdY + 55);

  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', 30, ttdY + 56, 18, 25);
  }

  pdf.text("YULIAN SARWO EDI", 25, ttdY + 80);
  pdf.text("NIP. 197707101999121001", 25, ttdY + 85);
}

async function previewSuperPPL_UB() {
  try {
    const { officers } = await fetchUBOfficersData();
    const ppls = officers.filter(o => o.role === 'ppl_ub');

    if (ppls.length === 0) {
      showToast('Belum ada data PPL UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Membuat preview Super PPL UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      ppls.forEach((ppl, idx) => {
        if (idx > 0) pdf.addPage('a4', 'portrait');
        buildSuperPPL_UB_Document(pdf, ppl, ttdYulianBase64);
      });

      window.open(pdf.output('bloburl'), '_blank');
    });
  } catch (err) {
    showToast('Gagal membuat preview Super PPL UB: ' + err.message, 'error');
  }
}

async function downloadSuperPPL_UB() {
  try {
    const { officers } = await fetchUBOfficersData();
    const ppls = officers.filter(o => o.role === 'ppl_ub');

    if (ppls.length === 0) {
      showToast('Belum ada data PPL UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Mengunduh Super PPL UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      ppls.forEach((ppl, idx) => {
        if (idx > 0) pdf.addPage('a4', 'portrait');
        buildSuperPPL_UB_Document(pdf, ppl, ttdYulianBase64);
      });

      pdf.save('super_ppl_ub_termin1.pdf');
    });
  } catch (err) {
    showToast('Gagal mengunduh Super PPL UB: ' + err.message, 'error');
  }
}

async function previewSuperKepala_UB() {
  try {
    const { officers } = await fetchUBOfficersData();

    if (officers.length === 0) {
      showToast('Belum ada data Petugas UB.', 'warning');
      return;
    }

    previewSuperAllRows = officers.map(o => ({
      'Nama Petugas Lapangan': o.nama,
      'Sobat ID': o.sobat_id,
      'NIK': o.nik,
      'No SPK': o.no_spk || '',
      'No BAPP': o.no_bapp || '',
      'No Super': o.no_super || '',
      'Jabatan': o.role === 'pml_ub' ? 'PML UB' : 'PPL UB',
      'Kode Kecamatan': 'UB'
    }));
    previewSuperRowTypes = officers.map(o => o.role === 'pml_ub' ? 'pml' : 'ppl');

    const titleEl = document.getElementById('previewSuperTitle');
    if (titleEl) titleEl.textContent = 'Preview Rekapitulasi Petugas UB T1';

    filterPreviewSuper();

    const modal = document.getElementById('previewSuperModal');
    if (modal) modal.classList.add('open');
  } catch (err) {
    showToast('Gagal membuka preview Rekap UB: ' + err.message, 'error');
  }
}

async function exportSuperKepalaLampiran_UB_ToExcel() {
  try {
    const { officers } = await fetchUBOfficersData();

    if (officers.length === 0) {
      showToast('Belum ada data Petugas UB untuk di-export.', 'warning');
      return;
    }

    const rows = officers.map((o, idx) => ({
      'No': idx + 1,
      'Nama Petugas Lapangan': o.nama,
      'Sobat ID': o.sobat_id,
      'NIK': o.nik,
      'Jabatan': o.role === 'pml_ub' ? 'PML UB' : 'PPL UB',
      'No SPK': o.no_spk || '',
      'No BAPP': o.no_bapp || '',
      'No Super': o.no_super || '',
      'Status': 'Petugas Usaha Besar'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Petugas UB');
    XLSX.writeFile(wb, 'rekapitulasi_petugas_ub_termin1.xlsx');
    showToast('Export Excel Rekap Petugas UB berhasil!', 'success');
  } catch (err) {
    showToast('Gagal export Excel UB: ' + err.message, 'error');
  }
}

async function generateBAPP_UB_LandscapePDF(pdf, officers) {
  const loadImgAsBase64 = (url) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = url;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => {
        resolve(null);
      };
    });
  };

  const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
  const ttdNingBase64 = await loadImgAsBase64('assets/ttd/ning sl.png') || await loadImgAsBase64('assets/ning_sri_lestari.png');

  for (let i = 0; i < officers.length; i++) {
    const r = officers[i];
    if (i > 0) {
      pdf.addPage();
    }
    const nama = (r.nama || '.........................................').toUpperCase();
    pdf.setFont('times', 'normal');
    pdf.setFontSize(11);
    pdf.text('-4-', 148.5, 12, { align: 'center' });
    pdf.setFont('times', 'bold');
    pdf.setFontSize(12);
    pdf.text('II. BUKTI PENCAPAIAN PEKERJAAN PETUGAS UB', 20, 20);

    if (r.screenshot) {
      if (r.crop_top === undefined || r.crop_top === null) {
        showToast(`Memindai OCR BAPP UB (${i + 1}/${officers.length})...`, 'info');
        const bounds = await detectCropBoundsUB(r.screenshot);
        r.crop_top = bounds.top;
        r.crop_bottom = bounds.bottom;
      }

      await new Promise((resolve) => {
        const img = new Image();
        img.src = r.screenshot;
        img.onload = () => {
          const topOffset = (r.crop_top !== undefined && r.crop_top !== null) ? parseFloat(r.crop_top) : 12.5;
          const bottomOffset = (r.crop_bottom !== undefined && r.crop_bottom !== null) ? parseFloat(r.crop_bottom) : 46.5;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const origW = img.naturalWidth;
          const origH = img.naturalHeight;
          const cropHeightPercent = bottomOffset - topOffset;
          const cropHeight = origH * (cropHeightPercent / 100);
          const startY = origH * (topOffset / 100);
          canvas.width = origW;
          canvas.height = cropHeight;
          ctx.drawImage(img, 0, startY, origW, cropHeight, 0, 0, origW, cropHeight);
          const croppedBase64 = canvas.toDataURL('image/png');
          const cropRatio = (origH / origW) * (cropHeightPercent / 100);
          const imgHeight = 60.0;
          const imgWidth = imgHeight / cropRatio;
          const imgX = (297 - imgWidth) / 2;
          const imgY = 28.0;
          pdf.addImage(croppedBase64, 'PNG', imgX, imgY, imgWidth, imgHeight);
          pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
          resolve();
        };
        img.onerror = () => {
          resolve();
        };
      });
    } else {
      const imgHeight = 60.0;
      const imgWidth = 80.0;
      const imgX = (297 - imgWidth) / 2;
      const imgY = 28.0;
      pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
      pdf.setFont('times', 'italic');
      pdf.setFontSize(10);
      pdf.text('[Bukti Screenshot Tidak Tersedia]', 148.5, imgY + 30, { align: 'center' });
    }

    const sigY = 120.0;
    pdf.setFont('times', 'normal');
    pdf.setFontSize(11);
    pdf.text('PIHAK KEDUA,', 70, sigY, { align: 'center' });
    pdf.text('PIHAK PERTAMA,', 227, sigY, { align: 'center' });
    if (ttdYulianBase64) {
      const ttdX = 177.5 + (100 - 20) / 2;
      pdf.addImage(ttdYulianBase64, 'PNG', ttdX, sigY + 0, 20, 30);
    }
    if (ttdNingBase64) {
      const ttdX = 87 + (100 - 32) / 2;
      pdf.addImage(ttdNingBase64, 'PNG', ttdX, sigY + 38, 50, 25);
    }
    pdf.setFont('times', 'bold');
    pdf.text(nama, 70, sigY + 25, { align: 'center' });
    const leftWidth = pdf.getTextWidth(nama);
    pdf.setLineWidth(0.3);
    pdf.line(70 - leftWidth / 2, sigY + 26, 70 + leftWidth / 2, sigY + 26);
    pdf.text('YULIAN SARWO EDI', 227, sigY + 25, { align: 'center' });
    const rightWidth = pdf.getTextWidth('YULIAN SARWO EDI');
    pdf.line(227 - rightWidth / 2, sigY + 26, 227 + rightWidth / 2, sigY + 26);
    pdf.setFont('times', 'normal');
    pdf.text('Menyetujui,', 148.5, sigY + 33, { align: 'center' });
    pdf.text('Pejabat Pembuat Komitmen', 148.5, sigY + 38, { align: 'center' });
    pdf.setFont('times', 'bold');
    pdf.text('NING SRI LESTARI', 148.5, sigY + 63, { align: 'center' });
    const ppkWidth = pdf.getTextWidth('NING SRI LESTARI');
    pdf.line(148.5 - ppkWidth / 2, sigY + 64, 148.5 + ppkWidth / 2, sigY + 64);
  }
}

async function previewBAPP_UB() {
  try {
    const { officers } = await fetchUBOfficersData();

    if (officers.length === 0) {
      showToast('Belum ada data Petugas UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Membuat preview BAPP Seluruh Petugas UB...', 'info');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      await generateBAPP_UB_LandscapePDF(pdf, officers);
      window.open(pdf.output('bloburl'), '_blank');
    });
  } catch (err) {
    showToast('Gagal membuat preview BAPP UB: ' + err.message, 'error');
  }
}

async function downloadBAPP_UB() {
  try {
    const { officers } = await fetchUBOfficersData();

    if (officers.length === 0) {
      showToast('Belum ada data Petugas UB. Silakan klik "Input Data Petugas UB".', 'warning');
      return;
    }

    showToast('Mengunduh BAPP Seluruh Petugas UB...', 'info');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      await generateBAPP_UB_LandscapePDF(pdf, officers);
      pdf.save('bapp_petugas_ub_termin1.pdf');
    });
  } catch (err) {
    showToast('Gagal mengunduh BAPP UB: ' + err.message, 'error');
  }
}

async function previewSuperKepalaDoc_UB() {
  try {
    const { config } = await fetchUBOfficersData();
    showToast('Membuat preview Super Kepala UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);
      buildSuperKepala_UB_Document(pdf, config, ttdYulianBase64);
      window.open(pdf.output('bloburl'), '_blank');
    });
  } catch (err) {
    showToast('Gagal membuat preview Super Kepala UB: ' + err.message, 'error');
  }
}

async function downloadSuperKepalaDoc_UB() {
  try {
    const { config } = await fetchUBOfficersData();
    showToast('Mengunduh Super Kepala UB...', 'info');
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
    loadJsPDF(async () => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);
      buildSuperKepala_UB_Document(pdf, config, ttdYulianBase64);
      pdf.save('super_kepala_ub_termin1.pdf');
    });
  } catch (err) {
    showToast('Gagal mengunduh Super Kepala UB: ' + err.message, 'error');
  }
}



// =====================================================
// CUSTOM SUPER PPL GENERATOR
// Allows selecting a single PPL, manually entering
// capaian and tanggal surat, then generating a PDF.
// =====================================================

let _customPPLList = []; // cache of all active PPLs with no_surat data

async function openCustomSuperPPLModal() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan menggunakan fitur ini.', 'warning');
    return;
  }

  const modal = document.getElementById('customSuperPPLModal');
  if (!modal) return;

  // Reset form
  document.getElementById('customPPLSelect').value = '';
  document.getElementById('customPPLInfoBox').style.display = 'none';
  document.getElementById('customPPLNIK').textContent = '—';
  document.getElementById('customPPLSobatID').textContent = '—';
  document.getElementById('customPPLNoSPK').textContent = '—';
  document.getElementById('customPPLNoSP').textContent = '—';
  document.getElementById('customPPLTarget').value = '';
  document.getElementById('customPPLRealisasi').value = '';
  document.getElementById('customPPLPctPreview').style.display = 'none';
  document.getElementById('customPPLTanggal').value = '';

  modal.classList.add('open');

  // Populate dropdown if not yet loaded
  const select = document.getElementById('customPPLSelect');
  if (select.options.length <= 1) {
    select.innerHTML = '<option value="">⏳ Memuat daftar PPL...</option>';
    try {
      // Fetch all active PPL profiles
      let profiles = [];
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await db.from('profiles')
          .select('id, sobatid, nama, nik, email_ref')
          .eq('role', 'ppl')
          .eq('is_active', true)
          .order('nama', { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        if (!data || data.length === 0) {
          hasMore = false;
        } else {
          profiles = profiles.concat(data);
          if (data.length < 1000) hasMore = false;
          else from += 1000;
        }
      }

      // Fetch no_surat_se for all PPLs
      const sobatids = profiles.map(p => String(p.sobatid || '').trim()).filter(Boolean);
      let noSuratMap = {};
      const chunk = 500;
      for (let i = 0; i < sobatids.length; i += chunk) {
        const sl = sobatids.slice(i, i + chunk);
        const { data, error } = await db.from('no_surat_se')
          .select('sobatid, no_spk, no_sp_pemeriksaan_t1')
          .in('sobatid', sl);
        if (error) throw error;
        if (data) {
          data.forEach(n => {
            noSuratMap[String(n.sobatid).trim()] = n;
          });
        }
      }

      // Also use allUsers kecamatan info
      const kecMap = {};
      (allUsers || []).forEach(u => {
        if (u.role === 'ppl') kecMap[u.id] = u.kecamatan || '—';
      });

      _customPPLList = profiles.map(p => {
        const key = String(p.sobatid || '').trim();
        return {
          id: p.id,
          nama: p.nama || '',
          sobatid: p.sobatid || '',
          nik: p.nik || '',
          kecamatan: kecMap[p.id] || '—',
          no_spk: noSuratMap[key]?.no_spk || '',
          no_sp_pemeriksaan_t1: noSuratMap[key]?.no_sp_pemeriksaan_t1 || ''
        };
      });

      select.innerHTML = '<option value="">-- Pilih PPL --</option>' +
        _customPPLList.map((p, i) =>
          `<option value="${i}">${escHtml(p.nama)}${p.kecamatan && p.kecamatan !== '—' ? ' — ' + escHtml(p.kecamatan) : ''}</option>`
        ).join('');
    } catch (err) {
      console.error('Gagal memuat daftar PPL:', err);
      select.innerHTML = '<option value="">-- Gagal memuat, coba lagi --</option>';
      showToast('Gagal memuat daftar PPL: ' + err.message, 'error');
    }
  }
}

function onCustomPPLSelectChange() {
  const select = document.getElementById('customPPLSelect');
  const idx = select.value;
  const infoBox = document.getElementById('customPPLInfoBox');

  if (idx === '' || _customPPLList.length === 0) {
    infoBox.style.display = 'none';
    return;
  }

  const ppl = _customPPLList[parseInt(idx)];
  if (!ppl) { infoBox.style.display = 'none'; return; }

  document.getElementById('customPPLNIK').textContent = ppl.nik || '—';
  document.getElementById('customPPLSobatID').textContent = ppl.sobatid || '—';
  document.getElementById('customPPLNoSPK').textContent = ppl.no_spk || '(belum diisi)';
  document.getElementById('customPPLNoSP').textContent = ppl.no_sp_pemeriksaan_t1 || '(belum diisi)';
  infoBox.style.display = '';
}

function updateCustomPPLPct() {
  const target = parseInt(document.getElementById('customPPLTarget').value) || 0;
  const real = parseInt(document.getElementById('customPPLRealisasi').value) || 0;
  const pctPreview = document.getElementById('customPPLPctPreview');
  const pctVal = document.getElementById('customPPLPctValue');

  if (target > 0 || real > 0) {
    const pct = target > 0 ? ((real / target) * 100).toFixed(2) : '0.00';
    pctVal.textContent = pct + '%';
    pctPreview.style.display = '';
  } else {
    pctPreview.style.display = 'none';
  }
}

function closeCustomSuperPPLModal() {
  const modal = document.getElementById('customSuperPPLModal');
  if (modal) modal.classList.remove('open');
}

async function generateCustomSuperPPL(isDownload = false) {
  const select = document.getElementById('customPPLSelect');
  const idx = select.value;

  if (idx === '') {
    showToast('Pilih PPL terlebih dahulu.', 'warning');
    return;
  }

  const ppl = _customPPLList[parseInt(idx)];
  if (!ppl) {
    showToast('PPL tidak ditemukan, coba muat ulang.', 'error');
    return;
  }

  const target = parseInt(document.getElementById('customPPLTarget').value) || 0;
  const realisasi = parseInt(document.getElementById('customPPLRealisasi').value) || 0;
  const tanggal = (document.getElementById('customPPLTanggal').value || '').trim();

  if (!tanggal) {
    showToast('Masukkan tanggal surat terlebih dahulu.', 'warning');
    return;
  }

  // Build ppl-like object for buildSuperPPLDocument
  const pplObj = {
    nama: ppl.nama,
    sobatid: ppl.sobatid,
    nik: ppl.nik,
    no_spk: ppl.no_spk,
    no_sp_pemeriksaan_t1: ppl.no_sp_pemeriksaan_t1,
    target,
    realisasi,
    capaian_pct: target > 0 ? (realisasi / target) * 100 : 0
  };

  const safeNama = (ppl.nama || 'custom_ppl').toLowerCase().replace(/\s+/g, '_');

  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `
        position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #7c3aed;
        color: #f8fafc; padding: 14px 20px; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
        z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;
        font-family: system-ui, sans-serif; font-weight: 500; transition: all 0.3s ease;
      `;
      document.body.appendChild(indicator);
    }

    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Membuat PDF Custom Super PPL...`;

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      // Use a special wrapper that passes custom tanggal
      buildSuperPPLDocumentCustom(pdf, pplObj, ttdYulianBase64, tanggal);

      indicator.style.borderColor = '#7c3aed';
      indicator.style.color = '#a855f7';
      indicator.innerHTML = '✓ PDF Custom Super PPL siap!';

      if (isDownload) {
        pdf.save(`custom_super_ppl_${safeNama}.pdf`);
      } else {
        window.open(pdf.output('bloburl'), '_blank');
      }

      setTimeout(() => { indicator.remove(); }, 2500);
    } catch (err) {
      console.error('Gagal generate Custom Super PPL:', err);
      indicator.style.borderColor = '#ef4444';
      indicator.style.color = '#ef4444';
      indicator.innerHTML = 'Gagal membuat PDF: ' + err.message;
      setTimeout(() => { indicator.remove(); }, 4000);
    }
  });
}

/**
 * Identical to buildSuperPPLDocument but accepts a custom tanggal string
 * instead of deriving it from gelombang number.
 */
function buildSuperPPLDocumentCustom(pdf, ppl, ttdYulianBase64, tanggalStr) {
  // Normalize tanggal: prepend "Lebak, " if not already present
  const dateStr = tanggalStr.startsWith('Lebak')
    ? tanggalStr
    : `Lebak, ${tanggalStr}`;

  pdf.setFont('Bookman', 'bold');
  pdf.setFontSize(12);
  pdf.text('SURAT PERNYATAAN PENYELESAIAN', 105, 25, { align: 'center' });
  pdf.text('PETUGAS LAPANGAN SENSUS EKONOMI 2026 TERMIN I', 105, 31, { align: 'center' });

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${ppl.no_sp_pemeriksaan_t1 || '......./SE2026/.../.../2026'}`, 105, 38, { align: 'center' });

  let y = 48;
  pdf.text('Yang bertanda tangan di bawah ini:', 25, y);

  y += 7;
  const labelX = 30;
  const colonX = 62;
  const valueX = 66;
  const lh = 5;

  const identitas = [
    ['Nama', (ppl.nama || '').toUpperCase()],
    ['NIK', ppl.nik || '.....................................'],
    ['Jabatan', 'Petugas Lapangan Sensus Ekonomi 2026']
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(':', colonX, y);
    const wrap = pdf.splitTextToSize(item[1], 185 - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 2;
  pdf.text('Dengan ini menyatakan:', 25, y);
  y += 6;

  const poin = [
    `bahwa telah melaksanakan pekerjaan Petugas Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Petugas Nomor: ${ppl.no_spk || '.....................................'}, sesuai dengan target pekerjaan termin I;`,
    `bahwa hasil pekerjaan Petugas Lapangan Sensus Ekonomi 2026 termin I yang telah diselesaikan sebanyak ${ppl.realisasi} usaha dan keluarga dengan presentase sebesar ${ppl.capaian_pct.toFixed(2)} persen dari ${ppl.target} usaha dan keluarga target prelist;`,
    `bahwa seluruh hasil pekerjaan termin I adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const textWidth = 185 - 33;
  poin.forEach((teks, idx) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${idx + 1}.`, 25, y);
    drawJustifiedText(pdf, teks, 33, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup = 'Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.';
  const penutupLines = pdf.splitTextToSize(penutup, 160);
  drawJustifiedText(pdf, penutup, 25, y, 160, 5);
  y += penutupLines.length + 6;

  // Tanda Tangan
  const ttdY = y + 15;
  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(12);

  const ttdX = 155;
  pdf.text(dateStr, ttdX, ttdY, { align: 'center' });
  pdf.text('Yang membuat pernyataan,', ttdX, ttdY + 5, { align: 'center' });
  pdf.text((ppl.nama || '').toUpperCase(), ttdX, ttdY + 33, { align: 'center' });

  pdf.text('Mengetahui,', 25, ttdY + 40);
  pdf.text('Ketua Tim Pelaksana Sensus Ekonomi', 25, ttdY + 45);
  pdf.text('2026', 25, ttdY + 50);
  pdf.text('Kabupaten Lebak', 25, ttdY + 55);

  if (ttdYulianBase64) {
    pdf.addImage(ttdYulianBase64, 'PNG', 30, ttdY + 56, 18, 25);
  }

  pdf.text('YULIAN SARWO EDI', 25, ttdY + 80);
  pdf.text('NIP. 197707101999121001', 25, ttdY + 85);
}

// ============================================================
// TERMIN II FUNCTIONS & BAST MODULE
// ============================================================

/**
 * 1. Inisialisasi Snapshot Termin 2
 * Menyalin data user_sls aktif ke user_sls_termin2 dengan user_id_asal = user_id
 */
async function inisialisasiTermin2() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang dapat melakukan inisialisasi Termin 2.', 'warning');
    return;
  }

  // Cek apakah sudah pernah diinisialisasi
  const { count, error: countErr } = await db.from('user_sls_termin2').select('*', { count: 'exact', head: true });
  if (!countErr && count && count > 0) {
    showToast(`Snapshot Termin 2 sudah aktif (${count} penugasan). Snapshot hanya dilakukan 1x di awal agar histori Termin 1 terkunci.`, 'info');
    updateSnapshotBtnState(true);
    return;
  }

  const konfirmasi = confirm(
    "Apakah Anda yakin ingin melakukan Inisialisasi Snapshot Termin 2?\n\n" +
    "Sistem akan menyalin seluruh penugasan user_sls ke tabel user_sls_termin2 sebagai basis awal penugasan Termin 2. " +
    "Setelah ini, penugasan Termin 1 akan terkunci permanen."
  );
  if (!konfirmasi) return;

  showToast('Memulai inisialisasi snapshot Termin 2...', 'info');

  try {
    let allActiveSls = [];
    let from = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await db.from('user_sls')
        .select('user_id, kode_sls, status')
        .eq('status', 'aktif')
        .range(from, from + 999);
      if (error) throw error;
      if (!data || data.length === 0) hasMore = false;
      else {
        allActiveSls = allActiveSls.concat(data);
        if (data.length < 1000) hasMore = false;
        else from += 1000;
      }
    }

    if (allActiveSls.length === 0) {
      showToast('Tidak ada data user_sls aktif yang ditemukan.', 'warning');
      return;
    }

    const toInsert = allActiveSls.map(x => ({
      user_id: x.user_id,
      kode_sls: x.kode_sls,
      status: x.status || 'aktif',
      user_id_asal: x.user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    const chunkSize = 500;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const { error } = await db.from('user_sls_termin2').insert(chunk);
      if (error) throw error;
    }

    showToast(`✅ Berhasil menginisialisasi ${toInsert.length} data penugasan ke Termin 2!`, 'success');
    updateSnapshotBtnState(true);
    isBappEligibilityLoadedT2 = false;
  } catch (err) {
    console.error('Gagal inisialisasi Termin 2:', err);
    showToast('Gagal inisialisasi Termin 2: ' + err.message, 'error');
  }
}

function updateSnapshotBtnState(isCompleted) {
  const btn = document.getElementById('btnInisiasiT2');
  if (!btn) return;
  if (isCompleted) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
      Snapshot T2 Sudah Diinisiasi
    `;
  }
}




/**
 * 3. Generate Data Laporan LK Beban Kerja Termin 2 Murni
 */
async function generateCapaianReportDataT2(gelombang = 1) {
  await loadBappEligibilityDataT2(true);

  // Ambil data penugasan T2
  let userSlsT2 = [];
  let fromSls = 0;
  let hasMoreSls = true;
  while (hasMoreSls) {
    const { data, error } = await db.from('user_sls_termin2').select('user_id, kode_sls').eq('status', 'aktif').range(fromSls, fromSls + 999);
    if (!error && data && data.length > 0) {
      userSlsT2 = userSlsT2.concat(data);
      if (data.length < 1000) hasMoreSls = false;
      else fromSls += 1000;
    } else {
      hasMoreSls = false;
    }
  }

  const userSlsMap = {};
  userSlsT2.forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  // Ambil capaian_termin2
  let capaianT2 = [];
  let fromCap = 0;
  let hasMoreCap = true;
  while (hasMoreCap) {
    const { data, error } = await db.from('capaian_termin2').select('*').range(fromCap, fromCap + 999);
    if (!error && data && data.length > 0) {
      capaianT2 = capaianT2.concat(data);
      if (data.length < 1000) hasMoreCap = false;
      else fromCap += 1000;
    } else {
      hasMoreCap = false;
    }
  }

  const prelistMap = {};
  const baruMap = {};
  const hasilMap = {};
  const targetMap = {};
  const slsSelesaiMap = {};
  capaianT2.forEach(c => {
    prelistMap[c.kode_subsls] = c[`prelist${gelombang}`] || 0;
    baruMap[c.kode_subsls] = c[`baru${gelombang}`] || 0;
    hasilMap[c.kode_subsls] = c[`hasilverif${gelombang}`] || 0;
    targetMap[c.kode_subsls] = c.targetsls || 0;
    slsSelesaiMap[c.kode_subsls] = c[`sls_selesai${gelombang}`] || 0;
  });

  // Ambil PML-PPL dengan paginasi penuh
  let relations = [];
  let fromRel = 0;
  let hasMoreRel = true;
  while (hasMoreRel) {
    const { data, error } = await db.from('pml_ppl').select('pml_id, ppl_id').range(fromRel, fromRel + 999);
    if (!error && data && data.length > 0) {
      relations = relations.concat(data);
      if (data.length < 1000) hasMoreRel = false;
      else fromRel += 1000;
    } else {
      hasMoreRel = false;
    }
  }

  const pmlToPpl = {};
  relations.forEach(r => {
    if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = new Set();
    pmlToPpl[r.pml_id].add(r.ppl_id);
  });

  // Ambil data profiles (PML & PPL) dengan paginasi penuh
  let allOfficers = [];
  let fromProf = 0;
  let hasMoreProf = true;
  while (hasMoreProf) {
    const { data, error } = await db.from('profiles').select('id, sobatid, nama, email_ref, role, kabupaten').in('role', ['ppl', 'pml']).range(fromProf, fromProf + 999);
    if (!error && data && data.length > 0) {
      allOfficers = allOfficers.concat(data);
      if (data.length < 1000) hasMoreProf = false;
      else fromProf += 1000;
    } else {
      hasMoreProf = false;
    }
  }

  const profileMap = {};
  allOfficers.forEach(p => {
    profileMap[p.id] = p;
  });

  const pmlUsers = allOfficers.filter(u => u.role === 'pml');
  const pplUsers = allOfficers.filter(u => u.role === 'ppl');

  const getProfileKec = (id) => {
    const codes = userSlsMap[id] || [];
    return (codes.length > 0 && codes[0].length >= 7) ? codes[0].substring(4, 7) : '';
  };
  const getPmlKec = (pmlId) => {
    const pplIds = Array.from(pmlToPpl[pmlId] || []);
    for (const pplId of pplIds) {
      const kec = getProfileKec(pplId);
      if (kec) return kec;
    }
    return '';
  };

  const excelRows = [];
  const rowTypes = [];
  let grandTotalPrelist = 0;
  let grandTotalBaru = 0;
  let grandTotalHasil = 0;
  let grandTotalTargetSls = 0;
  let grandTotalSlsCount = 0;
  let grandTotalSlsSelesaiSum = 0;

  const renderedPplIds = new Set();

  // Urutkan PML berdasarkan Kode Kecamatan, lalu Nama PML
  pmlUsers.sort((a, b) => {
    const kecA = getPmlKec(a.id) || '999';
    const kecB = getPmlKec(b.id) || '999';
    if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
    return (a.nama || '').localeCompare(b.nama || '', undefined, { sensitivity: 'base' });
  });

  // 1. Render PML & PPL yang terhubung
  pmlUsers.forEach(pml => {
    const pplIds = Array.from(pmlToPpl[pml.id] || []);
    if (pplIds.length === 0) return;

    let pmlSubtotalPrelist = 0;
    let pmlSubtotalBaru = 0;
    let pmlSubtotalHasil = 0;
    let pmlSubtotalTargetSls = 0;
    let pmlSlsCount = 0;
    let pmlSlsSelesaiSum = 0;
    let hasVisiblePpl = false;

    // Urutkan PPL di bawah PML ini berdasarkan Kode Kec, lalu Nama PPL
    const sortedPplIds = pplIds
      .filter(id => profileMap[id])
      .sort((a, b) => {
        const kecA = getProfileKec(a) || '999';
        const kecB = getProfileKec(b) || '999';
        if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
        return (profileMap[a].nama || '').localeCompare(profileMap[b].nama || '', undefined, { sensitivity: 'base' });
      });

    sortedPplIds.forEach(pplId => {
      if (renderedPplIds.has(pplId)) return;
      const ppl = profileMap[pplId];
      if (!ppl) return;
      renderedPplIds.add(ppl.id);
      const codes = [...(userSlsMap[ppl.id] || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (codes.length === 0) {
        excelRows.push({
          'Nama PML': pml.nama,
          'Email PML': pml.email_ref || '—',
          'Nama PPL': ppl.nama,
          'Email PPL': ppl.email_ref || '—',
          'Kode Kec': '—',
          'Kode Desa': '—',
          'Kode SLS+SubSLS': '—',
          'Prelist': 0,
          'Baru': 0,
          'Hasil Verif': 0,
          'Target SLS': 0,
          'SLS Selesai (%)': '0%'
        });
        rowTypes.push('data');
        hasVisiblePpl = true;
      } else {
        codes.forEach(code => {
          const prelist = prelistMap[code] || 0;
          const baru = baruMap[code] || 0;
          const hasil = hasilMap[code] || 0;
          const tgtSls = targetMap[code] || 0;
          const selesai = slsSelesaiMap[code] || 0;

          pmlSubtotalPrelist += prelist;
          pmlSubtotalBaru += baru;
          pmlSubtotalHasil += hasil;
          pmlSubtotalTargetSls += tgtSls;
          pmlSlsCount++;
          pmlSlsSelesaiSum += selesai;

          excelRows.push({
            'Nama PML': pml.nama,
            'Email PML': pml.email_ref || '—',
            'Nama PPL': ppl.nama,
            'Email PPL': ppl.email_ref || '—',
            'Kode Kec': code.substring(4, 7),
            'Kode Desa': code.substring(7, 10),
            'Kode SLS+SubSLS': code.substring(10, 16),
            'Prelist': prelist,
            'Baru': baru,
            'Hasil Verif': hasil,
            'Target SLS': tgtSls,
            'SLS Selesai (%)': `${selesai}%`
          });
          rowTypes.push('data');
          hasVisiblePpl = true;
        });
      }
    });

    if (hasVisiblePpl) {
      const avgSelesai = pmlSlsCount > 0 ? (pmlSlsSelesaiSum / pmlSlsCount).toFixed(2) + '%' : '0%';
      excelRows.push({
        'Nama PML': `SUB TOTAL PML: ${pml.nama}`,
        'Email PML': '',
        'Nama PPL': '',
        'Email PPL': '',
        'Kode Kec': '',
        'Kode Desa': '',
        'Kode SLS+SubSLS': '',
        'Prelist': pmlSubtotalPrelist,
        'Baru': pmlSubtotalBaru,
        'Hasil Verif': pmlSubtotalHasil,
        'Target SLS': pmlSubtotalTargetSls,
        'SLS Selesai (%)': avgSelesai
      });
      rowTypes.push('subtotal_pml');

      grandTotalPrelist += pmlSubtotalPrelist;
      grandTotalBaru += pmlSubtotalBaru;
      grandTotalHasil += pmlSubtotalHasil;
      grandTotalTargetSls += pmlSubtotalTargetSls;
      grandTotalSlsCount += pmlSlsCount;
      grandTotalSlsSelesaiSum += pmlSlsSelesaiSum;
    }
  });

  // 2. Render PPL yang belum terpetakan ke PML manapun (jika ada)
  const remainingPpls = pplUsers.filter(u => !renderedPplIds.has(u.id) && (userSlsMap[u.id] || []).length > 0);
  if (remainingPpls.length > 0) {
    remainingPpls.sort((a, b) => {
      const kecA = getProfileKec(a.id) || '999';
      const kecB = getProfileKec(b.id) || '999';
      if (kecA !== kecB) return kecA.localeCompare(kecB, undefined, { numeric: true });
      return (a.nama || '').localeCompare(b.nama || '', undefined, { sensitivity: 'base' });
    });

    let unmappedPrelist = 0;
    let unmappedBaru = 0;
    let unmappedHasil = 0;
    let unmappedTargetSls = 0;
    let unmappedSlsCount = 0;
    let unmappedSlsSelesaiSum = 0;

    remainingPpls.forEach(ppl => {
      const codes = [...(userSlsMap[ppl.id] || [])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      codes.forEach(code => {
        const prelist = prelistMap[code] || 0;
        const baru = baruMap[code] || 0;
        const hasil = hasilMap[code] || 0;
        const tgtSls = targetMap[code] || 0;
        const selesai = slsSelesaiMap[code] || 0;

        unmappedPrelist += prelist;
        unmappedBaru += baru;
        unmappedHasil += hasil;
        unmappedTargetSls += tgtSls;
        unmappedSlsCount++;
        unmappedSlsSelesaiSum += selesai;

        excelRows.push({
          'Nama PML': 'TANPA PML',
          'Email PML': '—',
          'Nama PPL': ppl.nama,
          'Email PPL': ppl.email_ref || '—',
          'Kode Kec': code.substring(4, 7),
          'Kode Desa': code.substring(7, 10),
          'Kode SLS+SubSLS': code.substring(10, 16),
          'Prelist': prelist,
          'Baru': baru,
          'Hasil Verif': hasil,
          'Target SLS': tgtSls,
          'SLS Selesai (%)': `${selesai}%`
        });
        rowTypes.push('data');
      });
    });

    const avgUnmappedSelesai = unmappedSlsCount > 0 ? (unmappedSlsSelesaiSum / unmappedSlsCount).toFixed(2) + '%' : '0%';
    excelRows.push({
      'Nama PML': 'SUB TOTAL TANPA PML',
      'Email PML': '',
      'Nama PPL': '',
      'Email PPL': '',
      'Kode Kec': '',
      'Kode Desa': '',
      'Kode SLS+SubSLS': '',
      'Prelist': unmappedPrelist,
      'Baru': unmappedBaru,
      'Hasil Verif': unmappedHasil,
      'Target SLS': unmappedTargetSls,
      'SLS Selesai (%)': avgUnmappedSelesai
    });
    rowTypes.push('subtotal_pml');

    grandTotalPrelist += unmappedPrelist;
    grandTotalBaru += unmappedBaru;
    grandTotalHasil += unmappedHasil;
    grandTotalTargetSls += unmappedTargetSls;
    grandTotalSlsCount += unmappedSlsCount;
    grandTotalSlsSelesaiSum += unmappedSlsSelesaiSum;
  }

  // 4 Petugas Pengganti Khusus (Masing-masing 2 baris kosong untuk entri/penyesuaian manual)
  for (let p = 1; p <= 4; p++) {
    for (let r = 1; r <= 2; r++) {
      excelRows.push({
        'Nama PML': '',
        'Email PML': '',
        'Nama PPL': `................................................ (Petugas Pengganti ${p} - Baris ${r})`,
        'Email PPL': '',
        'Kode Kec': '',
        'Kode Desa': '',
        'Kode SLS+SubSLS': '',
        'Prelist': '',
        'Baru': '',
        'Hasil Verif': '',
        'Target SLS': '',
        'SLS Selesai (%)': ''
      });
      rowTypes.push('data');
    }
  }

  const grandAvgSelesai = grandTotalSlsCount > 0 ? (grandTotalSlsSelesaiSum / grandTotalSlsCount).toFixed(2) + '%' : '0%';
  excelRows.push({
    'Nama PML': 'TOTAL KABUPATEN (TERMIN II)',
    'Email PML': '',
    'Nama PPL': '',
    'Email PPL': '',
    'Kode Kec': '',
    'Kode Desa': '',
    'Kode SLS+SubSLS': '',
    'Prelist': grandTotalPrelist,
    'Baru': grandTotalBaru,
    'Hasil Verif': grandTotalHasil,
    'Target SLS': grandTotalTargetSls,
    'SLS Selesai (%)': grandAvgSelesai
  });
  rowTypes.push('grand_total');

  return { excelRows, rowTypes };
}

/**
 * 4. Preview LK Beban Kerja T2
 */
async function previewCapaianT2(gelombang = 1) {
  const modal = document.getElementById('previewLkModal');
  const title = document.getElementById('previewLkTitle');
  const tbody = document.getElementById('previewLkTableBody');
  const searchInput = document.getElementById('previewLkSearch');

  previewLkGelombang = gelombang;
  previewLkCurrentPage = 1;
  if (searchInput) searchInput.value = '';

  if (title) title.textContent = `Preview LK Beban Kerja Termin II - Gelombang ${gelombang}`;
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:2rem"><span class="spinner"></span> Memuat data Termin II...</td></tr>';
  }
  if (modal) modal.classList.add('open');

  try {
    const { excelRows, rowTypes } = await generateCapaianReportDataT2(gelombang);
    previewLkAllRows = excelRows;
    previewLkRowTypes = rowTypes;
    filterPreviewLk();
  } catch (err) {
    console.error('Preview error T2:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--error)">Gagal memuat: ${err.message}</td></tr>`;
  }
}

async function exportCapaianT2ToExcel(gelombang = 1) {
  showToast(`Memproses ekspor LK Beban Kerja Termin II Gelombang ${gelombang}...`, 'info');
  try {
    const { excelRows, rowTypes } = await generateCapaianReportDataT2(gelombang);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);

    // Styling subtotal & grand total
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const type = rowTypes[R - 1];
      let cellStyle = null;

      if (type === 'subtotal_pml') {
        cellStyle = {
          fill: { fgColor: { rgb: "D9E1F2" } },
          font: { bold: true, color: { rgb: "1F4E78" } },
          border: {
            top: { style: "thin", color: { rgb: "A6B9D8" } },
            bottom: { style: "double", color: { rgb: "1F4E78" } }
          }
        };
      } else if (type === 'grand_total') {
        cellStyle = {
          fill: { fgColor: { rgb: "C6E0B4" } },
          font: { bold: true, color: { rgb: "375623" } },
          border: {
            top: { style: "thin", color: { rgb: "7F7F7F" } },
            bottom: { style: "double", color: { rgb: "375623" } }
          }
        };
      }

      if (cellStyle) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
          if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
          ws[cellRef].s = cellStyle;
        }
      }
    }

    // Auto-fit column widths
    const cols = [];
    const headers = Object.keys(excelRows[0] || {});
    headers.forEach(h => {
      cols.push({ wch: Math.max(h.length + 3, 10) });
    });
    excelRows.forEach(row => {
      headers.forEach((h, colIndex) => {
        const val = row[h] !== undefined && row[h] !== null ? row[h].toString() : '';
        if (val.length + 3 > cols[colIndex].wch) {
          cols[colIndex].wch = val.length + 3;
        }
      });
    });
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, `LK_T2_Gelombang_${gelombang}`);
    XLSX.writeFile(wb, `lk_beban_kerja_termin2_gelombang_${gelombang}.xlsx`);
    showToast('✓ Berhasil mengunduh Excel LK Beban Kerja Termin II!', 'success');
  } catch (err) {
    console.error('Export Excel T2 error:', err);
    showToast('Gagal ekspor Excel: ' + err.message, 'error');
  }
}

/**
 * 5. Dokumen Super PPL, PML & Kepala Termin 2 Murni
 */
async function previewSuperPPLT2(gelombang = 1) {
  generateSuperPPLActionT2(gelombang, false);
}

async function downloadSuperPPLT2(gelombang = 1) {
  generateSuperPPLActionT2(gelombang, true);
}

async function generateSuperPPLActionT2(gelombang = 1, isDownload = false) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];

  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada data PPL eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }

  showToast(`Memproses Surat Pernyataan PPL Termin II Gelombang ${gelombang}...`, 'info');
  // Generator PPL Termin 2
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8; color: #f8fafc; padding: 14px 20px; border-radius: 12px; z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;`;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      const pplList = await fetchSuperPPLDataT2(gelombang);
      if (pplList.length === 0) {
        showToast('Tidak ada PPL yang eligible di gelombang ini.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pplList.length; i++) {
        if (i > 0) pdf.addPage("a4", "portrait");
        buildSuperPPLDocumentT2(pdf, pplList[i], ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Selesai memproses PDF Super PPL T2!';

      if (isDownload) {
        pdf.save(`super_ppl_termin2_gelombang_${gelombang}.pdf`);
      } else {
        window.open(pdf.output('bloburl'), '_blank');
      }
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      showToast('Gagal membuat PDF: ' + err.message, 'error');
      if (indicator) indicator.remove();
    }
  });
}

/**
 * Helper untuk mengekstrak nomor urut 'XXX' dari format 'B-XXX/...'
 */
function extractNoUrutSurat(noStr) {
  if (!noStr || typeof noStr !== 'string') return null;
  const match = noStr.match(/B-(\d+)/i) || noStr.match(/^B-([^\/]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Derive nomor surat BAST Termin 2 dari nomor surat Termin 1
 * Format: B-XXX/BAST-{ROLE}-SE2026/3602/08/2026
 * Petugas baru yang belum memiliki nomor di T1 akan dibiarkan kosong ("")
 */
function deriveBastNoSurat(sobatid, role, noEntry) {
  if (noEntry && noEntry.no_sp_pemeriksaan_t2 && noEntry.no_sp_pemeriksaan_t2.trim()) {
    return noEntry.no_sp_pemeriksaan_t2.trim();
  }
  const xxx = extractNoUrutSurat(noEntry?.no_spk) || extractNoUrutSurat(noEntry?.no_sp_pemeriksaan_t1);
  if (xxx) {
    const roleCode = (role || 'ppl').toUpperCase();
    return `B-${xxx}/BAST-${roleCode}-SE2026/3602/08/2026`;
  }
  return '';
}

async function fetchSuperPPLDataT2(gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) return [];

  const { data: noSurats } = await db.from('no_surat_se').select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2');
  const noSuratMap = {};
  (noSurats || []).forEach(n => {
    if (n.sobatid) noSuratMap[String(n.sobatid).trim()] = n;
  });

  const { data: capaianT2 } = await db.from('capaian_termin2').select('*');
  const targetMap = {};
  const hasilMap = {};
  (capaianT2 || []).forEach(c => {
    targetMap[c.kode_subsls] = c.targetsls || 0;
    hasilMap[c.kode_subsls] = c[`hasilverif${gelombang}`] || 0;
  });

  const { data: userSlsT2 } = await db.from('user_sls_termin2').select('user_id, kode_sls').eq('status', 'aktif');
  const userSlsMap = {};
  (userSlsT2 || []).forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
  });

  const pplProfiles = (allUsers || []).filter(u => u.role === 'ppl' && u.is_active && eligibleIds.has(u.id));
  const result = [];

  pplProfiles.forEach(ppl => {
    const codes = userSlsMap[ppl.id] || [];
    let tgt = 0, real = 0;
    codes.forEach(code => {
      tgt += targetMap[code] || 0;
      real += hasilMap[code] || 0;
    });

    const key = String(ppl.sobatid).trim();
    const noEntry = noSuratMap[key] || {};
    const finalNoSp = noEntry.no_sp_pemeriksaan_t2 || deriveBastNoSurat(ppl.sobatid, 'ppl', noEntry);

    result.push({
      nama: ppl.nama,
      nik: ppl.nik,
      sobatid: ppl.sobatid,
      kecamatan: ppl.kecamatan || '',
      no_spk: noEntry.no_spk || '',
      no_sp_pemeriksaan_t2: finalNoSp,
      target: tgt,
      realisasi: real,
      capaian_pct: tgt > 0 ? (real / tgt) * 100 : 0
    });
  });

  result.sort((a, b) => (a.kdkec || '').localeCompare(b.kdkec || '') || (a.nama || '').localeCompare(b.nama || ''));
  return result;
}

const TANGGAL_SURAT_TERMIN2 = {
  1: "11 September 2026",
  2: "14 September 2026",
  3: "15 September 2026",
  4: "16 September 2026"
};

function buildSuperPPLDocumentT2(pdf, ppl, ttdYulianBase64, gelombang = 1) {
  const tanggal = TANGGAL_SURAT_TERMIN2[gelombang] || "11 September 2026";

  const pct = ppl.capaian_pct !== undefined ? ppl.capaian_pct.toFixed(2) + "%" : "0.00%";
  const targetStr = (ppl.target || 0).toString();
  const realisasiStr = (ppl.realisasi || 0).toString();

  pdf.setLineHeightFactor(1.0);
  const M = 25;
  const W = 160;
  const MR = 185;
  const lh = 5;

  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("SURAT PERNYATAAN PENYELESAIAN", 105, 30, { align: "center" });
  pdf.text("PENDATAAN LAPANGAN SENSUS EKONOMI 2026 TERMIN II", 105, 36, { align: "center" });

  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${ppl.no_sp_pemeriksaan_t2 || "......./SE2026/.../.../2026"}`, 105, 44, { align: "center" });

  let y = 56;
  pdf.text("Yang bertanda tangan di bawah ini:", M, y);
  y += 8;

  const labelX = 30;
  const colonX = 62;
  const valueX = 66;

  const identitas = [
    ["Nama", ppl.nama ? ppl.nama.toUpperCase() : "....................................."],
    ["NIK", ppl.nik || "....................................."],
    ["Jabatan", `Petugas Pendataan Lapangan Sensus Ekonomi 2026 Kecamatan ${ppl.kecamatan || "..."}`]
  ];

  identitas.forEach(item => {
    pdf.text(item[0], labelX, y);
    pdf.text(":", colonX, y);
    const wrap = pdf.splitTextToSize(item[1], MR - valueX);
    pdf.text(wrap, valueX, y);
    y += wrap.length * lh;
  });

  y += 3;
  pdf.text("Dengan ini menyatakan:", M, y);
  y += 6;

  const poin = [
    `bahwa telah menyelesaikan seluruh target pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${ppl.no_spk || "..."}, dengan rincian target prelist sebanyak ${targetStr} dan realisasi hasil pendataan sebanyak ${realisasiStr} (${pct});`,
    `bahwa seluruh hasil pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 termin II telah diserahkan dan diperiksa oleh Pemeriksa Lapangan;`,
    `bahwa seluruh hasil pekerjaan termin II yang diserahkan adalah benar, akurat, dan dapat dipertanggungjawabkan sesuai dengan kondisi di lapangan; dan`,
    `apabila di kemudian hari ditemukan ketidaksesuaian, kekeliruan, atau penyimpangan atas pekerjaan yang saya lakukan, maka saya bersedia bertanggung jawab sepenuhnya sesuai dengan ketentuan peraturan perundang-undangan.`
  ];

  const numX = M;
  const textX = M + 8;
  const textWidth = MR - textX;

  poin.forEach((teks, i) => {
    const lines = pdf.splitTextToSize(teks, textWidth);
    pdf.text(`${i + 1}.`, numX, y);
    drawJustifiedText(pdf, teks, textX, y, textWidth, 5);
    y += lines.length * 5;
  });

  y += 2;
  const penutup =
    "Demikian Surat Pernyataan ini dibuat dengan sebenarnya dalam keadaan sadar, tanpa paksaan dari pihak manapun, untuk digunakan sebagaimana mestinya.";

  const penutupLines = pdf.splitTextToSize(penutup, W);
  drawJustifiedText(pdf, penutup, M, y, W, 5);
  y += penutupLines.length * 5 + 10;

  const ttdX = 152;
  let dateStr = "Lebak, 16 Juli 2026";
  if (gelombang === 2) dateStr = "Lebak, 23 Juli 2026";
  if (gelombang === 3) dateStr = "Lebak, 28 Juli 2026";
  if (gelombang === 4) dateStr = "Lebak, 10 Agustus 2026";

  pdf.text(dateStr, ttdX, y, { align: "center" });
  pdf.text("Yang membuat pernyataan,", ttdX, y + lh, { align: "center" });
  y += 28;
  pdf.text(`(${(ppl.nama || "").toUpperCase()})`, ttdX, y, { align: "center" });
}

async function previewSuperPMLT2(gelombang = 1) {
  generateSuperPMLActionT2(gelombang, false);
}

async function downloadSuperPMLT2(gelombang = 1) {
  generateSuperPMLActionT2(gelombang, true);
}

async function generateSuperPMLActionT2(gelombang = 1, isDownload = false) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];

  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada data PML eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }

  showToast(`Memproses Surat Pernyataan PML Termin II Gelombang ${gelombang}...`, 'info');
  // Generator PML Termin 2
  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8; color: #f8fafc; padding: 14px 20px; border-radius: 12px; z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;`;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat data PML T2...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      const pmlList = await fetchSuperPMLDataT2(gelombang);
      if (pmlList.length === 0) {
        showToast('Tidak ada PML eligible di gelombang ini.', 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      for (let i = 0; i < pmlList.length; i++) {
        if (i > 0) pdf.addPage("a4", "portrait");
        buildSPTermin1Pages(pdf, pmlList[i], pmlList[i].rekapData, i > 0, ttdYulianBase64, gelombang);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = '✓ Selesai membuat PDF Super PML T2!';

      if (isDownload) {
        pdf.save(`super_pml_termin2_gelombang_${gelombang}.pdf`);
      } else {
        window.open(pdf.output('bloburl'), '_blank');
      }
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      showToast('Gagal membuat PDF: ' + err.message, 'error');
      if (indicator) indicator.remove();
    }
  });
}

async function fetchSuperPMLDataT2(gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) return [];

  const { data: noSurats } = await db.from('no_surat_se').select('sobatid, no_spk, no_sp_pemeriksaan_t2');
  const noSuratMap = {};
  (noSurats || []).forEach(n => {
    if (n.sobatid) noSuratMap[String(n.sobatid).trim()] = n;
  });

  const { data: capaianT2 } = await db.from('capaian_termin2').select('*');
  const targetMap = {};
  const hasilMap = {};
  (capaianT2 || []).forEach(c => {
    targetMap[c.kode_subsls] = c.targetsls || 0;
    hasilMap[c.kode_subsls] = c[`hasilverif${gelombang}`] || 0;
  });

  const { data: rels } = await db.from('pml_ppl').select('pml_id, ppl_id');
  const pmlToPpl = {};
  const pplToPml = {};
  (rels || []).forEach(r => {
    if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = [];
    pmlToPpl[r.pml_id].push(r.ppl_id);
    pplToPml[r.ppl_id] = r.pml_id;
  });

  const { data: userSlsT2 } = await db.from('user_sls_termin2').select('user_id, kode_sls, user_id_asal').eq('status', 'aktif');
  const userSlsMap = {};
  (userSlsT2 || []).forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);

    // Inherit PML pembina dari SLS / user_id_asal jika petugas merupakan PPL pengganti
    if (us.user_id_asal && pplToPml[us.user_id_asal]) {
      const pmlId = pplToPml[us.user_id_asal];
      if (pmlToPpl[pmlId] && !pmlToPpl[pmlId].includes(us.user_id)) {
        pmlToPpl[pmlId].push(us.user_id);
      }
    }
  });

  const pmlProfiles = (allUsers || []).filter(u => u.role === 'pml' && u.is_active && eligibleIds.has(u.id));
  const pplProfiles = (allUsers || []).filter(u => u.role === 'ppl' && u.is_active);

  const result = [];

  pmlProfiles.forEach(pml => {
    const pplIds = pmlToPpl[pml.id] || [];
    const rekapData = [];

    pplIds.forEach(pplId => {
      const ppl = pplProfiles.find(u => u.id === pplId);
      if (!ppl) return;
      const codes = userSlsMap[ppl.id] || [];
      let tgt = 0, real = 0;
      codes.forEach(code => {
        tgt += targetMap[code] || 0;
        real += hasilMap[code] || 0;
      });

      const keyPpl = String(ppl.sobatid).trim();
      const noEntryPpl = noSuratMap[keyPpl] || {};
      const pct = tgt > 0 ? (real / tgt) * 100 : 0;

      rekapData.push({
        nama: ppl.nama,
        nik: ppl.nik,
        sobatid: ppl.sobatid,
        kdkec: ppl.kecamatan || '',
        no_spk: noEntryPpl.no_spk || '',
        no_sp_pemeriksaan_t2: noEntryPpl.no_sp_pemeriksaan_t2 || '',
        target: tgt,
        realisasi: real,
        capaian_pct: pct
      });
    });

    // Tambahkan 2 baris kosong untuk masing-masing dari 4 petugas pengganti
    for (let p = 1; p <= 4; p++) {
      for (let r = 1; r <= 2; r++) {
        rekapData.push({
          nama: `................................................ (Petugas Pengganti ${p})`,
          nik: '',
          sobatid: '',
          kdkec: '',
          no_spk: '',
          no_sp_pemeriksaan_t2: '',
          target: '',
          realisasi: '',
          capaian_pct: '',
          is_replacement_blank: true
        });
      }
    }

    const keyPml = String(pml.sobatid).trim();
    const noEntryPml = noSuratMap[keyPml] || {};

    result.push({
      nama: pml.nama,
      nik: pml.nik,
      sobatid: pml.sobatid,
      kecamatan: pml.kecamatan || '',
      no_spk: noEntryPml.no_spk || '',
      no_sp_pemeriksaan_t1: noEntryPml.no_sp_pemeriksaan_t2 || '',
      rekapData
    });
  });

  return result;
}

/**
 * Super Kepala T2 & Lampiran T2 Murni
 */
async function printSuperEvaluasiT2(isDownload = false, gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada data eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }

  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #38bdf8; color: #f8fafc; padding: 14px 20px; border-radius: 12px; z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;`;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat Super Kepala T2 G${gelombang}...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      const dummyPml = {
        nama: "YULIAN SARWO EDI",
        nik: "1234567890123456",
        kecamatan: "Rangkasbitung",
        no_sp_pemeriksaan_t1: "001/SE2026/SP-PEM/01/2026",
        no_spk: "001/SPK/BPS/2026"
      };

      const rekapData = await fetchSuperEvaluasiT2Data(gelombang);
      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

      buildSuperEvaluasiT1Pages(pdf, dummyPml, rekapData, false, ttdYulianBase64, gelombang);

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = `✓ Berhasil membuat PDF Super Evaluasi T2 G${gelombang}!`;

      if (isDownload) {
        pdf.save(`super_kepala_termin2_g${gelombang}.pdf`);
      } else {
        window.open(pdf.output('bloburl'), '_blank');
      }
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error(err);
      showToast('Gagal membuat PDF: ' + err.message, 'error');
      if (indicator) indicator.remove();
    }
  });
}

async function fetchSuperEvaluasiT2Data(gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) return [];

  const { data: capaianT2 } = await db.from('capaian_termin2').select('*');
  const targetMap = {};
  const hasilMap = {};
  (capaianT2 || []).forEach(c => {
    targetMap[c.kode_subsls] = c.targetsls || 0;
    hasilMap[c.kode_subsls] = c[`hasilverif${gelombang}`] || 0;
  });

  const { data: userSlsT2 } = await db.from('user_sls_termin2').select('user_id, kode_sls, user_id_asal').eq('status', 'aktif');
  const userSlsMap = {};
  const userAsalMap = {};
  (userSlsT2 || []).forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
    if (us.user_id_asal) userAsalMap[us.user_id] = us.user_id_asal;
  });

  const { data: rels } = await db.from('pml_ppl').select('pml_id, ppl_id');
  const pplToPml = {};
  (rels || []).forEach(r => {
    pplToPml[r.ppl_id] = r.pml_id;
  });

  const users = (allUsers || []).filter(u => u.is_active && eligibleIds.has(u.id));
  const reportData = [];

  users.forEach(p => {
    const codes = userSlsMap[p.id] || [];
    let tgt = 0, real = 0;
    codes.forEach(c => {
      tgt += targetMap[c] || 0;
      real += hasilMap[c] || 0;
    });

    const pmlId = pplToPml[p.id] || (userAsalMap[p.id] && pplToPml[userAsalMap[p.id]]);
    const pmlUser = pmlId ? allUsers.find(u => u.id === pmlId) : null;

    reportData.push({
      nama_pml: pmlUser ? pmlUser.nama : '—',
      email_pml: pmlUser ? pmlUser.email_ref : '',
      nama_ppl: p.role === 'ppl' ? p.nama : '',
      email_ppl: p.role === 'ppl' ? p.email_ref : '',
      nama: p.nama,
      kdkec: p.kecamatan || '',
      jabatan: p.role.toUpperCase(),
      target: tgt,
      realisasi: real,
      persentase: tgt > 0 ? ((real / tgt) * 100).toFixed(2) + '%' : '0.00%'
    });
  });

  reportData.sort((a, b) => (a.jabatan === 'PPL' ? -1 : 1) || (a.kdkec || '').localeCompare(b.kdkec || '') || (a.nama || '').localeCompare(b.nama || ''));

  // Tambahkan 2 baris kosong untuk masing-masing dari 4 petugas pengganti
  for (let p = 1; p <= 4; p++) {
    for (let r = 1; r <= 2; r++) {
      reportData.push({
        nama_pml: '',
        email_pml: '',
        nama_ppl: `................................................ (Petugas Pengganti ${p})`,
        email_ppl: '',
        nama: `................................................ (Petugas Pengganti ${p})`,
        kdkec: '',
        jabatan: 'PPL',
        target: '',
        realisasi: '',
        persentase: '',
        is_replacement_blank: true
      });
    }
  }

  return reportData;
}

async function previewSuperKepalaLampiranT2(gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada data eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }
  printSuperEvaluasiT2(false, gelombang);
}

async function exportSuperKepalaLampiranT2ToExcel(gelombang = 1) {
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada data eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }

  showToast(`Mengekspor Lampiran Super Kepala T2 Gelombang ${gelombang}...`, 'info');
  try {
    const reportData = await fetchSuperEvaluasiT2Data(gelombang);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, ws, `Lampiran_T2_G${gelombang}`);
    XLSX.writeFile(wb, `lampiran_super_kepala_termin2_gelombang_${gelombang}.xlsx`);
    showToast('✓ Berhasil mengunduh Excel Lampiran Super Kepala T2!', 'success');
  } catch (err) {
    showToast('Gagal ekspor Excel: ' + err.message, 'error');
  }
}

function openPmlNoSuratModalT2(gelombang = 1) {
  openPmlNoSuratModal(gelombang);
}

function openPplNoSuratModalT2(gelombang = 1) {
  openPplNoSuratModal(gelombang);
}

function openCustomSuperPPLModalT2() {
  openCustomSuperPPLModal();
}

/**
 * 6. BAPP Termin II Modal Management
 */
let allBappT2Officers = [];

async function loadBAPPT2Data() {
  const tbody = document.getElementById('bappTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 0.5rem"></div>Memuat data BAPP Termin II...</td></tr>`;
  }

  try {
    await loadBappEligibilityDataT2(true);

    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    let totalCount = 0;
    while (hasMore) {
      const { data, error, count } = await db
        .from('bapp_uploads_t2')
        .select('id, profile_id, kode_kec, crop_top, crop_bottom, crop_top_uninstall, crop_bottom_uninstall, created_at, profiles:profile_id(nama, role, sobatid), wilayah_kec:kode_kec(nmkec)', { count: page === 0 ? 'exact' : 'none' })
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      if (page === 0) {
        totalCount = count || 0;
      }
      if (data && data.length > 0) {
        allData = allData.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    allBappUploads = allData;
    totalBappDbCount = totalCount || allBappUploads.length;
    currentBappPage = 1;
    filterBAPP();
  } catch (err) {
    console.error('Error loading BAPP T2 data:', err);
    showToast('Gagal memuat data BAPP Termin II: ' + err.message, 'error');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--error)">Gagal memuat: ${err.message}</td></tr>`;
    }
  } finally {
    const spinner = tbody ? tbody.querySelector('.spinner') : null;
    if (spinner) spinner.remove();
  }
}

/**
 * 7. BAST (BERITA ACARA SERAH TERIMA) FUNCTIONS
 */
/**
 * 7. BAST (BERITA ACARA SERAH TERIMA) FUNCTIONS
 */
async function previewBAST(gelombang = 1) {
  generateBASTAction(gelombang, false, 'all');
}

async function downloadBAST(gelombang = 1) {
  generateBASTAction(gelombang, true, 'all');
}

async function previewBASTPPL(gelombang = 1) {
  generateBASTAction(gelombang, false, 'ppl');
}

async function downloadBASTPPL(gelombang = 1) {
  generateBASTAction(gelombang, true, 'ppl');
}

async function previewBASTPML(gelombang = 1) {
  generateBASTAction(gelombang, false, 'pml');
}

async function downloadBASTPML(gelombang = 1) {
  generateBASTAction(gelombang, true, 'pml');
}

async function generateBASTAction(gelombang = 1, isDownload = false, roleFilter = 'all') {
  if (!allUsers || allUsers.length === 0) {
    if (typeof loadUsers === 'function') {
      await loadUsers();
    }
  }
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];

  if (!eligibleIds || eligibleIds.size === 0) {
    showToast(`Belum ada petugas eligible pada Gelombang ${gelombang} Termin 2. Silakan upload capaian FASIH terlebih dahulu.`, 'warning');
    return;
  }

  const eligibleOfficers = (allUsers || []).filter(u => u.is_active && eligibleIds.has(u.id) && (roleFilter === 'all' || u.role === roleFilter));
  const roleLabel = roleFilter === 'ppl' ? 'PPL ' : (roleFilter === 'pml' ? 'PML ' : '');

  if (eligibleOfficers.length === 0) {
    showToast(`Tidak ada petugas ${roleLabel}eligible untuk dicetak BAST pada Gelombang ${gelombang}.`, 'warning');
    return;
  }

  showToast(`Memproses BAST ${roleLabel}Termin II Gelombang ${gelombang} (${eligibleOfficers.length} petugas)...`, 'info');

  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    let indicator = document.getElementById('auto-crop-bg-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'auto-crop-bg-indicator';
      indicator.style = `position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #10b981; color: #f8fafc; padding: 14px 20px; border-radius: 12px; z-index: 99999; font-size: 0.85rem; display: flex; align-items: center; gap: 12px;`;
      document.body.appendChild(indicator);
    }
    indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memuat font Bookman...`;

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await registerBookmanFont(pdf);

      let bastOfficers = await fetchBASTData(gelombang);
      if (roleFilter !== 'all') {
        bastOfficers = bastOfficers.filter(o => o.role === roleFilter);
      }

      if (bastOfficers.length === 0) {
        showToast(`Tidak ada petugas ${roleLabel}eligible untuk dicetak BAST.`, 'warning');
        indicator.remove();
        return;
      }

      const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');
      const ttdNingBase64 = await loadImgAsBase64('assets/ttd/ning sl.png') || await loadImgAsBase64('assets/ning_sri_lestari.png');

      for (let i = 0; i < bastOfficers.length; i++) {
        const officer = bastOfficers[i];
        indicator.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Membuat BAST ${roleLabel}(${i + 1}/${bastOfficers.length})...`;
        if (i > 0) pdf.addPage("a4", "portrait");
        await buildBASTSingleDocument(pdf, officer, ttdYulianBase64, gelombang, ttdNingBase64);
      }

      indicator.style.borderColor = '#10b981';
      indicator.style.color = '#10b981';
      indicator.innerHTML = `✓ Selesai membuat dokumen BAST ${roleLabel}!`;

      const filenameRole = roleFilter !== 'all' ? `_${roleFilter}` : '';
      const pdfFileName = `bast${filenameRole}_termin2_gelombang_${gelombang}.pdf`;
      if (isDownload) {
        pdf.save(pdfFileName);
      } else {
        openPdfSafely(pdf, pdfFileName);
      }
      setTimeout(() => { indicator.remove(); }, 2000);
    } catch (err) {
      console.error('Failed to generate BAST:', err);
      showToast('Gagal membuat BAST: ' + err.message, 'error');
      if (indicator) indicator.remove();
    }
  });
}

async function fetchBASTData(gelombang = 1) {
  if (!allUsers || allUsers.length === 0) {
    if (typeof loadUsers === 'function') {
      await loadUsers();
    }
  }
  await loadBappEligibilityDataT2(true);
  const eligibleIds = bappEligibilityMapT2[gelombang];
  if (!eligibleIds || eligibleIds.size === 0) return [];

  const { data: noSurats } = await db.from('no_surat_se').select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2');
  const noSuratMap = {};
  (noSurats || []).forEach(n => {
    if (n.sobatid) noSuratMap[String(n.sobatid).trim()] = n;
  });

  const { data: capaianT2 } = await db.from('capaian_termin2').select('*');
  const targetMap = {};
  const hasilMap = {};
  (capaianT2 || []).forEach(c => {
    targetMap[c.kode_subsls] = c.targetsls || 0;
    hasilMap[c.kode_subsls] = c[`hasilverif${gelombang}`] || 0;
  });

  const { data: userSlsT2 } = await db.from('user_sls_termin2').select('user_id, kode_sls, user_id_asal').eq('status', 'aktif');
  const userSlsMap = {};
  const userAsalMap = {};
  (userSlsT2 || []).forEach(us => {
    if (!userSlsMap[us.user_id]) userSlsMap[us.user_id] = [];
    userSlsMap[us.user_id].push(us.kode_sls);
    if (us.user_id_asal) userAsalMap[us.user_id] = us.user_id_asal;
  });

  const { data: rels } = await db.from('pml_ppl').select('pml_id, ppl_id');
  const pmlToPpl = {};
  const pplToPml = {};
  (rels || []).forEach(r => {
    if (!pmlToPpl[r.pml_id]) pmlToPpl[r.pml_id] = [];
    pmlToPpl[r.pml_id].push(r.ppl_id);
    pplToPml[r.ppl_id] = r.pml_id;
  });

  // Hubungkan replacement PPL ke PML pembinanya
  Object.keys(userAsalMap).forEach(pplId => {
    const asalId = userAsalMap[pplId];
    const pmlId = pplToPml[asalId];
    if (pmlId && pmlToPpl[pmlId] && !pmlToPpl[pmlId].includes(pplId)) {
      pmlToPpl[pmlId].push(pplId);
    }
  });

  const officers = (allUsers || []).filter(u => u.is_active && (u.role === 'ppl' || u.role === 'pml') && eligibleIds.has(u.id));

  const officerIds = officers.map(o => o.id);
  const bappUploadMap = {};
  const chunkSize = 100;
  for (let i = 0; i < officerIds.length; i += chunkSize) {
    const sliceIds = officerIds.slice(i, i + chunkSize);
    const { data: bappT2Uploads, error } = await db
      .from('bapp_uploads_t2')
      .select('id, screenshot_uninstall, crop_top_uninstall, crop_bottom_uninstall')
      .in('id', sliceIds);
    if (!error && bappT2Uploads) {
      bappT2Uploads.forEach(b => {
        bappUploadMap[b.id] = b;
      });
    }
  }

  const result = [];

  officers.forEach(u => {
    let slsCodes = [];
    if (u.role === 'ppl') {
      slsCodes = userSlsMap[u.id] || [];
    } else {
      const pplIds = pmlToPpl[u.id] || [];
      const setCodes = new Set(userSlsMap[u.id] || []);
      pplIds.forEach(pid => {
        (userSlsMap[pid] || []).forEach(c => setCodes.add(c));
      });
      slsCodes = Array.from(setCodes);
    }

    let tgt = 0, real = 0;
    slsCodes.forEach(code => {
      tgt += targetMap[code] || 0;
      real += hasilMap[code] || 0;
    });

    const key = String(u.sobatid).trim();
    const noEntry = noSuratMap[key] || {};
    const finalNoBast = deriveBastNoSurat(u.sobatid, u.role, noEntry);
    const bData = bappUploadMap[u.id] || {};

    result.push({
      nama: u.nama,
      nik: u.nik,
      sobatid: u.sobatid,
      role: u.role,
      kecamatan: u.kecamatan || '',
      no_spk: noEntry.no_spk || '',
      no_bast: finalNoBast,
      target: tgt,
      realisasi: real,
      screenshot_uninstall: bData.screenshot_uninstall || null,
      crop_top_uninstall: bData.crop_top_uninstall || null,
      crop_bottom_uninstall: bData.crop_bottom_uninstall || null
    });
  });

  result.sort((a, b) => (a.role === 'ppl' ? -1 : 1) || (a.kecamatan || '').localeCompare(b.kecamatan || '') || (a.nama || '').localeCompare(b.nama || ''));
  return result;
}

async function buildBASTSingleDocument(pdf, officer, ttdYulianBase64, gelombang = 1, ttdNingBase64 = null) {
  const isPml = officer.role === 'pml';
  const roleTitle = isPml ? "Pemeriksa Lapangan Sensus Ekonomi 2026" : "Petugas Lapangan Sensus Ekonomi 2026";
  const cleanKec = officer.kecamatan ? officer.kecamatan.trim() : '';
  const roleTitleWithKec = isPml
    ? (cleanKec ? `Pemeriksa Lapangan Sensus Ekonomi 2026 Kecamatan ${cleanKec}` : "Pemeriksa Lapangan Sensus Ekonomi 2026")
    : (cleanKec ? `Petugas Lapangan Sensus Ekonomi 2026 Kecamatan ${cleanKec}` : "Petugas Lapangan Sensus Ekonomi 2026");

  // Load Ning signature if not passed
  if (!ttdNingBase64) {
    const loadImgAsBase64 = (url) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = url;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
      });
    };
    ttdNingBase64 = await loadImgAsBase64('assets/ttd/ning sl.png') || await loadImgAsBase64('assets/ning_sri_lestari.png');
  }

  // --- HALAMAN 1 (PORTRAIT A4) ---
  pdf.setLineHeightFactor(1.0);
  pdf.setFont("Bookman", "bold");
  pdf.setFontSize(12);
  pdf.text("BERITA ACARA SERAH TERIMA HASIL PEKERJAAN", 105, 23, { align: "center" });
  if (isPml) {
    pdf.text("PEMERIKSA LAPANGAN", 105, 29, { align: "center" });
    pdf.text("SENSUS EKONOMI 2026", 105, 35, { align: "center" });
  } else {
    pdf.text("PETUGAS LAPANGAN", 105, 29, { align: "center" });
    pdf.text("SENSUS EKONOMI 2026", 105, 35, { align: "center" });
  }

  const bastNo = officer.no_bast || (typeof deriveBastNoSurat === 'function' ? deriveBastNoSurat(officer.sobatid, officer.role, officer) : null) || `.../BAST-SE2026/.../${gelombang}/2026`;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(12);
  pdf.text(`Nomor: ${bastNo}`, 105, 42, { align: "center" });

  let y = 52;
  const dateSpelled = TANGGAL_TERBILANG_BAPP_T2[gelombang] || TANGGAL_TERBILANG_BAPP_T2[1];
  const intro = `Pada hari ini ${dateSpelled}, berdasarkan Perjanjian Kerja pada Badan Pusat Statistik Kabupaten Lebak Nomor: ${officer.no_spk || '...'} , bertempat di Lebak, kami yang bertanda tangan di bawah ini:`;
  const introLines = drawRichJustifiedText(pdf, intro, 25, y, 160, 5);
  y += introLines * 5 + 3;

  const labelX = 30;
  const colonX = 52;
  const valueX = 56;
  const lh = 5;

  pdf.text("1.", 25, y);
  pdf.text("Nama", labelX, y); pdf.text(":", colonX, y); pdf.text("NING SRI LESTARI", valueX, y); y += lh;
  pdf.text("NIP", labelX, y); pdf.text(":", colonX, y); pdf.text("198107062002122002", valueX, y); y += lh;
  const pihak1Teks = "PPK BPS Kabupaten Lebak bertindak untuk dan atas nama BPS Kabupaten Lebak, selanjutnya disebut sebagai PIHAK PERTAMA.";
  const wrapPPK = pdf.splitTextToSize(pihak1Teks, 185 - valueX);
  pdf.text("Jabatan", labelX, y); pdf.text(":", colonX, y);
  drawRichJustifiedText(pdf, pihak1Teks, valueX, y, 185 - valueX, lh);
  y += wrapPPK.length * lh + 2;

  pdf.text("2.", 25, y);
  pdf.text("Nama", labelX, y); pdf.text(":", colonX, y); pdf.text((officer.nama || "").toUpperCase(), valueX, y); y += lh;
  pdf.text("NIK", labelX, y); pdf.text(":", colonX, y); pdf.text(officer.nik || ".....................................", valueX, y); y += lh;
  const wrapJab2 = pdf.splitTextToSize(roleTitleWithKec, 185 - valueX);
  pdf.text("Jabatan", labelX, y); pdf.text(":", colonX, y); pdf.text(wrapJab2, valueX, y);
  y += wrapJab2.length * lh;
  const pihak2Teks = "bertindak untuk dan atas namanya sendiri, selanjutnya disebut sebagai PIHAK KEDUA.";
  const wrapPihak2 = pdf.splitTextToSize(pihak2Teks, 185 - labelX);
  drawRichJustifiedText(pdf, pihak2Teks, labelX, y, 185 - labelX, lh);
  y += wrapPihak2.length * lh + 3;

  pdf.text("Dengan ini menyatakan:", 25, y);
  y += 5;

  const pasal = isPml ? [
    `PIHAK KEDUA telah melaksanakan seluruh pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${officer.no_spk || '...'}, sesuai dengan target pekerjaan yang ditetapkan sebesar ${officer.target || 0} SLS/Sub-SLS selama pendataan 15 Juni 2026 sampai dengan 31 Agustus 2026.`,
    `PIHAK KEDUA telah menyelesaikan seluruh pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 berdasarkan hasil pemeriksaan dan evaluasi pekerjaan sebagaimana tercantum dalam lampiran.`,
    `Berdasarkan angka 2 tersebut di atas, PIHAK KEDUA menyerahkan seluruh hasil pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 kepada PIHAK PERTAMA, dan PIHAK PERTAMA menerima hasil pekerjaan tersebut yang telah sesuai dengan seharusnya;`,
    `Pekerjaan Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 sebagaimana dimaksud dalam angka 3, berupa dokumen pemeriksaan hasil Pendataan Lapangan Sensus Ekonomi 2026, sejumlah ${officer.realisasi || officer.target || 0} SLS/Sub-SLS.`,
    `Pekerjaaan pemeriksaan sebagaimana dimaksud pada angka 4 yang memerlukan pemeriksaan lanjutan, akan dilakukan pengecekan, perubahan, dan/atau kunjungan kembali ke lapangan merujuk pada perjanjian yang ditandatangani oleh PARA PIHAK.`,
    `PIHAK KEDUA menghapus Aplikasi FASIH dan data hasil Pemeriksaan Pendataan Lapangan Sensus Ekonomi 2026 pada perangkat handphone PIHAK KEDUA disaksikan oleh pegawai BPS Kabupaten/Kota yang ditunjuk oleh PIHAK PERTAMA.`
  ] : [
    `PIHAK KEDUA telah melaksanakan seluruh pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 pada Badan Pusat Statistik Kabupaten Lebak berdasarkan Perjanjian Kerja Nomor: ${officer.no_spk || '...'}, sesuai dengan target pekerjaan yang ditetapkan sebesar ${officer.target || 0} SLS/Sub-SLS selama pendataan 15 Juni 2026 sampai dengan 31 Agustus 2026.`,
    `PIHAK KEDUA telah menyelesaikan seluruh pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 berdasarkan hasil pemeriksaan dan evaluasi pekerjaan sebagaimana tercantum dalam lampiran.`,
    `Berdasarkan angka 2 tersebut di atas, PIHAK KEDUA menyerahkan seluruh hasil pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 kepada PIHAK PERTAMA, dan PIHAK PERTAMA menerima hasil pekerjaan tersebut yang telah sesuai dengan seharusnya;`,
    `Hasil pekerjaan Pendataan Lapangan Sensus Ekonomi 2026 sebagaimana dimaksud dalam angka 3, berupa dokumen hasil Pendataan Lapangan Sensus Ekonomi 2026, sejumlah ${officer.realisasi || officer.target || 0} SLS/Sub-SLS.`,
    `Hasil pekerjaan pendataan sebagaimana dimaksud pada angka 4 yang memerlukan pemeriksaan lanjutan, akan dilakukan pengecekan, perubahan, dan/atau kunjungan kembali ke lapangan merujuk pada perjanjian yang ditandatangani oleh PARA PIHAK.`,
    `PIHAK KEDUA menghapus Aplikasi FASIH dan data hasil Pendataan Lapangan Sensus Ekonomi 2026 pada perangkat handphone PIHAK KEDUA disaksikan oleh pegawai BPS Kabupaten/Kota yang ditunjuk oleh PIHAK PERTAMA.`
  ];

  const textWidth = 185 - 33;
  pasal.forEach((teks, idx) => {
    const linesCount = pdf.splitTextToSize(teks, textWidth).length;
    pdf.text(`${idx + 1}.`, 25, y);
    drawRichJustifiedText(pdf, teks, 33, y, textWidth, 4.5);
    y += linesCount * 4.5 + 1.5;
  });

  // --- HALAMAN 2 (PORTRAIT A4 PENUTUP & TTD) ---
  pdf.addPage('a4', 'portrait');

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('-2-', 105, 12, { align: 'center' });

  let y2 = 25;
  const penutup = "Demikian Berita Acara ini dibuat dengan sebenarnya dalam rangkap 2 (dua) dan menjadi sah berlaku setelah ditandatangani oleh KEDUA BELAH PIHAK.";
  const penutupLinesCount = drawRichJustifiedText(pdf, penutup, 25, y2, 160, 5);
  y2 += penutupLinesCount * 5 + 15;

  const ttdY = y2;
  pdf.setFont("Bookman", "normal");
  pdf.setFontSize(11);
  pdf.text("PIHAK KEDUA,", 55, ttdY, { align: "center" });
  pdf.text("PIHAK PERTAMA,", 155, ttdY, { align: "center" });

  if (ttdNingBase64) {
    pdf.addImage(ttdNingBase64, 'PNG', 140, ttdY + 6, 35, 20);
  }

  pdf.text(`(${officer.nama || ""})`.toUpperCase(), 55, ttdY + 34, { align: "center" });
  pdf.text("(NING SRI LESTARI)", 155, ttdY + 34, { align: "center" });

  // --- HALAMAN 4 (LANDSCAPE A4 LAMPIRAN BAST) ---
  pdf.addPage('a4', 'landscape');

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('-4-', 148.5, 12, { align: 'center' });

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('LAMPIRAN', 148.5, 17, { align: 'center' });
  pdf.text('BERITA ACARA SERAH TERIMA PEKERJAAN', 148.5, 22, { align: 'center' });
  const lampRoleTitle = isPml ? "PEMERIKSA LAPANGAN SENSUS EKONOMI 2026" : "PETUGAS LAPANGAN SENSUS EKONOMI 2026";
  pdf.text(lampRoleTitle, 148.5, 27, { align: 'center' });
  pdf.text('PADA BADAN PUSAT STATISTIK KABUPATEN LEBAK', 148.5, 32, { align: 'center' });
  pdf.text(`NOMOR: ${bastNo}`, 148.5, 37, { align: 'center' });

  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('BUKTI PENYELESAIAN PEKERJAAN KECAMATAN ' + (cleanKec ? cleanKec.toUpperCase() : '.........................'), 20, 44);

  const prepareCroppedImage = (src, topOff, botOff) => {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const topOffset = (topOff !== undefined && topOff !== null) ? parseFloat(topOff) : 8.0;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const origW = img.naturalWidth;
        const origH = img.naturalHeight;

        // Kunci skala 1:1 persegi (cropHeight = origW)
        const cropHeight = Math.min(origW, origH - (origH * (topOffset / 100)));
        const startY = origH * (topOffset / 100);
        canvas.width = origW;
        canvas.height = cropHeight;
        ctx.drawImage(img, 0, startY, origW, cropHeight, 0, 0, origW, cropHeight);
        resolve({ base64: canvas.toDataURL('image/png'), ratio: 1.0 });
      };
      img.onerror = () => resolve(null);
    });
  };

  // Render 1 Screenshot Bukti Uninstall FASIH (Strict 1:1 Square)
  const res = await prepareCroppedImage(officer.screenshot_uninstall, officer.crop_top_uninstall, officer.crop_bottom_uninstall);
  if (res) {
    const squareSize = 75.0; // mm (Bujur sangkar presisi 75x75mm di landscape A4)
    const imgWidth = squareSize;
    const imgHeight = squareSize;
    const imgX = (297 - imgWidth) / 2;
    const imgY = 46.0;
    pdf.addImage(res.base64, 'PNG', imgX, imgY, imgWidth, imgHeight);
    pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
  } else {
    const squareSize = 75.0;
    const imgWidth = squareSize;
    const imgHeight = squareSize;
    const imgX = (297 - imgWidth) / 2;
    const imgY = 46.0;
    pdf.rect(imgX, imgY, imgWidth, imgHeight, 'D');
    pdf.setFont('Bookman', 'italic');
    pdf.setFontSize(10);
    pdf.text('[Bukti Uninstall FASIH Tidak Tersedia]', 148.5, imgY + 37.5, { align: 'center' });
  }

  const sigY2 = 125.0;
  pdf.setFont('Bookman', 'normal');
  pdf.setFontSize(11);
  pdf.text('PIHAK KEDUA,', 70, sigY2, { align: 'center' });
  pdf.text('PIHAK PERTAMA,', 227, sigY2, { align: 'center' });

  if (ttdNingBase64) {
    const ttdX = 202;
    pdf.addImage(ttdNingBase64, 'PNG', ttdX, sigY2 + 2, 45, 22);
  }
  if (ttdYulianBase64) {
    const ttdX = 138;
    pdf.addImage(ttdYulianBase64, 'PNG', ttdX, sigY2 + 28, 20, 28);
  }

  pdf.text(`(${officer.nama || ""})`.toUpperCase(), 70, sigY2 + 25, { align: 'center' });
  pdf.text('(NING SRI LESTARI)', 227, sigY2 + 25, { align: 'center' });

  pdf.text('Mengetahui,', 148.5, sigY2 + 25, { align: 'center' });
  pdf.text('Ketua Tim Pelaksana selaku Pemeriksa Pekerjaan,', 148.5, sigY2 + 30, { align: 'center' });
  pdf.text('(YULIAN SARWO EDI)', 148.5, sigY2 + 55, { align: 'center' });
}

/**
 * Custom BAST Modal Handlers
 */
function openCustomBastModal() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan membuat custom BAST.', 'warning');
    return;
  }
  const modal = document.getElementById('customBastModal');
  if (modal) modal.classList.add('open');
  onCustomBastRoleChange();
}

function closeCustomBastModal() {
  const modal = document.getElementById('customBastModal');
  if (modal) modal.classList.remove('open');
}

function onCustomBastRoleChange() {
  const role = document.getElementById('customBastRole')?.value || 'ppl';
  const sel = document.getElementById('customBastUserSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Pilih Petugas --</option>';

  const filtered = (allUsers || []).filter(u => u.role === role && u.is_active);
  filtered.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
  filtered.forEach(u => {
    sel.innerHTML += `<option value="${u.id}">${escHtml(u.nama)} (${escHtml(u.kecamatan || '—')})</option>`;
  });
  onCustomBastUserChange();
}

async function onCustomBastUserChange() {
  const uid = document.getElementById('customBastUserSelect')?.value;
  const infoBox = document.getElementById('customBastInfoBox');
  if (!uid) {
    if (infoBox) infoBox.style.display = 'none';
    return;
  }

  const u = (allUsers || []).find(x => x.id === uid);
  if (!u) return;

  if (infoBox) infoBox.style.display = 'block';
  document.getElementById('customBastNIK').textContent = u.nik || '—';
  document.getElementById('customBastSobatID').textContent = u.sobatid || '—';
  document.getElementById('customBastKecamatan').textContent = u.kecamatan || '—';

  try {
    const { data } = await db.from('no_surat_se').select('no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2').eq('sobatid', String(u.sobatid).trim()).single();
    document.getElementById('customBastNoSPK').textContent = data?.no_spk || '—';
    const derivedNo = deriveBastNoSurat(u.sobatid, u.role, data);
    document.getElementById('customBastNoSurat').value = derivedNo || '';
  } catch (e) { }
}

function generateCustomBastPDF(isDownload = false) {
  const uid = document.getElementById('customBastUserSelect')?.value;
  if (!uid) {
    showToast('Pilih petugas terlebih dahulu.', 'warning');
    return;
  }
  const u = (allUsers || []).find(x => x.id === uid);
  if (!u) return;

  const role = document.getElementById('customBastRole')?.value || u.role;
  const noSurat = document.getElementById('customBastNoSurat')?.value || '';
  const tanggal = document.getElementById('customBastTanggal')?.value || '31 Juli 2026';
  const target = parseInt(document.getElementById('customBastTarget')?.value) || 0;
  const realisasi = parseInt(document.getElementById('customBastRealisasi')?.value) || 0;

  loadJsPDF(async () => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await registerBookmanFont(pdf);
    const ttdYulianBase64 = await loadImgAsBase64('assets/ttd/yulian.png') || await loadImgAsBase64('assets/yulian_sarwo_edi.png');

    const officer = {
      nama: u.nama,
      nik: u.nik,
      role: role,
      kecamatan: u.kecamatan || '',
      no_spk: document.getElementById('customBastNoSPK')?.textContent || '',
      no_bast: noSurat,
      target,
      realisasi
    };

    await buildBASTSingleDocument(pdf, officer, ttdYulianBase64, 1);

    if (isDownload) {
      pdf.save(`bast_custom_${(u.nama || '').replace(/\s+/g, '_').toLowerCase()}.pdf`);
    } else {
      window.open(pdf.output('bloburl'), '_blank');
    }
  });
}

/**
 * Nomor Surat BAST Modal Handlers
 */
let allBastNoSuratRows = [];

async function openBastNoSuratModal(gelombang = 1) {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengedit nomor surat.', 'warning');
    return;
  }
  const modal = document.getElementById('bastNoSuratModal');
  if (modal) modal.classList.add('open');

  const gelFilter = document.getElementById('bastNoSuratGelombangFilter');
  if (gelFilter) gelFilter.value = gelombang;

  const kecFilter = document.getElementById('bastNoSuratKecamatanFilter');
  if (kecFilter && kecFilter.options.length <= 1) {
    kecFilter.innerHTML = '<option value="">Semua Kecamatan</option>';
    const uniqueKec = new Set((allUsers || []).map(u => u.kecamatan).filter(Boolean));
    Array.from(uniqueKec).sort().forEach(k => {
      kecFilter.innerHTML += `<option value="${escHtml(k)}">${escHtml(k)}</option>`;
    });
  }

  await loadBastNoSuratTable();
}

function closeBastNoSuratModal() {
  const modal = document.getElementById('bastNoSuratModal');
  if (modal) modal.classList.remove('open');
}

async function loadBastNoSuratTable() {
  const tbody = document.getElementById('bastNoSuratTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem"><span class="spinner"></span> Memuat nomor surat BAST...</td></tr>';

  try {
    const { data: noSurats } = await db.from('no_surat_se').select('sobatid, no_spk, no_sp_pemeriksaan_t1, no_sp_pemeriksaan_t2');
    const map = {};
    (noSurats || []).forEach(n => {
      if (n.sobatid) map[String(n.sobatid).trim()] = n;
    });

    const officers = (allUsers || []).filter(u => u.is_active && (u.role === 'ppl' || u.role === 'pml'));
    allBastNoSuratRows = officers.map(u => {
      const key = String(u.sobatid).trim();
      const entry = map[key] || {};
      const derivedNoBast = deriveBastNoSurat(u.sobatid, u.role, entry);
      return {
        id: u.id,
        nama: u.nama,
        sobatid: u.sobatid,
        role: u.role,
        kecamatan: u.kecamatan || '—',
        no_spk: entry.no_spk || '',
        no_bast: entry.no_sp_pemeriksaan_t2 || derivedNoBast || '',
        is_edited: false
      };
    });

    filterBastNoSuratTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--error)">Gagal memuat: ${err.message}</td></tr>`;
  }
}

function filterBastNoSuratTable() {
  const tbody = document.getElementById('bastNoSuratTableBody');
  if (!tbody) return;

  const role = document.getElementById('bastNoSuratRoleFilter')?.value || '';
  const kec = document.getElementById('bastNoSuratKecamatanFilter')?.value || '';

  let filtered = allBastNoSuratRows.filter(r => {
    if (role && r.role !== role) return false;
    if (kec && r.kecamatan !== kec) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem">Tidak ada petugas yang cocok dengan filter.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><strong>${escHtml(r.nama)}</strong><br><small style="color:var(--text-muted)">${escHtml(r.sobatid)}</small></td>
      <td style="text-align:center"><span class="badge" style="background:${r.role === 'pml' ? '#0ea5e9' : '#16a34a'};color:#fff">${r.role.toUpperCase()}</span></td>
      <td style="text-align:center">${escHtml(r.kecamatan)}</td>
      <td><input type="text" class="form-input" style="font-size:0.8rem;padding:0.25rem 0.5rem" value="${escHtml(r.no_spk)}" onchange="onBastNoSuratRowChange('${r.id}', 'no_spk', this.value)"></td>
      <td><input type="text" class="form-input" style="font-size:0.8rem;padding:0.25rem 0.5rem" value="${escHtml(r.no_bast)}" placeholder="B-.../3602/BAST/2026" onchange="onBastNoSuratRowChange('${r.id}', 'no_bast', this.value)"></td>
    </tr>
  `).join('');
}

function onBastNoSuratRowChange(id, field, value) {
  const row = allBastNoSuratRows.find(r => r.id === id);
  if (row) {
    row[field] = value.trim();
    row.is_edited = true;
  }
}

async function saveBastNoSuratAll() {
  const edited = allBastNoSuratRows.filter(r => r.is_edited);
  if (edited.length === 0) {
    showToast('Tidak ada perubahan yang perlu disimpan.', 'info');
    return;
  }

  showToast('Menyimpan perubahan nomor surat BAST...', 'info');
  try {
    const payload = edited.map(r => ({
      sobatid: String(r.sobatid).trim(),
      no_spk: r.no_spk,
      no_sp_pemeriksaan_t2: r.no_bast,
      updated_at: new Date().toISOString()
    }));

    const { error } = await db.from('no_surat_se').upsert(payload, { onConflict: 'sobatid' });
    if (error) throw error;

    edited.forEach(r => r.is_edited = false);
    showToast(`✓ Berhasil menyimpan ${edited.length} nomor surat BAST!`, 'success');
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  }
}

/**
 * 8. IN-PAGE MODAL UPLOAD CAPAIAN FASIH TERMIN II LOGIC
 */
let modalT2File1Data = null;
let modalT2File2Data = null;
let modalT2MergedRows = [];

function openUploadCapaianT2Modal() {
  if (!adminProfile || adminProfile.role !== 'superadmin') {
    showToast('Hanya Superadmin yang diperbolehkan mengunggah data capaian.', 'warning');
    return;
  }
  const modal = document.getElementById('uploadCapaianT2Modal');
  if (modal) modal.classList.add('open');
  resetModalT2Upload();
}

function closeUploadCapaianT2Modal() {
  const modal = document.getElementById('uploadCapaianT2Modal');
  if (modal) modal.classList.remove('open');
}

function onModalT2GelombangChange() {
  const g = document.getElementById('modalT2SelectGelombang')?.value || '1';
  const lbl = document.getElementById('modalT2LblKolom');
  if (lbl) lbl.textContent = `prelist${g}, baru${g}, hasilverif${g}, sls_selesai${g}`;
}

function handleModalT2File1Select(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('modalT2StatusFile1').innerHTML = `⏳ Membaca: <strong>${escHtml(file.name)}</strong>...`;
  parseModalT2File1(file);
}

function handleModalT2File2Select(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.getElementById('modalT2StatusFile2').innerHTML = `⏳ Membaca: <strong>${escHtml(file.name)}</strong>...`;
  parseModalT2File2(file);
}

function cleanKodeSubSLS(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '').trim();
}

async function parseModalT2File1(file) {
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    modalT2File1Data = new Map();
    // Data dimulai dari baris ke-7 (0-indexed: index 6)
    for (let r = 6; r < raw.length; r++) {
      const row = raw[r];
      if (!row || row.length === 0) continue;

      // Kode SLS di Kolom A (index 0)
      const code = cleanKodeSubSLS(row[0]);

      if (code.length === 16 && code.startsWith('3602')) {
        const prelist = parseInt(row[2]) || 0;       // Kolom C
        const baru = parseInt(row[3]) || 0;          // Kolom D
        const hasilverif = parseInt(row[4]) || 0;    // Kolom E

        modalT2File1Data.set(code, {
          prelist: prelist,
          baru: baru,
          hasilverif: hasilverif
        });
      }
    }

    if (modalT2File1Data.size === 0) {
      throw new Error('Tidak ditemukan baris dengan Kode Sub-SLS 16-digit (Kolom A) mulai baris ke-7.');
    }

    document.getElementById('modalT2StatusFile1').innerHTML = `✅ Terbaca: <strong>${modalT2File1Data.size} Sub-SLS 16-Digit</strong> (${escHtml(file.name)})`;
    document.getElementById('modalT2StatusFile1').style.color = '#16a34a';
    checkModalT2Ready();
  } catch (err) {
    modalT2File1Data = null;
    document.getElementById('modalT2StatusFile1').innerHTML = `❌ Error: ${err.message}`;
    document.getElementById('modalT2StatusFile1').style.color = '#ef4444';
  }
}

async function parseModalT2File2(file) {
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    modalT2File2Data = new Map();
    // Data dimulai dari baris ke-10 (0-indexed: index 9)
    for (let r = 9; r < raw.length; r++) {
      const row = raw[r];
      if (!row || row.length === 0) continue;

      // Kode SLS di Kolom A (index 0)
      const code = cleanKodeSubSLS(row[0]);

      if (code.length === 16 && code.startsWith('3602')) {
        const targetsls = parseInt(row[2]) || 0;       // Kolom C
        const jumlah_selesai = parseInt(row[3]) || 0;  // Kolom D
        const sls_selesai = targetsls > 0 ? parseFloat(((jumlah_selesai / targetsls) * 100).toFixed(2)) : 0;

        modalT2File2Data.set(code, {
          targetsls: targetsls,
          jumlah_selesai: jumlah_selesai,
          sls_selesai: sls_selesai
        });
      }
    }

    if (modalT2File2Data.size === 0) {
      throw new Error('Tidak ditemukan baris dengan Kode Sub-SLS 16-digit (Kolom A) mulai baris ke-10.');
    }

    document.getElementById('modalT2StatusFile2').innerHTML = `✅ Terbaca: <strong>${modalT2File2Data.size} Sub-SLS 16-Digit</strong> (${escHtml(file.name)})`;
    document.getElementById('modalT2StatusFile2').style.color = '#16a34a';
    checkModalT2Ready();
  } catch (err) {
    modalT2File2Data = null;
    document.getElementById('modalT2StatusFile2').innerHTML = `❌ Error: ${err.message}`;
    document.getElementById('modalT2StatusFile2').style.color = '#ef4444';
  }
}

function checkModalT2Ready() {
  const btn = document.getElementById('modalT2BtnValidasi');
  const btnReset = document.getElementById('modalT2BtnReset');
  if (modalT2File1Data && modalT2File2Data && modalT2File1Data.size > 0 && modalT2File2Data.size > 0) {
    btn.disabled = false;
    btnReset.style.display = 'inline-block';
  } else {
    btn.disabled = true;
  }
}

function resetModalT2Upload() {
  modalT2File1Data = null;
  modalT2File2Data = null;
  modalT2MergedRows = [];
  document.getElementById('modalT2InputFile1').value = '';
  document.getElementById('modalT2InputFile2').value = '';
  document.getElementById('modalT2StatusFile1').innerHTML = 'Belum ada file dipilih';
  document.getElementById('modalT2StatusFile1').style.color = 'var(--text-muted)';
  document.getElementById('modalT2StatusFile2').innerHTML = 'Belum ada file dipilih';
  document.getElementById('modalT2StatusFile2').style.color = 'var(--text-muted)';
  document.getElementById('modalT2AlertContainer').innerHTML = '';
  document.getElementById('modalT2PreviewSection').style.display = 'none';
  checkModalT2Ready();
}

async function validasiDanPreviewModalT2() {
  const alertContainer = document.getElementById('modalT2AlertContainer');
  alertContainer.innerHTML = '<div class="alert alert-info">⏳ Menjalankan validasi pencocokan Sub-SLS 16-digit dan non-regresi...</div>';

  const keys1 = Array.from(modalT2File1Data.keys());
  const keys2 = Array.from(modalT2File2Data.keys());

  const onlyInFile1 = keys1.filter(k => !modalT2File2Data.has(k));
  const onlyInFile2 = keys2.filter(k => !modalT2File1Data.has(k));

  if (onlyInFile1.length > 0 || onlyInFile2.length > 0) {
    alertContainer.innerHTML = `
      <div class="alert alert-error" style="line-height:1.5">
        <strong>❌ Validasi Gagal: Sub-SLS File 1 dan File 2 Tidak Cocok!</strong><br>
        • ${onlyInFile1.length} Sub-SLS hanya ada di File 1.<br>
        • ${onlyInFile2.length} Sub-SLS hanya ada di File 2.
      </div>
    `;
    document.getElementById('modalT2PreviewSection').style.display = 'none';
    return;
  }

  const gel = document.getElementById('modalT2SelectGelombang')?.value || '1';
  const { data: existingRows } = await db.from('capaian_termin2').select(`kode_subsls, targetsls, hasilverif${gel}, sls_selesai${gel}`);
  const existMap = new Map();
  (existingRows || []).forEach(r => existMap.set(r.kode_subsls, r));

  modalT2MergedRows = [];
  const warnings = [];

  keys1.forEach(kode => {
    const d1 = modalT2File1Data.get(kode);
    const d2 = modalT2File2Data.get(kode);
    const ex = existMap.get(kode);

    if (ex) {
      const prevHasil = ex[`hasilverif${gel}`] || 0;
      const prevSls = ex[`sls_selesai${gel}`] || 0;
      if (d1.hasilverif < prevHasil) {
        warnings.push(`Kode ${kode}: Hasil verifikasi turun dari ${prevHasil} menjadi ${d1.hasilverif}`);
      }
      if (prevSls === 100 && d2.sls_selesai < 100) {
        warnings.push(`Kode ${kode}: Status SLS selesai turun dari 100% menjadi ${d2.sls_selesai}%`);
      }
    }

    modalT2MergedRows.push({
      kode_subsls: kode,
      targetsls: d2.targetsls,
      prelist: d1.prelist,
      baru: d1.baru,
      hasilverif: d1.hasilverif,
      sls_selesai: d2.sls_selesai
    });
  });

  let warnHtml = '';
  if (warnings.length > 0) {
    warnHtml = `
      <div class="alert alert-warning" style="margin-top:0.5rem;max-height:100px;overflow-y:auto;font-size:0.8rem">
        <strong>⚠️ Peringatan Nilai Regresi (${warnings.length}):</strong><br>
        ${warnings.slice(0, 5).map(w => `• ${w}`).join('<br>')}
        ${warnings.length > 5 ? `<br><em>...dan ${warnings.length - 5} peringatan lainnya</em>` : ''}
      </div>
    `;
  }

  alertContainer.innerHTML = `
    <div class="alert alert-success">
      <strong>✅ Validasi Berhasil!</strong> ${modalT2MergedRows.length} baris Sub-SLS 16-digit siap diperbarui untuk <strong>Gelombang ${gel} (Termin II)</strong>.
    </div>
    ${warnHtml}
  `;

  document.getElementById('modalT2PreviewStats').textContent = `Total: ${modalT2MergedRows.length} Sub-SLS 16-Digit | Gelombang ${gel}`;
  const tbody = document.getElementById('modalT2PreviewTableBody');
  tbody.innerHTML = modalT2MergedRows.slice(0, 50).map((row, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td><code>${row.kode_subsls}</code></td>
      <td style="text-align:right">${row.prelist.toLocaleString()}</td>
      <td style="text-align:right">${row.baru.toLocaleString()}</td>
      <td style="text-align:right;font-weight:600;color:#0284c7">${row.hasilverif.toLocaleString()}</td>
      <td style="text-align:right">${row.targetsls}</td>
      <td style="text-align:right;font-weight:600;color:${row.sls_selesai === 100 ? '#16a34a' : 'inherit'}">${row.sls_selesai}%</td>
    </tr>
  `).join('');

  document.getElementById('modalT2PreviewSection').style.display = 'block';
}

async function commitModalT2Capaian() {
  if (!modalT2MergedRows || modalT2MergedRows.length === 0) return;
  const gel = document.getElementById('modalT2SelectGelombang')?.value || '1';
  const btn = document.getElementById('modalT2BtnSimpan');
  btn.disabled = true;
  btn.innerHTML = '⏳ Menyimpan...';

  try {
    const payload = modalT2MergedRows.map(r => {
      const item = {
        kode_subsls: r.kode_subsls,
        targetsls: r.targetsls,
        updated_at: new Date().toISOString()
      };
      item[`prelist${gel}`] = r.prelist;
      item[`baru${gel}`] = r.baru;
      item[`hasilverif${gel}`] = r.hasilverif;
      item[`sls_selesai${gel}`] = r.sls_selesai;
      return item;
    });

    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await db.from('capaian_termin2').upsert(chunk, { onConflict: 'kode_subsls' });
      if (error) throw error;
    }

    showToast(`✓ Sukses! ${payload.length} data capaian Sub-SLS untuk Gelombang ${gel} berhasil disimpan.`, 'success');
    closeUploadCapaianT2Modal();
    isBappEligibilityLoadedT2 = false;
  } catch (err) {
    console.error('Error committing capaian:', err);
    showToast('Gagal menyimpan capaian ke database: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '✓ Simpan Capaian ke Database';
  }
}




