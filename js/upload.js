// ============================================================
// UPLOAD.JS — Excel Parsing, Validation & Merge Logic
// ============================================================

const EXPECTED_COLS_USAHA = [
  'No', 'Nama Usaha', 'Kode Prov', 'Nama Provinsi', 'Kode Kab/Kota',
  'Nama Kab/Kota', 'Kode Kec', 'Nama Kecamatan', 'Kode Desa', 'Nama Desa/Kel',
  'Kode SLS', 'Sub SLS', 'Assignment ID', 'Nama Anomali', 'Tindak Lanjut',
  'ID Petugas', 'Email Petugas', 'Link Fasih'
];

const EXPECTED_COLS_KELUARGA = [
  'No', 'Nama Kepala Keluarga', 'Kode Prov', 'Nama Provinsi', 'Kode Kab/Kota',
  'Nama Kab/Kota', 'Kode Kec', 'Nama Kecamatan', 'Kode Desa', 'Nama Desa/Kel',
  'Kode SLS', 'Sub SLS', 'Assignment ID', 'Nama Anomali', 'Tindak Lanjut',
  'ID Petugas', 'Email Petugas', 'Link Fasih'
];

const ANOMALI_REGEX_USAHA    = /Jumlah Anomali Data (\d+) \(([^)]+)\)/;
const ANOMALI_REGEX_KELUARGA = /Jumlah Anomali (\d+) \(([^)]+)\)/;
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

// ---- Validate Excel Structure ----
function validateExcel(rows, tipe) {
  const errors = [];
  const expected = tipe === 'usaha' ? EXPECTED_COLS_USAHA : EXPECTED_COLS_KELUARGA;

  if (!rows || rows.length < 3) {
    return { valid: false, errors: ['File tidak memiliki cukup baris'] };
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
    return { valid: false, errors: ['Format file tidak dikenali. Kolom "Kode Prov" dan "Assignment ID" tidak ditemukan di 10 baris pertama.'] };
  }

  let numIdx = -1;
  let dataStartIdx = headerIdx + 1;

  // Check if there is a number row immediately following the header (e.g. starts with '(1)')
  if (rows.length > headerIdx + 1) {
    const nextRowFirstCell = String(rows[headerIdx + 1][0] || '').trim();
    if (nextRowFirstCell === '(1)') {
      numIdx = headerIdx + 1;
      dataStartIdx = headerIdx + 2;
    }
  }

  // Check header columns
  const headerRow = rows[headerIdx];
  const colErrors = [];
  expected.forEach((col, i) => {
    const actual = String(headerRow[i] || '').trim();
    if (actual !== col) colErrors.push(`Kolom ${i + 1}: diharapkan "${col}", ditemukan "${actual}"`);
  });
  if (colErrors.length > 0) {
    return { valid: false, errors: ['Format header tidak sesuai template:', ...colErrors.slice(0, 6)] };
  }

  // Check column numbers row (1)(2)(3)... only if detected
  if (numIdx !== -1) {
    const numRow = rows[numIdx];
    if (!numRow || String(numRow[0] || '').trim() !== '(1)') {
      errors.push(`Baris ke-${numIdx + 1} harus berupa nomor kolom (1)(2)(3)... sesuai template`);
      return { valid: false, errors };
    }
  }

  // Validate data rows
  const dataRows = rows.slice(dataStartIdx).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const row = dataRows[i];
    const rowNum = i + dataStartIdx + 1;
    const assignmentId = String(row[12] || '').trim();
    const kodeDesa     = String(row[8]  || '').trim();
    const kodeSLS      = String(row[10] || '').trim();
    const kodeSubSLS   = String(row[11] || '').trim();
    const namaAnomali  = String(row[13] || '').trim();

    if (!UUID_REGEX.test(assignmentId))    rowErrors.push(`Baris ${rowNum}: Assignment ID tidak valid`);
    if (!/^\d{10}$/.test(kodeDesa))        rowErrors.push(`Baris ${rowNum}: Kode Desa harus 10 digit angka (ditemukan: "${kodeDesa}")`);
    if (!/^\d{4}$/.test(kodeSLS))          rowErrors.push(`Baris ${rowNum}: Kode SLS harus 4 digit angka (ditemukan: "${kodeSLS}")`);
    if (!/^\d{2}$/.test(kodeSubSLS))       rowErrors.push(`Baris ${rowNum}: Sub SLS harus 2 digit angka (ditemukan: "${kodeSubSLS}")`);
    const regex = tipe === 'usaha' ? ANOMALI_REGEX_USAHA : ANOMALI_REGEX_KELUARGA;
    if (!regex.test(namaAnomali))          rowErrors.push(`Baris ${rowNum}: Format Nama Anomali tidak dikenali`);
  }

  if (rowErrors.length > 0) return { valid: false, errors: rowErrors };
  return { valid: true, errors: [], dataRows };
}

// ---- Parse anomali name ----
function parseAnomaliName(namaStr, tipe) {
  const regex = tipe === 'usaha' ? ANOMALI_REGEX_USAHA : ANOMALI_REGEX_KELUARGA;
  const match = namaStr.match(regex);
  if (!match) return { nomor: null, nama: namaStr };
  return { nomor: parseInt(match[1]), nama: match[2].trim() };
}

// ---- Convert rows to records ----
function rowsToRecordsFull(rows, tipe, tanggalData) {
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

  if (headerIdx === -1) return [];

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

  return dataRows.map(row => {
    const get = (col) => {
      const idx = headerRow.indexOf(col);
      return idx >= 0 ? String(row[idx] !== null && row[idx] !== undefined ? row[idx] : '').trim() : '';
    };

    const assignmentId = get('Assignment ID');
    const namaAnomali  = get('Nama Anomali');
    if (!assignmentId || !namaAnomali) return null;

    const { nomor, nama } = parseAnomaliName(namaAnomali, tipe);
    if (!nomor) return null;

    const rawData = {};
    if (linkFasihIdx >= 0) {
      for (let i = linkFasihIdx + 1; i < headerRow.length; i++) {
        const v = row[i];
        if (headerRow[i] && v !== null && v !== undefined && v !== '-' && v !== '') {
          rawData[headerRow[i]] = v;
        }
      }
    }

    return {
      assignment_id:  assignmentId,
      tipe,
      nama_entitas:   tipe === 'keluarga' ? get('Nama Kepala Keluarga') : get('Nama Usaha') || null,
      kode_desa:      get('Kode Desa'),
      kode_sls:       get('Kode SLS'),
      kode_sub_sls:   get('Sub SLS'),
      nomor_anomali:  nomor,
      nama_anomali:   nama,
      first_seen:     tanggalData,
      last_seen:      tanggalData,
      raw_data:       Object.keys(rawData).length > 0 ? rawData : null
    };
  }).filter(Boolean);
}

// ---- Check SLS consistency between files ----
function checkSLSConsistency(kkRecords, usahaRecords) {
  const warnings = [];
  const kkSLSMap = {};
  kkRecords.forEach(r => {
    kkSLSMap[r.assignment_id] = r.kode_desa + r.kode_sls + r.kode_sub_sls;
  });
  usahaRecords.forEach(r => {
    const slsU = r.kode_desa + r.kode_sls + r.kode_sub_sls;
    if (kkSLSMap[r.assignment_id] && kkSLSMap[r.assignment_id] !== slsU) {
      warnings.push(`Assignment ${r.assignment_id.slice(0, 8)}...: Kode SLS berbeda antara file keluarga dan usaha`);
    }
  });
  return warnings;
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

// ---- Generate Template Excel ----
function generateTemplate(tipe) {
  const header = tipe === 'usaha' ? EXPECTED_COLS_USAHA : EXPECTED_COLS_KELUARGA;
  const numRow = header.map((_, i) => `(${i + 1})`);
  const sampleEntitas = tipe === 'usaha' ? 'CONTOH NAMA USAHA' : 'CONTOH NAMA KEPALA KELUARGA';
  const sampleAnomali = tipe === 'usaha'
    ? 'Jumlah Anomali Data 1 (Biaya Produksi Dominan) belum ditindaklanjuti'
    : 'Jumlah Anomali 1 (Kepala Keluarga dan pasangannya berstatus cerai atau belum kawin) belum ditindaklanjuti';

  const sampleRow = [
    1, sampleEntitas, 36, 'BANTEN', 3602, 'LEBAK', 3602060, 'BANJARSARI',
    '3602060001', 'KERTARAHARJA', '0001', '00',
    '00000000-0000-0000-0000-000000000001',
    sampleAnomali, 'Belum Ditindaklanjuti', '-', '-',
    'https://fasih-sm.bps.go.id/app/assignment-detail/00000000-0000-0000-0000-000000000001'
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, numRow, sampleRow]);
  ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 15) }));
  XLSX.utils.book_append_sheet(wb, ws, `Anomali ${tipe === 'usaha' ? 'Usaha' : 'Keluarga'}`);
  XLSX.writeFile(wb, `template_anomali_${tipe}.xlsx`);
}
