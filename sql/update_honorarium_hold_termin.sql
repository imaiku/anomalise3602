-- ========================================================================
-- MIGRATION: Add termin column to honorarium_hold
-- ========================================================================

-- 1. Tambah kolom termin jika belum ada (default 1 untuk Termin 1)
ALTER TABLE public.honorarium_hold 
ADD COLUMN IF NOT EXISTS termin INT NOT NULL DEFAULT 1 CHECK (termin IN (1, 2));

-- 2. Buat index pencarian honorarium_hold per termin
CREATE INDEX IF NOT EXISTS idx_honorarium_hold_user_gel_termin 
ON public.honorarium_hold(user_id, gelombang, termin) 
WHERE is_active = true;
