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

  -- Lock / Anti-Collision State
  locked_by_id      uuid,
  locked_by_nama    text,
  locked_at         timestamptz,

  -- Metadata
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Migrasi jika tabel sudah ada sebelumnya:
ALTER TABLE public.potensi_usaha ADD COLUMN IF NOT EXISTS locked_by_id uuid;
ALTER TABLE public.potensi_usaha ADD COLUMN IF NOT EXISTS locked_by_nama text;
ALTER TABLE public.potensi_usaha ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_assignment ON public.potensi_usaha (assignment_id);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_kecamatan  ON public.potensi_usaha (kecamatan);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_desa       ON public.potensi_usaha (desa);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_status     ON public.potensi_usaha (status);
CREATE INDEX IF NOT EXISTS idx_potensi_usaha_locks      ON public.potensi_usaha (locked_by_id, locked_at);

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

-- ============================================================
-- LOCK / ANTI-COLLISION RPC FUNCTIONS (TIMEOUT 1 JAM)
-- ============================================================

-- RPC: Klaim kunci baris potensi_usaha untuk mencegah tabrakan
-- Kunci dapat diambil jika:
-- 1. Belum dikunci (locked_by_id IS NULL)
-- 2. Sedang dikunci oleh user yang sama
-- 3. Kunci sebelumnya sudah kadaluarsa (> 1 jam / 60 menit)
CREATE OR REPLACE FUNCTION public.claim_potensi_usaha_locks(
  p_ids BIGINT[],
  p_user_id UUID,
  p_user_nama TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_count INT := 0;
  v_failed_ids BIGINT[] := '{}';
  v_id BIGINT;
  v_existing RECORD;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN jsonb_build_object('success', true, 'claimed_count', 0, 'failed_ids', '[]'::jsonb);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT locked_by_id, locked_by_nama, locked_at 
    INTO v_existing
    FROM public.potensi_usaha
    WHERE id = v_id
    LIMIT 1;

    -- Kunci diizinkan jika belum dikunci, milik sendiri, atau sudah kadaluarsa (> 1 jam)
    IF v_existing.locked_by_id IS NULL 
       OR v_existing.locked_by_id = p_user_id 
       OR (v_existing.locked_by_nama IS NOT NULL AND LOWER(v_existing.locked_by_nama) = LOWER(p_user_nama))
       OR v_existing.locked_at < (NOW() - INTERVAL '1 hour') THEN
      
      UPDATE public.potensi_usaha
      SET locked_by_id = p_user_id,
          locked_by_nama = p_user_nama,
          locked_at = NOW()
      WHERE id = v_id;

      v_claimed_count := v_claimed_count + 1;
    ELSE
      v_failed_ids := array_append(v_failed_ids, v_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', array_length(v_failed_ids, 1) IS NULL,
    'claimed_count', v_claimed_count,
    'failed_ids', to_jsonb(v_failed_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_potensi_usaha_locks(BIGINT[], UUID, TEXT) TO authenticated, anon;

-- RPC: Melepaskan kunci baris potensi_usaha milik user / nama sesi tertentu
CREATE OR REPLACE FUNCTION public.release_potensi_usaha_locks(
  p_ids BIGINT[],
  p_user_id UUID,
  p_user_nama TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released_count INT := 0;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.potensi_usaha
  SET locked_by_id = NULL,
      locked_by_nama = NULL,
      locked_at = NULL
  WHERE id = ANY(p_ids)
    AND (
      locked_by_id = p_user_id 
      OR (p_user_nama IS NOT NULL AND LOWER(locked_by_nama) = LOWER(p_user_nama))
      OR locked_at < (NOW() - INTERVAL '1 hour')
    );

  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  RETURN v_released_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_potensi_usaha_locks(BIGINT[], UUID, TEXT) TO authenticated, anon;

-- RPC: Membersihkan semua kunci potensi_usaha yang sudah expired (> 1 jam)
CREATE OR REPLACE FUNCTION public.cleanup_expired_potensi_usaha_locks()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  UPDATE public.potensi_usaha
  SET locked_by_id = NULL,
      locked_by_nama = NULL,
      locked_at = NULL
  WHERE locked_at < (NOW() - INTERVAL '1 hour');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_potensi_usaha_locks() TO authenticated, anon;
