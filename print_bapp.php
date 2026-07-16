<?php
// print_bapp.php
// Backend PDF Generator for BAPP Attachment using Supabase REST API and FPDF

$ids = isset($_GET['id']) ? explode(',', $_GET['id']) : [];
$namas = isset($_GET['nama']) ? explode(',', $_GET['nama']) : [];
$kecamatans = isset($_GET['kecamatan']) ? explode(',', $_GET['kecamatan']) : [];

if (empty($ids)) {
    die("Error: Parameter 'id' tidak ditemukan.");
}

$supabase_url = 'https://vpbhqemomsewrnrggbmd.supabase.co';
$supabase_key = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';

require 'fpdf.php';

class PDF extends FPDF
{   
    // Fungsi untuk merender gambar dengan Fitur Clipping sederhana
    function ClippedImage($file, $x, $y, $w, $h, $type = '', $topOffsetPercent = 0, $bottomOffsetPercent = 100, $origW = 0, $origH = 0) {
        $this->_out('q');
        
        $hp = $this->h;
        // Clipping box
        $this->_out(sprintf('%.2F %.2F %.2F %.2F re W n', $x * $this->k, ($hp - ($y + $h)) * $this->k, $w * $this->k, $h * $this->k));
        
        if ($origW > 0 && $origH > 0) {
            $scale = $w / $origW; // Selaraskan lebar gambar agar pas dengan lebar box PDF
            $renderW = $origW * $scale;
            $renderH = $origH * $scale;
            
            $renderX = $x;
            
            // Geser koordinat Y ke atas berdasarkan persentase offset
            $offsetY = $renderH * ($topOffsetPercent / 100);
            $renderY = $y - $offsetY; 
            
            $this->Image($file, $renderX, $renderY, $renderW, $renderH, $type);
        } else {
            $this->Image($file, $x, $y, $w, $h, $type);
        }
        
        $this->_out('Q');
    }

    // Fungsi helper untuk mendeteksi letak file tanda tangan (telah mendukung assets/ttd/)
    function GetSignatureFile($name) {
        $paths = [
            'assets/ttd/' . $name,
            'assets/' . $name,
            'assets/signatures/' . $name,
            $name
        ];
        foreach ($paths as $path) {
            if (file_exists($path)) {
                return $path;
            }
        }
        return '';
    }

    // Fungsi untuk mencetak Halaman Lampiran BAPP (Landscape A4)
    function BappLampiran($nama, $screenshot, $kecamatan, $topOffset, $bottomOffset) {
        $this->AddPage('L', 'A4');
        
        // 1. Nomor Halaman di atas tengah
        $this->SetFont('Bookman', '', 11);
        $this->Cell(0, 10, '-4-', 0, 1, 'C');
        
        // 2. Judul Bagian: II. BUKTI PENCAPAIAN PEKERJAAN KECAMATAN XXX
        $this->SetFont('Bookman', 'B', 12);
        $titleText = 'II. BUKTI PENCAPAIAN PEKERJAAN KECAMATAN ' . strtoupper($kecamatan);
        $this->Cell(0, 10, $titleText, 0, 1, 'L');
        $this->Ln(3);
        
        // 3. Render Bukti Screenshot Pekerjaan
        $tempFile = '';
        $imgType = '';
        if (!empty($screenshot)) {
            // Decode base64 dan simpan ke file temp
            if (preg_match('/^data:image\/(\w+);base64,/', $screenshot, $type)) {
                $dataImg = substr($screenshot, strpos($screenshot, ',') + 1);
                $imgType = strtolower($type[1]);
                $dataImg = base64_decode($dataImg);
                if ($dataImg !== false) {
                    $tempFile = tempnam(sys_get_temp_dir(), 'bapp_img_');
                    file_put_contents($tempFile, $dataImg);
                }
            } else {
                $dataImg = base64_decode($screenshot);
                if ($dataImg !== false) {
                    $imgType = 'png'; // default fallback
                    $tempFile = tempnam(sys_get_temp_dir(), 'bapp_img_');
                    file_put_contents($tempFile, $dataImg);
                }
            }
        }
        
        // Dapatkan ukuran asli gambar
        $origW = 0;
        $origH = 0;
        if (!empty($tempFile) && file_exists($tempFile)) {
            $size = @getimagesize($tempFile);
            if ($size) {
                $origW = $size[0];
                $origH = $size[1];
            }
        }
        
        // Posisi Awal Gambar & Letak Tanda Tangan Tetap (Fixed di 120mm)
        $imgY = $this->GetY();
        $sigY = 120; 
        
        // 1. Tinggi gambar selalu fixed 60mm sesuai keinginan user
        $imgHeight = 60.0;
        
        // 2. Hitung rasio krop gambar (selalu portrait)
        $cropRatio = 1.0;
        if ($origW > 0) {
            $cropHeightPercent = $bottomOffset - $topOffset;
            if ($cropHeightPercent <= 0) $cropHeightPercent = 100;
            $cropRatio = ($origH / $origW) * ($cropHeightPercent / 100);
        }
        
        // 3. Hitung lebar gambar agar rasio aspek tetap terjaga (resize murni tanpa krop samping)
        $imgWidth = $imgHeight / $cropRatio;
        
        // Sentralkan posisi X gambar
        $imgX = (297 - $imgWidth) / 2;
        
        if (!empty($tempFile) && file_exists($tempFile)) {
            $fpdfType = (strcasecmp($imgType, 'jpeg') == 0 || strcasecmp($imgType, 'jpg') == 0) ? 'JPG' : 'PNG';
            
            // Cetak gambar kustom
            $this->ClippedImage($tempFile, $imgX, $imgY, $imgWidth, $imgHeight, $fpdfType, $topOffset, $bottomOffset, $origW, $origH);
            @unlink($tempFile); // Hapus file temp
        } else {
            // Placeholder box jika gambar tidak tersedia
            $this->Rect($imgX, $imgY, $imgWidth, $imgHeight, 'D');
            $this->SetXY($imgX, $imgY + ($imgHeight / 2) - 5);
            $this->SetFont('Bookman', 'I', 10);
            $this->Cell($imgWidth, 10, '[Bukti Screenshot Tidak Tersedia]', 0, 1, 'C');
        }
        
        // 4. Area Tanda Tangan (Spasi Tanda Tangan diperlebar ke 25mm agar pantas disisipkan tanda tangan digital)
        $this->SetFont('Bookman', '', 11);
        
        // Kolom Kiri: PIHAK KEDUA
        $this->SetXY(20, $sigY);
        $this->Cell(100, 5, 'PIHAK KEDUA,', 0, 0, 'C');
        
        // Kolom Kanan: PIHAK PERTAMA
        $this->SetXY(177, $sigY);
        $this->Cell(100, 5, 'PIHAK PERTAMA,', 0, 0, 'C');
        
        // --- DRAW SIGNATURES IMAGES IF AVAILABLE (FIXED COORD, NO MANUAL OFFSETS) ---
        // Tanda Tangan Yulian (Pihak Pertama)
        $ttd_yulian_file = $this->GetSignatureFile('yulian.png');
        if (empty($ttd_yulian_file)) {
            $ttd_yulian_file = $this->GetSignatureFile('yulian_sarwo_edi.png');
        }
        if (!empty($ttd_yulian_file)) {
            // Centered secara vertikal di space 25mm (sigY + 4.5)
            $ttd_x = 177 + (100 - 32) / 2;
            $this->Image($ttd_yulian_file, $ttd_x, $sigY + 4.5, 32, 16);
        }
        
        // Tanda Tangan PPK Ning Sri Lestari
        $ttd_ning_file = $this->GetSignatureFile('ning sl.png');
        if (empty($ttd_ning_file)) {
            $ttd_ning_file = $this->GetSignatureFile('ning sl.png');
        }
        if (!empty($ttd_ning_file)) {
            // Centered secara vertikal di space 25mm dari basline title (sigY + 43.5)
            $ttd_x = 85 + (100 - 32) / 2;
            $this->Image($ttd_ning_file, $ttd_x, $sigY + 42, 50, 25);
        }
        
        // Nama Terang Bold & Underlined (Jarak tanda tangan manual disesuaikan ke 25mm)
        $this->SetFont('Bookman', 'BU', 11);
        $this->SetXY(20, $sigY + 25);
        $this->Cell(100, 5, $nama, 0, 0, 'C');
        
        $this->SetXY(177, $sigY + 25);
        $this->Cell(100, 5, 'YULIAN SARWO EDI', 0, 0, 'C');
        
        // Menyetujui: PPK NING SRI LESTARI (Tengah Bawah)
        $this->SetFont('Bookman', '', 11);
        $this->SetXY(98.5, $sigY + 33);
        $this->Cell(100, 5, 'Menyetujui,', 0, 1, 'C');
        $this->SetX(98.5);
        $this->Cell(100, 5, 'Pejabat Pembuat Komitmen', 0, 1, 'C');
        
        // Jarak Tanda Tangan PPK disesuaikan ke 25mm (baseline title di 38mm, 38 + 25 = 63mm)
        $this->SetFont('Bookman', 'BU', 11);
        $this->SetXY(98.5, $sigY + 63);
        $this->Cell(100, 5, 'NING SRI LESTARI', 0, 1, 'C');
    }
}

// Fungsi helper untuk mengambil screenshot & batas krop dari Supabase REST API
function fetch_bapp_from_supabase($id, $supabase_url, $supabase_key) {
    $url = $supabase_url . '/rest/v1/bapp_uploads?select=screenshot,crop_top,crop_bottom&id=eq.' . urlencode($id);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "apikey: " . $supabase_key,
        "Authorization: Bearer " . $supabase_key,
        "Content-Type: application/json"
    ]);
    
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($response === false || $http_code !== 200) {
        return null;
    }
    
    $resObj = json_decode($response);
    return (!empty($resObj) && is_array($resObj)) ? $resObj[0] : null;
}

// Generate PDF
$pdf = new PDF();
// Nonaktifkan Page Break Otomatis agar layout tanda tangan di bawah tidak dipaksa ke Page 2
$pdf->SetAutoPageBreak(false);
$pdf->AliasNbPages();

// Register Custom Bookman Fonts
$pdf->AddFont('Bookman', '', 'bookman.json');
$pdf->AddFont('Bookman', 'B', 'bookmanb.json');
$pdf->AddFont('Bookman', 'I', 'bookmani.json');

// Render halaman BAPP untuk setiap ID yang diminta
foreach ($ids as $index => $id) {
    $id = trim($id);
    $nama = isset($namas[$index]) ? trim($namas[$index]) : '.........................................';
    $kecamatan = isset($kecamatans[$index]) ? trim($kecamatans[$index]) : '.........................................';
    
    $bappData = fetch_bapp_from_supabase($id, $supabase_url, $supabase_key);
    $screenshot = isset($bappData->screenshot) ? $bappData->screenshot : '';
    
    // Gunakan crop_top dan crop_bottom dari database (jika kosong/null, fallback ke default 12.5 dan 46.5)
    $topOffset = (isset($bappData->crop_top) && $bappData->crop_top !== null) ? floatval($bappData->crop_top) : 12.5;
    $bottomOffset = (isset($bappData->crop_bottom) && $bappData->crop_bottom !== null) ? floatval($bappData->crop_bottom) : 46.5;
    
    $pdf->BappLampiran($nama, $screenshot, $kecamatan, $topOffset, $bottomOffset);
}

$pdf->Output('I', 'BAPP_Lampiran.pdf');
?>
