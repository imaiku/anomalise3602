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

  // Push state to browser history for mobile back button control
  window.history.pushState({ modalOpen: 'detail' }, '');
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
    .from('status_history')
    .select('*, profiles:diubah_oleh_id(role)')
    .in('assignment_anomali_id', rowIds)
    .order('created_at', { ascending: false }).limit(50);

  const historyMap = {};
  (history || []).forEach(h => {
    if (!historyMap[h.assignment_anomali_id]) historyMap[h.assignment_anomali_id] = [];
    historyMap[h.assignment_anomali_id].push(h);
  });

  const nama_kk = rows.find(r => r.tipe === 'keluarga')?.nama_entitas;
  const usahaNames = [...new Set(rows.filter(r => r.tipe === 'usaha').map(r => r.nama_entitas).filter(Boolean))];

  // Fetch regional details from master_wilayah view
  let alamat = `Kode SLS: ${currentGroup.kode_sls_gabungan}`;
  try {
    const { data: wilData } = await db
      .from('master_wilayah')
      .select('nmkec, nmdesa, nmsls, nmsubsls')
      .eq('kode_sls_gabungan', currentGroup.kode_sls_gabungan)
      .maybeSingle();

    if (wilData) {
      const slsName = wilData.nmsls || '—';
      const subName = wilData.nmsubsls || '—';
      const slsPart = (slsName.trim().toLowerCase() === subName.trim().toLowerCase()) 
        ? slsName 
        : `${slsName} (${subName})`;
      alamat = `Kec. ${wilData.nmkec}, Desa ${wilData.nmdesa}, ${slsPart}`;
    }
  } catch (err) {
    console.error('Error fetching regional details:', err);
  }

  let html = '';
  
  const isAdmin = currentProfile && ['superadmin', 'admin'].includes(currentProfile.role);
  if (isAdmin) {
    const showAnomalyVal = rows[0]?.show_anomaly === true;
    const isRejectedVal = rows[0]?.is_rejected === true;

    html += `<div class="card mb-4" style="padding:0.875rem 1rem; border: 1px solid var(--border); border-left: 4px solid var(--primary)">
      <div style="font-weight:600; font-size:0.85rem; color:var(--text); margin-bottom:0.75rem; display:flex; align-items:center; gap:0.4rem">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
        Status Reject Assignment (Monitoring Admin)
      </div>
      <div style="display:flex; flex-direction:column; gap:0.5rem; font-size:0.8125rem">
        <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; color:var(--text)">
          <input type="checkbox" id="modalShowAnomaly" ${showAnomalyVal ? 'checked' : ''} onchange="onShowAnomalyToggle(this.checked)" style="width:16px; height:16px; accent-color:var(--primary)">
          <span>Tampilkan Anomali <span style="color:var(--text-subtle); font-size:0.75rem">(tampilkan list anomali di akun petugas PPL/PML)</span></span>
        </label>
        <label id="modalRejectLabel" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; color:${showAnomalyVal ? 'var(--text)' : 'var(--text-muted)'}">
          <input type="checkbox" id="modalReject" ${isRejectedVal ? 'checked' : ''} ${showAnomalyVal ? '' : 'disabled'} style="width:16px; height:16px; accent-color:var(--primary)">
          <span>Reject <span style="color:var(--text-subtle); font-size:0.75rem">(telah direject di Fasih-SM)</span></span>
        </label>
      </div>
    </div>`;
  }

  html += `<div class="card mb-4" style="padding:0.875rem 1rem">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;font-size:0.8125rem">
      <div><span style="color:var(--text-muted)">Kepala Keluarga</span><br><strong>${escHtml(nama_kk || '\u2014')}</strong></div>
      <div style="grid-column:1/-1"><span style="color:var(--text-muted)">Alamat</span><br><strong>${escHtml(alamat)}</strong></div>
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



  body.innerHTML = html;
}

function renderAnomaliItem(row, refMap, historyList) {
  const ref = refMap[`${row.tipe}-${row.nomor_anomali}`];
  const statusConf = STATUS_CONFIG[row.status] || {};
  const statusOptions = Object.entries(STATUS_CONFIG)
    .map(([val, conf]) => `<option value="${val}" ${row.status === val ? 'selected' : ''}>${conf.label}</option>`).join('');

  const historyHtml = historyList.length > 0
    ? historyList.slice(0, 5).map(h => {
        const roleText = h.profiles?.role ? h.profiles.role.toUpperCase() : 'SISTEM';
        return `<div class="history-item">
          <span class="${h.sumber === 'merge_otomatis' ? 'history-source-auto' : 'history-source-manual'}">[${h.sumber === 'merge_otomatis' ? 'Sistem' : 'Manual'}]</span>
          ${formatDate(h.created_at, true)} \u00b7 ${escHtml(h.diubah_oleh_nama || 'Sistem')} - <strong style="font-size:0.7rem;color:var(--primary)">${escHtml(roleText)}</strong>
          <br>${escHtml(STATUS_CONFIG[h.status_lama]?.label || h.status_lama || '\u2014')} \u2192 ${escHtml(STATUS_CONFIG[h.status_baru]?.label || h.status_baru)}
          ${h.catatan ? `<br><em style="font-size:0.75rem">${escHtml(h.catatan)}</em>` : ''}
        </div>`;
      }).join('')
    : '<div class="history-item">Belum ada riwayat perubahan</div>';

  return `<div class="anomali-item">
    <div class="anomali-item-header">
      <span class="anomali-number">#${row.nomor_anomali}</span>
      <span class="anomali-name">${escHtml(row.nama_anomali || ref?.nama || 'Anomali')}</span>
      ${row.is_ever_reopened ? '<span class="reopen-badge">Re-open</span>' : ''}
      <span class="status-badge ${statusConf.color}" style="margin-left:auto">${statusConf.label}</span>
    </div>
    ${ref?.penjelasan ? `<div class="anomali-explanation">${escHtml(ref.penjelasan)}</div>` : ''}
    
    <!-- Relevant Raw Data Display (Show Raw Data with Converted Codes and Units) -->
    ${(() => {
      if (!row.raw_data || Object.keys(row.raw_data).length === 0) return '';
      
      const entries = Object.entries(row.raw_data).filter(([k, v]) => {
        return v !== null && v !== '' && v !== '-' && v !== undefined;
      });

      if (entries.length === 0) return '';

      return `<div style="background:var(--bg); border:1px solid var(--border); border-radius:var(--radius-sm); padding:0.6rem 0.8rem; margin: 0.5rem 0 0.875rem 0; font-size:0.8rem">
        <div style="font-weight:600; color:var(--text-muted); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.4rem">Data Pendukung:</div>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:0.4rem 0.75rem">
          ${entries.map(([k, v]) => {
            const kClean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            let vDisplay = String(v);
            
            // 1. Format nominal uang / Rupiah
            if (kClean.includes('biaya') || kClean.includes('pendapatan') || kClean.includes('pengeluaran') || kClean.includes('gaji') || kClean.includes('rupiah') || kClean.includes('selisih') || kClean.includes('omset') || kClean.includes('omzet') || (kClean.includes('listrik') && !kClean.includes('daya'))) {
              const num = parseFloat(v);
              if (!isNaN(num)) {
                vDisplay = num < 0 ? `-Rp${Math.abs(num).toLocaleString('id')}` : `Rp${num.toLocaleString('id')}`;
              }
            } 
            // 2. Format satuan luas m²
            else if (kClean.includes('luas') || kClean.includes('lantai')) {
              const num = parseFloat(v);
              vDisplay = !isNaN(num) ? `${v} m²` : vDisplay;
            } 
            // 3. Decode daya terpasang
            else if (kClean.includes('daya') || kClean.includes('power')) {
              const dMap = { '1': '450 watt', '2': '900 watt', '3': '1.300 watt', '4': '2.200 watt', '5': '> 2.200 watt' };
              vDisplay = dMap[String(v).trim()] || `${v} Watt/VA`;
            } 
            // 4. Decode memproduksi sendiri / produk sendiri
            else if (kClean.includes('produksendiri') || kClean.includes('produksisendiri') || kClean.includes('produkssendiri')) {
              const valStr = String(v).trim();
              if (valStr === '1') vDisplay = 'Ya';
              else if (valStr === '2') vDisplay = 'Tidak';
            } 
            // 5. Decode status badan usaha
            else if (kClean.includes('badanusaha')) {
              const valStr = String(v).trim().toLowerCase().replace(/\s+/g, '').replace('.', '');
              const buMap = {
                '1a': 'Perseroan (PT/NV/Tbk/Daerah)',
                '1b': 'Perseroan Perorangan',
                '2': 'Yayasan',
                '3': 'Koperasi',
                '4': 'Dana Pensiun',
                '5': 'Perum/Perumda',
                '6': 'BUM Desa',
                '7': 'CV',
                '8': 'Firma (Fa)',
                '9': 'Persekutuan Perdata',
                '10': 'Kantor Perwakilan Luar Negeri',
                '11': 'Badan Usaha Luar Negeri',
                '12': 'Badan Usaha Lainnya (BLU, PTN-BH)',
                '13': 'Bukan Badan Usaha'
              };
              vDisplay = buMap[valStr] || vDisplay;
            }
            // 6. Format persentase / rasio
            else if (kClean.includes('rasio') || kClean.includes('persen')) {
              const num = parseFloat(v);
              if (!isNaN(num)) {
                vDisplay = `${num.toFixed(2)}%`;
              }
            } 
            
            return `<div>
              <span style="color:var(--text-muted); font-size:0.75rem">${escHtml(k.replace(/_/g, ' '))}:</span><br>
              <strong style="color:var(--primary); font-size:0.85rem">${escHtml(vDisplay)}</strong>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    })()}


    <div class="anomali-status-row">
      <div class="form-group">
        <label class="form-label-sm">Status Tindak Lanjut</label>
        <select class="form-select" style="font-size:0.875rem" onchange="onStatusChange('${row.id}', this.value)" ${!canEdit ? 'disabled' : ''}>${statusOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label-sm">Catatan <span style="color:var(--error)">* (Wajib diisi jika ada perubahan)</span></label>
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

function onShowAnomalyToggle(checked) {
  const rejectCb = document.getElementById('modalReject');
  const rejectLabel = document.getElementById('modalRejectLabel');
  if (rejectCb) {
    rejectCb.disabled = !checked;
    if (!checked) {
      rejectCb.checked = false;
    }
  }
  if (rejectLabel) {
    rejectLabel.style.color = checked ? 'var(--text)' : 'var(--text-muted)';
  }
}

let afterLoginCallback = null;

async function saveChanges() {
  if (!currentProfile) {
    // Save the callback to execute after successful background authentication
    afterLoginCallback = async () => {
      await saveChanges();
    };
    openLoginModal();
    return;
  }
  if (!canEdit) return;
  
  const changes = Object.entries(pendingChanges);
  const isAdmin = currentProfile && ['superadmin', 'admin'].includes(currentProfile.role);
  
  let hasCheckboxChanges = false;
  let showAnomalyChecked = true;
  let isRejectedChecked = false;
  
  if (isAdmin) {
    showAnomalyChecked = document.getElementById('modalShowAnomaly')?.checked ?? true;
    isRejectedChecked = document.getElementById('modalReject')?.checked ?? false;
    
    const initialShowAnomaly = currentGroup.show_anomaly !== false;
    const initialIsRejected = currentGroup.is_rejected === true;
    
    if (showAnomalyChecked !== initialShowAnomaly || isRejectedChecked !== initialIsRejected) {
      hasCheckboxChanges = true;
    }
  }

  if (changes.length === 0 && !hasCheckboxChanges) {
    showToast('Tidak ada perubahan untuk disimpan', 'info');
    return;
  }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';

  try {
    const sessionName = getSessionName(currentProfile);
    const now = new Date().toISOString();

    if (isAdmin && hasCheckboxChanges) {
      const { error: updErr } = await db
        .from('assignment_anomali')
        .update({
          show_anomaly: showAnomalyChecked,
          is_rejected: isRejectedChecked,
          updated_at: now,
          updated_by_nama: sessionName,
          updated_by_id: currentProfile.id
        })
        .eq('assignment_id', currentAssignmentId);
        
      if (updErr) throw updErr;
      
      currentGroup.show_anomaly = showAnomalyChecked;
      currentGroup.is_rejected = isRejectedChecked;
    }

    for (const [rowId, ch] of changes) {
      const { data: cur } = await db.from('assignment_anomali').select('status,catatan').eq('id', rowId).single();
      const upd = { updated_at: now, updated_by_nama: sessionName, updated_by_id: currentProfile.id };

      const isStatusChanged = ch.status !== undefined && ch.status !== cur.status;
      const isCatatanChanged = ch.catatan !== undefined && ch.catatan !== cur.catatan;

      if (isStatusChanged || isCatatanChanged) {
        const noteToSave = ch.catatan !== undefined ? ch.catatan.trim() : (cur.catatan ? cur.catatan.trim() : '');
        if (!noteToSave) {
          showToast('Catatan wajib diisi jika Anda melakukan perubahan status atau catatan!', 'warning');
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg> Simpan Perubahan';
          return;
        }

        if (isStatusChanged) upd.status = ch.status;
        if (ch.catatan !== undefined) upd.catatan = ch.catatan;

        await db.from('status_history').insert({
          assignment_anomali_id: rowId,
          status_lama: cur.status,
          status_baru: ch.status !== undefined ? ch.status : cur.status,
          diubah_oleh_nama: sessionName,
          diubah_oleh_id: currentProfile.id,
          catatan: noteToSave,
          sumber: 'manual'
        });
      }
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

function closeDetailModal(triggerHistoryBack = true) {
  const modal = document.getElementById('detailModal');
  if (modal && modal.classList.contains('open')) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    currentAssignmentId = null; currentGroup = null; pendingChanges = {};
    if (triggerHistoryBack && window.history.state?.modalOpen === 'detail') {
      window.history.back();
    }
  }
}
function handleOverlayClick(e) { if (e.target === document.getElementById('detailModal')) closeDetailModal(); }

// BULK EDIT MODAL CONTROLLER
let bulkSelectedData = [];
function openBulkModal() {
  if (!selectedIds.size) return;
  if (selectedIds.size > 10) {
    showToast('Maksimal assignment yang dapat dibuka bersamaan adalah 10!', 'warning');
    return;
  }
  bulkSelectedData = allData.filter(g => selectedIds.has(g.assignment_id));
  renderBulkSheetBody();
  
  const modal = document.getElementById('bulkModal');
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    window.history.pushState({ modalOpen: 'bulk' }, '');
  }
}

function openAllBulkTabs() {
  if (bulkSelectedData.length === 0) return;
  const count = bulkSelectedData.length;
  if (count > 5) {
    if (!confirm(`Apakah Anda yakin ingin membuka ${count} tab Fasih-SM sekaligus?`)) {
      return;
    }
  }
  
  bulkSelectedData.forEach(g => {
    const url = buildFasihLink(g.assignment_id);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  
  showToast(`Membuka ${count} tautan Fasih-SM. Sila izinkan pop-up jika terblokir.`, 'success');
}
function closeBulkModal(triggerHistoryBack = true) {
  const modal = document.getElementById('bulkModal');
  if (modal && modal.classList.contains('open')) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    if (triggerHistoryBack && window.history.state?.modalOpen === 'bulk') {
      window.history.back();
    }
  }
}
function handleBulkOverlayClick(e) {
  if (e.target === document.getElementById('bulkModal')) closeBulkModal();
}
function renderBulkSheetBody() {
  const body = document.getElementById('bulkSheetBody');
  if (!body) return;
  
  let html = `<div style="overflow-x:auto">
    <table class="table" style="width:100%; font-size:0.8rem; border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid var(--border)">
          <th style="padding:0.75rem; text-align:left">Nama KK / Usaha</th>
          <th style="padding:0.75rem; text-align:center; width:130px">Tampilkan Anomali</th>
          <th style="padding:0.75rem; text-align:center; width:90px">Reject</th>
          <th style="padding:0.75rem; text-align:center; width:180px">Aksi</th>
        </tr>
      </thead>
      <tbody>`;
      
  bulkSelectedData.forEach((g, idx) => {
    const showAnomalyVal = g.show_anomaly === true;
    const isRejectedVal = g.is_rejected === true;
    
    const nameParts = [];
    if (g.nama_kk) nameParts.push(g.nama_kk);
    if (g.nama_usaha_list.length > 0) {
      nameParts.push(g.nama_usaha_list.join(', '));
    }
    const combinedName = nameParts.length > 0 ? nameParts.join(' / ') : '—';
    const fasihUrl = buildFasihLink(g.assignment_id);
    
    html += `
        <tr style="border-bottom:1px solid var(--border)">
          <td style="padding:0.75rem">
            <div style="font-weight:600; color:var(--text)">${escHtml(combinedName)}</div>
            <div style="font-size:0.7rem; color:var(--text-muted)">${g.kode_sls_gabungan} &nbsp;·&nbsp; ${g.assignment_id.slice(0, 8)}...</div>
          </td>
          <td style="padding:0.75rem; text-align:center">
            <input type="checkbox" class="bulk-show-cb" data-idx="${idx}" ${showAnomalyVal ? 'checked' : ''} onchange="onBulkShowAnomalyToggle(${idx}, this.checked)" style="width:16px; height:16px; accent-color:var(--primary); cursor:pointer">
          </td>
          <td style="padding:0.75rem; text-align:center">
            <input type="checkbox" class="bulk-reject-cb" id="bulkReject-${idx}" data-idx="${idx}" ${isRejectedVal ? 'checked' : ''} ${showAnomalyVal ? '' : 'disabled'} style="width:16px; height:16px; accent-color:var(--primary); cursor:pointer">
          </td>
          <td style="padding:0.75rem; text-align:center; white-space:nowrap">
            <a href="${fasihUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding:0.25rem 0.5rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.2rem">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
              Buka
            </a>
            <button id="btnRejectApi-${idx}" onclick="rejectIndividualAssignment(${idx}, '${g.assignment_id}')" class="btn btn-secondary btn-sm" style="padding:0.25rem 0.5rem; font-size:0.75rem; display:inline-flex; align-items:center; gap:0.2rem; background:var(--error); color:#fff; border:none; margin-left:0.25rem">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
              Reject API
            </button>
          </td>
        </tr>`;
  });
  
  html += `</tbody></table></div>`;
  body.innerHTML = html;
}
function onBulkShowAnomalyToggle(idx, checked) {
  const rejectCb = document.getElementById(`bulkReject-${idx}`);
  const label = document.getElementById(`bulkRejectLabel-${idx}`);
  if (rejectCb) {
    rejectCb.disabled = !checked;
    if (!checked) {
      rejectCb.checked = false;
    }
  }
  if (label) {
    label.style.color = checked ? 'var(--text)' : 'var(--text-muted)';
  }
}
async function saveBulkChanges() {
  const saveBtn = document.getElementById('bulkSaveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';
  
  try {
    const sessionName = getSessionName(currentProfile);
    const now = new Date().toISOString();
    const showCbs = document.querySelectorAll('.bulk-show-cb');
    const rejectCbs = document.querySelectorAll('.bulk-reject-cb');
    
    for (let i = 0; i < bulkSelectedData.length; i++) {
      const g = bulkSelectedData[i];
      const showAnomalyVal = showCbs[i]?.checked ?? false;
      const isRejectedVal = rejectCbs[i]?.checked ?? false;
      
      const { error: updErr } = await db
        .from('assignment_anomali')
        .update({
          show_anomaly: showAnomalyVal,
          is_rejected: isRejectedVal,
          updated_at: now,
          updated_by_nama: sessionName,
          updated_by_id: currentProfile.id
        })
        .eq('assignment_id', g.assignment_id);
        
      if (updErr) throw updErr;
      
      g.show_anomaly = showAnomalyVal;
      g.is_rejected = isRejectedVal;
    }
    
    showToast('Perubahan massal berhasil disimpan', 'success');
    clearSelection();
    closeBulkModal(true);
    await loadData();
    await loadStats();
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Simpan Perubahan`;
  }
}

// Listen to browser popstate to close modal on back button press
window.addEventListener('popstate', (e) => {
  const modal = document.getElementById('detailModal');
  if (modal && modal.classList.contains('open')) {
    if (!e.state || e.state.modalOpen !== 'detail') {
      closeDetailModal(false);
    }
  }
  const bulkModal = document.getElementById('bulkModal');
  if (bulkModal && bulkModal.classList.contains('open')) {
    if (!e.state || e.state.modalOpen !== 'bulk') {
      closeBulkModal(false);
    }
  }
});

// ============================================================
// INLINE LOGIN MODAL CONTROLLER
// ============================================================
function detectModalLoginType(value) {
  const hint     = document.getElementById('modalLoginTypeHint');
  const dot      = document.getElementById('modalLoginTypeDot');
  const typeText = document.getElementById('modalLoginTypeText');
  const passLbl  = document.getElementById('modalLoginPassLabel');
  const isPPL    = /^\d+$/.test(value.trim()) && value.trim().length > 0;
  if (hint) {
    hint.style.borderColor  = isPPL ? 'var(--primary)' : 'var(--border)';
    hint.style.color        = isPPL ? 'var(--text)' : 'var(--text-muted)';
  }
  if (dot)  dot.style.background = isPPL ? 'var(--primary)' : 'var(--border-strong)';
  if (typeText) {
    typeText.textContent = isPPL
      ? 'Terdeteksi sebagai PPL/PML — gunakan NIK sebagai password'
      : value.trim().length > 0
        ? 'Terdeteksi sebagai Admin — gunakan password Anda'
        : 'Masukkan Sobat ID atau email';
  }
  if (passLbl) passLbl.textContent = isPPL ? 'NIK (Password)' : 'Password';
}

function toggleModalPassword() {
  const input  = document.getElementById('loginPassword');
  const eyeO   = document.getElementById('modalEyeOpen');
  const eyeC   = document.getElementById('modalEyeClosed');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    eyeO?.classList.add('hidden');
    eyeC?.classList.remove('hidden');
  } else {
    input.type = 'password';
    eyeO?.classList.remove('hidden');
    eyeC?.classList.add('hidden');
  }
}

function openLoginModal() {
  const errDiv = document.getElementById('loginModalError');
  if (errDiv) errDiv.classList.add('hidden');
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPassword');
  if (emailEl) { emailEl.value = ''; }
  if (passEl)  { passEl.value = ''; passEl.type = 'password'; }
  // Reset type hint
  detectModalLoginType('');
  document.getElementById('modalEyeOpen')?.classList.remove('hidden');
  document.getElementById('modalEyeClosed')?.classList.add('hidden');
  document.getElementById('loginModal').classList.add('open');
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('open');
  afterLoginCallback = null;
}

function handleLoginOverlayClick(e) {
  if (e.target === document.getElementById('loginModal')) {
    closeLoginModal();
  }
}

async function handleModalLoginSubmit() {
  const emailInput = document.getElementById('loginEmail').value.trim();
  const password   = document.getElementById('loginPassword').value;
  const errDiv     = document.getElementById('loginModalError');
  const errText    = document.getElementById('loginModalErrorText');
  const btn        = document.getElementById('loginModalSubmitBtn');
  const btnText    = document.getElementById('loginModalBtnText');
  const spinner    = document.getElementById('loginModalSpinner');

  if (!emailInput || !password) {
    if (errText) errText.textContent = 'Sobat ID/email dan password wajib diisi';
    errDiv?.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  if (btnText) btnText.textContent = 'Memverifikasi...';
  spinner?.classList.remove('hidden');
  errDiv?.classList.add('hidden');

  try {
    let email = emailInput;
    if (!email.includes('@')) {
      email = `${emailInput}@anomali3602.se`;
    } else if (!email.endsWith('@anomali3602.se')) {
      try {
        const { data: resolvedEmail } = await db.rpc('resolve_auth_email', { p_email: email });
        if (resolvedEmail) {
          email = resolvedEmail;
        }
      } catch (e) {
        console.error('Failed to resolve auth email:', e);
      }
    }

    const { data: authData, error: authErr } = await db.auth.signInWithPassword({ email, password });
    if (authErr) {
      const msg = authErr.message.includes('Invalid login')
        ? 'Sobat ID / password salah. Periksa kembali.'
        : authErr.message;
      throw new Error(msg);
    }

    const { data: profile, error: profErr } = await db
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profErr || !profile) throw new Error('Akun tidak ditemukan. Hubungi administrator.');
    if (!profile.is_active)  throw new Error('Akun Anda telah dinonaktifkan.');

    currentProfile = profile;

    // Sync header navigation UI
    const userDisplayName = document.getElementById('userDisplayName');
    const userRoleBadge   = document.getElementById('userRoleBadge');
    const loginNavBtn     = document.getElementById('loginNavBtn');
    const logoutNavBtn    = document.getElementById('logoutNavBtn');
    const adminNavBtn     = document.getElementById('adminNavBtn');

    if (userDisplayName) userDisplayName.textContent = getSessionName(profile);
    if (userRoleBadge) {
      userRoleBadge.textContent = profile.role.toUpperCase();
      userRoleBadge.className = `type-badge type-${
        profile.role === 'ppl' ? 'keluarga' :
        profile.role === 'pml' ? 'usaha' : 'keduanya'}`;
      userRoleBadge.style.display = 'inline-block';
    }
    loginNavBtn?.classList.add('hidden');
    logoutNavBtn?.classList.remove('hidden');
    const isAdmin = ['superadmin', 'admin'].includes(profile.role);
    adminNavBtn?.classList.toggle('hidden', !isAdmin);

    // Re-verify edit rights for this SLS
    canEdit = await canEditSLS(currentGroup.kode_sls_gabungan, currentProfile);
    document.getElementById('saveBtn').disabled = !canEdit;

    closeLoginModal();
    showToast('Login berhasil!', 'success');

    // Run callback to automatically save the pending changes
    if (afterLoginCallback) {
      const cb = afterLoginCallback;
      afterLoginCallback = null;
      await cb();
    }
  } catch (err) {
    const errText = document.getElementById('loginModalErrorText');
    if (errText) errText.textContent = err.message;
    else errDiv.textContent = err.message;
    errDiv?.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    if (btnText) btnText.textContent = 'Masuk & Simpan';
    spinner?.classList.add('hidden');
  }
}

// ============================================================
// FASIH-SM API REJECT INTEGRATION
// ============================================================
async function callRejectAPI(assignmentId) {
  try {
    const response = await fetch('https://fasih-sm.bps.go.id/app/api/assignment-approval/api/v2/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assignmentId: assignmentId,
        statusApproval: "false",
        comment: JSON.stringify({ dataKey: "", notes: [] })
      })
    });
    
    if (response.ok) {
      showToast(`Assignment ${assignmentId.slice(0, 8)}... berhasil direject di Fasih-SM!`, 'success');
      return true;
    } else {
      const errText = await response.text();
      throw new Error(errText || `HTTP error ${response.status}`);
    }
  } catch (err) {
    console.error('Reject API error:', err);
    showToast(`Gagal reject ${assignmentId.slice(0, 8)}...: ${err.message}. Pastikan Anda sudah login di Fasih-SM dan mengaktifkan ekstensi CORS jika diperlukan.`, 'error');
    return false;
  }
}

async function rejectIndividualAssignment(idx, assignmentId) {
  const btn = document.getElementById(`btnRejectApi-${idx}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Processing...';
  }
  
  const success = await callRejectAPI(assignmentId);
  
  if (success) {
    const showCb = document.querySelectorAll('.bulk-show-cb')[idx];
    const rejectCb = document.getElementById(`bulkReject-${idx}`);
    
    if (showCb) {
      showCb.checked = true;
      onBulkShowAnomalyToggle(idx, true);
    }
    if (rejectCb) {
      rejectCb.checked = true;
    }
  }
  
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Reject API`;
  }
}

async function rejectAllBulkAssignments() {
  const btn = document.getElementById('bulkRejectAllBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Rejecting...';
  }
  
  let successCount = 0;
  for (let i = 0; i < bulkSelectedData.length; i++) {
    const g = bulkSelectedData[i];
    const success = await callRejectAPI(g.assignment_id);
    if (success) {
      successCount++;
      const showCb = document.querySelectorAll('.bulk-show-cb')[i];
      const rejectCb = document.getElementById(`bulkReject-${i}`);
      if (showCb) {
        showCb.checked = true;
        onBulkShowAnomalyToggle(i, true);
      }
      if (rejectCb) {
        rejectCb.checked = true;
      }
    }
  }
  
  showToast(`Selesai memproses reject: ${successCount} dari ${bulkSelectedData.length} berhasil.`, 'info');
  
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg> Reject Semua (API)`;
  }
}
