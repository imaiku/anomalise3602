-- ============================================================
-- TABEL & FUNGSI SISTEM ANTRIAN SCRAPING MITRA BPS MULTI-DEVICE
-- (Idempotent: Aman dijalankan berulang kali di Supabase SQL Editor)
-- ============================================================

-- 1. Buat Tabel mitra_data_sync
CREATE TABLE IF NOT EXISTS public.mitra_data_sync (
    id_mitra BIGINT PRIMARY KEY,
    id_ms TEXT,
    username TEXT,
    nama_lengkap TEXT,
    nik TEXT,
    no_telp TEXT,
    email TEXT,
    tgl_lahir TEXT,
    jenis_kelamin TEXT,
    agama TEXT,
    pendidikan TEXT,
    pekerjaan TEXT,
    status_kawin TEXT,
    alamat_detail TEXT,
    desa TEXT,
    kecamatan TEXT,
    kabupaten TEXT,
    provinsi TEXT,
    bank TEXT,
    rekening TEXT,
    npwp TEXT,
    sobat_id TEXT,
    is_motor TEXT,
    is_laptop TEXT,
    is_hp_android TEXT,
    is_bisa_komputer TEXT,
    posisi TEXT,
    status_mitra TEXT,
    satker TEXT,
    nik_revealed BOOLEAN DEFAULT FALSE,
    queue_status TEXT DEFAULT 'pending', -- 'pending', 'claimed', 'done', 'failed'
    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indeks untuk mempercepat antrean dan pencarian
CREATE INDEX IF NOT EXISTS idx_mitra_data_sync_queue ON public.mitra_data_sync (queue_status, claimed_at);
CREATE INDEX IF NOT EXISTS idx_mitra_data_sync_nik_revealed ON public.mitra_data_sync (nik_revealed);

-- Enable RLS
ALTER TABLE public.mitra_data_sync ENABLE ROW LEVEL SECURITY;

-- Drop Policy lama jika sudah ada agar tidak error 42710
DROP POLICY IF EXISTS "Allow public read mitra_data_sync" ON public.mitra_data_sync;
DROP POLICY IF EXISTS "Allow public insert mitra_data_sync" ON public.mitra_data_sync;
DROP POLICY IF EXISTS "Allow public update mitra_data_sync" ON public.mitra_data_sync;

-- Buat ulang Policy RLS (Izinkan Anon / Public Read, Insert, Update)
CREATE POLICY "Allow public read mitra_data_sync" 
    ON public.mitra_data_sync FOR SELECT 
    USING (true);

CREATE POLICY "Allow public insert mitra_data_sync" 
    ON public.mitra_data_sync FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Allow public update mitra_data_sync" 
    ON public.mitra_data_sync FOR UPDATE 
    USING (true);

-- 2. RPC: Claim Antrean Multi-Device (FOR UPDATE SKIP LOCKED)
-- Otomatis merebut antrean yang macet / ditinggal > 90 detik
CREATE OR REPLACE FUNCTION public.claim_mitra_scrape_queue(
    p_limit INT DEFAULT 5,
    p_client_id TEXT DEFAULT 'client'
)
RETURNS SETOF public.mitra_data_sync
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_limit INT := LEAST(GREATEST(p_limit, 1), 50);
BEGIN
    RETURN QUERY
    WITH available AS (
        SELECT id_mitra
        FROM public.mitra_data_sync
        WHERE 
            nik_revealed = FALSE
            AND (
                queue_status = 'pending'
                OR queue_status = 'failed'
                OR (queue_status = 'claimed' AND (claimed_at IS NULL OR claimed_at < (NOW() - INTERVAL '90 seconds')))
            )
        ORDER BY id_mitra ASC
        LIMIT v_limit
        FOR UPDATE SKIP LOCKED
    ),
    updated AS (
        UPDATE public.mitra_data_sync m
        SET 
            queue_status = 'claimed',
            claimed_by = p_client_id,
            claimed_at = NOW(),
            updated_at = NOW()
        FROM available a
        WHERE m.id_mitra = a.id_mitra
        RETURNING m.*
    )
    SELECT * FROM updated;
END;
$$;

-- 3. RPC: Update Data NIK Hasil Reveal & Selesaikan Antrean
CREATE OR REPLACE FUNCTION public.save_mitra_revealed(
    p_id_mitra BIGINT,
    p_nik TEXT,
    p_status TEXT DEFAULT 'done'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.mitra_data_sync
    SET 
        nik = COALESCE(NULLIF(p_nik, ''), nik),
        nik_revealed = (p_nik IS NOT NULL AND p_nik <> '' AND p_nik NOT LIKE '%*%'),
        queue_status = p_status,
        claimed_by = NULL,
        claimed_at = NULL,
        updated_at = NOW()
    WHERE id_mitra = p_id_mitra;
END;
$$;

-- 4. RPC: Lepaskan Klaim Tertentu (Jika Error / Tab Ditutup)
CREATE OR REPLACE FUNCTION public.release_mitra_claim(
    p_id_mitra BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.mitra_data_sync
    SET 
        queue_status = 'pending',
        claimed_by = NULL,
        claimed_at = NULL,
        updated_at = NOW()
    WHERE id_mitra = p_id_mitra AND queue_status = 'claimed';
END;
$$;

-- 5. RPC: Heartbeat Klaim (Agar antrean aktif tidak direbut saat menunggu captcha)
CREATE OR REPLACE FUNCTION public.heartbeat_mitra_claim(
    p_id_mitra BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.mitra_data_sync
    SET claimed_at = NOW()
    WHERE id_mitra = p_id_mitra AND queue_status = 'claimed';
END;
$$;

-- 6. RPC: Reset Antrean Macet / Ditinggal (> 90 detik)
CREATE OR REPLACE FUNCTION public.reset_stale_mitra_claims(
    p_seconds INT DEFAULT 90
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.mitra_data_sync
    SET 
        queue_status = 'pending',
        claimed_by = NULL,
        claimed_at = NULL,
        updated_at = NOW()
    WHERE 
        nik_revealed = FALSE 
        AND (
            (queue_status = 'claimed' AND (claimed_at IS NULL OR claimed_at < (NOW() - (p_seconds || ' seconds')::INTERVAL)))
            OR queue_status = 'failed'
        );
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- 7. RPC: Reset SEMUA Antrean yang Belum Selesai ke 'pending'
CREATE OR REPLACE FUNCTION public.reset_mitra_scrape_queue()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.mitra_data_sync
    SET 
        queue_status = 'pending',
        claimed_by = NULL,
        claimed_at = NULL,
        updated_at = NOW()
    WHERE nik_revealed = FALSE;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
