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
    return { valid: false, errors: ['File tidak memiliki cukup baris (minimum 3 baris termasuk 2 baris header)'] };
  }

  // Layer 2: Check header columns
  const headerRow = rows[0];
  const colErrors = [];
  expected.forEach((col, i) => {
    const actual = String(headerRow[i] || '').trim();
    if (actual !== col) colErrors.push(`Kolom ${i + 1}: diharapkan "${col}", ditemukan "${actual}"`);
  });
  if (colErrors.length > 0) {
    return { valid: false, errors: ['Format header tidak sesuai template:', ...colErrors.slice(0, 6)] };
  }

  // Layer 3: Row 2 must be (1)(2)(3)...
  const numRow = rows[1];
  if (!numRow || String(numRow[0] || '').trim() !== '(1)') {
    errors.push('Baris kedua harus berupa nomor kolom (1)(2)(3)... sesuai template');
    return { valid: false, errors };
  }

  // Layer 4: Validate data rows
  const dataRows = rows.slice(2).filter(r => r && r.some(c => c !== null && c !== ''));
  const rowErrors = [];

  for (let i = 0; i < dataRows.length && rowErrors.length < 10; i++) {
    const row = dataRows[i];
    const rowNum = i + 3;
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
  const headerRow = rows[0].map(h => String(h || '').trim());
  const dataRows  = rows.slice(2).filter(r => r && r.some(c => c !== null && c !== ''));
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
  const BATCH_SIZE = 100;

  // Deduplicate records by composite key (take last occurrence)
  const recordMap = {};
  records.forEach(r => {
    recordMap[`${r.assignment_id}|${r.tipe}|${r.nomor_anomali}`] = r;
  });
  const uniqueRecords = Object.values(recordMap);
  const total = uniqueRecords.length;

  // Process in batches
  for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
    const batch = uniqueRecords.slice(i, i + BATCH_SIZE);
    const assignmentIds = [...new Set(batch.map(r => r.assignment_id))];

    const { data: existing } = await db
      .from('assignment_anomali')
      .select('id, assignment_id, tipe, nomor_anomali, status, is_ever_reopened')
      .in('assignment_id', assignmentIds);

    const existingMap = {};
    (existing || []).forEach(e => {
      existingMap[`${e.assignment_id}|${e.tipe}|${e.nomor_anomali}`] = e;
    });

    for (const record of batch) {
      const key = `${record.assignment_id}|${record.tipe}|${record.nomor_anomali}`;
      const existingRow = existingMap[key];

      try {
        if (!existingRow) {
          // New anomali
          const { data: inserted, error: insErr } = await db
            .from('assignment_anomali')
            .insert({ ...record, status: 'belum_ditindaklanjuti', batch_id: batchId })
            .select('id').single();

          if (!insErr && inserted) {
            await db.from('status_history').insert({
              assignment_anomali_id: inserted.id,
              status_lama: null,
              status_baru: 'belum_ditindaklanjuti',
              diubah_oleh_nama: 'Sistem (Merge)',
              sumber: 'merge_otomatis'
            });
          }
          results.inserted++;
        } else {
          // Existing anomali — update last_seen
          const updatePayload = {
            last_seen: tanggalData,
            batch_id: batchId,
            nama_entitas: record.nama_entitas || existingRow.nama_entitas
          };

          let reopened = false;
          if (existingRow.status === 'sudah_diperbaiki') {
            updatePayload.status = 'belum_ditindaklanjuti';
            updatePayload.is_ever_reopened = true;
            reopened = true;
            results.reopened++;
          }

          await db.from('assignment_anomali').update(updatePayload).eq('id', existingRow.id);

          if (reopened) {
            await db.from('status_history').insert({
              assignment_anomali_id: existingRow.id,
              status_lama: 'sudah_diperbaiki',
              status_baru: 'belum_ditindaklanjuti',
              diubah_oleh_nama: 'Sistem (Merge)',
              sumber: 'merge_otomatis'
            });
          }
          results.updated++;
        }
      } catch (e) {
        results.errors.push(`${record.assignment_id.slice(0, 8)}: ${e.message}`);
      }
    }

    if (onProgress) onProgress(Math.round(((i + batch.length) / total) * 75));
  }

  // Auto-resolve: anomali not in today's file
  if (onProgress) onProgress(78);
  const tipes = [...new Set(records.map(r => r.tipe))];

  for (const tipe of tipes) {
    const tipeKeySet = new Set(
      records.filter(r => r.tipe === tipe)
             .map(r => `${r.assignment_id}|${r.nomor_anomali}`)
    );

    // Get all non-resolved records for this tipe
    const { data: activeRows } = await db
      .from('assignment_anomali')
      .select('id, assignment_id, nomor_anomali, status')
      .eq('tipe', tipe)
      .not('status', 'in', '("tidak_terdeteksi_lagi","sesuai_kondisi")');

    for (const row of (activeRows || [])) {
      const key = `${row.assignment_id}|${row.nomor_anomali}`;
      if (!tipeKeySet.has(key)) {
        await db.from('assignment_anomali').update({
          status: 'tidak_terdeteksi_lagi',
          last_seen: tanggalData
        }).eq('id', row.id);

        await db.from('status_history').insert({
          assignment_anomali_id: row.id,
          status_lama: row.status,
          status_baru: 'tidak_terdeteksi_lagi',
          diubah_oleh_nama: 'Sistem (Merge)',
          sumber: 'merge_otomatis'
        });
        results.resolved++;
      }
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
