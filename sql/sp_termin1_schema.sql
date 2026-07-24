-- ============================================================
-- ANOMALI DASHBOARD — SP PEMERIKSAAN TERMIN I
-- Jalankan di Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- 1. Tambah kolom NIK ke profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nik VARCHAR(16);

-- 2. Tabel no_surat_se
CREATE TABLE IF NOT EXISTS public.no_surat_se (
  sobatid                  VARCHAR(20) PRIMARY KEY REFERENCES public.profiles(sobatid) ON DELETE CASCADE,
  no_spk                   VARCHAR(100),
  no_sp_pemeriksaan_t1     VARCHAR(100),
  no_sp_pemeriksaan_t2     VARCHAR(100),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.no_surat_se ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "no_surat_select" ON public.no_surat_se;
CREATE POLICY "no_surat_select" ON public.no_surat_se FOR SELECT USING (true);

DROP POLICY IF EXISTS "no_surat_admin" ON public.no_surat_se;
CREATE POLICY "no_surat_admin" ON public.no_surat_se FOR ALL TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

DROP TRIGGER IF EXISTS trg_no_surat_updated_at ON public.no_surat_se;
CREATE TRIGGER trg_no_surat_updated_at
  BEFORE UPDATE ON public.no_surat_se
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Tambah target ke wilayah_subsls
ALTER TABLE public.wilayah_subsls
  ADD COLUMN IF NOT EXISTS target INTEGER DEFAULT 0;

-- 4. Tabel capaian
CREATE TABLE IF NOT EXISTS public.capaian (
  kode_sls_gabungan  VARCHAR(16) PRIMARY KEY REFERENCES public.wilayah_subsls(kode_sls_gabungan) ON DELETE CASCADE,
  capaian1           INTEGER DEFAULT 0,  -- capaian PPL Termin 1 Gelombang 1
  capaian1_g2        INTEGER DEFAULT 0,  -- capaian PPL Termin 1 Gelombang 2
  capaian2           INTEGER DEFAULT 0,  -- capaian PPL Termin 2 Gelombang 1
  capaian2_g2        INTEGER DEFAULT 0,  -- capaian PPL Termin 2 Gelombang 2
  capaian1_pml       INTEGER DEFAULT 0,  -- capaian PML Termin 1 Gelombang 1
  capaian1_pml_g2    INTEGER DEFAULT 0,  -- capaian PML Termin 1 Gelombang 2
  capaian2_pml       INTEGER DEFAULT 0,  -- capaian PML Termin 2 Gelombang 1
  capaian2_pml_g2    INTEGER DEFAULT 0,  -- capaian PML Termin 2 Gelombang 2
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Tambah kolom jika tabel sudah ada
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_pml INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_g2 INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian1_pml_g2 INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian2 INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian2_g2 INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian2_pml INTEGER DEFAULT 0;
ALTER TABLE public.capaian ADD COLUMN IF NOT EXISTS capaian2_pml_g2 INTEGER DEFAULT 0;

ALTER TABLE public.capaian ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "capaian_select" ON public.capaian;
CREATE POLICY "capaian_select" ON public.capaian FOR SELECT USING (true);

DROP POLICY IF EXISTS "capaian_admin" ON public.capaian;
CREATE POLICY "capaian_admin" ON public.capaian FOR ALL TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

CREATE INDEX IF NOT EXISTS idx_capaian_kode ON public.capaian(kode_sls_gabungan);

DROP TRIGGER IF EXISTS trg_capaian_updated_at ON public.capaian;
CREATE TRIGGER trg_capaian_updated_at
  BEFORE UPDATE ON public.capaian
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Fungsi rekapitulasi PML
-- Mengembalikan per PPL: target & capaian PPL
-- Capaian PML dihitung dari SLS yang dibawahi PML langsung (capaian1_pml)
DROP FUNCTION IF EXISTS public.get_rekapitulasi_pml(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.get_rekapitulasi_pml(p_pml_id UUID)
RETURNS TABLE(
  nama_ppl        VARCHAR,
  sobatid_ppl     VARCHAR,
  total_target    BIGINT,
  total_capaian1  BIGINT,
  total_capaian1_pml BIGINT,
  total_capaian1_pml_g2 BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.nama::VARCHAR,
    p.sobatid::VARCHAR,
    COALESCE(SUM(ws.target),       0)::BIGINT AS total_target,
    COALESCE(SUM(c.capaian1),      0)::BIGINT AS total_capaian1,
    COALESCE(SUM(c.capaian1_pml),  0)::BIGINT AS total_capaian1_pml,
    COALESCE(SUM(c.capaian1_pml_g2),  0)::BIGINT AS total_capaian1_pml_g2
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

-- 6. Update fungsi register_users_batch untuk NIK
CREATE OR REPLACE FUNCTION public.register_users_batch(
  p_users jsonb
)
RETURNS jsonb
SECURITY DEFINER
AS $$
DECLARE
  v_user jsonb;
  v_user_id uuid;
  v_encrypted_pw text;
  v_success_count int := 0;
  v_fail_count int := 0;
  v_errors text[] := '{}';
BEGIN
  -- 1. Check authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Loop data pengguna
  FOR v_user IN SELECT * FROM jsonb_array_elements(p_users) LOOP
    BEGIN
      -- Cek apakah user dengan Sobat ID tersebut sudah memiliki akun auth
      SELECT id INTO v_user_id 
      FROM auth.users 
      WHERE email = (v_user->>'sobatid') || '@anomali3602.se';

      IF v_user_id IS NOT NULL THEN
        -- A. User sudah ada, lakukan update profile (Dukung parsial update seperti update NIK saja)
        UPDATE public.profiles
        SET 
          nik = COALESCE(NULLIF(v_user->>'nik', ''), nik),
          nama = COALESCE(NULLIF(v_user->>'nama', ''), nama),
          role = COALESCE(NULLIF(v_user->>'role', ''), role),
          email_ref = COALESCE(NULLIF(v_user->>'email', ''), email_ref),
          updated_at = now()
        WHERE id = v_user_id;

        -- Jika NIK disediakan, update password di auth.users ke NIK baru
        IF NULLIF(v_user->>'nik', '') IS NOT NULL THEN
          UPDATE auth.users
          SET encrypted_password = extensions.crypt(NULLIF(v_user->>'nik', ''), extensions.gen_salt('bf', 10)),
              updated_at = now()
          WHERE id = v_user_id;
        END IF;
      ELSE
        -- B. User belum ada, daftarkan baru
        v_user_id := gen_random_uuid();
        v_encrypted_pw := extensions.crypt(COALESCE(v_user->>'nik', v_user->>'sobatid'), extensions.gen_salt('bf', 10));

        -- Insert into auth.users
        INSERT INTO auth.users (
          id,
          instance_id,
          email,
          encrypted_password,
          email_confirmed_at,
          raw_app_meta_data,
          raw_user_meta_data,
          aud,
          role,
          created_at,
          updated_at
        ) VALUES (
          v_user_id,
          '00000000-0000-0000-0000-000000000000',
          (v_user->>'sobatid') || '@anomali3602.se',
          v_encrypted_pw,
          now(),
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          '{}'::jsonb,
          'authenticated',
          'authenticated',
          now(),
          now()
        );

        -- Insert into auth.identities
        INSERT INTO auth.identities (
          id,
          user_id,
          identity_data,
          provider,
          provider_id,
          last_sign_in_at,
          created_at,
          updated_at
        ) VALUES (
          v_user_id,
          v_user_id,
          jsonb_build_object('sub', v_user_id::text, 'email', (v_user->>'sobatid') || '@anomali3602.se'),
          'email',
          v_user_id::text,
          now(),
          now(),
          now()
        );

        -- Insert into public.profiles
        INSERT INTO public.profiles (
          id,
          sobatid,
          nik,
          nama,
          role,
          email_ref,
          is_active
        ) VALUES (
          v_user_id,
          v_user->>'sobatid',
          v_user->>'nik',
          v_user->>'nama',
          v_user->>'role',
          NULLIF(v_user->>'email', ''),
          true
        );
      END IF;

      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail_count := v_fail_count + 1;
      v_errors := array_append(v_errors, (v_user->>'sobatid') || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success_count', v_success_count,
    'fail_count', v_fail_count,
    'errors', to_jsonb(v_errors)
  );
END;
$$ LANGUAGE plpgsql;
