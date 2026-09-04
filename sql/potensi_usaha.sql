-- ============================================================
-- POTENSI USAHA — Table Schema for SE2026 Kab. Lebak
-- Run this in Supabase SQL Editor
-- ============================================================

-- Drop if exists (uncomment to reset)
-- DROP TABLE IF EXISTS public.potensi_usaha;

CREATE TABLE IF NOT EXISTS public.potensi_usaha (
  id                bigserial PRIMARY KEY,

  -- Assignment ID Fasih-SM
  assignment_id     text,

  -- Lokasi / Wilayah
  kecamatan         text NOT NULL,
  desa              text NOT NULL,
  nama_sls          text,

  -- Identitas Responden
  nama_art          text NOT NULL,
  kedudukan_kerja   text,
  uraian_profesi    text,

  -- Status Pengerjaan
  -- Nilai: 'belum' | 'sudah_dikerjakan' | 'sudah_selesai'
  status            text NOT NULL DEFAULT 'belum'
                    CHECK (status IN ('belum', 'sudah_dikerjakan', 'sudah_selesai')),

  -- Audit: Sudah Dikerjakan
  dikerjakan_oleh   text,
  dikerjakan_at     timestamptz,

  -- Audit: Sudah Selesai
  selesai_oleh      text,
  selesai_at        timestamptz,

  -- Metadata
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_assignment ON public.potensi_usaha (assignment_id);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_kecamatan  ON public.potensi_usaha (kecamatan);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_desa       ON public.potensi_usaha (desa);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_status     ON public.potensi_usaha (status);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_potensi_usaha_updated_at ON public.potensi_usaha;
CREATE TRIGGER trg_potensi_usaha_updated_at
  BEFORE UPDATE ON public.potensi_usaha
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.potensi_usaha ENABLE ROW LEVEL SECURITY;

-- Public read access
DROP POLICY IF EXISTS "potensi_usaha_read_all" ON public.potensi_usaha;
CREATE POLICY "potensi_usaha_read_all"
  ON public.potensi_usaha FOR SELECT
  USING (true);

-- Write access hanya untuk authenticated users
DROP POLICY IF EXISTS "potensi_usaha_write_auth" ON public.potensi_usaha;
CREATE POLICY "potensi_usaha_write_auth"
  ON public.potensi_usaha FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
