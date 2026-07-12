// ============================================================
// MODAL.JS — Bottom Sheet Detail & Tindak Lanjut
// Depends on: config.js, utils.js (escHtml, showToast, formatDate), auth.js
// ============================================================

let currentAssignmentId = null;
let currentGroup = null;
let pendingChanges = {};
let canEdit = false;

async function openDetail(assignmentId) {
  currentAssignmentId = assignmentId;
  pendingChanges = {};
  currentGroup = allData.find(g => g.assignment_id === assignmentId);
  if (!currentGroup) return;

  if (!currentProfile) {
    canEdit = true; // Let guests interact in the modal
  } else {
    canEdit = await canEditSLS(currentGroup.kode_sls_gabungan, currentProfile);
  }

  document.getElementById('sheetTitle').textContent =
    currentGroup.nama_kk || currentGroup.nama_usaha_list[0] || assignmentId.slice(0, 8) + '...';
  document.getElementById('sheetSubtitle').textContent =
    `Assignment ID: ${assignmentId} \u00b7 SLS: ${currentGroup.kode_sls_gabungan}`;
  document.getElementById('fasihLink').href = buildFasihLink(assignmentId);
  document.getElementById('saveBtn').disabled = !canEdit;

  await renderSheetBody();
  document.getElementById('detailModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function renderSheetBody() {
  const body = document.getElementById('sheetBody');
  body.innerHTML = '<div class="spinner" style="margin:1.5rem auto;display:block"></div>';

  const { data: rows, error } = await db
    .from('assignment_anomali')
    .select('*')
    .eq('assignment_id', currentAssignmentId)
    .order('tipe').order('nomor_anomali');

  if (error) {
    body.innerHTML = `<div class="alert alert-error"><span>Gagal memuat: ${error.message}</span></div>`;
    return;
  }

  const { data: refs } = await db.from('anomali_ref').select('*');
  const refMap = {};
  (refs || []).forEach(r => { refMap[`${r.tipe}-${r.nomor}`] = r; });

  const rowIds = rows.map(r => r.id);
  const { data: history } = await db
    .from('status_history').select('*')
    .in('assignment_anomali_id', rowIds)
    .order('created_at', { ascending: false }).limit(50);

  const historyMap = {};
  (history || []).forEach(h => {
    if (!historyMap[h.assignment_anomali_id]) historyMap[h.assignment_anomali_id] = [];
    historyMap[h.assignment_anomali_id].push(h);
  });

  const nama_kk = rows.find(r => r.tipe === 'keluarga')?.nama_entitas;
  const usahaNames = [...new Set(rows.filter(r => r.tipe === 'usaha').map(r => r.nama_entitas).filter(Boolean))];

  let html = `<div class="card mb-4" style="padding:0.875rem 1rem">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;font-size:0.8125rem">
      <div><span style="color:var(--text-muted)">Kepala Keluarga</span><br><strong>${escHtml(nama_kk || '\u2014')}</strong></div>
      <div><span style="color:var(--text-muted)">Kode SLS</span><br><strong class="mono">${currentGroup.kode_sls_gabungan}</strong></div>
      ${usahaNames.length > 0 ? `<div style="grid-column:1/-1"><span style="color:var(--text-muted)">Usaha</span><br><strong>${escHtml(usahaNames.join(', '))}</strong></div>` : ''}
      <div><span style="color:var(--text-muted)">Pertama Terdeteksi</span><br><strong>${formatDate(currentGroup.first_seen)}</strong></div>
      <div><span style="color:var(--text-muted)">Terakhir Terdeteksi</span><br><strong>${formatDate(currentGroup.last_seen)}</strong></div>
    </div>
  </div>`;

  if (!canEdit) {
    html += `<div class="alert alert-info mb-4"><svg class="alert-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg><span>Anda hanya dapat melihat data ini. Akses edit tidak tersedia untuk SLS ini.</span></div>`;
  }

  const kkRows    = rows.filter(r => r.tipe === 'keluarga');
  const usahaRows = rows.filter(r => r.tipe === 'usaha');

  if (kkRows.length > 0) {
    html += `<div class="anomali-section-title">Anomali Keluarga</div>`;
    html += kkRows.map(r => renderAnomaliItem(r, refMap, historyMap[r.id] || [])).join('');
  }

  if (usahaRows.length > 0) {
    const usahaGroups = {};
    usahaRows.forEach(r => {
      const key = r.nama_entitas || 'Tanpa Nama';
      if (!usahaGroups[key]) usahaGroups[key] = [];
      usahaGroups[key].push(r);
    });
    Object.entries(usahaGroups).forEach(([uName, uRows]) => {
      html += `<div class="anomali-section-title">Anomali Usaha \u2014 ${escHtml(uName)}</div>`;
      html += uRows.map(r => renderAnomaliItem(r, refMap, historyMap[r.id] || [])).join('');
    });
  }

  const sampleRow = rows[0];
  if (sampleRow?.raw_data && Object.keys(sampleRow.raw_data).length > 0) {
    const validEntries = Object.entries(sampleRow.raw_data).filter(([k, v]) => v !== null && v !== '' && v !== '-');
    if (validEntries.length > 0) {
      html += `<div class="divider"></div>
      <button class="history-toggle" onclick="toggleRawData()">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        Lihat Data Mentah
      </button>
      <div id="rawDataSection" class="hidden" style="margin-top:0.75rem">
        <div class="raw-data-grid">
          ${validEntries.map(([k, v]) => `<div class="raw-data-item"><span class="raw-data-key">${escHtml(k)}:</span><span class="raw-data-val">${escHtml(String(v))}</span></div>`).join('')}
        </div>
      </div>`;
    }
  }

  body.innerHTML = html;
}

function renderAnomaliItem(row, refMap, historyList) {
  const ref = refMap[`${row.tipe}-${row.nomor_anomali}`];
  const statusConf = STATUS_CONFIG[row.status] || {};
  const statusOptions = Object.entries(STATUS_CONFIG)
    .map(([val, conf]) => `<option value="${val}" ${row.status === val ? 'selected' : ''}>${conf.label}</option>`).join('');

  const historyHtml = historyList.length > 0
    ? historyList.slice(0, 5).map(h =>
        `<div class="history-item">
          <span class="${h.sumber === 'merge_otomatis' ? 'history-source-auto' : 'history-source-manual'}">[${h.sumber === 'merge_otomatis' ? 'Sistem' : 'Manual'}]</span>
          ${formatDate(h.created_at, true)} \u00b7 ${escHtml(h.diubah_oleh_nama || 'Sistem')}
          <br>${escHtml(STATUS_CONFIG[h.status_lama]?.label || h.status_lama || '\u2014')} \u2192 ${escHtml(STATUS_CONFIG[h.status_baru]?.label || h.status_baru)}
          ${h.catatan ? `<br><em style="font-size:0.75rem">${escHtml(h.catatan)}</em>` : ''}
        </div>`).join('')
    : '<div class="history-item">Belum ada riwayat perubahan</div>';

  return `<div class="anomali-item">
    <div class="anomali-item-header">
      <span class="anomali-number">#${row.nomor_anomali}</span>
      <span class="anomali-name">${escHtml(row.nama_anomali || ref?.nama || 'Anomali')}</span>
      ${row.is_ever_reopened ? '<span class="reopen-badge">Re-open</span>' : ''}
      <span class="status-badge ${statusConf.color}" style="margin-left:auto">${statusConf.label}</span>
    </div>
    ${ref?.penjelasan ? `<div class="anomali-explanation">${escHtml(ref.penjelasan)}</div>` : ''}
    <div class="anomali-status-row">
      <div class="form-group">
        <label class="form-label-sm">Status Tindak Lanjut</label>
        <select class="form-select" style="font-size:0.875rem" onchange="onStatusChange('${row.id}', this.value)" ${!canEdit ? 'disabled' : ''}>${statusOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label-sm">Catatan (opsional)</label>
        <textarea class="form-textarea" style="font-size:0.8125rem;min-height:60px" onchange="onCatatanChange('${row.id}', this.value)" ${!canEdit ? 'disabled' : ''}>${escHtml(row.catatan || '')}</textarea>
      </div>
    </div>
    <button class="history-toggle" onclick="toggleHistory('hist-${row.id}')">
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
      Riwayat Perubahan
    </button>
    <div id="hist-${row.id}" class="hidden" style="padding:0.5rem 0">${historyHtml}</div>
  </div>`;
}

function onStatusChange(rowId, v)  { if (!pendingChanges[rowId]) pendingChanges[rowId] = {}; pendingChanges[rowId].status  = v; }
function onCatatanChange(rowId, v) { if (!pendingChanges[rowId]) pendingChanges[rowId] = {}; pendingChanges[rowId].catatan = v; }
function toggleHistory(id)  { const el = document.getElementById(id); if (el) el.classList.toggle('hidden'); }
function toggleRawData()    { const el = document.getElementById('rawDataSection'); if (el) el.classList.toggle('hidden'); }

async function saveChanges() {
  if (!currentProfile) {
    window.location.href = '/login.html';
    return;
  }
  if (!canEdit) return;
  const changes = Object.entries(pendingChanges);
  if (changes.length === 0) { showToast('Tidak ada perubahan untuk disimpan', 'info'); return; }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';

  try {
    const sessionName = getSessionName(currentProfile);
    const now = new Date().toISOString();

    for (const [rowId, ch] of changes) {
      const { data: cur } = await db.from('assignment_anomali').select('status,catatan').eq('id', rowId).single();
      const upd = { updated_at: now, updated_by_nama: sessionName, updated_by_id: currentProfile.id };

      if (ch.status !== undefined && ch.status !== cur.status) {
        upd.status = ch.status;
        await db.from('status_history').insert({
          assignment_anomali_id: rowId,
          status_lama: cur.status,
          status_baru: ch.status,
          diubah_oleh_nama: sessionName,
          diubah_oleh_id: currentProfile.id,
          catatan: ch.catatan || null,
          sumber: 'manual'
        });
      }
      if (ch.catatan !== undefined) upd.catatan = ch.catatan;
      await db.from('assignment_anomali').update(upd).eq('id', rowId);
    }

    showToast('Perubahan berhasil disimpan', 'success');
    pendingChanges = {};
    closeDetailModal();
    await loadData();
    await loadStats();
  } catch (e) {
    showToast('Gagal menyimpan: ' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg> Simpan Perubahan';
  }
}

function closeDetailModal() {
  document.getElementById('detailModal').classList.remove('open');
  document.body.style.overflow = '';
  currentAssignmentId = null; currentGroup = null; pendingChanges = {};
}
function handleOverlayClick(e) { if (e.target === document.getElementById('detailModal')) closeDetailModal(); }
