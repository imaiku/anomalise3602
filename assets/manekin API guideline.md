# Panduan Integrasi API Penilaian Kinerja Petugas Sensus (BPS Kab. Lebak)

Dokumen ini berisi spesifikasi teknis dan panduan integrasi API untuk implementasi pada frontend / sistem eksternal.

> [!IMPORTANT]
> **Update versi terbaru**: Sistem submit penilaian menggunakan **batch-submit** (`POST /api/v1/penilaian/sensus/batch-submit`). Seluruh mekanisme kode revisi dan pembatasan lock telah **dihapus** — petugas dapat melakukan submit awal maupun perubahan penilaian kapanpun diperlukan.

---

## 1. Konfigurasi Dasar & Autentikasi

- **Base URL**: `https://<domain-aplikasi-anda>`
- **Autentikasi**: Bearer Token
  ```http
  Authorization: Bearer <API_SECRET_KEY>
  ```
- **Content-Type**: `application/json`

---

## 2. Ringkasan Alur (User Flow)

```
                       [1. Petugas Login / Buka Form]
                                     │
                                     ▼
                GET /api/v1/penilaian/sensus/form?nik={nik}
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
           [Role = PML]                            [Role = PPL]
                 │                                       │
                 ▼                                       ▼
    1. Nilai daftar_wajib_nilai             1. Opsional nilai daftar_opsional_nilai
       (Semua PPL binaan)                      - PML Atasan Langsung
                 │                             - Rekan sesama PPL (1 PML)
                 ▼
    2. Opsional: Nilai Rekan PML lain
       (dari daftar_opsional_nilai)
                 │
                 ▼
    3. Opsional: Cari PPL Lintas PML/Kecamatan
       GET /api/v1/penilaian/sensus/search-ppl?penilai_id=...&q={input}
                 │
                 ▼
    [4. Submit Semua Nilai Sekaligus — 1 Request]
    POST /api/v1/penilaian/sensus/batch-submit
```

---

## 3. Spesifikasi Endpoint

### Endpoint 1: Mengambil Data Form & Target Penilaian
Digunakan saat pertama kali petugas membuka halaman evaluasi kinerja untuk memuat identitas penilai dan target petugas yang akan dinilai.

- **Method**: `POST`
- **Path**: `/api/v1/penilaian/sensus/form`
- **Headers**:
  ```http
  Authorization: Bearer <API_SECRET_KEY>
  Content-Type: application/json
  ```
- **Request Body (JSON)**:
  | Field | Tipe | Wajib | Keterangan |
  | :--- | :--- | :--- | :--- |
  | `nik` | String | Ya* | NIK 16 digit petugas (*salah satu dengan penugasan_id) |
  | `penugasan_id` | String | Ya* | ID penugasan (12 char) jika diketahui |

#### Contoh Request:
```http
POST /api/v1/penilaian/sensus/form
Authorization: Bearer dev_api_secret_3602_lebak_local
Content-Type: application/json

{
  "nik": "3602123456780001"
}
```


#### Contoh Response:
```json
{
  "success": true,
  "api_version": "v1",
  "data": {
    "penilai": {
      "penugasan_id": "010102p00001",
      "nama": "Ahmad Supardi",
      "sobat_id": "360212345",
      "role": "PML",
      "kegiatan_id": "0101"
    },
    "guidelines": {
      "skala_dimensi": {
        "min": 1,
        "max": 4,
        "fields": ["komunikasi", "kondef", "probing", "kualitas"],
        "deskripsi": "Skala 1 (Sangat Buruk) hingga 4 (Sangat Baik)"
      },
      "skala_overall": {
        "min": 1,
        "max": 6,
        "field": "overall",
        "deskripsi": "Kesediaan bekerja sama kembali dari skala 1 (Sangat Tidak Bersedia) hingga 6 (Sangat Bersedia)"
      },
      "catatan": {
        "required": false,
        "deskripsi": "Catatan atau rekomendasi performa bersifat opsional"
      }
    },
    "daftar_wajib_nilai": [
      {
        "penugasan_id": "010103m00001",
        "nama": "Budi Santoso",
        "role": "PPL",
        "tipe": "binaan",
        "sudah_dinilai": false,
        "is_complete": false,
        "nilai_sebelumnya": null
      }
    ],
    "daftar_opsional_nilai": [
      {
        "penugasan_id": "010102p00002",
        "nama": "Citra Lestari",
        "role": "PML",
        "tipe": "rekan_pml",
        "sudah_dinilai": false,
        "is_complete": false,
        "nilai_sebelumnya": null
      }
    ]
  }
}
```

---

### Endpoint 2: Pencarian PPL Lintas PML / Lintas Kecamatan (Search Bar)
Digunakan pada search bar ketika PML ingin mencari petugas PPL di luar binaannya.

- **Method**: `GET`
- **Path**: `/api/v1/penilaian/sensus/search-ppl`
- **Headers**:
  ```http
  Authorization: Bearer <API_SECRET_KEY>
  ```
- **Query Parameters**:
  | Parameter | Tipe | Wajib | Keterangan |
  | :--- | :--- | :--- | :--- |
  | `penilai_id` | String | **Ya** | Penugasan ID penilai. PPL binaan langsung otomatis di-exclude. `kegiatan_id` di-resolve otomatis dari penilai. |
  | `q` | String | Opsional | Kata kunci pencarian (nama, wilayah tugas, penugasan ID, atau NIK/NIP). Jika kosong, mengembalikan daftar PPL awal. |
  | `limit` | Number | Opsional | Jumlah item maksimal (Default: `20`, Maks: `50`). |

> [!TIP]
> **Rekomendasi Pemanggilan Search Bar**:
> - Pasang *debounce* 300ms pada input search agar tidak terlalu banyak hit ke server.
> - Format: `GET /api/v1/penilaian/sensus/search-ppl?penilai_id={penilai_id}&q={input}&limit=20`

#### Contoh Request:
```http
GET /api/v1/penilaian/sensus/search-ppl?penilai_id=010102p00001&q=budi&limit=20
Authorization: Bearer dev_api_secret_3602_lebak_local
```

#### Contoh Response:
```json
{
  "success": true,
  "api_version": "v1",
  "data": {
    "total_found": 2,
    "limit": 20,
    "items": [
      {
        "penugasan_id": "010103m00055",
        "petugas_id": "m00055",
        "nama": "Budi Hartono",
        "wilayah_tugas": "Rangkasbitung",
        "display_label": "Budi Hartono - Rangkasbitung",
        "role": "PPL",
        "sudah_dinilai": false,
        "is_complete": false,
        "nilai_sebelumnya": null
      },
      {
        "penugasan_id": "010103m00098",
        "petugas_id": "m00098",
        "nama": "Budi Setiawan",
        "wilayah_tugas": "Malingping",
        "display_label": "Budi Setiawan - Malingping",
        "role": "PPL",
        "sudah_dinilai": true,
        "is_complete": true,
        "nilai_sebelumnya": {
          "overall": 6,
          "approval_status": "pending",
          "is_cross_review": true
        }
      }
    ]
  }
}
```

---

### Endpoint 3: Batch Submit Penilaian *(Direkomendasikan untuk PML)*

Mengirimkan penilaian untuk **semua petugas sekaligus** dalam satu request. Cocok untuk alur PML yang menilai binaan + opsional dalam 1 sesi.

- **Method**: `POST`
- **Path**: `/api/v1/penilaian/sensus/batch-submit`
- **Headers**:
  ```http
  Authorization: Bearer <API_SECRET_KEY>
  Content-Type: application/json
  ```

#### Field Body JSON (Root):

| Field | Tipe | Wajib | Keterangan |
| :--- | :--- | :--- | :--- |
| `penilaiPenugasanId` | String | **Ya** | Penugasan ID Penilai (12 char) |
| `items` | Array | **Ya** | Daftar penilaian (min. 1 item) |

#### Field Setiap Item dalam `items`:

| Field | Tipe | Wajib | Rentang | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `dinilaiPenugasanId` | String | **Ya** | 12 char | Penugasan ID petugas yang dinilai |
| `komunikasi1` | Number | **Ya** | 1 – 4 | Skor Komunikasi & Koordinasi (Termin 1) |
| `kondef1` | Number | **Ya** | 1 – 4 | Skor Penguasaan Konsep & Definisi (Termin 1) |
| `probing1` | Number | **Ya** | 1 – 4 | Skor Kemampuan Probing & Wawancara (Termin 1) |
| `kualitas1` | Number | **Ya** | 1 – 4 | Skor Kualitas & Kerapian Isian Data (Termin 1) |
| `komunikasi2` | Number | **Ya** | 1 – 4 | Skor Komunikasi & Koordinasi (Termin 2) |
| `kondef2` | Number | **Ya** | 1 – 4 | Skor Penguasaan Konsep & Definisi (Termin 2) |
| `probing2` | Number | **Ya** | 1 – 4 | Skor Kemampuan Probing & Wawancara (Termin 2) |
| `kualitas2` | Number | **Ya** | 1 – 4 | Skor Kualitas & Kerapian Isian Data (Termin 2) |
| `overall` | Number | **Ya** | 1 – 6 | Kesediaan Bekerja Sama Kembali |
| `catatan` | String | Opsional | — | Catatan evaluasi / rekomendasi |


> [!IMPORTANT]
> **Aturan Submit & Perubahan Nilai**:
> - Setiap item **wajib diisi lengkap** sebagai 1 paket: 8 dimensi (termin 1 + termin 2) + `overall`. Hanya `catatan` yang opsional.
> - Tidak memerlukan token atau kode revisi apapun. Data yang dikirim akan otomatis dibuat baru (*created*) atau diperbarui (*updated*).

> [!CAUTION]
> **All-or-nothing**: Jika salah satu item gagal validasi atau hierarki, **seluruh batch dibatalkan** dan tidak ada data yang tersimpan.

#### Contoh Request Body:
```json
{
  "penilaiPenugasanId": "910102mm478d",
  "items": [
    {
      "dinilaiPenugasanId": "910103moa4m9",
      "komunikasi1": 3,
      "kondef1": 4,
      "probing1": 3,
      "kualitas1": 4,
      "komunikasi2": 4,
      "kondef2": 4,
      "probing2": 3,
      "kualitas2": 4,
      "overall": 5,
      "catatan": "Komunikatif dan cepat tanggap."
    },
    {
      "dinilaiPenugasanId": "910103m5idlz",
      "komunikasi1": 4,
      "kondef1": 3,
      "probing1": 4,
      "kualitas1": 4,
      "komunikasi2": 3,
      "kondef2": 4,
      "probing2": 4,
      "kualitas2": 3,
      "overall": 6
    }
  ]
}
```

#### Contoh Response Berhasil (`200`):
```json
{
  "success": true,
  "api_version": "v1",
  "message": "Batch penilaian berhasil disimpan.",
  "data": {
    "total": 2,
    "items": [
      { "dinilaiPenugasanId": "910103moa4m9", "action": "created", "approvalStatus": "approved" },
      { "dinilaiPenugasanId": "910103m5idlz", "action": "updated", "approvalStatus": "pending" }
    ]
  }
}
```


---

### Endpoint 4: Submit Penilaian Single *(Alternatif / Penggunaan Khusus)*

Untuk submit satu orang saja. Digunakan untuk alur non-PML (PPL, PIC) atau integrasi sistem lama yang sudah ada.

> [!NOTE]
> Untuk PML yang menilai banyak orang sekaligus, gunakan **Endpoint 3 (batch-submit)**. Field `kodeRevisi` pada endpoint ini sudah **deprecated** dan tidak lagi berfungsi — revisi kini dikelola melalui jendela waktu.

- **Method**: `POST`
- **Path**: `/api/v1/penilaian/sensus/submit`
- **Headers**:
  ```http
  Authorization: Bearer <API_SECRET_KEY>
  Content-Type: application/json
  ```

#### Daftar Field Isian (Body JSON):

| Field | Tipe | Wajib | Rentang | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| `penilaiPenugasanId` | String | **Ya** | 12 char | Penugasan ID Penilai |
| `dinilaiPenugasanId` | String | **Ya** | 12 char | Penugasan ID Petugas yang Dinilai |
| `komunikasi1` *(atau `komunikasi`)* | Number | **Ya** | 1 – 4 | Skor Komunikasi (Termin 1) |
| `kondef1` *(atau `kondef`)* | Number | **Ya** | 1 – 4 | Skor Konsep & Definisi (Termin 1) |
| `probing1` *(atau `probing`)* | Number | **Ya** | 1 – 4 | Skor Probing (Termin 1) |
| `kualitas1` *(atau `kualitas`)* | Number | **Ya** | 1 – 4 | Skor Kualitas (Termin 1) |
| `komunikasi2` | Number | **Ya** | 1 – 4 | Skor Komunikasi (Termin 2) |
| `kondef2` | Number | **Ya** | 1 – 4 | Skor Konsep & Definisi (Termin 2) |
| `probing2` | Number | **Ya** | 1 – 4 | Skor Probing (Termin 2) |
| `kualitas2` | Number | **Ya** | 1 – 4 | Skor Kualitas (Termin 2) |
| `overall` | Number | **Ya** | 1 – 6 | Kesediaan Bekerja Sama Kembali |
| `catatan` | String | Opsional | — | Catatan evaluasi (opsional) |
| ~~`kodeRevisi`~~ | — | — | — | **Deprecated** — tidak lagi dipakai |


#### Contoh Request Body:
```json
{
  "penilaiPenugasanId": "010102p00001",
  "dinilaiPenugasanId": "010103m00055",
  "komunikasi1": 3,
  "kondef1": 4,
  "probing1": 3,
  "kualitas1": 4,
  "komunikasi2": 4,
  "kondef2": 4,
  "probing2": 3,
  "kualitas2": 4,
  "overall": 5,
  "catatan": "Kinerja di lapangan sangat baik dan responsif."
}
```

#### Contoh Response Berhasil:
```json
{
  "success": true,
  "api_version": "v1",
  "message": "Penilaian berhasil disimpan.",
  "data": {
    "penilaian_id": "8fa538e1-95c5-430b-938b-eb012a647ff9",
    "action": "created",
    "approval_status": "approved"
  }
}
```


---

## 4. Kode Error Umum

| HTTP Code | `error` | Penyebab |
| :--- | :--- | :--- |
| `400` | `BAD_REQUEST` | Field wajib tidak dikirim atau format salah |
| `400` | `INCOMPLETE_SCORES` | Ada dimensi wajib yang tidak diisi |
| `400` | `INVALID_SCORE_RANGE` | Nilai skor di luar rentang yang diizinkan |
| `401` | `UNAUTHORIZED` | API Secret Key tidak valid atau tidak dikirim |
| `403` | `FORBIDDEN_TARGET` | PIC tidak boleh dinilai oleh petugas lapangan |
| `403` | `FORBIDDEN_HIERARCHY` | Melanggar aturan hierarki penilaian |
| `404` | `PENUGASAN_NOT_FOUND` | ID penugasan tidak ditemukan di database |
| `429` | `TOO_MANY_REQUESTS` | Melebihi batas 60 request per menit per IP |

| `500` | `INTERNAL_ERROR` | Kesalahan server, coba ulang beberapa saat |

---

## 5. Tabel Aturan Status Approval Otomatis

| Penilai | Petugas Dinilai | Status Approval | Keterangan |
| :--- | :--- | :--- | :--- |
| **PML** | PPL Binaan Langsung | `approved` | Langsung disetujui tanpa review |
| **PML** | Sesama PML (Satu PIC/Kecamatan) | `approved` | Peer review langsung disetujui |
| **PML** | PPL Lintas Bina / Lintas Kec | `pending` | Memerlukan review & approval Admin Tim |
| **PPL** | PML Atasan Langsung | `approved` | Langsung disetujui |
| **PPL** | Rekan PPL (Satu PML) | `approved` | Langsung disetujui |
| **PIC** | PML Binaan & PPL Koordinasinya | `approved` | Langsung disetujui |

---

## 6. Skala Skor & Dimensi Penilaian

1. **Dimensi Kinerja Lapangan (Skala 1 s/d 4)**:
   - `1`: Sangat Buruk
   - `2`: Buruk
   - `3`: Baik
   - `4`: Sangat Baik
   - **Fields**: `komunikasi`, `kondef` (Konsep Definisi), `probing` (Wawancara), `kualitas` (Kerapian & Kebenaran Data).

2. **Dimensi Kesediaan Bekerja Sama (Skala 1 s/d 6)**:
   - `1`: Sangat Tidak Bersedia
   - `2`: Tidak Bersedia
   - `3`: Kurang Bersedia
   - `4`: Cukup Bersedia
   - `5`: Bersedia
   - `6`: Sangat Bersedia
   - **Field**: `overall`

3. **Catatan**: Tipe `text` (String), **bersifat opsional**.

---

## 7. Contoh Alur Lengkap PML (Pseudocode)

```javascript
// 1. Load form data (POST dengan body JSON)
const form = await POST('/api/v1/penilaian/sensus/form', {
  nik: '360212345678000X'
});
const penilaiId = form.data.penilai.penugasan_id;


// 2. Tampilkan daftar wajib & opsional ke user
const wajib = form.data.daftar_wajib_nilai;
const opsional = form.data.daftar_opsional_nilai;

// 3. Jika user ingin cari PPL lintas kecamatan:
const searchResult = await GET(`/api/v1/penilaian/sensus/search-ppl?penilai_id=${penilaiId}&q=budi`);

// 4. Kumpulkan semua nilai ke dalam satu array
// Setiap item WAJIB lengkap: termin1 + termin2 + overall (catatan opsional)
const allItems = [
  ...wajib.map(p => ({
    dinilaiPenugasanId: p.penugasan_id,
    komunikasi1: ..., kondef1: ..., probing1: ..., kualitas1: ...,
    komunikasi2: ..., kondef2: ..., probing2: ..., kualitas2: ...,
    overall: ...,
    catatan: ... // opsional
  })),
  // tambah dari opsional & search jika ada
];


// 5. Submit sekaligus dalam 1 request
const result = await POST('/api/v1/penilaian/sensus/batch-submit', {
  penilaiPenugasanId: penilaiId,
  items: allItems
});

// result.data.items berisi status per orang: { action: "created"|"updated", approvalStatus: "approved"|"pending" }
```
