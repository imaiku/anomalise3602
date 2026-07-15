-- ============================================================
-- SQL SCRIPT: MEMBUAT TABEL BAPP UPLOADS & KEBIJAKAN RLS
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bapp_uploads (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  kode_kec       VARCHAR(7) REFERENCES public.wilayah_kec(kode_kec) ON DELETE SET NULL,
  screenshot     TEXT NOT NULL, -- Menyimpan data gambar Base64
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (profile_id)
);

-- Mengaktifkan Row Level Security (RLS)
ALTER TABLE public.bapp_uploads ENABLE ROW LEVEL SECURITY;

-- 1. Kebijakan Select: Semua pengguna (baik publik maupun terautentikasi) bisa melihat data upload BAPP
CREATE POLICY "bapp_select_all" ON public.bapp_uploads FOR SELECT USING (true);

-- 2. Kebijakan Insert: Siapa saja (publik) bisa melakukan upload (karena halaman bersifat publik)
CREATE POLICY "bapp_insert_public" ON public.bapp_uploads FOR INSERT WITH CHECK (true);

-- 3. Kebijakan Update: Siapa saja (publik) bisa mengupdate/mengunggah ulang (melalui ON CONFLICT)
CREATE POLICY "bapp_update_public" ON public.bapp_uploads FOR UPDATE USING (true) WITH CHECK (true);

-- 4. Kebijakan Delete: Hanya Superadmin/Admin yang bisa menghapus data upload BAPP
CREATE POLICY "bapp_delete_admin" ON public.bapp_uploads FOR DELETE TO authenticated 
  USING (get_my_role() IN ('superadmin', 'admin'));

-- ============================================================
-- DATABASE FUNCTION: MENDAPATKAN DAFTAR PETUGAS SECARA PUBLIK
-- Fungsi ini menggunakan SECURITY DEFINER agar bisa diakses secara anonim
-- untuk bypass RLS tabel profiles & user_sls yang terproteksi.
-- Hanya mengembalikan kolom nama, role, dan kode_kec (aman dari kebocoran data).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_petugas_list()
RETURNS TABLE (
  id UUID,
  nama VARCHAR,
  role VARCHAR,
  kode_kec VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  -- 1. Semua PPL (beserta kecamatan dari SLS aktifnya jika ada)
  SELECT DISTINCT p.id, p.nama, p.role, substring(us.kode_sls from 1 for 7)::VARCHAR as kode_kec
  FROM public.profiles p
  LEFT JOIN public.user_sls us ON p.id = us.user_id AND us.status = 'aktif'
  WHERE p.is_active = true 
    AND p.role = 'ppl'
    
  UNION
  
  -- 2. Semua PML (beserta kecamatan dari PPL bawahannya atau SLS aktifnya jika ada)
  SELECT DISTINCT p.id, p.nama, p.role, COALESCE(substring(us_direct.kode_sls from 1 for 7), substring(us_ppl.kode_sls from 1 for 7))::VARCHAR as kode_kec
  FROM public.profiles p
  LEFT JOIN public.user_sls us_direct ON p.id = us_direct.user_id AND us_direct.status = 'aktif'
  LEFT JOIN public.pml_ppl pm ON p.id = pm.pml_id
  LEFT JOIN public.user_sls us_ppl ON pm.ppl_id = us_ppl.user_id AND us_ppl.status = 'aktif'
  WHERE p.is_active = true 
    AND p.role = 'pml'
  ORDER BY nama;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- DATABASE FUNCTION: PENCARIAN PETUGAS DENGAN FILTER KECAMATAN
-- Fungsi ini digunakan untuk mencari petugas secara publik (bypass RLS)
-- dan membatasi pencarian hanya pada kecamatan yang dipilih (jika ada).
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_petugas_by_kec(
  p_query TEXT, 
  p_kode_kec TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  nama VARCHAR,
  role VARCHAR,
  kode_kec VARCHAR,
  email_ref VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    p.id, 
    p.nama, 
    p.role, 
    COALESCE(substring(us_direct.kode_sls from 1 for 7), substring(us_ppl.kode_sls from 1 for 7))::VARCHAR as kode_kec, 
    p.email_ref
  FROM public.profiles p
  LEFT JOIN public.user_sls us_direct ON p.id = us_direct.user_id AND us_direct.status = 'aktif'
  LEFT JOIN public.pml_ppl pm ON p.id = pm.pml_id
  LEFT JOIN public.user_sls us_ppl ON pm.ppl_id = us_ppl.user_id AND us_ppl.status = 'aktif'
  WHERE p.is_active = true 
    AND p.role IN ('ppl', 'pml')
    AND (p.nama ILIKE '%' || p_query || '%' OR p.email_ref ILIKE '%' || p_query || '%')
    AND (
      p_kode_kec IS NULL 
      OR p_kode_kec = '' 
      OR COALESCE(substring(us_direct.kode_sls from 1 for 7), substring(us_ppl.kode_sls from 1 for 7)) = p_kode_kec
    )
  ORDER BY p.nama;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


