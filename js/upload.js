// ============================================================
// UPLOAD.JS — Excel Parsing, Validation & Merge Logic
// Format Gabungan: 1 file berisi anomali keluarga + usaha
// ============================================================

const EXPECTED_COLS_GABUNGAN = [
  'No', 'Nama Usaha / Kepala Keluarga', 'Kode Prov', 'Nama Provinsi', 'Kode Kab/Kota',
  'Nama Kab/Kota', 'Kode Kec', 'Nama Kecamatan', 'Kode Desa', 'Nama Desa/Kel',
  'Kode SLS', 'Sub SLS', 'Assignment ID', 'Daftar Anomali', 'Tindak Lanjut',
  'ID Petugas', 'Email Petugas', 'Link Fasih'
];

// Regex untuk parsing setiap anomali individu dari kolom "Daftar Anomali"
// Menangkap: "Anomali Keluarga 4 (Luas lantai per kapita < 3 m2 atau > 200 m2)"
// Menangkap: "Anomali Usaha 2 (Keuntungan Usaha)"
// Menangkap: "Anomali 1 (Biaya Produksi Dominan)" -> default tipe usaha
const ANOMALI_ITEM_REGEX = /Anomali\s+(Keluarga\s+|Usaha\s+)?(\d+)\s*\(([^)]+)\)/gi;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Parse Excel File ----
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        resolve(rows);
      } catch (err) {
        reject(new Error('File tidak dapat dibaca: ' + err.message));
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

// ---- Parse "Daftar Anomali" column ----
// Mengembalikan array: [{ tipe: 'keluarga'|'usaha', nomor: int, nama: string }]
function parseDaftarAnomali(str) {
  if (!str) return [];
  const text = String(str).trim();
  if (!text) return [];
  const results = [];
  let match;
  const regex = new RegExp(ANOMALI_ITEM_REGEX.source, 'gi');
  while ((match = regex.exec(text)) !== null) {
    const tipeRaw = (match[1] || '').trim().toLowerCase();
    const tipe = tipeRaw === 'keluarga' ? 'keluarga' : 'usaha'; // Default to usaha if not specified
    const nomor = parseInt(match[2], 10);
    const nama = match[3].trim();
    results.push({ tipe, nomor, nama });
  }
  return results;
}

// ---- Parse "Nama Usaha / Kepala Keluarga" column ----
// Format 1: "SARWI" (nama tunggal)
// Format 2: "[Usaha: BAKSO DAN MIE AYAM AGUS] [Keluarga: AGUS]"
// Mengembalikan: { usaha: string|null, keluarga: string|null, raw: string }
function parseNamaEntitas(str) {
  if (!str) return { usaha: null, keluarga: null, raw: '' };
  const text = String(str).trim();
  
  const usahaMatch = text.match(/\[Usaha:\s*([^\]]+)\]/i);
  const keluargaMatch = text.match(/\[Keluarga:\s*([^\]]+)\]/i);
  
  if (usahaMatch || keluargaMatch) {
    return {
      usaha: usahaMatch ? usahaMatch[1].trim() : null,
      keluarga: keluargaMatch ? keluargaMatch[1].trim() : null,
      raw: text
    };
  }
  
  // Nama tunggal — tipe akan ditentukan dari kolom Daftar Anomali
  return { usaha: null, keluarga: null, raw: text };
}

// ---- Validate Excel Structure (Format Gabungan) ----
function validateExcel(rows) {
  const errors = [];
  const warnings = [];

  if (!rows || rows.length < 3) {
    return { valid: false, errors: ['File tidak memiliki cukup baris (minimal 3: header + nomor + data)'], warnings: [] };
  }

  // Dynamically locate the header row by looking for key columns
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    const hasProv = row.some(c => String(c || '').trim() === 'Kode Prov');
    const hasAssId = row.some(c => String(c || '').trim() === 'Assignment ID');
    if (hasProv && hasAssId) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return { valid: false, errors: ['Format file tidak dikenali. Kolom "Kode Prov" dan "Assignment ID" tidak ditemukan di 10 baris pertama.'], warnings: [] };
  }

  let dataStartIdx = headerIdx + 1;

  // Check if there is a number row immediately following the header (e.g. starts with '(1)')
  if (rows.length > headerIdx + 1) {
    const nextRowFirstCell = String(rows[headerIdx + 1][0] || '').trim();
    if (nextRowFirstCell === '(1)') {
      dataStartIdx = headerIdx + 2;
    }
  }

  // Check first 18 core header columns (kolom inti yang wajib ada dan urut)
  const headerRow = rows[headerIdx];
  const colErrors = [];
  EXPECTED_COLS_GABUNGAN.forEach((col, i) => {
    const actual = String(headerRow[i] || '').trim();
    if (actual !== col) colErrors.push(`Kolom ${i + 1}: diharapkan "${col}", ditemukan "${actual}"`);
  });
  if (colErrors.length > 0) {
    return { valid: false, errors: ['Format header tidak sesuai template format gabungan:', ...colErrors.slice(0, 8)], warnings: [] };
  }

  // Check for extra columns beyond core 18 (informational)
  const headerRowTrimmed = headerRow.map(h => String(h || '').trim());
  const extraCols = headerRowTrimmed.slice(EXPECTED_COLS_GABUNGAN.length).filter(h => h);
  if (extraCols.length > 0) {
    warnings.push(`Ditemukan ${extraCols.length} kolom tambahan setelah "Link Fasih" (Penjelasan/data value — akan disimpan di raw_data)`);
  }

  // Validate data rows
  const dataRows = rows.slice(dataStartIdx).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];
  const rowWarnings = [];
  const seenAssignments = new Set();
  let emptyDaftarAnomaliCount = 0;
  let unparsedAnomaliRows = [];
  let formatAnomaliVariants = new Set(); // Menangkap variasi format yang belum dikenal

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + dataStartIdx + 1;
    const assignmentId = String(row[12] || '').trim();
    const kodeDesa     = String(row[8]  || '').trim();
    const kodeSLS      = String(row[10] || '').trim();
    const kodeSubSLS   = String(row[11] || '').trim();
    const daftarAnomali = String(row[13] || '').trim();
    const namaEntitas  = String(row[1]  || '').trim();

    // --- Validasi Assignment ID ---
    if (!UUID_REGEX.test(assignmentId)) {
      if (rowErrors.length < 15) rowErrors.push(`Baris ${rowNum}: Assignment ID tidak valid ("${assignmentId.slice(0, 20)}...")`);
    }

    // --- Validasi Kode Wilayah ---
    if (!/^\d{10}$/.test(kodeDesa)) {
      if (rowErrors.length < 15) rowErrors.push(`Baris ${rowNum}: Kode Desa harus 10 digit (ditemukan: "${kodeDesa}")`);
    }
    if (!/^\d{4}$/.test(kodeSLS)) {
      if (rowErrors.length < 15) rowErrors.push(`Baris ${rowNum}: Kode SLS harus 4 digit (ditemukan: "${kodeSLS}")`);
    }
    if (!/^\d{2}$/.test(kodeSubSLS)) {
      if (rowErrors.length < 15) rowErrors.push(`Baris ${rowNum}: Sub SLS harus 2 digit (ditemukan: "${kodeSubSLS}")`);
    }

    // --- Validasi Daftar Anomali (KETAT) ---
    if (!daftarAnomali) {
      emptyDaftarAnomaliCount++;
      if (emptyDaftarAnomaliCount <= 3) {
        if (rowWarnings.length < 20) rowWarnings.push(`⚠️ Baris ${rowNum}: Kolom "Daftar Anomali" kosong — baris akan di-skip`);
      }
    } else {
      const parsedItems = parseDaftarAnomali(daftarAnomali);
      if (parsedItems.length === 0) {
        // Kolom tidak kosong tapi tidak ada anomali yang bisa diparsing — kemungkinan format baru/aneh
        unparsedAnomaliRows.push({ rowNum, value: daftarAnomali.slice(0, 80) });
      }

      // Cek apakah ada bagian teks yang TIDAK tertangkap oleh regex
      let cleanedText = daftarAnomali;
      const regex = new RegExp(ANOMALI_ITEM_REGEX.source, 'gi');
      let m;
      while ((m = regex.exec(daftarAnomali)) !== null) {
        cleanedText = cleanedText.replace(m[0], '');
      }
      // Hapus separator umum (koma, spasi, titik koma)
      const leftover = cleanedText.replace(/[,;\s]+/g, '').trim();
      if (leftover.length > 2) {
        // Ada teks signifikan yang tidak terbaca
        formatAnomaliVariants.add(`Baris ${rowNum}: sisa teks tidak terparsing: "${leftover.slice(0, 50)}"`);
      }
    }

    // --- Validasi Nama Entitas ---
    if (!namaEntitas) {
      if (rowWarnings.length < 20) rowWarnings.push(`⚠️ Baris ${rowNum}: Kolom "Nama Usaha / Kepala Keluarga" kosong`);
    }

    // --- Deteksi duplikat assignment_id ---
    if (UUID_REGEX.test(assignmentId)) {
      if (seenAssignments.has(assignmentId)) {
        if (rowWarnings.length < 20) rowWarnings.push(`⚠️ Baris ${rowNum}: Assignment ID "${assignmentId.slice(0, 8)}..." muncul lebih dari 1x di file`);
      }
      seenAssignments.add(assignmentId);
    }
  }

  // Kumpulkan warning summary
  if (emptyDaftarAnomaliCount > 3) {
    rowWarnings.push(`⚠️ Total ${emptyDaftarAnomaliCount} baris memiliki kolom "Daftar Anomali" kosong — semua akan di-skip`);
  }

  if (unparsedAnomaliRows.length > 0) {
    rowErrors.push(`⛔ ${unparsedAnomaliRows.length} baris memiliki "Daftar Anomali" yang tidak bisa diparsing:`);
    unparsedAnomaliRows.slice(0, 5).forEach(r => {
      rowErrors.push(`   Baris ${r.rowNum}: "${r.value}"`);
    });
    if (unparsedAnomaliRows.length > 5) {
      rowErrors.push(`   ...dan ${unparsedAnomaliRows.length - 5} baris lainnya`);
    }
  }

  if (formatAnomaliVariants.size > 0) {
    warnings.push(`⚠️ Terdeteksi teks dalam "Daftar Anomali" yang tidak dikenali parser:`);
    Array.from(formatAnomaliVariants).slice(0, 5).forEach(w => warnings.push(`   ${w}`));
    if (formatAnomaliVariants.size > 5) {
      warnings.push(`   ...dan ${formatAnomaliVariants.size - 5} pattern lainnya`);
    }
  }

  // Merge all warnings
  const allWarnings = [...warnings, ...rowWarnings];

  if (rowErrors.length > 0) return { valid: false, errors: rowErrors, warnings: allWarnings };
  return { valid: true, errors: [], warnings: allWarnings, dataRows };
}

function mapTindakLanjutToStatus(val) {
  const str = String(val || '').toLowerCase().trim();
  if (str.includes('perbaikan')) {
    return 'sudah_diperbaiki';
  }
  if (str.includes('kondisi') || str.includes('sesuai')) {
    return 'sesuai_kondisi';
  }
  return 'belum_ditindaklanjuti';
}

// ---- Convert rows to records (Format Gabungan) ----
// 1 baris Excel bisa menghasilkan BEBERAPA record database
// Return: { records: [], warnings: [] }
function rowsToRecordsFull(rows, tanggalData) {
  // Dynamically locate the header row
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    const hasProv = row.some(c => String(c || '').trim() === 'Kode Prov');
    const hasAssId = row.some(c => String(c || '').trim() === 'Assignment ID');
    if (hasProv && hasAssId) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return { records: [], warnings: ['Header tidak ditemukan'] };

  let dataStartIdx = headerIdx + 1;
  if (rows.length > headerIdx + 1) {
    const nextRowFirstCell = String(rows[headerIdx + 1][0] || '').trim();
    if (nextRowFirstCell === '(1)') {
      dataStartIdx = headerIdx + 2;
    }
  }

  const headerRow = rows[headerIdx].map(h => String(h || '').trim());
  const dataRows  = rows.slice(dataStartIdx).filter(r => r && r.some(c => c !== null && c !== ''));
  const linkFasihIdx = headerRow.indexOf('Link Fasih');

  const allRecords = [];
  const conversionWarnings = [];

  // Pre-build index of penjelasan columns for fast lookup
  const penjelasanColMap = {};
  headerRow.forEach((h, idx) => {
    const lower = h.toLowerCase().trim();
    // Penjelasan pattern: "Anomali X Keluarga Penjelasan" or "Anomali X Penjelasan"
    const matchKel = lower.match(/^anomali\s+(\d+)\s+keluarga\s+penjelasan$/);
    const matchUsa = lower.match(/^anomali\s+(\d+)\s+penjelasan$/);
    if (matchKel) {
      penjelasanColMap[`keluarga_${matchKel[1]}`] = idx;
    } else if (matchUsa) {
      penjelasanColMap[`usaha_${matchUsa[1]}`] = idx;
    }
  });

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + dataStartIdx + 1;

    const get = (col) => {
      const idx = headerRow.indexOf(col);
      return idx >= 0 ? String(row[idx] !== null && row[idx] !== undefined ? row[idx] : '').trim() : '';
    };

    const assignmentId = get('Assignment ID');
    const daftarAnomaliStr = get('Daftar Anomali');
    const namaEntitasStr = get('Nama Usaha / Kepala Keluarga');

    if (!assignmentId || !UUID_REGEX.test(assignmentId)) continue;
    if (!daftarAnomaliStr) continue; // Skip baris tanpa daftar anomali

    // Parse multi-anomali dari kolom "Daftar Anomali"
    const anomaliList = parseDaftarAnomali(daftarAnomaliStr);
    if (anomaliList.length === 0) {
      conversionWarnings.push(`Baris ${rowNum}: Daftar Anomali "${daftarAnomaliStr.slice(0, 50)}" tidak bisa diparsing — di-skip`);
      continue;
    }

    // Parse nama entitas dari kolom B
    const entitas = parseNamaEntitas(namaEntitasStr);

    // Collect raw_data from columns after "Link Fasih"
    const rawData = {};
    if (linkFasihIdx >= 0) {
      for (let j = linkFasihIdx + 1; j < headerRow.length; j++) {
        const v = row[j];
        if (headerRow[j] && v !== null && v !== undefined && v !== '-' && v !== '') {
          rawData[headerRow[j]] = v;
        }
      }
    }

    const tindakLanjutStatus = mapTindakLanjutToStatus(get('Tindak Lanjut'));

    // Generate 1 record per anomali item
    for (const anomali of anomaliList) {
      // Determine nama_entitas based on tipe
      let namaEntitasFinal;
      if (entitas.usaha || entitas.keluarga) {
        // Parsed [Usaha: ...] [Keluarga: ...] format
        namaEntitasFinal = anomali.tipe === 'keluarga' ? entitas.keluarga : entitas.usaha;
        // Fallback to raw if specific type not found
        if (!namaEntitasFinal) namaEntitasFinal = entitas.raw;
      } else {
        // Nama tunggal — gunakan apa adanya
        namaEntitasFinal = entitas.raw;
      }

      // Lookup catatan/penjelasan from the matching column
      const penjelasanKey = `${anomali.tipe}_${anomali.nomor}`;
      const penjelasanIdx = penjelasanColMap[penjelasanKey];
      let catatanVal = null;
      if (penjelasanIdx !== undefined && row[penjelasanIdx] !== null && row[penjelasanIdx] !== undefined) {
        const v = String(row[penjelasanIdx]).trim();
        if (v && v !== '-') catatanVal = v;
      }

      allRecords.push({
        assignment_id:  assignmentId,
        tipe:           anomali.tipe,
        nama_entitas:   namaEntitasFinal || null,
        kode_desa:      get('Kode Desa'),
        kode_sls:       get('Kode SLS'),
        kode_sub_sls:   get('Sub SLS'),
        nomor_anomali:  anomali.nomor,
        nama_anomali:   anomali.nama,
        tindak_lanjut_status: tindakLanjutStatus,
        catatan:        catatanVal,
        first_seen:     tanggalData,
        last_seen:      tanggalData,
        raw_data:       Object.keys(rawData).length > 0 ? rawData : null
      });
    }
  }

  return { records: allRecords, warnings: conversionWarnings };
}

// ---- Merge Logic ----
async function mergeRecords(records, batchId, tanggalData, onProgress) {
  const results = { inserted: 0, updated: 0, reopened: 0, resolved: 0, errors: [] };
  const BATCH_SIZE = 500; // Large safe chunk size for batch database execution

  // Group records by type because the database function processes one type at a time
  const recordsByTipe = {};
  records.forEach(r => {
    if (!recordsByTipe[r.tipe]) recordsByTipe[r.tipe] = [];
    recordsByTipe[r.tipe].push(r);
  });

  const total = records.length;
  let processed = 0;

  for (const [tipe, tipeRecords] of Object.entries(recordsByTipe)) {
    for (let i = 0; i < tipeRecords.length; i += BATCH_SIZE) {
      const chunk = tipeRecords.slice(i, i + BATCH_SIZE);
      
      if (onProgress) {
        const pct = Math.round((processed / total) * 100);
        onProgress(pct);
      }

      const { data, error } = await db.rpc('merge_anomali_batch', {
        p_records: chunk,
        p_batch_id: batchId,
        p_tanggal_data: tanggalData,
        p_tipe: tipe
      });

      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          throw new Error('Fungsi merge_anomali_batch belum ditambahkan di database. Harap jalankan script SQL terbaru di editor SQL Supabase Anda.');
        }
        throw error;
      }

      results.inserted += data.inserted || 0;
      results.updated  += data.updated || 0;
      results.reopened += data.reopened || 0;
      results.resolved += data.resolved || 0;
      if (data.errors && data.errors.length > 0) {
        results.errors = results.errors.concat(data.errors);
      }

      processed += chunk.length;
    }

    // Resolve unseen anomalies of this type ONLY in the villages (desa) present in the uploaded file
    const desaCodes = [...new Set(tipeRecords.map(r => r.kode_desa))];
    const { data: resCount, error: resErr } = await db.rpc('resolve_unseen_anomali', {
      p_batch_id: batchId,
      p_tanggal_data: tanggalData,
      p_tipe: tipe,
      p_desa_codes: desaCodes
    });
    if (!resErr) {
      results.resolved += resCount || 0;
    } else {
      console.error('Gagal menjalankan resolve_unseen_anomali:', resErr);
    }
  }

  if (onProgress) onProgress(100);
  return results;
}

// ---- Generate Template Excel (Format Gabungan) ----
function generateTemplate() {
  const header = [
    ...EXPECTED_COLS_GABUNGAN,
    'Anomali 1 Penjelasan', 'Anomali 2 Penjelasan',
    'Anomali 3 Keluarga Penjelasan', 'Anomali 3 Penjelasan',
    'Anomali 4 Keluarga Penjelasan', 'Anomali 4 Penjelasan'
  ];
  const numRow = header.map((_, i) => `(${i + 1})`);

  // Contoh baris: hanya anomali keluarga
  const sampleRow1 = [
    1, 'SARWI', 36, 'BANTEN', 3602, 'LEBAK', 3602060, 'BANJARSARI',
    '3602060001', 'KERTARAHARJA', '0001', '00',
    '00000000-0000-0000-0000-000000000001',
    'Anomali Keluarga 4 (Luas lantai per kapita < 3 m2 atau > 200 m2)',
    'Belum Ditindaklanjuti', '-', '-',
    'https://fasih-sm.bps.go.id/app/assignment-detail/00000000-0000-0000-0000-000000000001',
    '', '', '', '', 'Luas lantai 2 m2 untuk 3 orang', ''
  ];

  // Contoh baris: anomali keluarga + usaha
  const sampleRow2 = [
    2, '[Usaha: BAKSO AGUS] [Keluarga: AGUS]', 36, 'BANTEN', 3602, 'LEBAK', 3602060, 'BANJARSARI',
    '3602060001', 'KERTARAHARJA', '0001', '00',
    '00000000-0000-0000-0000-000000000002',
    'Anomali Keluarga 4 (Luas lantai per kapita < 3 m2 atau > 200 m2), Anomali Usaha 2 (Keuntungan Usaha)',
    'Belum Ditindaklanjuti', '-', '-',
    'https://fasih-sm.bps.go.id/app/assignment-detail/00000000-0000-0000-0000-000000000002',
    '', 'Keuntungan usaha tidak wajar', '', '', 'Luas lantai 1 m2', ''
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, numRow, sampleRow1, sampleRow2]);
  ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 15) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Anomali Gabungan');
  XLSX.writeFile(wb, 'template_anomali_gabungan.xlsx');
}
