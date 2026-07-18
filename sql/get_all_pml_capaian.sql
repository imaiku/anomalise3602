-- ============================================================
-- SQL Fungsi get_all_pml_capaian (Diperbarui)
-- Jalankan di Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_all_pml_capaian()
RETURNS TABLE(
  pml_id              UUID,
  total_target        BIGINT,
  total_capaian       BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    mp.pml_id,
    COALESCE(SUM(ws.target), 0)::BIGINT AS total_target,
    COALESCE(SUM(c.capaian1_pml), 0)::BIGINT AS total_capaian -- Menggunakan capaian1_pml untuk PML
  FROM public.pml_ppl mp
  JOIN public.user_sls us ON us.user_id = mp.ppl_id AND us.status = 'aktif'
  JOIN public.wilayah_subsls ws ON ws.kode_sls_gabungan = us.kode_sls
  LEFT JOIN public.capaian c ON c.kode_sls_gabungan = us.kode_sls
  GROUP BY mp.pml_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_pml_capaian() TO anon, authenticated;
