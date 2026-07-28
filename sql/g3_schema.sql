-- SQL SCRIPT: GELOMBANG 3 SCHEMA UPDATE
-- Menambahkan kolom capaian Gelombang 3 ke tabel capaian & memperbarui RPC get_rekapitulasi_pml

-- 1. Tambah kolom capaian Gelombang 3 ke tabel capaian
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_g3     INTEGER DEFAULT 0; -- capaian PPL Termin 1 Gelombang 3
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_pml_g3 INTEGER DEFAULT 0; -- capaian PML Termin 1 Gelombang 3

-- 2. Update fungsi get_rekapitulasi_pml agar mendukung Gelombang 3 & 4
DROP FUNCTION IF EXISTS public.get_rekapitulasi_pml(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_rekapitulasi_pml(p_pml_id UUID)
RETURNS TABLE(
  nama_ppl              VARCHAR,
  sobatid_ppl           VARCHAR,
  total_target          BIGINT,
  total_capaian1        BIGINT,
  total_capaian1_pml    BIGINT,
  total_capaian1_pml_g2 BIGINT,
  total_capaian1_pml_g3 BIGINT,
  total_capaian1_pml_g4 BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.nama::VARCHAR,
    p.sobatid::VARCHAR,
    COALESCE(SUM(ws.target),                 0)::BIGINT AS total_target,
    COALESCE(SUM(c.capaian1),                0)::BIGINT AS total_capaian1,
    COALESCE(SUM(c.capaian1_pml),            0)::BIGINT AS total_capaian1_pml,
    COALESCE(SUM(c.capaian1_pml_g2),           0)::BIGINT AS total_capaian1_pml_g2,
    COALESCE(SUM(c.capaian1_pml_g3),           0)::BIGINT AS total_capaian1_pml_g3,
    COALESCE(SUM(c.capaian1_pml_g4),           0)::BIGINT AS total_capaian1_pml_g4
  FROM public.pml_ppl mp
  JOIN public.profiles p  ON p.id = mp.ppl_id
  JOIN public.user_sls us ON us.user_id = mp.ppl_id AND us.status = 'aktif'
  JOIN public.wilayah_subsls ws ON ws.kode_sls_gabungan = us.kode_sls
  LEFT JOIN public.capaian c ON c.kode_sls_gabungan = us.kode_sls
  WHERE mp.pml_id = p_pml_id
  GROUP BY p.id, p.nama, p.sobatid
  ORDER BY p.nama;
$$;

GRANT EXECUTE ON FUNCTION public.get_rekapitulasi_pml(UUID) TO anon, authenticated;
