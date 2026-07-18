// ============================================================
// IMPORT.JS — Batch import logic for users and SLS mappings
// Depends on: utils.js (escHtml, showToast, renderValidationResult, setZoneFile)
//             upload.js (parseExcelFile)
//             auth.js (toAuthEmail)
// ============================================================

// ============================================================
// USER IMPORT
// ============================================================
const EXPECTED_USER_COLS = [
  'Sobat ID', 'NIK (Password)', 'Nama Lengkap', 'Role (ppl/pml/admin/superadmin)', 'Email (Opsional)'
];
let parsedUsersData = null;
let detectedUserChanges = [];

function generateUserTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    EXPECTED_USER_COLS,
    ['360212345678', '3602012808950002', 'AHMAD WAHYUDI', 'ppl', 'ahmad@email.com'],
    ['360212345679', '3602012808950003', 'BUDI SANTOSO',  'pml', 'budi@email.com']
  ]);
  ws['!cols'] = EXPECTED_USER_COLS.map(h => ({ wch: Math.max(h.length + 2, 20) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Daftar Pengguna');
  XLSX.writeFile(wb, 'template_pengguna.xlsx');
}

function handleUserDrop(e) {
  e.preventDefault();
  document.getElementById('zoneUsers')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processUserFile(file);
}

function handleUserFileSelect(e) {
  const file = e.target.files[0];
  if (file) processUserFile(file);
}

async function processUserFile(file) {
  setZoneFile('zoneUsers', 'usersImportLabel', file.name, false);
  document.getElementById('usersValidation').innerHTML = '<div class="chip">Memvalidasi...</div>';
  detectedUserChanges = [];

  try {
    const rows = await parseExcelFile(file);
    const result = validateUserExcel(rows);

    if (!result.valid) {
      renderValidationResult('usersValidation', result);
      document.getElementById('importUsersPreviewArea')?.classList.add('hidden');
      parsedUsersData = null;
      return;
    }

    parsedUsersData = result.dataRows;

    // Fetch existing profiles to check for changes
    const sobatids = parsedUsersData.map(u => u.sobatid);
    
    // Chunk fetch existing profiles if count is large to prevent SQL expression limits
    let existing = [];
    const chunkSize = 500;
    for (let i = 0; i < sobatids.length; i += chunkSize) {
      const chunk = sobatids.slice(i, i + chunkSize);
      const { data } = await db.from('profiles').select('sobatid, nama, role, email_ref').in('sobatid', chunk);
      if (data) existing = existing.concat(data);
    }

    const existingMap = {};
    existing.forEach(p => {
      if (p.sobatid) existingMap[p.sobatid] = p;
    });

    const conflicts = [];
    parsedUsersData.forEach(u => {
      const match = existingMap[u.sobatid];
      if (match) {
        const diffs = [];
        if (match.nama !== u.nama) diffs.push(`Nama: "${match.nama}" → "${u.nama}"`);
        if (match.role !== u.role) diffs.push(`Role: "${match.role}" → "${u.role}"`);
        const oldEmail = match.email_ref || '';
        const newEmail = u.email || '';
        if (oldEmail !== newEmail) diffs.push(`Email: "${oldEmail || '—'}" → "${newEmail || '—'}"`);

        if (diffs.length > 0) {
          conflicts.push({
            sobatid: u.sobatid,
            nama: u.nama,
            oldNama: match.nama,
            diffs: diffs
          });
        }
      }
    });

    detectedUserChanges = conflicts;

    setZoneFile('zoneUsers', 'usersImportLabel', file.name, true);
    
    let validMsg = `<div class="chip success">Format file valid (${parsedUsersData.length} baris)</div>`;
    if (detectedUserChanges.length > 0) {
      validMsg += ` <div class="chip warning" style="margin-left:0.5rem">${detectedUserChanges.length} perubahan profil dideteksi</div>`;
    }
    document.getElementById('usersValidation').innerHTML = validMsg;

    document.getElementById('importUsersCount').textContent = `${parsedUsersData.length} pengguna ditemukan`;
    document.getElementById('importUsersTableBody').innerHTML = parsedUsersData.slice(0, 50).map(u => `
      <tr>
        <td class="mono">${escHtml(u.sobatid)}</td>
        <td class="mono">${escHtml(u.nik)}</td>
        <td><strong>${escHtml(u.nama)}</strong></td>
        <td><span class="type-badge type-${u.role === 'ppl' ? 'keluarga' : u.role === 'pml' ? 'usaha' : 'keduanya'}">${u.role.toUpperCase()}</span></td>
        <td style="color:var(--text-muted)">${escHtml(u.email || '—')}</td>
      </tr>
    `).join('') + (parsedUsersData.length > 50 ? `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">...dan ${parsedUsersData.length - 50} baris lainnya...</td></tr>` : '');

    document.getElementById('importUsersPreviewArea')?.classList.remove('hidden');
  } catch (err) {
    document.getElementById('usersValidation').innerHTML = `<div class="chip error">Error: ${escHtml(err.message)}</div>`;
  }
}

function validateUserExcel(rows) {
  if (!rows || rows.length < 2) {
    return { valid: false, errors: ['File kosong atau tidak memiliki data'] };
  }

  // Header mapping (fleksibel)
  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  const mapIdx = { sobatid: -1, nik: -1, nama: -1, role: -1, email: -1 };

  headers.forEach((h, idx) => {
    if (h.includes('sobatid') || h.includes('sobat id')) mapIdx.sobatid = idx;
    else if (h === 'nik' || h.includes('password')) mapIdx.nik = idx;
    else if (h === 'nama' || h.includes('nama lengkap')) mapIdx.nama = idx;
    else if (h.includes('role')) mapIdx.role = idx;
    else if (h.includes('email')) mapIdx.email = idx;
  });

  if (mapIdx.sobatid === -1) {
    return { valid: false, errors: ['Kolom "Sobat ID" wajib ada di header baris pertama'] };
  }

  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];
  const validRows = [];

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const row = dataRows[i];
    const sobatid = String(mapIdx.sobatid !== -1 ? row[mapIdx.sobatid] || '' : '').trim();
    const nik     = String(mapIdx.nik !== -1 ? row[mapIdx.nik] || '' : '').trim();
    const nama    = String(mapIdx.nama !== -1 ? row[mapIdx.nama] || '' : '').trim();
    const role    = String(mapIdx.role !== -1 ? row[mapIdx.role] || '' : '').trim().toLowerCase();
    const email   = String(mapIdx.email !== -1 ? row[mapIdx.email] || '' : '').trim();
    const rowNum  = i + 2;

    if (!sobatid || !/^\d+$/.test(sobatid)) rowErrors.push(`Baris ${rowNum}: Sobat ID wajib diisi dan harus berupa angka`);
    if (mapIdx.nik !== -1 && (!nik || !/^\d+$/.test(nik))) rowErrors.push(`Baris ${rowNum}: NIK wajib diisi dan harus berupa angka`);
    if (mapIdx.nama !== -1 && !nama) rowErrors.push(`Baris ${rowNum}: Nama Lengkap wajib diisi`);
    if (mapIdx.role !== -1 && !['ppl', 'pml', 'admin', 'superadmin'].includes(role))
                                             rowErrors.push(`Baris ${rowNum}: Role "${role}" tidak dikenali (harus ppl/pml/admin/superadmin)`);

    if (rowErrors.length === 0) validRows.push({ sobatid, nik, nama, role, email });
  }

  if (rowErrors.length > 0) return { valid: false, errors: rowErrors };
  return { valid: true, errors: [], dataRows: validRows };
}

async function processUserImport(confirm = false) {
  if (!parsedUsersData?.length) return;

  // Jika terdeteksi perubahan data dan belum dikonfirmasi oleh Super Admin
  if (!confirm && detectedUserChanges.length > 0) {
    const tbody = document.getElementById('overwriteModalTableBody');
    tbody.innerHTML = detectedUserChanges.map(c => `
      <tr>
        <td>
          <strong>${escHtml(c.nama)}</strong>
          ${c.oldNama !== c.nama ? `<br><span style="font-size:0.75rem;color:var(--text-subtle)">Sebelumnya: ${escHtml(c.oldNama)}</span>` : ''}
        </td>
        <td class="mono">${escHtml(c.sobatid)}</td>
        <td style="font-size:0.8125rem;color:var(--primary)">
          ${c.diffs.map(d => `<div style="margin-bottom:2px">• ${escHtml(d)}</div>`).join('')}
        </td>
      </tr>
    `).join('');
    document.getElementById('confirmOverwriteModal').classList.add('open');
    return;
  }

  // Jika dikonfirmasi atau tidak ada perubahan, langsung jalankan
  closeOverwriteModal();

  const btn = document.getElementById('processImportBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  let successCount = 0;
  let failCount    = 0;
  const chunkSize  = 40; // 40 users per request to fit within Supabase's statement timeout

  try {
    for (let i = 0; i < parsedUsersData.length; i += chunkSize) {
      const chunk = parsedUsersData.slice(i, i + chunkSize);
      btn.textContent = `Memproses (${i} / ${parsedUsersData.length})...`;

      const payload = chunk.map(u => ({
        sobatid: u.sobatid,
        nik: u.nik,
        nama: u.nama,
        role: u.role,
        email: u.email || ''
      }));

      const { data, error } = await db.rpc('register_users_batch', { p_users: payload });

      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          throw new Error('Fungsi register_users_batch belum ditambahkan di database. Harap jalankan script SQL terbaru di editor SQL Supabase Anda.');
        }
        throw error;
      }

      successCount += data.success_count || 0;
      failCount    += data.fail_count || 0;
    }

    showToast(`Impor selesai. ${successCount} berhasil, ${failCount} gagal.`, successCount > 0 ? 'success' : 'error');

    if (successCount > 0) {
      // Reset UI
      setZoneFile('zoneUsers', 'usersImportLabel', null, false);
      document.getElementById('usersValidation').innerHTML = '';
      document.getElementById('importUsersPreviewArea')?.classList.add('hidden');
      document.getElementById('fileUsers').value = '';
      parsedUsersData = null;
      detectedUserChanges = [];

      showSection('users');
      await loadUsers();
    }
  } catch (e) {
    console.error('Proses impor gagal:', e);
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Proses Impor Massal';
  }
}

function closeOverwriteModal() {
  document.getElementById('confirmOverwriteModal')?.classList.remove('open');
}

function proceedWithUserImport(confirm) {
  processUserImport(confirm);
}

// ============================================================
// SLS & PML-PPL MAPPING IMPORT
// ============================================================
const EXPECTED_SLS_COLS = ['Kode SLS', 'Email PML', 'Email PPL'];
let parsedSLSData = null;

function generateSLSTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    EXPECTED_SLS_COLS,
    ['3602070001001900', 'pml@email.com', 'ppl@email.com']
  ]);
  ws['!cols'] = EXPECTED_SLS_COLS.map(h => ({ wch: Math.max(h.length + 2, 22) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Mapping SLS');
  XLSX.writeFile(wb, 'template_mapping_sls.xlsx');
}

function handleSLSDrop(e) {
  e.preventDefault();
  document.getElementById('zoneSLS')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processSLSFile(file);
}

function handleSLSFileSelect(e) {
  const file = e.target.files[0];
  if (file) processSLSFile(file);
}

async function processSLSFile(file) {
  setZoneFile('zoneSLS', 'slsImportLabel', file.name, false);
  document.getElementById('slsValidation').innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows  = await parseExcelFile(file);
    const result = validateSLSExcel(rows);

    renderValidationResult('slsValidation', result);
    if (!result.valid) {
      document.getElementById('importSLSPreviewArea')?.classList.add('hidden');
      parsedSLSData = null;
      return;
    }

    setZoneFile('zoneSLS', 'slsImportLabel', file.name, true);
    parsedSLSData = result.dataRows;

    document.getElementById('importSLSCount').textContent = `${parsedSLSData.length} baris mapping ditemukan`;
    const tbody = document.getElementById('importSLSTableBody');
    tbody.innerHTML = parsedSLSData.slice(0, 50).map(s => `
      <tr>
        <td class="mono">${escHtml(s.kode_sls)}</td>
        <td>${escHtml(s.email_pml)}</td>
        <td>${escHtml(s.email_ppl)}</td>
      </tr>
    `).join('') +
    (parsedSLSData.length > 50
      ? `<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">...dan ${parsedSLSData.length - 50} baris lainnya...</td></tr>`
      : '');

    document.getElementById('importSLSPreviewArea')?.classList.remove('hidden');
  } catch (err) {
    document.getElementById('slsValidation').innerHTML = `<div class="chip error">Error: ${escHtml(err.message)}</div>`;
  }
}

function validateSLSExcel(rows) {
  if (!rows || rows.length < 2) {
    return { valid: false, errors: ['File kosong atau tidak memiliki data'] };
  }

  const headerErrors = validateHeaders(rows[0], EXPECTED_SLS_COLS);
  if (headerErrors.length > 0) {
    return { valid: false, errors: ['Format header tidak sesuai template:', ...headerErrors] };
  }

  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];
  const validRows = [];

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const [slsRaw, pmlRaw, pplRaw] = dataRows[i];
    const kode_sls  = String(slsRaw || '').trim();
    const email_pml = String(pmlRaw || '').trim();
    const email_ppl = String(pplRaw || '').trim();
    const rowNum    = i + 2;

    if (!kode_sls || !/^\d{16}$/.test(kode_sls))
      rowErrors.push(`Baris ${rowNum}: Kode SLS wajib 16 digit angka (contoh: 3602070001001900)`);
    if (!email_pml) rowErrors.push(`Baris ${rowNum}: Email PML wajib diisi`);
    if (!email_ppl) rowErrors.push(`Baris ${rowNum}: Email PPL wajib diisi`);

    if (rowErrors.length === 0) validRows.push({ kode_sls, email_pml, email_ppl });
  }

  if (rowErrors.length > 0) return { valid: false, errors: rowErrors };
  return { valid: true, errors: [], dataRows: validRows };
}

async function processSLSImport() {
  if (!parsedSLSData?.length) return;

  const btn = document.getElementById('processSLSImportBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  let slsSuccess = 0, relSuccess = 0, failCount = 0;
  const chunkSize = 500; // Send 500 mappings at a time

  try {
    for (let i = 0; i < parsedSLSData.length; i += chunkSize) {
      const chunk = parsedSLSData.slice(i, i + chunkSize);
      btn.textContent = `Memproses (${i} / ${parsedSLSData.length})...`;

      const payload = chunk.map(s => ({
        kode_sls: s.kode_sls,
        email_pml: s.email_pml || '',
        email_ppl: s.email_ppl
      }));

      const { data, error } = await db.rpc('import_sls_batch', { p_mappings: payload });

      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          throw new Error('Fungsi import_sls_batch belum ditambahkan di database. Harap jalankan script SQL terbaru di editor SQL Supabase Anda.');
        }
        throw error;
      }

      slsSuccess += data.sls_success || 0;
      relSuccess += data.rel_success || 0;
      failCount  += data.fail_count || 0;
    }

    showToast(
      `Impor SLS selesai. ${slsSuccess} SLS terdaftar, ${relSuccess} hubungan PML-PPL terbuat, ${failCount} gagal.`,
      failCount === 0 ? 'success' : 'warning'
    );

    if (slsSuccess > 0) {
      // Reset UI
      setZoneFile('zoneSLS', 'slsImportLabel', null, false);
      document.getElementById('slsValidation').innerHTML = '';
      document.getElementById('importSLSPreviewArea')?.classList.add('hidden');
      document.getElementById('fileSLS').value = '';
      parsedSLSData = null;

      showSection('users');
      await loadUsers();
    }
  } catch (e) {
    console.error('Proses impor SLS gagal:', e);
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Proses Impor SLS & PML';
  }
}

function generateWilayahTemplate() {
  const headers = ['kdprov', 'kdkab', 'kdkec', 'kddesa', 'kdsls', 'kdsubsls', 'idsubsls_25_2', 'nmprov', 'nmkab', 'nmkec', 'nmdesa', 'nmsls', 'nmsubsls'];
  const data = [
    ['36', '02', '060', '001', '0001', '00', '3602060001000100', 'BANTEN', 'LEBAK', 'BANJARSARI', 'KERTARAHARJA', 'RT 001 RW 001', 'RT 001 RW 001']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 16) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Master Wilayah');
  XLSX.writeFile(wb, 'template_master_wilayah.xlsx');
}

// ============================================================
// CAPAIAN & TARGET SLS IMPORT
// ============================================================
const EXPECTED_CAPAIAN_COLS = [
  'Kode SLS', 'Target', 'Capaian PPL T1', 'Capaian PPL T2', 'Capaian PML T1', 'Capaian PML T2'
];
let parsedCapaianData = null;
let missingCapaianSlsCount = 0;

function generateCapaianTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    EXPECTED_CAPAIAN_COLS,
    ['3602070001001900', 50, 45, 0, 42, 0]
  ]);
  ws['!cols'] = EXPECTED_CAPAIAN_COLS.map(h => ({ wch: Math.max(h.length + 2, 18) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Capaian SLS');
  XLSX.writeFile(wb, 'template_capaian_sls.xlsx');
}

function handleCapaianDrop(e) {
  e.preventDefault();
  document.getElementById('zoneCapaian')?.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processCapaianFile(file);
}

function handleCapaianFileSelect(e) {
  const file = e.target.files[0];
  if (file) processCapaianFile(file);
}

async function processCapaianFile(file) {
  setZoneFile('zoneCapaian', 'capaianImportLabel', file.name, false);
  document.getElementById('capaianValidation').innerHTML = '<div class="chip">Memvalidasi...</div>';

  try {
    const rows = await parseExcelFile(file);
    const result = validateCapaianExcel(rows);

    renderValidationResult('capaianValidation', result);
    if (!result.valid) {
      document.getElementById('importCapaianPreviewArea')?.classList.add('hidden');
      parsedCapaianData = null;
      missingCapaianSlsCount = 0;
      return;
    }

    setZoneFile('zoneCapaian', 'capaianImportLabel', file.name, true);
    const rawData = result.dataRows;

    // Check which SLS exist in the database
    const slsCodes = rawData.map(c => c.kode_sls);
    const existingSls = new Set();
    const dbChunkSize = 500;
    
    document.getElementById('capaianValidation').innerHTML = '<div class="chip">Mengecek keberadaan SLS di database...</div>';

    for (let i = 0; i < slsCodes.length; i += dbChunkSize) {
      const chunk = slsCodes.slice(i, i + dbChunkSize);
      const { data } = await db.from('wilayah_subsls').select('kode_sls_gabungan').in('kode_sls_gabungan', chunk);
      if (data) {
        data.forEach(row => existingSls.add(row.kode_sls_gabungan));
      }
    }

    const missingSls = rawData.filter(c => !existingSls.has(c.kode_sls));
    parsedCapaianData = rawData.filter(c => existingSls.has(c.kode_sls));
    missingCapaianSlsCount = missingSls.length;

    let validMsg = `<div class="chip success">Format file valid (${rawData.length} baris)</div>`;
    if (missingSls.length > 0) {
      validMsg += ` <div class="chip warning" style="margin-left:0.5rem">${missingSls.length} SLS tidak ditemukan di database wilayah (akan diabaikan)</div>`;
    }
    document.getElementById('capaianValidation').innerHTML = validMsg;

    if (missingSls.length > 0) {
      const missingList = missingSls.slice(0, 10).map(m => m.kode_sls).join(', ');
      const extraInfo = missingSls.length > 10 ? `... dan ${missingSls.length - 10} lainnya` : '';
      const validationContainer = document.getElementById('capaianValidation');
      validationContainer.innerHTML += `
        <div style="margin-top:0.5rem;padding:0.75rem;border-radius:var(--radius-md);background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);color:var(--warning);font-size:0.85rem">
          <strong>Peringatan:</strong> Beberapa SLS berikut tidak terdaftar di database wilayah dan target/capaiannya tidak akan diimpor:<br>
          <code style="word-break:break-all;color:inherit">${escHtml(missingList)}</code>${escHtml(extraInfo)}
        </div>
      `;
    }

    document.getElementById('importCapaianCount').textContent = `${parsedCapaianData.length} baris data valid siap diimpor`;
    const tbody = document.getElementById('importCapaianTableBody');
    tbody.innerHTML = parsedCapaianData.slice(0, 50).map(s => `
      <tr>
        <td class="mono">${escHtml(s.kode_sls)}</td>
        <td>${s.target}</td>
        <td>${s.ppl1}</td>
        <td>${s.ppl2}</td>
        <td>${s.pml1}</td>
        <td>${s.pml2}</td>
      </tr>
    `).join('') +
    (parsedCapaianData.length > 50
      ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">...dan ${parsedCapaianData.length - 50} baris lainnya...</td></tr>`
      : '');

    document.getElementById('importCapaianPreviewArea')?.classList.remove('hidden');
  } catch (err) {
    document.getElementById('capaianValidation').innerHTML = `<div class="chip error">Error: ${escHtml(err.message)}</div>`;
    missingCapaianSlsCount = 0;
  }
}

function validateCapaianExcel(rows) {
  if (!rows || rows.length < 2) {
    return { valid: false, errors: ['File kosong atau tidak memiliki data'] };
  }

  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  const mapIdx = { sls: -1, target: -1, ppl1: -1, ppl2: -1, pml1: -1, pml2: -1 };

  headers.forEach((h, idx) => {
    if (h.includes('sls') || h.includes('sls_gabungan')) mapIdx.sls = idx;
    else if (h.includes('target')) mapIdx.target = idx;
    else if (h.includes('ppl t1') || h.includes('ppl 1') || h.includes('capaian1') || h.includes('ppl termin 1')) mapIdx.ppl1 = idx;
    else if (h.includes('ppl t2') || h.includes('ppl 2') || h.includes('capaian2') || h.includes('ppl termin 2')) mapIdx.ppl2 = idx;
    else if (h.includes('pml t1') || h.includes('pml 1') || h.includes('pml termin 1') || h.includes('capaian1_pml')) mapIdx.pml1 = idx;
    else if (h.includes('pml t2') || h.includes('pml 2') || h.includes('pml termin 2') || h.includes('capaian2_pml')) mapIdx.pml2 = idx;
  });

  if (mapIdx.sls === -1) {
    return { valid: false, errors: ['Kolom "Kode SLS" atau "Kode SLS Gabungan" wajib ada di header baris pertama'] };
  }

  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];
  const uniqueRows = new Map();

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const row = dataRows[i];
    const rawSls = String(mapIdx.sls !== -1 ? row[mapIdx.sls] || '' : '').trim();
    const rowNum = i + 2;

    if (!rawSls || !/^\d{16}$/.test(rawSls)) {
      rowErrors.push(`Baris ${rowNum}: Kode SLS wajib 16 digit angka`);
      continue;
    }

    const target = mapIdx.target !== -1 ? parseInt(row[mapIdx.target]) || 0 : 0;
    const ppl1   = mapIdx.ppl1 !== -1 ? parseInt(row[mapIdx.ppl1]) || 0 : 0;
    const ppl2   = mapIdx.ppl2 !== -1 ? parseInt(row[mapIdx.ppl2]) || 0 : 0;
    const pml1   = mapIdx.pml1 !== -1 ? parseInt(row[mapIdx.pml1]) || 0 : 0;
    const pml2   = mapIdx.pml2 !== -1 ? parseInt(row[mapIdx.pml2]) || 0 : 0;

    uniqueRows.set(rawSls, { kode_sls: rawSls, target, ppl1, ppl2, pml1, pml2 });
  }

  if (rowErrors.length > 0) return { valid: false, errors: rowErrors };
  return { valid: true, errors: [], dataRows: Array.from(uniqueRows.values()) };
}

async function processCapaianImport() {
  if (!parsedCapaianData?.length) return;

  const btn = document.getElementById('processCapaianImportBtn');
  
  if (missingCapaianSlsCount > 0) {
    const confirmImport = confirm(`Peringatan: Ada ${missingCapaianSlsCount} SLS yang tidak terdaftar di database wilayah dan akan diabaikan. Apakah Anda yakin ingin melanjutkan proses impor?`);
    if (!confirmImport) {
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = 'Memproses...';

  let successCount = 0;
  const chunkSize = 500;

  try {
    for (let i = 0; i < parsedCapaianData.length; i += chunkSize) {
      const chunk = parsedCapaianData.slice(i, i + chunkSize);
      btn.textContent = `Memproses (${i} / ${parsedCapaianData.length})...`;

      // 1. Update targets in wilayah_subsls
      const targetPayload = chunk.map(c => {
        const full = c.kode_sls;
        return {
          kode_sls_gabungan: full,
          kode_sls: full.substring(0, 14),
          kdsls: full.substring(10, 14),
          kdsubsls: full.substring(14, 16),
          target: c.target
        };
      });

      // In Supabase, upserting only partial columns when conflict occurs acts as an update
      const { error: targetErr } = await db.from('wilayah_subsls').upsert(targetPayload, { onConflict: 'kode_sls_gabungan' });
      if (targetErr) throw targetErr;

      // 2. Upsert achievement numbers in capaian table
      const capaianPayload = chunk.map(c => ({
        kode_sls_gabungan: c.kode_sls,
        capaian1: c.ppl1,
        capaian2: c.ppl2,
        capaian1_pml: c.pml1,
        capaian2_pml: c.pml2,
        updated_at: new Date().toISOString()
      }));

      const { error: capaianErr } = await db.from('capaian').upsert(capaianPayload, { onConflict: 'kode_sls_gabungan' });
      if (capaianErr) throw capaianErr;

      successCount += chunk.length;
    }

    showToast(`Impor capaian selesai! Berhasil memperbarui ${successCount} data SLS.`, 'success');

    // Reset UI
    setZoneFile('zoneCapaian', 'capaianImportLabel', null, false);
    document.getElementById('capaianValidation').innerHTML = '';
    document.getElementById('importCapaianPreviewArea')?.classList.add('hidden');
    document.getElementById('fileCapaian').value = '';
    parsedCapaianData = null;
    missingCapaianSlsCount = 0;

    showSection('sp-termin1');
    await loadSPTermin1Data(); // Refresh SP Termin I table counts/capaian
  } catch (err) {
    console.error('Proses impor capaian gagal:', err);
    showToast('Gagal memproses impor: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Proses Impor Capaian';
  }
}
