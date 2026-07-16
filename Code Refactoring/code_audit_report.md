# 🔍 Laporan Audit Kode — Dashboard Anomali SE2026

> **Tanggal:** 15 Juli 2026 | **Cakupan:** 17 file, ~10.800 baris | **Status:** Read-only audit

---

## 🔴 CRITICAL (Harus ditangani segera)

### SEC-01: SQL Injection via Supabase `.or()` / `.ilike()` — User Input Tidak Di-escape

**File:** [dashboard.js:435](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L435), [dashboard.js:122](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L122)

User input (`search`, `val.trim()`) diinterpolasi langsung ke dalam string filter PostgREST tanpa sanitasi:

```js
// dashboard.js:435 — search input langsung masuk ke query
q = q.or(`assignment_id.ilike.%${search}%,nama_entitas.ilike.%${search}%,...`);

// dashboard.js:122 — autocomplete petugas
.or(`email_ref.ilike.%${val.trim()}%,nama.ilike.%${val.trim()}%`)
```

Karakter khusus PostgREST seperti `,`, `.`, `(`, `)` di input user bisa memodifikasi filter query. Meskipun ini bukan SQL injection tradisional (Supabase menggunakan parameterized queries di sisi server), input seperti `%,status.eq.belum_ditindaklanjuti` bisa memanipulasi filter.

> **Rekomendasi:** Sanitize input sebelum interpolasi — hapus karakter `,`, `.`, `(`, `)`, `%` dari search string, atau gunakan parameter terpisah `.ilike('column', `%${sanitized}%`).

---

### SEC-02: Supabase API Key Hardcoded di Source Code

**File:** [config.js:2-3](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/config.js#L2-L3)

```js
const SUPABASE_URL = 'https://vpbhqemomsewrnrggbmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';
```

API key dan URL terpapar di client-side code. Ini adalah anon/publishable key (bukan service_role key), sehingga **keamanan bergantung sepenuhnya pada RLS policies**. Namun ada risiko:
- Key terlihat di Git history dan deployments
- Jika RLS policy salah/incomplete, data sensitif bisa diakses

> **Rekomendasi:** Ini "by design" untuk Supabase public clients, tetapi pastikan **semua RLS policies sudah benar dan komprehensif**. Pertimbangkan environment variables via Vercel.

---

### SEC-03: Schema/Code Mismatch — 3 Kolom Digunakan Tapi Tidak Ada di `schema.sql`

**File:** JavaScript menggunakan `show_anomaly`, `is_rejected`, `is_api_synced` di banyak tempat, tapi **ketiga kolom ini tidak didefinisikan** di [schema.sql](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/sql/schema.sql).

| Kolom | Digunakan di | Tidak ada di |
|-------|-------------|-------------|
| `show_anomaly` | dashboard.js, modal.js | schema.sql `assignment_anomali` |
| `is_rejected` | dashboard.js, modal.js | schema.sql `assignment_anomali` |
| `is_api_synced` | dashboard.js | schema.sql `assignment_anomali` |

Ini berarti:
- Schema SQL tidak mencerminkan database aktual (schema.sql ketinggalan update)
- Jika schema.sql dijalankan ulang, fitur reject dan show/hide anomali akan rusak
- Tidak ada `DEFAULT` value, `CHECK` constraint, atau index untuk kolom-kolom ini

> **Rekomendasi:** Tambahkan ketiga kolom ke `schema.sql` CREATE TABLE `assignment_anomali` dengan default values (`show_anomaly BOOLEAN DEFAULT false`, `is_rejected BOOLEAN DEFAULT false`, `is_api_synced BOOLEAN DEFAULT false`). Tambahkan index jika digunakan di filter.

---

## 🟠 HIGH (Harus ditangani sebelum release)

### BUG-01: `sortBappData()` — Semua Branch Identik (Sort Tidak Berfungsi)

**File:** [admin.js:1509-1523](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1509-L1523)

```js
function sortBappData() {
  filteredBappUploads.sort((a, b) => {
    let va, vb;
    if (bappSortField === 'nama') {
      va = (a.profiles?.nama || '').toLowerCase();
      vb = (b.profiles?.nama || '').toLowerCase();
    } else {
      // BUG: Identik dengan branch 'nama' di atas!
      va = (a.profiles?.nama || '').toLowerCase();
      vb = (b.profiles?.nama || '').toLowerCase();
    }
    ...
  });
}
```

Semua `bappSortField` value akan selalu mengurutkan berdasarkan `nama`, terlepas dari field yang dipilih user. Sort by kecamatan, role, atau waktu upload **tidak akan berfungsi**.

> **Rekomendasi:** Implementasi branch `else` dengan switch-case untuk setiap field: `role`, `kecamatan`, `created_at`, dll.

---

### BUG-02: `handle_new_user()` — Trigger Function Kosong (No-op)

**File:** [schema.sql:347-353](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/sql/schema.sql#L347-L353)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Profile created manually via admin panel, not auto-created
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Fungsi trigger ini **tidak melakukan apa-apa**. Jika ada trigger yang me-reference fungsi ini, trigger tersebut sia-sia. Jika tidak ada trigger, fungsi ini adalah dead code.

> **Rekomendasi:** Hapus fungsi ini beserta trigger-nya jika ada, atau implementasi logic auto-create profile.

---

### PERF-01: `loadUsers()` — N+1 Query Pattern, Unbounded Data Loading

**File:** [admin.js:497-664](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L497-L664) — **167 baris**

Fungsi ini melakukan **5 serial queries** dalam loop pagination ke database, lalu melakukan **2 pass O(n) processing** di client:

1. `profiles` (loop pagination)
2. `user_sls` (loop pagination)  
3. `pml_ppl` (loop pagination)
4. `get_anomaly_counts_by_sls` (RPC)
5. `wilayah_kec` (kecamatan names)
6. Pass 1: Calculate PPL anomaly counts
7. Pass 2: Calculate PML anomaly counts

Setiap kali `showSection('users')` dipanggil, **semua data dimuat ulang dari awal**.

> **Rekomendasi:** Buat single RPC function di database (`get_user_management_data`) yang menggabungkan semua 5 queries dalam satu call. Cache data di client dan invalidate hanya saat ada perubahan.

---

### PERF-02: BAPP Screenshot Disimpan Sebagai Base64 di Database

**File:** [bapp_uploads_schema.sql:10](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/sql/bapp_uploads_schema.sql#L10)

```sql
screenshot TEXT NOT NULL, -- Menyimpan data gambar Base64
```

Base64-encoded images disimpan langsung di kolom TEXT database. Saat `loadBAPPData()` dipanggil ([admin.js:1448](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1448)), **semua screenshot dimuat sekaligus** ke memory browser:

```js
const { data, error, count } = await db
  .from('bapp_uploads')
  .select('*, profiles:profile_id(...), wilayah_kec:kode_kec(...)') // Termasuk screenshot!
```

Jika ada 200 petugas × 500KB/image = **~100MB data dimuat ke RAM browser**.

> **Rekomendasi:** 
> 1. Pindahkan gambar ke Supabase Storage, simpan hanya URL di database
> 2. Exclude `screenshot` dari initial query, muat lazy saat user klik "Lihat Bukti"
> 3. Minimal: `.select('id, profile_id, kode_kec, created_at, profiles:..., wilayah_kec:...')`

---

### PERF-03: Dashboard Query Tidak Dibatasi untuk Guest/Admin — Memuat Semua Data

**File:** [dashboard.js:411-626](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L411-L626)

Saat `jenis === 'keduanya'` dan tidak ada filter nomor/keterangan, dashboard memanggil RPC `get_both_type_anomalies` yang bisa mengembalikan **semua anomali di seluruh kabupaten** (~10.000-50.000 rows). Untuk non-`keduanya`, query dibatasi `.limit(1000)` tapi masih besar.

Data di-group, di-filter, dan di-sort **sepenuhnya di client** JavaScript.

> **Rekomendasi:** Implementasi server-side pagination di RPC function. Kirim filter parameters ke database dan return hanya data yang dibutuhkan per halaman.

---

### SEC-04: `assignSLStoPPL()` — Menggunakan `prompt()` untuk Memilih PPL

**File:** [admin.js:1051-1066](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1051-L1066)

```js
const choice = prompt(`Pilih PPL untuk SLS ${kodeSLS}:\n\n${ppls.map(...)}\n\nMasukkan nomor:`);
```

Menggunakan `prompt()` bawaan browser untuk operasi database kritis (assign SLS ke PPL). Ini rawan human error dan tidak ada validasi konfirmasi.

> **Rekomendasi:** Ganti dengan modal dialog yang proper, dengan dropdown PPL dan konfirmasi.

---

## 🟡 MEDIUM (Perbaiki di sprint berikutnya)

### DUP-01: Pagination Logic Terduplikasi 5 Kali

Logika pagination (prev/next buttons, page range calculation, ellipsis) di-copy-paste di 5 tempat yang hampir identik:

| # | Fungsi | File | Baris |
|---|--------|------|-------|
| 1 | `renderPagination()` | [dashboard.js:882-908](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L882-L908) | 26 |
| 2 | `renderUserPagination()` | [admin.js:764-808](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L764-L808) | 44 |
| 3 | `renderUnassignedPagination()` | [admin.js:973-1010](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L973-L1010) | 37 |
| 4 | `renderWilayahPagination()` | [admin.js:1188-1225](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1188-L1225) | 37 |
| 5 | `renderBappPagination()` | [admin.js:1630-1668](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1630-L1668) | 38 |

> **Rekomendasi:** Ekstrak menjadi satu fungsi reusable `renderGenericPagination(containerId, currentPage, totalPages, goPageFn)` di `utils.js`.

---

### DUP-02: Sort Logic Terduplikasi 5 Kali

Pola `sort()` dengan `field switch + asc/desc` terduplikasi:

| Fungsi | File |
|--------|------|
| `sortData()` | [dashboard.js:757-774](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L757-L774) |
| `sortUsersData()` | [admin.js:694-712](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L694-L712) |
| `sortUnassignedData()` | [admin.js:1025-1049](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1025-L1049) |
| `sortWilayahData()` | [admin.js:1132-1143](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1132-L1143) |
| `sortBappData()` | [admin.js:1509-1523](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1509-L1523) |

> **Rekomendasi:** Buat generic `genericSort(arr, field, dir, fieldAccessor)` di `utils.js`.

---

### DUP-03: `initTheme()` / `toggleTheme()` Diduplikasi di 2 Tempat

**File:** [utils.js:48-64](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/utils.js#L48-L64) dan [login.html:286-300](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/login.html#L286-L300)

Kedua file berisi implementasi identik dari `initTheme()` dan `toggleTheme()`. Login page **tidak memuat `utils.js`**, sehingga duplikasi inline dilakukan.

> **Rekomendasi:** Tambahkan `utils.js` ke script load di `login.html`, atau pindahkan theme functions ke `config.js` (yang sudah dimuat oleh login.html).

---

### DUP-04: Paginated Data Fetching (Loop While) Terduplikasi 4 Kali

Pattern loop pagination untuk fetch data besar:

```js
let all = []; let from = 0; let hasMore = true;
while (hasMore) { ... all = all.concat(data); if (data.length < step) hasMore = false; else from += step; }
```

Terduplikasi di:
1. [admin.js:498-543](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L498-L543) — profiles
2. [admin.js:548-561](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L548-L561) — user_sls
3. [admin.js:563-578](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L563-L578) — pml_ppl
4. [admin.js:1082-1097](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1082-L1097) — master_wilayah

> **Rekomendasi:** Buat `async function fetchAllPaginated(table, selectCols, filters, orderBy)` di `utils.js`.

---

### DUP-05: Login Type Detection Logic Terduplikasi

Logika deteksi PPL (numerik Sobat ID) ada di:
1. [login.html:304-320](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/login.html#L304-L320) — `detectLoginType()`
2. [modal.js:668-687](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L668-L687) — `detectModalLoginType()`
3. [modal.js:750-763](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L750-L763) — email resolving logic (duplicated from `login()`)

> **Rekomendasi:** Konsolidasikan ke `auth.js`.

---

### DEAD-01: Fungsi & Variabel yang Tidak Pernah Dipanggil

| Item | File | Baris | Keterangan |
|------|------|-------|-----------|
| `buildSLSCode()` | [config.js:51-53](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/config.js#L51-L53) | 3 | Didefinisi tapi tidak pernah dipanggil di manapun |
| `ROLES` constant | [config.js:38-43](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/config.js#L38-L43) | 6 | Didefinisi tapi role hardcoded sebagai string di semua tempat |
| `toAuthEmail()` | [auth.js:5-11](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/auth.js#L5-L11) | 7 | Didefinisi tapi `login()` menggunakan logika inline sendiri |
| `toggleRawData()` | [modal.js:286](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L286) | 1 | Tidak ada HTML yang memanggil fungsi ini |
| `handle_new_user()` | [schema.sql:347-353](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/sql/schema.sql#L347-L353) | 7 | Trigger function kosong (no-op) |

> **Rekomendasi:** Hapus dead code, atau implementasi jika memang dibutuhkan (`ROLES` → gunakan di role checks alih-alih hardcoded strings).

---

### LONG-01: Fungsi Terlalu Panjang (>100 Baris)

| Fungsi | File | Baris | Panjang |
|--------|------|-------|---------|
| `loadData()` | [dashboard.js:411-626](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L411-L626) | 215 |
| `loadUsers()` | [admin.js:497-664](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L497-L664) | 167 |
| `renderAnomaliItem()` | [modal.js:159-281](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L159-L281) | 122 |
| `saveChanges()` | [modal.js:304-408](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L304-L408) | 104 |
| `renderSheetBody()` | [modal.js:38-157](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L38-L157) | 119 |
| `handleModalLoginSubmit()` | [modal.js:730-826](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L730-L826) | 96 |
| `renderBulkSheetBody()` | [modal.js:523-589](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L523-L589) | 66 |
| `renderTable()` | [dashboard.js:788-836](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L788-L836) | 48 |
| `printBAPP()` | [admin.js:1731-1889](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1731-L1889) | 158 |
| `processWilayahFile()` | [admin.js:1252-1319](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1252-L1319) | 67 |
| `checkMissingReferences()` | [admin.js:298-349](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L298-L349) | 51 |

> **Rekomendasi:** Pecah fungsi besar menjadi sub-fungsi yang fokus pada satu tanggung jawab. Contoh: `loadData()` bisa dipecah menjadi `buildDataQuery()`, `applyRoleFilter()`, `processResults()`.

---

### LONG-02: File Terlalu Besar

| File | Baris | Rekomendasi Split |
|------|-------|-------------------|
| [admin.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js) | 1891 | Pisahkan: `admin-upload.js`, `admin-users.js`, `admin-wilayah.js`, `admin-bapp.js` |
| [dashboard.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js) | 1428 | Pisahkan: `dashboard-filters.js`, `dashboard-render.js`, `dashboard-wilayah.js` |
| [modal.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js) | 920 | Pisahkan: `detail-modal.js`, `bulk-modal.js`, `login-modal.js`, `fasih-api.js` |
| [admin.html](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/admin.html) | 1371 | HTML terlalu besar — pertimbangkan template literals atau JS rendering |

---

### SEC-05: Fasih-SM API Reject Tanpa CSRF Protection

**File:** [modal.js:831-858](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js#L831-L858)

```js
await fetch('https://fasih-sm.bps.go.id/app/api/...', {
  method: 'POST',
  credentials: 'include',  // Mengirim cookies
  body: JSON.stringify({ assignmentId, statusApproval: "false", ... })
});
```

API call ke Fasih-SM menggunakan `credentials: 'include'` (sending cookies) tanpa CSRF token. Ini mengandalkan CORS policy di sisi Fasih-SM, tapi komentar di kode sendiri menyarankan "mengaktifkan ekstensi CORS" — yang berarti bypass CORS protection.

> **Rekomendasi:** Dokumentasikan risiko. Jangan sarankan pengguna mematikan CORS. Idealnya implementasi server-side proxy.

---

### SEC-06: `error.message` Ditampilkan ke User Tanpa Sanitasi

**File:** Beberapa tempat di admin.js dan dashboard.js

```js
// admin.js:394
tbody.innerHTML = `...Gagal memuat: ${error.message}...`;
// admin.js:423  
grid.innerHTML = `...Gagal memuat: ${error.message}...`;
```

`error.message` bisa mengandung HTML jika error berasal dari sumber tidak terpercaya, menyebabkan XSS reflected.

> **Rekomendasi:** Selalu gunakan `escHtml(error.message)` saat menampilkan error di innerHTML.

---

## 🟢 LOW (Perbaiki saat ada waktu)

### STYLE-01: Inconsistensi Penggunaan Line Endings

- [admin.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js) menggunakan `\r\n` (Windows CRLF)
- [dashboard.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js), [modal.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/modal.js), [upload.js](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/upload.js) menggunakan `\n` (Unix LF)

> **Rekomendasi:** Tambahkan `.editorconfig` dan `.gitattributes` untuk konsistensi. Gunakan LF di semua file.

---

### STYLE-02: Inconsistensi Penamaan Variabel

| Pattern | Contoh | File |
|---------|--------|------|
| camelCase | `currentPage`, `sortField` | dashboard.js |
| snake_case di JS | `assignment_id`, `kode_sls_gabungan` | Semua (mengikuti DB columns) |
| Mixed | `parsedKK` (singkatan) vs `parsedUsaha` (penuh) | admin.js |
| Prefix inconsistency | `allBappUploads` vs `allUnassignedGroups` vs `allUsers` | admin.js |

---

### STYLE-03: Inline Styles Berlebihan

Lebih dari **50 instances** inline `style="..."` ditemukan di JavaScript template literals. Contoh:

```js
// modal.js:121
`<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem 1.5rem;font-size:0.8125rem">`
```

> **Rekomendasi:** Pindahkan ke CSS classes di `main.css`.

---

### STYLE-04: `DOMContentLoaded` Listener Ganda di `admin.js`

**File:** [admin.js:173](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L173) dan [admin.js:1351](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1351)

Ada 2 `document.addEventListener('DOMContentLoaded', ...)` yang terpisah di file yang sama.

> **Rekomendasi:** Konsolidasikan menjadi satu listener.

---

### STYLE-05: Inconsistensi Bootstrap Pattern Antar Halaman

| Halaman | Bootstrap Pattern |
|---------|------------------|
| `admin.js` | `getSession()` check di DOMContentLoaded + `initAdmin()` calls `requireAuth()` (double check) |
| `dashboard.js` | `getSession()` check di DOMContentLoaded → `initDashboard()` (no requireAuth) |
| `login.html` | Inline IIFE `(async () => {...})()` |

> **Rekomendasi:** Standarisasi ke satu pattern bootstrap di semua halaman.

---

### STYLE-06: `admin.js:1349-1357` Melakukan Auth Check Duplikat

**File:** [admin.js:1349-1357](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1349-L1357)

Bootstrap code melakukan manual auth check:
```js
const session = await getSession();
if (!session || !session.profile) { window.location.href = '/login.html'; return; }
if (!['superadmin', 'admin'].includes(session.profile.role)) { window.location.href = '/dashboard.html'; return; }
await initAdmin();
```

Tapi `initAdmin()` di baris pertamanya sudah memanggil `requireAuth(['superadmin', 'admin'])` yang melakukan check identik.

> **Rekomendasi:** Hapus manual check di bootstrap, biarkan `initAdmin()` → `requireAuth()` yang menangani.

---

### DEAD-02: Variable `parsedWilayahExcel` Tidak Pernah Di-reset Setelah Upload Berhasil

**File:** [admin.js:1321-1345](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/admin.js#L1321-L1345)

`uploadMasterWilayah()` tidak me-reset `parsedWilayahExcel = null` setelah sukses, hanya pada open modal.

> **Rekomendasi:** Tambahkan `parsedWilayahExcel = null;` setelah upload berhasil.

---

### PERF-04: `renderAll()` Memproses Tabel + Cards + Pagination Sekaligus

**File:** [dashboard.js:779-786](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L779-L786)

```js
function renderAll() {
  renderTable(pageData);      // Desktop
  renderMobileCards(pageData); // Mobile
  renderPagination();
  updateTableCount();
}
```

Keduanya selalu dirender, padahal hanya salah satu yang visible di satu waktu (CSS media query).

> **Rekomendasi:** Cek viewport width dan hanya render yang visible, atau gunakan `requestIdleCallback`.

---

### PERF-05: `applyFilters()` Memanggil `loadData()` + `loadStats()` + `loadAnomalinomorOptions()` Setiap Filter Change

**File:** [dashboard.js:704-710](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/js/dashboard.js#L704-L710)

Setiap kali user mengubah filter (termasuk search debounce 300ms), 3 API calls baru dilakukan:

```js
function applyFilters() {
  currentPage = 1;
  renderKecamatanProgress();
  loadStats();              // API call
  loadAnomalinomorOptions(); // API call
  loadData();               // Heavy API call
}
```

> **Rekomendasi:** Stats dan nomor options jarang berubah — cukup dimuat sekali saat init, bukan setiap filter change.

---

### MISC-01: SVG Icons Inline Berulang Kali

SVG icon yang sama (checkmark, warning, arrow, close) di-paste secara inline di **puluhan tempat** di HTML dan JS. Contoh: icon save button muncul 3 kali identik di modal.js.

> **Rekomendasi:** Buat SVG sprite sheet atau gunakan reusable icon function:
> ```js
> function icon(name, size = 14) { return ICONS[name]; }
> ```

---

### MISC-02: `Contoh pdf/` — Folder Berisi Satu File PDF, Tidak Direferensi di Kode

**File:** [Contoh pdf/BAPP termin I - Lampiran.pdf](file:///c:/Users/ipds3602/Documents/antigravity/fervent-curie/Contoh%20pdf/BAPP%20termin%20I%20-%20Lampiran.pdf)

Tidak ada referensi ke file ini di kode manapun. Kemungkinan besar hanya reference document.

> **Rekomendasi:** Pindahkan ke `docs/` folder atau hapus dari repo (simpan di Google Drive).

---

## 📊 Ringkasan Temuan

| Prioritas | Jumlah | Tipe Dominan |
|-----------|--------|-------------|
| 🔴 **Critical** | 3 | Security (SQL injection, schema mismatch) |
| 🟠 **High** | 6 | Bugs, Performance, Security |
| 🟡 **Medium** | 11 | Duplikasi kode, Long functions, Dead code |
| 🟢 **Low** | 10 | Style, Minor performance, Housekeeping |
| **Total** | **30** | |

### Top 5 Prioritas Rekomendasi

1. **Sanitize search input** sebelum interpolasi ke Supabase `.or()` filter
2. **Sinkronkan schema.sql** dengan kolom aktual di database (`show_anomaly`, `is_rejected`, `is_api_synced`)
3. **Fix `sortBappData()`** — saat ini semua sort field menghasilkan output identik
4. **Lazy-load BAPP screenshots** — jangan muat semua base64 images sekaligus
5. **Ekstrak pagination/sort ke reusable functions** — kurangi ~250 baris duplikasi
