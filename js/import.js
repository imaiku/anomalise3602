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

  try {
    const rows = await parseExcelFile(file);
    const result = validateUserExcel(rows);

    renderValidationResult('usersValidation', result);
    if (!result.valid) {
      document.getElementById('importUsersPreviewArea')?.classList.add('hidden');
      parsedUsersData = null;
      return;
    }

    setZoneFile('zoneUsers', 'usersImportLabel', file.name, true);
    parsedUsersData = result.dataRows;

    document.getElementById('importUsersCount').textContent = `${parsedUsersData.length} pengguna ditemukan`;
    document.getElementById('importUsersTableBody').innerHTML = parsedUsersData.map(u => `
      <tr>
        <td class="mono">${escHtml(u.sobatid)}</td>
        <td class="mono">${escHtml(u.nik)}</td>
        <td><strong>${escHtml(u.nama)}</strong></td>
        <td><span class="type-badge type-${u.role === 'ppl' ? 'keluarga' : 'usaha'}">${u.role.toUpperCase()}</span></td>
        <td style="color:var(--text-muted)">${escHtml(u.email || '—')}</td>
      </tr>
    `).join('');

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

async function processUserImport() {
  if (!parsedUsersData?.length) return;

  const btn = document.getElementById('processImportBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  try {
    const payload = parsedUsersData.map(u => ({
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

    const successCount = data.success_count || 0;
    const failCount = data.fail_count || 0;
    const errors = data.errors || [];

    if (errors.length > 0) {
      console.warn('Beberapa baris gagal diimpor:', errors);
    }

    showToast(`Impor selesai. ${successCount} berhasil, ${failCount} gagal.`, successCount > 0 ? 'success' : 'error');

    if (successCount > 0) {
      // Reset UI
      setZoneFile('zoneUsers', 'usersImportLabel', null, false);
      document.getElementById('usersValidation').innerHTML = '';
      document.getElementById('importUsersPreviewArea')?.classList.add('hidden');
      document.getElementById('fileUsers').value = '';
      parsedUsersData = null;

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

  const { data: profiles, error: profErr } = await db.from('profiles').select('id, email_ref, role');
  if (profErr) {
    showToast('Gagal memuat profil pengguna: ' + profErr.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Proses Impor SLS & PML';
    return;
  }

  // Build email → profile map
  const emailMap = {};
  (profiles || []).forEach(p => {
    if (p.email_ref) emailMap[p.email_ref.toLowerCase().trim()] = p;
  });

  let slsSuccess = 0, relSuccess = 0, failCount = 0;

  for (const item of parsedSLSData) {
    try {
      const pplProfile = emailMap[item.email_ppl.toLowerCase().trim()];
      const pmlProfile = emailMap[item.email_pml.toLowerCase().trim()];

      if (!pplProfile)           throw new Error(`Email PPL "${item.email_ppl}" tidak ditemukan`);
      if (pplProfile.role !== 'ppl') throw new Error(`Email PPL "${item.email_ppl}" rolenya bukan PPL`);

      const { error: slsErr } = await db.from('user_sls').upsert({
        user_id: pplProfile.id, kode_sls: item.kode_sls, status: 'aktif'
      });
      if (slsErr) throw slsErr;
      slsSuccess++;

      if (pmlProfile?.role === 'pml') {
        const { error: relErr } = await db.from('pml_ppl').upsert({
          pml_id: pmlProfile.id, ppl_id: pplProfile.id
        });
        if (relErr) throw relErr;
        relSuccess++;
      }
    } catch (e) {
      console.error(`Gagal mengimpor SLS ${item.kode_sls}:`, e);
      failCount++;
    }
  }

  showToast(
    `Impor SLS selesai. ${slsSuccess} SLS terdaftar, ${relSuccess} hubungan PML-PPL terbuat, ${failCount} gagal.`,
    failCount === 0 ? 'success' : 'warning'
  );

  // Reset UI
  setZoneFile('zoneSLS', 'slsImportLabel', null, false);
  document.getElementById('slsValidation').innerHTML = '';
  document.getElementById('importSLSPreviewArea')?.classList.add('hidden');
  document.getElementById('fileSLS').value = '';
  parsedSLSData = null;

  showSection('users');
  await loadUsers();
}
