-- ============================================================
-- FASIH CAPAIAN SCRAPING SCHEMA
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- 1. Tambah kolom fasih_region_id ke tabel wilayah
ALTER TABLE public.wilayah_kec  ADD COLUMN IF NOT EXISTS fasih_region_id UUID;
ALTER TABLE public.wilayah_desa ADD COLUMN IF NOT EXISTS fasih_region_id UUID;
ALTER TABLE public.wilayah_sls  ADD COLUMN IF NOT EXISTS fasih_region_id UUID;

-- 2. Tabel fasih_capaian_harian
--    Primary key: kode_sub_sls (16 digit dari label response API)
--    Kolom tanggal (misal "2026-08-06") ditambahkan secara dinamis via fungsi di bawah
CREATE TABLE IF NOT EXISTS public.fasih_capaian_harian (
  kode_sub_sls  VARCHAR(16) PRIMARY KEY,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fasih_capaian_harian ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fasih_capaian_select" ON public.fasih_capaian_harian;
CREATE POLICY "fasih_capaian_select" ON public.fasih_capaian_harian FOR SELECT USING (true);

DROP POLICY IF EXISTS "fasih_capaian_upsert" ON public.fasih_capaian_harian;
CREATE POLICY "fasih_capaian_upsert" ON public.fasih_capaian_harian
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. RPC: Tambah kolom tanggal secara dinamis
--    Dipanggil dari bot sebelum upsert data harian
--    p_date contoh: '2026-08-06'
CREATE OR REPLACE FUNCTION public.fasih_add_date_column(p_date TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format(
    'ALTER TABLE public.fasih_capaian_harian ADD COLUMN IF NOT EXISTS %I JSONB',
    p_date
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fasih_add_date_column(TEXT) TO authenticated;

-- 4. Tabel antrian scraping (untuk sistem claim multi-device)
CREATE TABLE IF NOT EXISTS public.fasih_scrape_queue (
  kode_sls       VARCHAR(14) PRIMARY KEY,  -- fullCode SLS (level 5 FASIH = level 5 kita)
  fasih_sls_id   UUID NOT NULL,            -- region5Id (SLS) untuk payload API
  fasih_desa_id  UUID NOT NULL,            -- region4Id (desa) untuk payload API
  fasih_kec_id   UUID NOT NULL,            -- region3Id (kecamatan) untuk payload API
  status         TEXT DEFAULT 'pending',   -- pending | claimed | done | error
  claimed_at     TIMESTAMPTZ,
  done_at        TIMESTAMPTZ,
  scrape_date    DATE
);

ALTER TABLE public.fasih_scrape_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scrape_queue_all" ON public.fasih_scrape_queue;
CREATE POLICY "scrape_queue_all" ON public.fasih_scrape_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. RPC: Claim batch antrian scraping (aman untuk multi-device)
CREATE OR REPLACE FUNCTION public.fasih_claim_scrape_queue(p_limit INT, p_date DATE)
RETURNS TABLE(
  kode_sls       VARCHAR(14),
  fasih_sls_id   UUID,
  fasih_desa_id  UUID,
  fasih_kec_id   UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.fasih_scrape_queue q
  SET
    status     = 'claimed',
    claimed_at = NOW(),
    scrape_date = p_date
  WHERE q.kode_sls IN (
    SELECT sq.kode_sls
    FROM public.fasih_scrape_queue sq
    WHERE
      sq.status = 'pending'
      OR (sq.status = 'claimed' AND sq.claimed_at < NOW() - INTERVAL '10 minutes')
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.kode_sls, q.fasih_sls_id, q.fasih_desa_id, q.fasih_kec_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fasih_claim_scrape_queue(INT, DATE) TO authenticated;

-- 6. RPC: Reset antrian (untuk mulai scraping hari baru)
CREATE OR REPLACE FUNCTION public.fasih_reset_scrape_queue()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.fasih_scrape_queue
  SET status = 'pending', claimed_at = NULL, done_at = NULL, scrape_date = NULL
  WHERE status IN ('done', 'error', 'claimed');
$$;
GRANT EXECUTE ON FUNCTION public.fasih_reset_scrape_queue() TO authenticated;

-- ============================================================
-- 7. Kolom claim untuk region lookup multi-device (Fase 3: SLS per desa)
--    Bot region-lookup menggunakan kolom ini agar setiap desa hanya
--    diproses oleh SATU device saat banyak device berjalan bersamaan.
-- ============================================================
ALTER TABLE public.wilayah_desa
  ADD COLUMN IF NOT EXISTS lookup_status     TEXT DEFAULT 'pending',  -- pending|claimed|done|error
  ADD COLUMN IF NOT EXISTS lookup_claimed_at TIMESTAMPTZ;

-- 8. RPC: Claim batch desa untuk region lookup (multi-device safe)
--    Mirip fasih_claim_scrape_queue, tapi untuk tabel wilayah_desa.
--    Hanya claim desa yang fasih_region_id-nya sudah terisi (sudah lolos Fase 2).
CREATE OR REPLACE FUNCTION public.fasih_claim_desa_lookup(p_limit INT)
RETURNS TABLE(
  kode_desa         VARCHAR(10),
  kode_kec          VARCHAR(7),
  fasih_desa_id     UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.wilayah_desa d
  SET
    lookup_status     = 'claimed',
    lookup_claimed_at = NOW()
  WHERE d.kode_desa IN (
    SELECT wd.kode_desa
    FROM public.wilayah_desa wd
    WHERE
      wd.fasih_region_id IS NOT NULL   -- hanya desa yang sudah punya fasih_region_id
      AND (
        wd.lookup_status = 'pending'
        OR (wd.lookup_status = 'claimed' AND wd.lookup_claimed_at < NOW() - INTERVAL '5 minutes')
      )
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING d.kode_desa, d.kode_kec, d.fasih_region_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fasih_claim_desa_lookup(INT) TO authenticated;

-- 9. RPC: Reset lookup_status desa (untuk menjalankan ulang region lookup dari awal)
CREATE OR REPLACE FUNCTION public.fasih_reset_desa_lookup()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wilayah_desa
  SET lookup_status = 'pending', lookup_claimed_at = NULL
  WHERE lookup_status IN ('done', 'error', 'claimed');
$$;
GRANT EXECUTE ON FUNCTION public.fasih_reset_desa_lookup() TO authenticated;

-- ============================================================
-- SETELAH MENJALANKAN SCRIPT INI:
-- 1. Jalankan fasihsm-region-lookup-bot.js di browser console
--    (login dulu di fasih-sm.bps.go.id) untuk populate fasih_region_id
--    di wilayah_kec, wilayah_desa, wilayah_sls dan isi fasih_scrape_queue.
--    Bot ini bisa dijalankan di beberapa device sekaligus (multi-device safe).
-- 2. Setelah queue terisi, jalankan fasihsm-capaian-bot.js setiap hari
--    untuk scraping capaian (juga multi-device safe).
-- ============================================================
