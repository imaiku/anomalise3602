-- ============================================================
-- TERMIN 1 GELOMBANG 4 — Schema Update
-- Jalankan di Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- 1. Tambah kolom capaian Gelombang 4 ke tabel capaian
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_g4     INTEGER DEFAULT 0; -- capaian PPL Termin 1 Gelombang 4
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_pml_g4 INTEGER DEFAULT 0; -- capaian PML Termin 1 Gelombang 4

-- 2. Update constraint gelombang di honorarium_hold agar menerima nilai 4
ALTER TABLE public.honorarium_hold
  DROP CONSTRAINT IF EXISTS honorarium_hold_gelombang_check;

ALTER TABLE public.honorarium_hold
  ADD CONSTRAINT honorarium_hold_gelombang_check
    CHECK (gelombang IN (1, 2, 3, 4));

-- Verifikasi kolom sudah ada
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'capaian'
  AND column_name IN ('capaian1_g4', 'capaian1_pml_g4');
