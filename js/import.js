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

  const headerErrors = validateHeaders(rows[0], EXPECTED_USER_COLS);
  if (headerErrors.length > 0) {
    return { valid: false, errors: ['Format header tidak sesuai template:', ...headerErrors] };
  }

  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];
  const validRows = [];

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const [sobatidRaw, nikRaw, namaRaw, roleRaw, emailRaw] = dataRows[i];
    const sobatid = String(sobatidRaw || '').trim();
    const nik     = String(nikRaw    || '').trim();
    const nama    = String(namaRaw   || '').trim();
    const role    = String(roleRaw   || '').trim().toLowerCase();
    const email   = String(emailRaw  || '').trim();
    const rowNum  = i + 2;

    if (!sobatid || !/^\d+$/.test(sobatid)) rowErrors.push(`Baris ${rowNum}: Sobat ID wajib diisi dan harus berupa angka`);
    if (!nik     || !/^\d+$/.test(nik))     rowErrors.push(`Baris ${rowNum}: NIK wajib diisi dan harus berupa angka`);
    if (!nama)                               rowErrors.push(`Baris ${rowNum}: Nama Lengkap wajib diisi`);
    if (!['ppl', 'pml', 'admin', 'superadmin'].includes(role))
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
