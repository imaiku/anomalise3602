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

let activeKelolaTermin = 2; // Default to Termin 2 since Termin 1 is locked

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initKelolaPetugasPage();
  } catch (err) {
    console.error('Error initializing Kelola Petugas page:', err);
  }
});

function switchKelolaTermin(termin) {
  activeKelolaTermin = termin;
  const btn1 = document.getElementById('btnKelolaTermin1');
  const btn2 = document.getElementById('btnKelolaTermin2');
  const notice = document.getElementById('kelolaTerminBadgeNotice');
  const btnImport = document.getElementById('btnKelolaImport');

  if (termin === 1) {
    if (btn1) { btn1.className = 'btn btn-sm btn-primary'; btn1.style.background = '#0284c7'; btn1.style.borderColor = '#0284c7'; }
    if (btn2) { btn2.className = 'btn btn-sm btn-secondary'; btn2.style.background = ''; btn2.style.borderColor = ''; }
    if (notice) {
      notice.style.background = 'rgba(2, 132, 199, 0.1)';
      notice.style.color = '#0284c7';
      notice.style.borderColor = 'rgba(2, 132, 199, 0.25)';
      notice.innerHTML = '🔒 Mode Lihat: Penugasan Termin 1 bersifat HISTORIS & TERKUNCI (Tidak dapat diubah).';
    }
    if (btnImport) btnImport.style.display = 'none';
  } else {
    if (btn1) { btn1.className = 'btn btn-sm btn-secondary'; btn1.style.background = ''; btn1.style.borderColor = ''; }
    if (btn2) { btn2.className = 'btn btn-sm btn-primary'; btn2.style.background = '#7c3aed'; btn2.style.borderColor = '#7c3aed'; }
    if (notice) {
      notice.style.background = 'rgba(124, 58, 237, 0.1)';
      notice.style.color = '#7c3aed';
      notice.style.borderColor = 'rgba(124, 58, 237, 0.25)';
      notice.innerHTML = '✏️ Mode Aktif: Mengelola Penugasan Termin 2 (PML tetap, hanya PPL yang dapat diganti).';
    }
    if (btnImport) btnImport.style.display = 'inline-flex';
  }

  loadKelolaData();
}

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
    const targetTable = activeKelolaTermin === 2 ? 'user_sls_termin2' : 'user_sls';

    // 1. Ambil master wilayah
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

      // 2. Fetch seluruh profiles untuk lookup terpisah (menghindari error relasi PostgREST pada user_sls_termin2)
      const profileMapById = new Map();
      let pOffset = 0;
      let hasMoreP = true;
      while (hasMoreP) {
        const { data: pChunk, error: pErr } = await db
          .from('profiles')
          .select('id, nama, email_ref, sobatid, role')
          .range(pOffset, pOffset + BATCH_SIZE - 1);
        if (pErr) {
          console.error('Error fetching profiles:', pErr);
          break;
        }
        if (pChunk && pChunk.length > 0) {
          pChunk.forEach(p => profileMapById.set(p.id, p));
          if (pChunk.length < BATCH_SIZE) hasMoreP = false;
          else pOffset += BATCH_SIZE;
        } else {
          hasMoreP = false;
        }
      }

      // 3. Fetch penugasan aktif dari tabel sesuai termin (user_sls atau user_sls_termin2)
      let userSlsOffset = 0;
      let hasMoreUserSls = true;
      let userSlsData = [];

      while (hasMoreUserSls) {
        const { data: usChunk, error: usErr } = await db
          .from(targetTable)
          .select('id, kode_sls, user_id, status, user_id_asal')
          .eq('status', 'aktif')
          .range(userSlsOffset, userSlsOffset + BATCH_SIZE - 1);

        if (usErr) {
          console.error(`Error loading from ${targetTable}:`, usErr);
          break;
        }
        if (usChunk && usChunk.length > 0) {
          userSlsData = userSlsData.concat(usChunk);
          if (usChunk.length < BATCH_SIZE) hasMoreUserSls = false;
          else userSlsOffset += BATCH_SIZE;
        } else {
          hasMoreUserSls = false;
        }
      }

      // 4. Fetch relasi pml_ppl untuk menampilkan PML
      let relOffset = 0;
      let hasMoreRel = true;
      let pmlPplData = [];
      while (hasMoreRel) {
        const { data: relChunk, error: relErr } = await db
          .from('pml_ppl')
          .select('pml_id, ppl_id')
          .range(relOffset, relOffset + BATCH_SIZE - 1);
        if (relErr) {
          console.error('Error fetching pml_ppl:', relErr);
          break;
        }
        if (relChunk && relChunk.length > 0) {
          pmlPplData = pmlPplData.concat(relChunk);
          if (relChunk.length < BATCH_SIZE) hasMoreRel = false;
          else relOffset += BATCH_SIZE;
        } else {
          hasMoreRel = false;
        }
      }

      const pplToPmlMap = {};
      pmlPplData.forEach(rel => {
        if (rel.ppl_id && rel.pml_id) {
          const pmlProf = profileMapById.get(rel.pml_id);
          if (pmlProf) {
            pplToPmlMap[rel.ppl_id] = pmlProf.email_ref || pmlProf.sobatid || pmlProf.nama;
          }
        }
      });

      if (userSlsData.length > 0) {
        const pplMap = {};
        const pmlMap = {};
        userSlsData.forEach(us => {
          const prof = profileMapById.get(us.user_id);
          if (prof) {
            const pplIdent = prof.email_ref || prof.sobatid || prof.nama;
            pplMap[us.kode_sls] = pplIdent;
            // Inherit PML dari PPL aktif atau fallback ke user_id_asal di SLS tersebut
            const inheritedPml = pplToPmlMap[us.user_id] || (us.user_id_asal && pplToPmlMap[us.user_id_asal]);
            if (inheritedPml) {
              pmlMap[us.kode_sls] = inheritedPml;
            }
          }
        });

        allKelolaRows.forEach(r => {
          const sls14 = r.kode_sls_gabungan ? r.kode_sls_gabungan.substring(0, 14) : '';
          if (pplMap[r.kode_sls_gabungan] || (sls14 && pplMap[sls14])) {
            r.emailppl = pplMap[r.kode_sls_gabungan] || pplMap[sls14];
          }
          if (pmlMap[r.kode_sls_gabungan] || (sls14 && pmlMap[sls14])) {
            r.emailpml = pmlMap[r.kode_sls_gabungan] || pmlMap[sls14];
          }
        });
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

    const actionBtn = activeKelolaTermin === 1
      ? `<span class="badge" style="background:rgba(100,116,139,0.1);color:#64748b;font-size:0.75rem;padding:0.25rem 0.5rem">🔒 Terkunci</span>`
      : `<button class="btn btn-secondary btn-sm" onclick="openEditModal('${r.kode_sls_gabungan}', '${r.emailppl || ''}', '${r.emailpml || ''}')">Ganti PPL</button>`;

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
          ${actionBtn}
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

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Prev button
  html += `<button class="btn btn-sm ${kelolaCurrentPage === 1 ? 'btn-secondary disabled' : 'btn-secondary'}" 
    onclick="goToPage(${kelolaCurrentPage - 1})" ${kelolaCurrentPage === 1 ? 'disabled' : ''} style="padding:0.25rem 0.5rem">‹</button>`;

  // Page numbers logic
  let startPage = Math.max(1, kelolaCurrentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }

  if (startPage > 1) {
    html += `<button class="btn btn-sm btn-secondary" onclick="goToPage(1)" style="padding:0.25rem 0.5rem">1</button>`;
    if (startPage > 2) html += `<span style="padding:0.25rem 0.4rem;color:var(--text-muted)">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    const isActive = i === kelolaCurrentPage;
    html += `<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}" 
      onclick="goToPage(${i})" style="padding:0.25rem 0.5rem;${isActive ? 'background:var(--primary);border-color:var(--primary)' : ''}">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span style="padding:0.25rem 0.4rem;color:var(--text-muted)">...</span>`;
    html += `<button class="btn btn-sm btn-secondary" onclick="goToPage(${totalPages})" style="padding:0.25rem 0.5rem">${totalPages}</button>`;
  }

  // Next button
  html += `<button class="btn btn-sm ${kelolaCurrentPage === totalPages ? 'btn-secondary disabled' : 'btn-secondary'}" 
    onclick="goToPage(${kelolaCurrentPage + 1})" ${kelolaCurrentPage === totalPages ? 'disabled' : ''} style="padding:0.25rem 0.5rem">›</button>`;

  container.innerHTML = html;
}

function goToPage(page) {
  const pSize = kelolaPageSize === 'all' ? filteredKelolaRows.length : parseInt(kelolaPageSize, 10);
  const totalPages = Math.ceil(filteredKelolaRows.length / (pSize || 1));
  if (page < 1 || page > totalPages) return;
  kelolaCurrentPage = page;
  renderTable();
}

function changePageSize() {
  const sel = document.getElementById('pageSizeSelect');
  if (sel) {
    kelolaPageSize = sel.value;
  }
  kelolaCurrentPage = 1;
  renderTable();
}

function openEditModal(kodeSubSls, currentPpl, currentPml) {
  if (activeKelolaTermin === 1) {
    alert('Penugasan Termin 1 sudah terkunci dan tidak dapat diubah.');
    return;
  }
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
  if (activeKelolaTermin === 1) {
    alert('Penugasan Termin 1 terkunci.');
    return;
  }

  const emailPpl = document.getElementById('modalEmailPpl').value.trim();
  const emailPml = document.getElementById('modalEmailPml') ? document.getElementById('modalEmailPml').value.trim() : '';
  const btn = document.getElementById('btnSaveEditPetugas');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
  }

  try {
    // Cari user profile PPL baru
    let newUserId = null;
    if (emailPpl) {
      const { data: userProfile, error: uErr } = await db
        .from('profiles')
        .select('id, role')
        .or(`email_ref.eq.${emailPpl},sobatid.eq.${emailPpl}`)
        .single();

      if (uErr || !userProfile) {
        throw new Error(`Petugas PPL '${emailPpl}' tidak ditemukan dalam master pengguna.`);
      }
      newUserId = userProfile.id;
    }

    // Cari user profile PML jika diisi
    let pmlUserId = null;
    if (emailPml) {
      const { data: pmlProfile } = await db
        .from('profiles')
        .select('id, role')
        .or(`email_ref.eq.${emailPml},sobatid.eq.${emailPml}`)
        .maybeSingle();

      if (pmlProfile) {
        pmlUserId = pmlProfile.id;
      }
    }

    // Update di tabel user_sls_termin2
    const sls14 = activeEditKodeSubSls.length >= 14 ? activeEditKodeSubSls.substring(0, 14) : activeEditKodeSubSls;
    if (newUserId) {
      const { data: existing } = await db
        .from('user_sls_termin2')
        .select('id, user_id_asal')
        .or(`kode_sls.eq.${activeEditKodeSubSls},kode_sls.eq.${sls14}`)
        .maybeSingle();

      if (existing) {
        const { error } = await db
          .from('user_sls_termin2')
          .update({
            user_id: newUserId,
            status: 'aktif',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from('user_sls_termin2')
          .insert({
            user_id: newUserId,
            kode_sls: activeEditKodeSubSls,
            status: 'aktif',
            user_id_asal: newUserId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        if (error) throw error;
      }

      // Simpan relasi PML-PPL ke pml_ppl jika PML terisi
      if (pmlUserId) {
        await db.from('pml_ppl').upsert({
          pml_id: pmlUserId,
          ppl_id: newUserId
        }, { onConflict: 'pml_id,ppl_id' });
      }
    } else {
      // Jika dikosongkan
      await db.from('user_sls_termin2').delete().or(`kode_sls.eq.${activeEditKodeSubSls},kode_sls.eq.${sls14}`);
    }

    // Update local data state
    const targetRow = allKelolaRows.find(r => r.kode_sls_gabungan === activeEditKodeSubSls);
    if (targetRow) {
      targetRow.emailppl = emailPpl;
      if (emailPml) targetRow.emailpml = emailPml;
    }

    calculateSummaryStats();
    renderTable();
    closeEditModal();

    if (typeof showToast !== 'undefined') {
      showToast(`Penugasan Termin 2 untuk ${activeEditKodeSubSls} berhasil diperbarui!`, 'success');
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

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(wb, ws, `Penugasan_Termin_${activeKelolaTermin}`);
  XLSX.writeFile(wb, `penugasan_petugas_sls_termin_${activeKelolaTermin}.xlsx`);
}

function downloadKelolaTemplate() {
  if (typeof XLSX === 'undefined') {
    alert('Library XLSX belum dimuat.');
    return;
  }

  const templateRows = [
    {
      kdprov: '36',
      kdkab: '02',
      kdkec: '010',
      kddesa: '001',
      kdsls: '0001',
      kdsubsls: '00',
      emailpml: 'mayang.juwita00@gmail.com',
      emailppl: 'nazwanazarina0608@gmail.com'
    }
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(templateRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'template_penugasan_petugas_sls.xlsx');
}

function openImportModal() {
  if (activeKelolaTermin === 1) {
    alert('Penugasan Termin 1 sudah terkunci.');
    return;
  }
  const modal = document.getElementById('importModal');
  if (modal) modal.classList.remove('hidden');
  resetImportState();
}

function closeImportModal() {
  const modal = document.getElementById('importModal');
  if (modal) modal.classList.add('hidden');
  resetImportState();
}

function resetImportState() {
  parsedImportRows = [];
  const input = document.getElementById('fileImportKelola');
  if (input) input.value = '';
  const label = document.getElementById('importFileLabel');
  if (label) label.textContent = 'Klik atau seret file Excel di sini';
  const log = document.getElementById('importResultLog');
  if (log) {
    log.classList.add('hidden');
    log.innerHTML = '';
  }
}

function handleImportFileSelect(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (json.length === 0) {
        alert('File Excel kosong!');
        return;
      }

      parsedImportRows = [];
      const invalidDetails = [];

      json.forEach((row, idx) => {
        const rowNum = idx + 2;
        const keys = Object.keys(row);

        let kdprov = '', kdkab = '', kdkec = '', kddesa = '', kdsls = '', kdsubsls = '', fullKodeDirect = '';
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

        if (!fullKode || fullKode.length !== 16 || !fullKode.startsWith('3602')) {
          invalidDetails.push(`Baris ${rowNum}: Kode Sub-SLS tidak valid (${fullKode})`);
          return;
        }

        parsedImportRows.push({
          kode_sub_sls: fullKode,
          emailppl: emailppl,
          emailpml: emailpml
        });
      });

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
          log.innerHTML = `<strong>⚠️ Catatan Validasi Excel (${invalidDetails.length} Peringatan):</strong><br>` +
            invalidDetails.slice(0, 5).map(d => `• ${d}`).join('<br>');
        } else {
          log.className = 'alert alert-success mt-3';
          log.innerHTML = `<strong>✅ Seluruh ${parsedImportRows.length} data penugasan lulus validasi!</strong><br>Klik 'Proses Impor' untuk memperbarui penugasan Termin 2.`;
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
    btn.textContent = 'Memproses Impor Termin 2...';
  }

  try {
    // Ambil profiles untuk mapping email/sobatid -> user_id
    const { data: allProfiles } = await db.from('profiles').select('id, email_ref, sobatid, role');
    const profileMap = {};
    (allProfiles || []).forEach(p => {
      if (p.email_ref) profileMap[p.email_ref.toLowerCase().trim()] = p.id;
      if (p.sobatid) profileMap[String(p.sobatid).trim()] = p.id;
    });

    const payload = [];
    parsedImportRows.forEach(r => {
      const emailPpl = (r.emailppl || '').toLowerCase().trim();
      const uid = profileMap[emailPpl];
      if (uid) {
        payload.push({
          kode_sls: r.kode_sub_sls,
          user_id: uid,
          status: 'aktif',
          user_id_asal: uid,
          updated_at: new Date().toISOString()
        });
      }
    });

    const BATCH_SIZE = 500;
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      const { error } = await db.from('user_sls_termin2').upsert(chunk, { onConflict: 'kode_sls' });
      if (error) throw error;
    }

    alert(`✅ Berhasil memperbarui ${payload.length} penugasan Termin 2!`);
    closeImportModal();
    loadKelolaData();
  } catch (err) {
    alert('Gagal impor: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Proses Impor';
    }
  }
}

