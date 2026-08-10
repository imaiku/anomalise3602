/**
 * js/kelola-petugas-sls.js
 * ============================================================
 * Logic Halaman Kelola Petugas SLS (/kelola-petugas-sls)
 * ============================================================
 */

let allKelolaRows = [];
let filteredKelolaRows = [];
let allKecList = [];
let allDesaList = [];

let kelolaCurrentPage = 1;
let kelolaPageSize = 25;

let activeEditKodeSubSls = null;
let parsedImportRows = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initKelolaPetugasPage();
  } catch (err) {
    console.error('Error initializing Kelola Petugas page:', err);
  }
});

async function initKelolaPetugasPage() {
  // Load Master Kecamatan & Desa
  const { data: kecData } = await db.from('wilayah_kec').select('kode_kec, nmkec').order('nmkec');
  allKecList = kecData || [];
  populateKecDropdown();

  const { data: desaData } = await db.from('wilayah_desa').select('kode_desa, kode_kec, nmdesa').order('nmdesa');
  allDesaList = desaData || [];
  populateDesaDropdown();

  // Setup Event Listeners
  document.getElementById('filterStatusPetugas').addEventListener('change', filterAndRender);
  document.getElementById('filterKecamatan').addEventListener('change', () => {
    populateDesaDropdown();
    filterAndRender();
  });
  document.getElementById('filterDesa').addEventListener('change', filterAndRender);
  document.getElementById('searchInput').addEventListener('input', filterAndRender);

  // Fetch Data
  await loadKelolaData();
}

function populateKecDropdown() {
  const sel = document.getElementById('filterKecamatan');
  if (!sel) return;
  sel.innerHTML = '<option value="">Semua Kecamatan</option>' +
    allKecList.map(k => `<option value="${k.kode_kec}">${k.nmkec}</option>`).join('');
}

function populateDesaDropdown() {
  const selKec = document.getElementById('filterKecamatan').value;
  const selDesa = document.getElementById('filterDesa');
  if (!selDesa) return;

  let list = allDesaList;
  if (selKec) {
    list = list.filter(d => d.kode_kec === selKec);
  }

  selDesa.innerHTML = '<option value="">Semua Desa</option>' +
    list.map(d => `<option value="${d.kode_desa}">${d.nmdesa}</option>`).join('');
}

async function loadKelolaData() {
  try {
    allKelolaRows = [];
    const BATCH_SIZE = 1000;
    let offset = 0;
    let hasMore = true;

    // 1. Chunked fetch via RPC get_all_subsls_petugas_list (2500 rows per batch)
    while (hasMore) {
      const { data: chunk, error: rpcErr } = await db
        .rpc('get_all_subsls_petugas_list')
        .range(offset, offset + BATCH_SIZE - 1);

      if (rpcErr) {
        console.warn('RPC Range error, falling back to manual fetch:', rpcErr);
        break;
      }

      if (chunk && chunk.length > 0) {
        allKelolaRows = allKelolaRows.concat(chunk);
        if (chunk.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      } else {
        hasMore = false;
      }
    }

    // Fallback if RPC failed or returned 0 rows
    if (allKelolaRows.length === 0) {
      let masterOffset = 0;
      let hasMoreMaster = true;
      let rawMasterData = [];

      while (hasMoreMaster) {
        const { data: mChunk } = await db
          .from('master_wilayah')
          .select('*')
          .range(masterOffset, masterOffset + BATCH_SIZE - 1);

        if (mChunk && mChunk.length > 0) {
          rawMasterData = rawMasterData.concat(mChunk);
          if (mChunk.length < BATCH_SIZE) hasMoreMaster = false;
          else masterOffset += BATCH_SIZE;
        } else {
          hasMoreMaster = false;
        }
      }

      if (rawMasterData.length > 0) {
        allKelolaRows = rawMasterData.map(m => {
          const full = m.kode_sls_gabungan || '';
          return {
            kode_sls_gabungan: full,
            kdprov: full.substring(0, 2) || '36',
            kdkab: full.substring(2, 4) || '02',
            kdkec: full.substring(4, 7) || (m.kdkec || ''),
            kddesa: full.substring(7, 10) || (m.kddesa || ''),
            kdsls: full.substring(10, 14) || (m.kdsls || ''),
            kdsubsls: full.substring(14, 16) || (m.kdsubsls || '00'),
            nmkec: m.nmkec || '',
            nmdesaAllocation: m.nmdesa || '',
            nmsls: m.nmsls || '',
            nmsubsls: m.nmsubsls || '',
            emailppl: '',
            namappl: '',
            emailpml: '',
            namapml: ''
          };
        });

        // Enrich with PPL & PML if profiles available (2500 chunked)
        let userSlsOffset = 0;
        let hasMoreUserSls = true;
        let userSlsData = [];

        while (hasMoreUserSls) {
          const { data: usChunk } = await db
            .from('user_sls')
            .select('kode_sls, user_id, status, profiles(id, nama, email_ref, sobatid, role)')
            .eq('status', 'aktif')
            .range(userSlsOffset, userSlsOffset + BATCH_SIZE - 1);

          if (usChunk && usChunk.length > 0) {
            userSlsData = userSlsData.concat(usChunk);
            if (usChunk.length < BATCH_SIZE) hasMoreUserSls = false;
            else userSlsOffset += BATCH_SIZE;
          } else {
            hasMoreUserSls = false;
          }
        }

        if (userSlsData.length > 0) {
          const pplMap = {};
          userSlsData.forEach(us => {
            if (us.profiles && us.profiles.role === 'ppl') {
              pplMap[us.kode_sls] = us.profiles.email_ref || us.profiles.sobatid || us.profiles.nama;
            }
          });

          allKelolaRows.forEach(r => {
            const sls14 = r.kode_sls_gabungan.substring(0, 14);
            if (pplMap[sls14] || pplMap[r.kode_sls_gabungan]) {
              r.emailppl = pplMap[sls14] || pplMap[r.kode_sls_gabungan];
            }
          });
        }
      }
    }

    // Deduplicate by unique Sub-SLS code (guarantees exact 7350 master records and preserves PPL/PML)
    const uniqueMap = new Map();
    allKelolaRows.forEach(r => {
      const existing = uniqueMap.get(r.kode_sls_gabungan);
      if (!existing) {
        uniqueMap.set(r.kode_sls_gabungan, r);
      } else {
        if (!existing.emailppl && r.emailppl) existing.emailppl = r.emailppl;
        if (!existing.emailpml && r.emailpml) existing.emailpml = r.emailpml;
        if (!existing.namappl && r.namappl) existing.namappl = r.namappl;
        if (!existing.namapml && r.namapml) existing.namapml = r.namapml;
      }
    });
    allKelolaRows = Array.from(uniqueMap.values());

    calculateSummaryStats();
    filterAndRender();

  } catch (err) {
    console.error('Error loading kelola data:', err);
  }
}

function calculateSummaryStats() {
  const total = allKelolaRows.length;
  const tanpaPpl = allKelolaRows.filter(r => !r.emailppl).length;
  const tanpaPml = allKelolaRows.filter(r => !r.emailpml).length;
  const lengkap = allKelolaRows.filter(r => r.emailppl && r.emailpml).length;

  document.getElementById('statTotalSubsls').textContent = total.toLocaleString('id-ID');
  document.getElementById('statTanpaPpl').textContent = tanpaPpl.toLocaleString('id-ID');
  document.getElementById('statTanpaPml').textContent = tanpaPml.toLocaleString('id-ID');
  document.getElementById('statLengkap').textContent = lengkap.toLocaleString('id-ID');
}

function filterAndRender() {
  const statusFilter = document.getElementById('filterStatusPetugas').value;
  const kecFilter = document.getElementById('filterKecamatan').value;
  const desaFilter = document.getElementById('filterDesa').value;
  const searchTerm = (document.getElementById('searchInput').value || '').toLowerCase().trim();

  filteredKelolaRows = allKelolaRows.filter(r => {
    // Status Filter
    if (statusFilter === 'tanpa_ppl' && r.emailppl) return false;
    if (statusFilter === 'tanpa_pml' && r.emailpml) return false;
    if (statusFilter === 'lengkap' && (!r.emailppl || !r.emailpml)) return false;

    // Kec Filter
    if (kecFilter) {
      const kdkec = r.kdkec;
      const targetKdkec = kecFilter.length >= 3 ? kecFilter.substring(4, 7) : kecFilter;
      if (kdkec !== targetKdkec && !r.nmkec?.toLowerCase().includes(kecFilter.toLowerCase())) {
        return false;
      }
    }

    // Desa Filter
    if (desaFilter) {
      const kddesa = r.kddesa;
      const targetKddesa = desaFilter.length >= 3 ? desaFilter.substring(7, 10) : desaFilter;
      if (kddesa !== targetKddesa && !r.nmdesaAllocation?.toLowerCase().includes(desaFilter.toLowerCase())) {
        return false;
      }
    }

    // Search Term
    if (searchTerm) {
      const searchTarget = `${r.kode_sls_gabungan} ${r.emailppl} ${r.namappl} ${r.emailpml} ${r.namapml} ${r.nmkec} ${r.nmsls}`.toLowerCase();
      if (!searchTarget.includes(searchTerm)) return false;
    }

    return true;
  });

  kelolaCurrentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('tableBodyKelola');
  const countLabel = document.getElementById('tableCountLabel');

  if (countLabel) {
    countLabel.textContent = `${filteredKelolaRows.length} Sub-SLS ditemukan`;
  }

  if (!tbody) return;

  if (filteredKelolaRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:2rem;color:var(--text-muted)">
          Tidak ada data Sub-SLS yang sesuai dengan filter.
        </td>
      </tr>
    `;
    renderPagination(0);
    return;
  }

  // Calculate Pagination Slice
  const totalRows = filteredKelolaRows.length;
  let rowsToDisplay = filteredKelolaRows;

  if (kelolaPageSize !== 'all') {
    const pSize = parseInt(kelolaPageSize, 10);
    const startIdx = (kelolaCurrentPage - 1) * pSize;
    rowsToDisplay = filteredKelolaRows.slice(startIdx, startIdx + pSize);
  }

  tbody.innerHTML = rowsToDisplay.map(r => {
    const pplDisplay = r.emailppl ? `<span>${r.emailppl}</span>` : `<span class="badge-empty">Belum ada PPL</span>`;
    const pmlDisplay = r.emailpml ? `<span>${r.emailpml}</span>` : `<span class="badge-empty">Belum ada PML</span>`;

    return `
      <tr>
        <td class="code-cell">${r.kdprov || '36'}</td>
        <td class="code-cell">${r.kdkab || '02'}</td>
        <td class="code-cell">${r.kdkec || ''}</td>
        <td class="code-cell">${r.kddesa || ''}</td>
        <td class="code-cell">${r.kdsls || ''}</td>
        <td class="code-cell">${r.kdsubsls || '00'}</td>
        <td>${pmlDisplay}</td>
        <td>${pplDisplay}</td>
        <td style="text-align:center">
          <button class="btn btn-secondary btn-sm" onclick="openEditModal('${r.kode_sls_gabungan}', '${r.emailppl || ''}', '${r.emailpml || ''}')">
            Ganti
          </button>
        </td>
      </tr>
    `;
  }).join('');

  renderPagination(totalRows);
}

function renderPagination(totalRows) {
  const container = document.getElementById('paginationButtons');
  if (!container) return;

  if (kelolaPageSize === 'all' || totalRows <= 0) {
    container.innerHTML = '';
    return;
  }

  const pSize = parseInt(kelolaPageSize, 10);
  const totalPages = Math.ceil(totalRows / pSize);

  let html = '';

  html += `<button class="btn btn-secondary btn-sm" ${kelolaCurrentPage === 1 ? 'disabled' : ''} onclick="goToPage(${kelolaCurrentPage - 1})">‹</button>`;

  const maxButtons = 5;
  let startP = Math.max(1, kelolaCurrentPage - 2);
  let endP = Math.min(totalPages, startP + maxButtons - 1);
  if (endP - startP + 1 < maxButtons) {
    startP = Math.max(1, endP - maxButtons + 1);
  }

  for (let i = startP; i <= endP; i++) {
    html += `<button class="btn btn-sm ${i === kelolaCurrentPage ? 'btn-primary' : 'btn-secondary'}" onclick="goToPage(${i})">${i}</button>`;
  }

  html += `<button class="btn btn-secondary btn-sm" ${kelolaCurrentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${kelolaCurrentPage + 1})">›</button>`;

  container.innerHTML = html;
}

function goToPage(p) {
  kelolaCurrentPage = p;
  renderTable();
}

function changePageSize() {
  const sel = document.getElementById('pageSizeSelect');
  kelolaPageSize = sel ? sel.value : '25';
  kelolaCurrentPage = 1;
  renderTable();
}

/**
 * Modal Edit Petugas Handler
 */
function openEditModal(kodeSubSls, currentPpl, currentPml) {
  activeEditKodeSubSls = kodeSubSls;
  document.getElementById('modalKodeSubSls').textContent = kodeSubSls;
  document.getElementById('modalEmailPpl').value = currentPpl || '';
  document.getElementById('modalEmailPml').value = currentPml || '';

  const modal = document.getElementById('editPetugasModal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditModal() {
  const modal = document.getElementById('editPetugasModal');
  if (modal) modal.classList.add('hidden');
  activeEditKodeSubSls = null;
}

async function savePetugasEdit() {
  if (!activeEditKodeSubSls) return;

  const emailPpl = document.getElementById('modalEmailPpl').value.trim();
  const emailPml = document.getElementById('modalEmailPml').value.trim();

  const btn = document.getElementById('btnSaveEditPetugas');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
  }

  try {
    const { error } = await db.rpc('update_subsls_petugas', {
      p_kode_subsls: activeEditKodeSubSls,
      p_email_ppl: emailPpl,
      p_email_pml: emailPml
    });

    if (error) throw error;

    // Update local data state
    const targetRow = allKelolaRows.find(r => r.kode_sls_gabungan === activeEditKodeSubSls);
    if (targetRow) {
      targetRow.emailppl = emailPpl;
      targetRow.emailpml = emailPml;
    }

    calculateSummaryStats();
    renderTable();
    closeEditModal();

    if (typeof showToast !== 'undefined') {
      showToast(`Petugas untuk ${activeEditKodeSubSls} berhasil di-update.`, 'success');
    } else {
      alert('Perubahan petugas berhasil disimpan!');
    }

  } catch (err) {
    console.error('Error updating petugas:', err);
    alert('Gagal menyimpan perubahan: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Simpan Perubahan';
    }
  }
}

/**
 * Export & Import Excel Handler
 */
function exportKelolaExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Library XLSX belum dimuat.');
    return;
  }

  const exportData = filteredKelolaRows.map(r => ({
    'kdprov': r.kdprov || '36',
    'kdkab': r.kdkab || '02',
    'kdkec': r.kdkec || '',
    'kddesa': r.kddesa || '',
    'kdsls': r.kdsls || '',
    'kdsubsls': r.kdsubsls || '00',
    'emailpml': r.emailpml || '',
    'emailppl': r.emailppl || ''
  }));

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kelola Petugas SLS');

  ws['!cols'] = [
    { wch: 8 },  // kdprov
    { wch: 8 },  // kdkab
    { wch: 8 },  // kdkec
    { wch: 8 },  // kddesa
    { wch: 10 }, // kdsls
    { wch: 10 }, // kdsubsls
    { wch: 30 }, // emailpml
    { wch: 30 }  // emailppl
  ];

  XLSX.writeFile(wb, `Kelola_Petugas_SLS_SE2026_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function openImportModal() {
  const modal = document.getElementById('importModal');
  if (modal) modal.classList.remove('hidden');
}

function closeImportModal() {
  const modal = document.getElementById('importModal');
  if (modal) modal.classList.add('hidden');
  parsedImportRows = [];
}

function handleImportFileSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      parsedImportRows = [];
      let invalidDetails = [];

      jsonRows.forEach((row, idx) => {
        const rowNum = idx + 2; // Excel header is row 1
        const keys = Object.keys(row);
        let kdprov = '', kdkab = '', kdkec = '', kddesa = '', kdsls = '', kdsubsls = '';
        let fullKodeDirect = '';
        let emailpml = '', emailppl = '';

        keys.forEach(k => {
          const nk = k.toLowerCase().replace(/[\s_]/g, '');
          if (nk === 'kdprov') kdprov = String(row[k]).replace(/\D/g, '').trim();
          else if (nk === 'kdkab') kdkab = String(row[k]).replace(/\D/g, '').trim();
          else if (nk === 'kdkec') kdkec = String(row[k]).replace(/\D/g, '').trim();
          else if (nk === 'kddesa') kddesa = String(row[k]).replace(/\D/g, '').trim();
          else if (nk === 'kdsls') kdsls = String(row[k]).replace(/\D/g, '').trim();
          else if (nk === 'kdsubsls') kdsubsls = String(row[k]).replace(/\D/g, '').trim();
          else if (nk.includes('kodesubsls') || nk === 'kode') fullKodeDirect = String(row[k]).replace(/\D/g, '').trim();
          else if (nk.includes('emailpml') || nk === 'pml') emailpml = String(row[k]).trim();
          else if (nk.includes('emailppl') || nk === 'ppl') emailppl = String(row[k]).trim();
        });

        // Construct 16-digit kode_sub_sls
        let fullKode = fullKodeDirect;
        if (!fullKode && (kdprov || kdkec || kdsls)) {
          const prov = (kdprov || '36').padStart(2, '0');
          const kab = (kdkab || '02').padStart(2, '0');
          const kec = kdkec.padStart(3, '0');
          const desa = kddesa.padStart(3, '0');
          const sls = kdsls.padStart(4, '0');
          const sub = (kdsubsls || '00').padStart(2, '0');
          fullKode = `${prov}${kab}${kec}${desa}${sls}${sub}`;
        }

        // 1. Validasi Kode Sub-SLS
        if (!fullKode) {
          invalidDetails.push(`Baris ${rowNum}: Kode Sub-SLS tidak terisi`);
          return;
        }
        if (fullKode.length !== 16) {
          invalidDetails.push(`Baris ${rowNum}: Kode Sub-SLS '${fullKode}' tidak 16 digit`);
          return;
        }
        if (!fullKode.startsWith('3602')) {
          invalidDetails.push(`Baris ${rowNum}: Kode Sub-SLS '${fullKode}' bukan wilayah Kab. Lebak (harus 3602)`);
          return;
        }

        // 2. Validasi Email PPL / PML jika terisi
        if (emailppl && emailppl.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailppl)) {
          invalidDetails.push(`Baris ${rowNum}: Format email PPL '${emailppl}' kurang tepat`);
        }
        if (emailpml && emailpml.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailpml)) {
          invalidDetails.push(`Baris ${rowNum}: Format email PML '${emailpml}' kurang tepat`);
        }

        parsedImportRows.push({
          kode_sub_sls: fullKode,
          emailppl: emailppl,
          emailpml: emailpml
        });
      });

      // Render Label & Log Validasi Modal
      const label = document.getElementById('importFileLabel');
      if (label) {
        label.innerHTML = `File Siap: <strong style="color:#16a34a">${parsedImportRows.length} baris valid</strong>` +
          (invalidDetails.length > 0 ? ` · <span style="color:#ef4444">${invalidDetails.length} ditolak</span>` : '');
      }

      const log = document.getElementById('importResultLog');
      if (log) {
        log.classList.remove('hidden');
        if (invalidDetails.length > 0) {
          log.className = 'alert alert-warning mt-3';
          log.style.fontSize = '0.8rem';
          log.style.maxHeight = '150px';
          log.style.overflowY = 'auto';
          log.innerHTML = `<strong>⚠️ Catatan Validasi Excel (${invalidDetails.length} Peringatan):</strong><br>` +
            invalidDetails.map(d => `• ${d}`).join('<br>');
        } else {
          log.className = 'alert alert-success mt-3';
          log.innerHTML = `<strong>✅ Seluruh ${parsedImportRows.length} data penugasan lulus validasi!</strong><br>Klik 'Proses Impor' untuk menyimpan ke database.`;
        }
      }

    } catch (err) {
      alert('Gagal membaca berkas Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(files[0]);
}

async function processImportFile() {
  if (!parsedImportRows || parsedImportRows.length === 0) {
    alert('Belum ada data Excel yang valid untuk diimpor.');
    return;
  }

  const btn = document.getElementById('btnProsesImport');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Memproses Impor...';
  }

  const BATCH_SIZE = 500;
  let successCount = 0;

  try {
    for (let i = 0; i < parsedImportRows.length; i += BATCH_SIZE) {
      const chunk = parsedImportRows.slice(i, i + BATCH_SIZE);
      
      if (btn) {
        btn.textContent = `Memproses ${Math.min(i + BATCH_SIZE, parsedImportRows.length)} / ${parsedImportRows.length}...`;
      }

      const { data: batchCount, error } = await db.rpc('update_subsls_petugas_batch', {
        p_rows: chunk
      });

      if (!error) {
        successCount += (batchCount ?? chunk.length);
      } else {
        console.warn('Batch RPC error, falling back to row-by-row for chunk:', error);
        for (const r of chunk) {
          const { error: singleErr } = await db.rpc('update_subsls_petugas', {
            p_kode_subsls: r.kode_sub_sls,
            p_email_ppl: r.emailppl,
            p_email_pml: r.emailpml
          });
          if (!singleErr) successCount++;
        }
      }
    }

    const log = document.getElementById('importResultLog');
    if (log) {
      log.className = 'alert alert-success mt-3';
      log.innerHTML = `<strong>✅ Impor Berhasil Disimpan!</strong><br>Sebanyak <strong>${successCount}</strong> dari ${parsedImportRows.length} data penugasan berhasil di-update ke database.`;
      log.classList.remove('hidden');
    }

    if (typeof showToast !== 'undefined') {
      showToast(`Impor Penugasan berhasil (${successCount} data)`, 'success');
    }

    await loadKelolaData();

  } catch (err) {
    alert('Gagal memproses impor: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Proses Impor';
    }
  }
}

/**
 * Download Template Excel Penugasan SLS
 */
function downloadKelolaTemplate() {
  if (typeof XLSX === 'undefined') {
    alert('Library XLSX belum dimuat.');
    return;
  }

  const sampleRows = [
    {
      'kdprov': '36',
      'kdkab': '02',
      'kdkec': '011',
      'kddesa': '001',
      'kdsls': '0001',
      'kdsubsls': '00',
      'emailpml': 'mayang.juwita00@gmail.com',
      'emailppl': 'nazwanazarina0608@gmail.com'
    },
    {
      'kdprov': '36',
      'kdkab': '02',
      'kdkec': '011',
      'kddesa': '001',
      'kdsls': '0002',
      'kdsubsls': '00',
      'emailpml': 'mayang.juwita00@gmail.com',
      'emailppl': 'petugas2@gmail.com'
    }
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Penugasan SLS');

  ws['!cols'] = [
    { wch: 8 },  // kdprov
    { wch: 8 },  // kdkab
    { wch: 8 },  // kdkec
    { wch: 8 },  // kddesa
    { wch: 10 }, // kdsls
    { wch: 10 }, // kdsubsls
    { wch: 30 }, // emailpml
    { wch: 30 }  // emailppl
  ];

  XLSX.writeFile(wb, `Template_Penugasan_Petugas_SLS_SE2026.xlsx`);
}
