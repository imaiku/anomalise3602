-- ============================================================
-- MIGRATION: Tabel BAPP Pencairan Termin 2
-- Jalankan di Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bapp_uploads_t2 (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  kode_kec    VARCHAR(7) REFERENCES public.wilayah_kec(kode_kec),
  screenshot  TEXT NOT NULL,          -- base64 JPEG, max ~500KB setelah kompresi
  crop_top    NUMERIC(5,1) DEFAULT 12.5,
  crop_bottom NUMERIC(5,1) DEFAULT 46.5,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id)                 -- satu petugas satu upload (upsert)
);

-- Index untuk query by kecamatan
CREATE INDEX IF NOT EXISTS idx_bapp_uploads_t2_kode_kec
  ON public.bapp_uploads_t2(kode_kec);

-- RLS: aktifkan (sama dengan bapp_uploads termin 1)
ALTER TABLE public.bapp_uploads_t2 ENABLE ROW LEVEL SECURITY;

-- Policy: siapa saja bisa insert/upsert (halaman publik tanpa login)
CREATE POLICY "allow_public_upsert_t2"
  ON public.bapp_uploads_t2
  FOR ALL
  USING (true)
  WITH CHECK (true);
