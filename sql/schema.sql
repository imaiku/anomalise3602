-- ============================================================
-- ANOMALI DASHBOARD — DATABASE SCHEMA
-- Jalankan di Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- 1. PROFILES
CREATE TABLE public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  sobatid     VARCHAR(20) UNIQUE,
  nama        VARCHAR(255) NOT NULL,
  email_ref   VARCHAR(255),
  role        VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'admin', 'pml', 'ppl')),
  kabupaten   VARCHAR(20) DEFAULT '3602',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USER SLS (PPL's SLS assignments)
CREATE TABLE public.user_sls (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  kode_sls    VARCHAR(16) NOT NULL,
  status      VARCHAR(10) DEFAULT 'aktif' CHECK (status IN ('aktif', 'historis')),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  UNIQUE (user_id, kode_sls)
);

-- Trigger to automatically change previous PPL's assignment on the same SLS to 'historis'
CREATE OR REPLACE FUNCTION public.trg_user_sls_single_active_ppl()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'aktif' THEN
    UPDATE public.user_sls
       SET status = 'historis',
           released_at = NOW()
     WHERE kode_sls = NEW.kode_sls
       AND user_id != NEW.user_id
       AND status = 'aktif';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_user_sls_single_active_ppl_trigger
  BEFORE INSERT OR UPDATE ON public.user_sls
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_user_sls_single_active_ppl();

-- 3. PML - PPL RELATIONSHIP
CREATE TABLE public.pml_ppl (
  pml_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ppl_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pml_id, ppl_id)
);

-- 4. ANOMALI REFERENCE (CMS)
CREATE TABLE public.anomali_ref (
  id          SERIAL PRIMARY KEY,
  nomor       INTEGER NOT NULL,
  tipe        VARCHAR(10) NOT NULL CHECK (tipe IN ('keluarga', 'usaha')),
  nama        VARCHAR(500) NOT NULL,
  penjelasan  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (nomor, tipe)
);

-- 4.b. REGIONAL TABLES (NORMALIZED LEVEL 3 - 6)
CREATE TABLE public.wilayah_kec (
  kode_kec VARCHAR(7) PRIMARY KEY, -- kdprov (2) + kdkab (2) + kdkec (3)
  nmkec    VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.wilayah_desa (
  kode_desa VARCHAR(10) PRIMARY KEY, -- kode_kec (7) + kddesa (3)
  kode_kec  VARCHAR(7) REFERENCES public.wilayah_kec(kode_kec) ON DELETE CASCADE,
  nmdesa    VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.wilayah_sls (
  kode_sls  VARCHAR(14) PRIMARY KEY, -- kode_desa (10) + kdsls (4)
  kode_desa VARCHAR(10) REFERENCES public.wilayah_desa(kode_desa) ON DELETE CASCADE,
  nmsls     VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.wilayah_subsls (
  kode_sls_gabungan VARCHAR(16) PRIMARY KEY, -- kode_sls (14) + kdsubsls (2)
  kode_sls          VARCHAR(14) REFERENCES public.wilayah_sls(kode_sls) ON DELETE CASCADE,
  kdsls             VARCHAR(4) NOT NULL,
  kdsubsls          VARCHAR(2) NOT NULL,
  nmsls             VARCHAR(255),
  nmsubsls          VARCHAR(255),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- VIEW Master Wilayah (Backward Compatibility)
CREATE OR REPLACE VIEW public.master_wilayah AS
SELECT
  sub.kode_sls_gabungan,
  substring(sub.kode_sls_gabungan from 1 for 2) as kdprov,
  substring(sub.kode_sls_gabungan from 3 for 2) as kdkab,
  substring(kec.kode_kec from 5 for 3) as kdkec,
  substring(des.kode_desa from 8 for 3) as kddesa,
  sub.kdsls,
  sub.kdsubsls,
  'BANTEN'::varchar as nmprov,
  'LEBAK'::varchar as nmkab,
  kec.nmkec,
  des.nmdesa,
  sub.nmsls,
  sub.nmsubsls,
  sub.created_at as created_at,
  sub.created_at as updated_at
FROM public.wilayah_subsls sub
JOIN public.wilayah_sls sls ON sub.kode_sls = sls.kode_sls
JOIN public.wilayah_desa des ON sls.kode_desa = des.kode_desa
JOIN public.wilayah_kec kec ON des.kode_kec = kec.kode_kec;

-- 5. UPLOAD BATCHES
CREATE TABLE public.upload_batches (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tanggal_data      DATE NOT NULL,
  uploaded_by_nama  VARCHAR(255),
  uploaded_by_id    UUID REFERENCES public.profiles(id),
  status            VARCHAR(20) DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  jumlah_keluarga   INTEGER DEFAULT 0,
  jumlah_usaha      INTEGER DEFAULT 0,
  catatan           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 6. MAIN ANOMALI TABLE
CREATE TABLE public.assignment_anomali (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id     VARCHAR(50) NOT NULL,
  tipe              VARCHAR(10) NOT NULL CHECK (tipe IN ('keluarga', 'usaha')),
  nama_entitas      VARCHAR(500),
  kode_desa         VARCHAR(10),
  kode_sls          VARCHAR(4),
  kode_sub_sls      VARCHAR(2),
  kode_sls_gabungan VARCHAR(16) GENERATED ALWAYS AS (kode_desa || kode_sls || kode_sub_sls) STORED,
  nomor_anomali     INTEGER,
  nama_anomali      VARCHAR(500),
  status            VARCHAR(30) DEFAULT 'belum_ditindaklanjuti'
                    CHECK (status IN (
                      'belum_ditindaklanjuti',
                      'sesuai_kondisi',
                      'sudah_diperbaiki',
                      'tidak_terdeteksi_lagi'
                    )),
  catatan           TEXT,
  raw_data          JSONB,
  first_seen        DATE NOT NULL,
  last_seen         DATE NOT NULL,
  is_ever_reopened  BOOLEAN DEFAULT false,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by_nama   VARCHAR(255),
  updated_by_id     UUID REFERENCES public.profiles(id),
  batch_id          UUID REFERENCES public.upload_batches(id),
  UNIQUE (assignment_id, tipe, nomor_anomali)
);

-- 7. STATUS HISTORY
CREATE TABLE public.status_history (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_anomali_id UUID REFERENCES public.assignment_anomali(id) ON DELETE CASCADE,
  status_lama           VARCHAR(30),
  status_baru           VARCHAR(30) NOT NULL,
  diubah_oleh_nama      VARCHAR(255),
  diubah_oleh_id        UUID REFERENCES public.profiles(id),
  catatan               TEXT,
  sumber                VARCHAR(20) CHECK (sumber IN ('manual', 'merge_otomatis')),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_aa_assignment_id   ON public.assignment_anomali(assignment_id);
CREATE INDEX idx_aa_kode_sls        ON public.assignment_anomali(kode_sls_gabungan);
CREATE INDEX idx_aa_status          ON public.assignment_anomali(status);
CREATE INDEX idx_aa_tipe            ON public.assignment_anomali(tipe);
CREATE INDEX idx_aa_nomor           ON public.assignment_anomali(nomor_anomali);
CREATE INDEX idx_aa_first_seen      ON public.assignment_anomali(first_seen);
CREATE INDEX idx_aa_last_seen       ON public.assignment_anomali(last_seen);
CREATE INDEX idx_aa_reopened        ON public.assignment_anomali(is_ever_reopened);
CREATE INDEX idx_aa_composite       ON public.assignment_anomali(status, tipe, kode_sls_gabungan);
CREATE INDEX idx_user_sls_kode      ON public.user_sls(kode_sls);
CREATE INDEX idx_user_sls_user      ON public.user_sls(user_id);
CREATE INDEX idx_history_anomali    ON public.status_history(assignment_anomali_id);
CREATE INDEX idx_history_created    ON public.status_history(created_at);
CREATE INDEX idx_profiles_role      ON public.profiles(role);
CREATE INDEX idx_profiles_active    ON public.profiles(is_active);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pml_ppl            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anomali_ref        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_anomali ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_wilayah     ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user role (Safe from RLS recursive calls)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role varchar;
BEGIN
  -- Ambil langsung dari profiles. Karena SECURITY DEFINER, query ini berjalan sebagai postgres/owner
  -- dan secara otomatis mem-bypass RLS profiles, sehingga TIDAK AKAN PERNAH LOOP.
  SELECT role INTO v_role 
  FROM public.profiles 
  WHERE id = auth.uid();

  RETURN coalesce(v_role, 'guest');
END;
$$;

-- Helper function: get current user's SLS list
CREATE OR REPLACE FUNCTION public.get_my_sls()
RETURNS TABLE(kode_sls VARCHAR) AS $$
  SELECT kode_sls FROM public.user_sls WHERE user_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: get SLS accessible by PML (all PPL bawahan)
CREATE OR REPLACE FUNCTION public.get_pml_sls()
RETURNS TABLE(kode_sls VARCHAR) AS $$
  SELECT DISTINCT us.kode_sls
  FROM public.user_sls us
  JOIN public.pml_ppl mp ON us.user_id = mp.ppl_id
  WHERE mp.pml_id = auth.uid() AND us.status = 'aktif';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_petugas_sls(p_user_id uuid, p_role text)
RETURNS TABLE(kode_sls VARCHAR) AS $$
BEGIN
  IF lower(p_role) = 'ppl' THEN
    RETURN QUERY 
      SELECT us.kode_sls::VARCHAR
      FROM public.user_sls us
      WHERE us.user_id = p_user_id AND us.status = 'aktif';
  ELSIF lower(p_role) = 'pml' THEN
    RETURN QUERY 
      SELECT DISTINCT us.kode_sls::VARCHAR
      FROM public.user_sls us
      JOIN public.pml_ppl mp ON us.user_id = mp.ppl_id
      WHERE mp.pml_id = p_user_id AND us.status = 'aktif';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- PROFILES: own row + superadmin/admin sees all
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR get_my_role() IN ('superadmin', 'admin'));

CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_all_admin" ON public.profiles FOR ALL TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

-- USER_SLS: PPL sees own, admin/superadmin sees all
CREATE POLICY "user_sls_select" ON public.user_sls FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR get_my_role() IN ('superadmin', 'admin', 'pml'));

CREATE POLICY "user_sls_admin" ON public.user_sls FOR ALL TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

-- PML_PPL: admin manages, pml sees own
CREATE POLICY "pml_ppl_select" ON public.pml_ppl FOR SELECT TO authenticated
  USING (pml_id = auth.uid() OR get_my_role() IN ('superadmin', 'admin'));

CREATE POLICY "pml_ppl_admin" ON public.pml_ppl FOR ALL TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

-- ANOMALI_REF: all can read, only superadmin manages
CREATE POLICY "anomali_ref_select" ON public.anomali_ref FOR SELECT USING (true);
CREATE POLICY "anomali_ref_admin" ON public.anomali_ref FOR ALL TO authenticated
  USING (get_my_role() = 'superadmin');

-- UPLOAD_BATCHES: all can read, superadmin manages
CREATE POLICY "batches_select" ON public.upload_batches FOR SELECT USING (true);
CREATE POLICY "batches_admin" ON public.upload_batches FOR ALL TO authenticated
  USING (get_my_role() = 'superadmin');

-- ASSIGNMENT_ANOMALI: read based on role, update based on SLS access
CREATE POLICY "aa_select_all" ON public.assignment_anomali FOR SELECT USING (true);

CREATE POLICY "aa_insert_admin" ON public.assignment_anomali FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('superadmin', 'admin'));

CREATE POLICY "aa_update" ON public.assignment_anomali FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('superadmin', 'admin')
    OR (get_my_role() = 'pml'
        AND kode_sls_gabungan IN (SELECT kode_sls FROM public.get_pml_sls()))
    OR (get_my_role() = 'ppl'
        AND kode_sls_gabungan IN (SELECT kode_sls FROM public.get_my_sls()))
  );

CREATE POLICY "aa_delete_admin" ON public.assignment_anomali FOR DELETE TO authenticated
  USING (get_my_role() IN ('superadmin', 'admin'));

-- STATUS_HISTORY: all can read, insert on update
CREATE POLICY "history_select" ON public.status_history FOR SELECT USING (true);
CREATE POLICY "history_insert" ON public.status_history FOR INSERT TO authenticated WITH CHECK (true);

-- MASTER_WILAYAH: public read access
CREATE POLICY "wilayah_select" ON public.master_wilayah FOR SELECT USING (true);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER trg_anomali_updated_at
  BEFORE UPDATE ON public.assignment_anomali
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile on auth.users insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Profile created manually via admin panel, not auto-created
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SEED: Initial superadmin account placeholder
-- Note: Create auth user via Supabase Auth dashboard first,
--       then insert profile below with the user's UUID
-- ============================================================
-- INSERT INTO public.profiles (id, sobatid, nama, role, email_ref)
-- VALUES ('YOUR-SUPERADMIN-UUID-HERE', 'superadmin', 'Super Admin', 'superadmin', 'superadmin@anomali3602.se');

-- ============================================================
-- BATCH USER CREATION FUNCTION (ADMIN ONLY)
-- ============================================================
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
        -- A. User sudah ada, lakukan update profile saja (Timpah Data)
        INSERT INTO public.profiles (
          id,
          sobatid,
          nama,
          role,
          email_ref,
          is_active
        ) VALUES (
          v_user_id,
          v_user->>'sobatid',
          v_user->>'nama',
          v_user->>'role',
          NULLIF(v_user->>'email', ''),
          true
        )
        ON CONFLICT (sobatid) DO UPDATE SET
          nama = EXCLUDED.nama,
          role = EXCLUDED.role,
          email_ref = EXCLUDED.email_ref,
          is_active = EXCLUDED.is_active,
          updated_at = now();
      ELSE
        -- B. User belum ada, daftarkan baru
        v_user_id := gen_random_uuid();
        v_encrypted_pw := extensions.crypt(v_user->>'nik', extensions.gen_salt('bf', 10));

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
          nama,
          role,
          email_ref,
          is_active
        ) VALUES (
          v_user_id,
          v_user->>'sobatid',
          v_user->>'nama',
          v_user->>'role',
          NULLIF(v_user->>'email', ''),
          true
        );
      END IF;

      v_success_count := v_success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail_count := v_fail_count + 1;
      v_errors := array_append(v_errors, (v_user->>'nama') || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success_count', v_success_count,
    'fail_count', v_fail_count,
    'errors', to_jsonb(v_errors)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BATCH SLS MAPPING IMPORT FUNCTION (ADMIN ONLY)
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_sls_batch(
  p_mappings jsonb
)
RETURNS jsonb
SECURITY DEFINER
AS $$
DECLARE
  v_item jsonb;
  v_ppl_id uuid;
  v_pml_id uuid;
  v_sls_success int := 0;
  v_rel_success int := 0;
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

  -- 2. Loop through mappings
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_mappings) LOOP
    BEGIN
      -- Cari PPL ID berdasarkan email_ref
      SELECT id INTO v_ppl_id FROM public.profiles 
      WHERE LOWER(TRIM(email_ref)) = LOWER(TRIM(v_item->>'email_ppl')) AND role = 'ppl';

      IF v_ppl_id IS NULL THEN
        RAISE EXCEPTION 'Email PPL % tidak terdaftar atau rolenya bukan PPL', v_item->>'email_ppl';
      END IF;

      -- Cari PML ID berdasarkan email_ref (opsional)
      SELECT id INTO v_pml_id FROM public.profiles 
      WHERE LOWER(TRIM(email_ref)) = LOWER(TRIM(v_item->>'email_pml')) AND role = 'pml';

      -- A. Upsert SLS ke user_sls
      INSERT INTO public.user_sls (user_id, kode_sls, status)
      VALUES (v_ppl_id, v_item->>'kode_sls', 'aktif')
      ON CONFLICT (user_id, kode_sls) DO UPDATE SET status = 'aktif';
      
      v_sls_success := v_sls_success + 1;

      -- B. Upsert Hubungan PML-PPL (jika PML ditemukan)
      IF v_pml_id IS NOT NULL THEN
        INSERT INTO public.pml_ppl (pml_id, ppl_id)
        VALUES (v_pml_id, v_ppl_id)
        ON CONFLICT (pml_id, ppl_id) DO NOTHING;
        
        v_rel_success := v_rel_success + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_fail_count := v_fail_count + 1;
      v_errors := array_append(v_errors, (v_item->>'kode_sls') || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'sls_success', v_sls_success,
    'rel_success', v_rel_success,
    'fail_count', v_fail_count,
    'errors', to_jsonb(v_errors)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BATCH ANOMALI MERGE FUNCTION (ADMIN ONLY)
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_anomali_batch(
  p_records jsonb,
  p_batch_id uuid,
  p_tanggal_data date,
  p_tipe text
)
RETURNS jsonb
SECURITY DEFINER
AS $$
DECLARE
  v_rec record;
  v_existing_id uuid;
  v_existing_status varchar;
  v_inserted_id uuid;
  v_inserted_count int := 0;
  v_updated_count int := 0;
  v_reopened_count int := 0;
  v_errors text[] := '{}';
  v_target_status varchar;
BEGIN
  -- 1. Check authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Loop records using jsonb_to_recordset for type-safety
  FOR v_rec IN 
    SELECT * FROM jsonb_to_recordset(p_records) AS x(
      assignment_id text,
      nomor_anomali int,
      nama_anomali text,
      kode_desa text,
      kode_sls text,
      kode_sub_sls text,
      nama_entitas text,
      tindak_lanjut_status text,
      raw_data jsonb
    )
  LOOP
    BEGIN
      -- A. Auto-register reference in public.anomali_ref if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM public.anomali_ref
        WHERE nomor = v_rec.nomor_anomali AND tipe = p_tipe
      ) THEN
        INSERT INTO public.anomali_ref (nomor, tipe, nama, penjelasan, created_at, updated_at)
        VALUES (v_rec.nomor_anomali, p_tipe, v_rec.nama_anomali, null, now(), now());
      END IF;

      -- A.b. Auto-register SLS to regional tables
      IF NOT EXISTS (
        SELECT 1 FROM public.wilayah_subsls
        WHERE kode_sls_gabungan = (v_rec.kode_desa || v_rec.kode_sls || v_rec.kode_sub_sls)
      ) THEN
        -- Insert Kec
        INSERT INTO public.wilayah_kec (kode_kec, nmkec)
        VALUES (
          substring(v_rec.kode_desa from 1 for 7),
          upper(COALESCE(v_rec.raw_data->>'Nama Kecamatan', '—'))
        ) ON CONFLICT (kode_kec) DO NOTHING;

        -- Insert Desa
        INSERT INTO public.wilayah_desa (kode_desa, kode_kec, nmdesa)
        VALUES (
          v_rec.kode_desa,
          substring(v_rec.kode_desa from 1 for 7),
          upper(COALESCE(v_rec.raw_data->>'Nama Desa/Kel', '—'))
        ) ON CONFLICT (kode_desa) DO NOTHING;

        -- Insert SLS
        INSERT INTO public.wilayah_sls (kode_sls, kode_desa, nmsls)
        VALUES (
          (v_rec.kode_desa || v_rec.kode_sls),
          v_rec.kode_desa,
          COALESCE(v_rec.raw_data->>'Nama SLS', '—')
        ) ON CONFLICT (kode_sls) DO NOTHING;

        -- Insert Sub SLS
        INSERT INTO public.wilayah_subsls (kode_sls_gabungan, kode_sls, nmsls, nmsubsls, kdsls, kdsubsls)
        VALUES (
          (v_rec.kode_desa || v_rec.kode_sls || v_rec.kode_sub_sls),
          (v_rec.kode_desa || v_rec.kode_sls),
          COALESCE(v_rec.raw_data->>'Nama SLS', '—'),
          COALESCE(v_rec.raw_data->>'Sub SLS', '—'),
          v_rec.kode_sls,
          v_rec.kode_sub_sls
        ) ON CONFLICT (kode_sls_gabungan) DO NOTHING;
      END IF;

      -- B. Check if already exists in assignment_anomali
      SELECT id, status INTO v_existing_id, v_existing_status
      FROM public.assignment_anomali
      WHERE assignment_id = v_rec.assignment_id
        AND tipe = p_tipe
        AND nomor_anomali = v_rec.nomor_anomali
        AND COALESCE(nama_entitas, '') = COALESCE(NULLIF(v_rec.nama_entitas, ''), '');

      IF v_existing_id IS NULL THEN
        -- Insert new anomali
        v_inserted_id := gen_random_uuid();
        v_target_status := COALESCE(NULLIF(v_rec.tindak_lanjut_status, ''), 'belum_ditindaklanjuti');
        INSERT INTO public.assignment_anomali (
          id, assignment_id, tipe, nama_entitas, kode_desa, kode_sls, kode_sub_sls,
          nomor_anomali, nama_anomali, status, raw_data, first_seen, last_seen, batch_id
        ) VALUES (
          v_inserted_id, v_rec.assignment_id, p_tipe, NULLIF(v_rec.nama_entitas, ''),
          v_rec.kode_desa, v_rec.kode_sls, v_rec.kode_sub_sls,
          v_rec.nomor_anomali, v_rec.nama_anomali, v_target_status,
          v_rec.raw_data, p_tanggal_data, p_tanggal_data, p_batch_id
        );

        -- Add to status history
        INSERT INTO public.status_history (
          assignment_anomali_id, status_lama, status_baru, diubah_oleh_nama, sumber
        ) VALUES (
          v_inserted_id, null, v_target_status, 'Sistem (Merge)', 'merge_otomatis'
        );

        v_inserted_count := v_inserted_count + 1;
      ELSE
        -- Update existing anomali
        v_target_status := COALESCE(NULLIF(v_rec.tindak_lanjut_status, ''), 'belum_ditindaklanjuti');

        IF v_existing_status IN ('sudah_diperbaiki', 'tidak_terdeteksi_lagi') AND v_target_status = 'belum_ditindaklanjuti' THEN
          UPDATE public.assignment_anomali SET
            last_seen = p_tanggal_data,
            batch_id = p_batch_id,
            nama_entitas = COALESCE(NULLIF(v_rec.nama_entitas, ''), nama_entitas),
            status = 'belum_ditindaklanjuti',
            is_ever_reopened = true,
            updated_at = now()
          WHERE id = v_existing_id;

          INSERT INTO public.status_history (
            assignment_anomali_id, status_lama, status_baru, diubah_oleh_nama, sumber
          ) VALUES (
            v_existing_id, v_existing_status, 'belum_ditindaklanjuti', 'Sistem (Merge)', 'merge_otomatis'
          );

          v_reopened_count := v_reopened_count + 1;
        ELSE
          UPDATE public.assignment_anomali SET
            last_seen = p_tanggal_data,
            batch_id = p_batch_id,
            nama_entitas = COALESCE(NULLIF(v_rec.nama_entitas, ''), nama_entitas),
            status = CASE WHEN v_target_status != 'belum_ditindaklanjuti' THEN v_target_status ELSE status END,
            updated_at = now()
          WHERE id = v_existing_id;

          IF v_target_status != 'belum_ditindaklanjuti' AND v_existing_status != v_target_status THEN
            INSERT INTO public.status_history (
              assignment_anomali_id, status_lama, status_baru, diubah_oleh_nama, sumber
            ) VALUES (
              v_existing_id, v_existing_status, v_target_status, 'Sistem (Merge)', 'merge_otomatis'
            );
          END IF;

          v_updated_count := v_updated_count + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, v_rec.assignment_id || ': ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted_count,
    'updated', v_updated_count,
    'reopened', v_reopened_count,
    'resolved', 0,
    'errors', to_jsonb(v_errors)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- RESOLVE UNSEEN ANOMALI FUNCTION (ADMIN ONLY)
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_unseen_anomali(
  p_batch_id uuid,
  p_tanggal_data date,
  p_tipe text,
  p_desa_codes text[]
)
RETURNS int
SECURITY DEFINER
AS $$
DECLARE
  v_resolved_count int := 0;
BEGIN
  -- 1. Check authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Mark any active anomalies of this type in these specific villages that were NOT in today's upload batch as resolved
  WITH resolved_rows AS (
    UPDATE public.assignment_anomali
    SET status = 'tidak_terdeteksi_lagi', last_seen = p_tanggal_data
    WHERE tipe = p_tipe
      AND status NOT IN ('tidak_terdeteksi_lagi', 'sesuai_kondisi')
      AND kode_desa = ANY(p_desa_codes)
      AND batch_id != p_batch_id
    RETURNING id, status
  )
  INSERT INTO public.status_history (
    assignment_anomali_id,
    status_lama,
    status_baru,
    diubah_oleh_nama,
    sumber
  )
  SELECT id, 'belum_ditindaklanjuti', 'tidak_terdeteksi_lagi', 'Sistem (Merge)', 'merge_otomatis'
  FROM resolved_rows;

  -- Count and return number of updated rows
  SELECT count(*) INTO v_resolved_count
  FROM public.assignment_anomali
  WHERE tipe = p_tipe
    AND last_seen = p_tanggal_data
    AND status = 'tidak_terdeteksi_lagi'
    AND kode_desa = ANY(p_desa_codes)
    AND batch_id != p_batch_id;

  RETURN v_resolved_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- GET DASHBOARD STATS FUNCTION (EFFICIENT COUNTS FOR LARGE DATA)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_user_id uuid,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total          int := 0;
  v_selesai        int := 0;
  v_belum          int := 0;
  v_progress       int := 0;
  v_anomali_total  int := 0;
  v_anomali_done   int := 0;
  v_anomali_todo   int := 0;
  v_sls_codes text[] := '{}';
BEGIN
  -- Ambil kode SLS berdasarkan role
  IF lower(p_role) = 'ppl' THEN
    SELECT COALESCE(array_agg(kode_sls), '{}')
      INTO v_sls_codes
      FROM public.user_sls
     WHERE user_id = p_user_id AND status = 'aktif';
  ELSIF lower(p_role) = 'pml' THEN
    SELECT COALESCE(array_agg(DISTINCT us.kode_sls), '{}')
      INTO v_sls_codes
      FROM public.user_sls us
      JOIN public.pml_ppl mp ON us.user_id = mp.ppl_id
     WHERE mp.pml_id = p_user_id AND us.status = 'aktif';
  END IF;

  -- 1. Hitung total anomali secara individu (baris mentah)
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))::int,
    count(*) FILTER (WHERE status NOT IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))::int
  INTO v_anomali_total, v_anomali_done, v_anomali_todo
  FROM public.assignment_anomali
  WHERE
    (lower(p_role) IN ('superadmin', 'admin', 'guest') OR kode_sls_gabungan = ANY(v_sls_codes))
    AND (lower(p_role) IN ('superadmin', 'admin', 'guest') OR show_anomaly = true);

  -- 2. Hitung berdasarkan assignment_id
  WITH group_status AS (
    SELECT
      assignment_id,
      bool_and(status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi')) AS is_done
    FROM public.assignment_anomali
    WHERE
      (lower(p_role) IN ('superadmin', 'admin', 'guest') OR kode_sls_gabungan = ANY(v_sls_codes))
      AND (lower(p_role) IN ('superadmin', 'admin', 'guest') OR show_anomaly = true)
    GROUP BY assignment_id
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_done = true)::int,
    count(*) FILTER (WHERE is_done = false)::int
  INTO v_total, v_selesai, v_belum
  FROM group_status;

  IF v_total > 0 THEN
    v_progress := round((v_selesai::float / v_total::float) * 100);
  END IF;

  RETURN jsonb_build_object(
    'total',            v_total,
    'selesai',          v_selesai,
    'belum',            v_belum,
    'progress',         v_progress,
    'anomali_total',    v_anomali_total,
    'anomali_selesai',  v_anomali_done,
    'anomali_belum',    v_anomali_todo
  );
END;
$$;

-- Berikan akses execute ke semua role
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_petugas_sls(uuid, text) TO anon, authenticated;

-- ============================================================
-- HELPER FUNCTION: GET ANOMALY COUNTS BY SLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_anomaly_counts_by_sls()
RETURNS TABLE(kode_sls_gabungan varchar, tipe varchar, total_anomali bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT kode_sls_gabungan, tipe, count(*)::bigint
  FROM public.assignment_anomali
  GROUP BY kode_sls_gabungan, tipe;
$$;

GRANT EXECUTE ON FUNCTION public.get_anomaly_counts_by_sls() TO anon, authenticated;


-- ============================================================
-- BATCH IMPORT MASTER WILAYAH FUNCTION (ADMIN ONLY)
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_master_wilayah_batch(
  p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 1. Insert Kecamatan
  INSERT INTO public.wilayah_kec (kode_kec, nmkec)
  SELECT DISTINCT 
    (kdprov || kdkab || kdkec),
    upper(nmkec)
  FROM jsonb_to_recordset(p_records) AS x(
    kdprov text, kdkab text, kdkec text, nmkec text
  )
  ON CONFLICT (kode_kec) DO UPDATE 
  SET nmkec = EXCLUDED.nmkec;
  
  -- 2. Insert Desa
  INSERT INTO public.wilayah_desa (kode_desa, kode_kec, nmdesa)
  SELECT DISTINCT 
    (kdprov || kdkab || kdkec || kddesa),
    (kdprov || kdkab || kdkec),
    upper(nmdesa)
  FROM jsonb_to_recordset(p_records) AS x(
    kdprov text, kdkab text, kdkec text, kddesa text, nmdesa text
  )
  ON CONFLICT (kode_desa) DO UPDATE 
  SET nmdesa = EXCLUDED.nmdesa;

  -- 3. Insert SLS
  INSERT INTO public.wilayah_sls (kode_sls, kode_desa, nmsls)
  SELECT DISTINCT 
    (kdprov || kdkab || kdkec || kddesa || kdsls),
    (kdprov || kdkab || kdkec || kddesa),
    nmsls
  FROM jsonb_to_recordset(p_records) AS x(
    kdprov text, kdkab text, kdkec text, kddesa text, kdsls text, nmsls text
  )
  ON CONFLICT (kode_sls) DO UPDATE 
  SET nmsls = EXCLUDED.nmsls;

  -- 4. Insert Sub-SLS
  INSERT INTO public.wilayah_subsls (kode_sls_gabungan, kode_sls, nmsls, nmsubsls, kdsls, kdsubsls)
  SELECT DISTINCT 
    kode_sls_gabungan,
    (kdprov || kdkab || kdkec || kddesa || kdsls),
    nmsls,
    nmsubsls,
    kdsls,
    kdsubsls
  FROM jsonb_to_recordset(p_records) AS x(
    kode_sls_gabungan text, kdprov text, kdkab text, kdkec text, kddesa text, kdsls text, nmsls text, nmsubsls text, kdsubsls text
  )
  ON CONFLICT (kode_sls_gabungan) DO UPDATE 
  SET nmsls = EXCLUDED.nmsls,
      nmsubsls = EXCLUDED.nmsubsls,
      kdsls = EXCLUDED.kdsls,
      kdsubsls = EXCLUDED.kdsubsls;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_master_wilayah_batch(jsonb) TO authenticated;

-- ============================================================
-- Ringkasan Progres per Kecamatan
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kecamatan_progress()
RETURNS TABLE(
  kode_kec VARCHAR,
  nmkec VARCHAR,
  total_anomali BIGINT,
  selesai_anomali BIGINT,
  persen_progress NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    k.kode_kec,
    k.nmkec,
    COUNT(a.id)::BIGINT as total_anomali,
    COUNT(a.id) FILTER (WHERE a.status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))::BIGINT as selesai_anomali,
    COALESCE(
      ROUND(
        (COUNT(a.id) FILTER (WHERE a.status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))::NUMERIC / 
         NULLIF(COUNT(a.id), 0)::NUMERIC) * 100, 
        1
      ),
      0.0
    ) as persen_progress
  FROM public.wilayah_kec k
  LEFT JOIN public.wilayah_desa d ON k.kode_kec = d.kode_kec
  LEFT JOIN public.assignment_anomali a ON a.kode_desa = d.kode_desa
  GROUP BY k.kode_kec, k.nmkec
  ORDER BY k.nmkec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_kecamatan_progress() TO anon, authenticated;

-- ============================================================
-- Get Summary of SLS without PPL (Optimized for Admin Panel)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_unassigned_sls_summary()
RETURNS TABLE(
  assignment_id uuid, 
  kode_sls_gabungan varchar, 
  tipe text, 
  nama_entitas varchar, 
  total_anomali bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT id FROM public.assignment_anomali WHERE kode_sls_gabungan = a.kode_sls_gabungan AND status != 'tidak_terdeteksi_lagi' LIMIT 1) as assignment_id,
    a.kode_sls_gabungan,
    string_agg(DISTINCT a.tipe, ', ') as tipe,
    (SELECT nama_entitas FROM public.assignment_anomali WHERE kode_sls_gabungan = a.kode_sls_gabungan AND status != 'tidak_terdeteksi_lagi' LIMIT 1) as nama_entitas,
    count(*)::bigint as total_anomali
  FROM public.assignment_anomali a
  LEFT JOIN public.user_sls u ON a.kode_sls_gabungan = u.kode_sls AND u.status = 'aktif'
  WHERE a.status != 'tidak_terdeteksi_lagi'
    AND u.id IS NULL
  GROUP BY a.kode_sls_gabungan;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_sls_summary() TO anon, authenticated;

-- ============================================================
-- Get Assignment IDs that have BOTH Keluarga & Usaha Anomalies
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_both_type_assignments(
  p_status text DEFAULT NULL,
  p_nomor_anomali int DEFAULT NULL,
  p_nomor_tipe text DEFAULT NULL,
  p_ket text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_kec_code text DEFAULT NULL,
  p_desa_code text DEFAULT NULL,
  p_sls_code text DEFAULT NULL,
  p_ppl_user_id uuid DEFAULT NULL,
  p_pml_user_id uuid DEFAULT NULL
)
RETURNS TABLE(assignment_id varchar)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sls_codes text[] := NULL;
BEGIN
  -- Get SLS codes for PPL/PML if applicable
  IF p_ppl_user_id IS NOT NULL THEN
    SELECT array_agg(kode_sls) INTO v_sls_codes FROM public.user_sls WHERE user_id = p_ppl_user_id AND status = 'aktif';
  ELSIF p_pml_user_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT us.kode_sls) INTO v_sls_codes 
    FROM public.user_sls us JOIN public.pml_ppl mp ON us.user_id = mp.ppl_id 
    WHERE mp.pml_id = p_pml_user_id;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT a.assignment_id, a.tipe
    FROM public.assignment_anomali a
    WHERE a.status != 'tidak_terdeteksi_lagi'
      AND (p_status IS NULL OR a.status = p_status)
      -- Keterangan filter
      AND (
        p_ket IS NULL 
        OR (p_ket = 'selesai' AND a.status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))
        OR (p_ket = 'belum' AND a.status = 'belum_ditindaklanjuti')
      )
      -- Nomor filter
      AND (
        p_nomor_anomali IS NULL 
        OR (a.nomor_anomali = p_nomor_anomali AND a.tipe = p_nomor_tipe)
      )
      -- Search filter
      AND (
        p_search IS NULL 
        OR a.assignment_id::text ILIKE '%' || p_search || '%'
        OR a.nama_entitas ILIKE '%' || p_search || '%'
        OR a.kode_sls_gabungan ILIKE '%' || p_search || '%'
      )
      -- Wilayah filter
      AND (p_sls_code IS NULL OR a.kode_sls_gabungan = p_sls_code)
      AND (p_sls_code IS NOT NULL OR p_desa_code IS NULL OR a.kode_desa = p_desa_code)
      AND (p_sls_code IS NOT NULL OR p_desa_code IS NOT NULL OR p_kec_code IS NULL OR a.kode_desa LIKE p_kec_code || '%')
      -- Role filter
      AND (v_sls_codes IS NULL OR a.kode_sls_gabungan = ANY(v_sls_codes))
  )
  SELECT f.assignment_id
  FROM filtered f
  GROUP BY f.assignment_id
  HAVING count(DISTINCT f.tipe) = 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_both_type_assignments(text, int, text, text, text, text, text, text, uuid, uuid) TO anon, authenticated;

-- ============================================================
-- Get Full Anomalies that have BOTH Keluarga & Usaha (Solves URL Limit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_both_type_anomalies(
  p_status text DEFAULT NULL,
  p_nomor_anomali int DEFAULT NULL,
  p_nomor_tipe text DEFAULT NULL,
  p_ket text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_kec_code text DEFAULT NULL,
  p_desa_code text DEFAULT NULL,
  p_sls_code text DEFAULT NULL,
  p_ppl_user_id uuid DEFAULT NULL,
  p_pml_user_id uuid DEFAULT NULL,
  p_limit int DEFAULT 1000
)
RETURNS SETOF public.assignment_anomali
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sls_codes text[] := NULL;
BEGIN
  -- Get SLS codes for PPL/PML if applicable
  IF p_ppl_user_id IS NOT NULL THEN
    SELECT array_agg(kode_sls) INTO v_sls_codes FROM public.user_sls WHERE user_id = p_ppl_user_id AND status = 'aktif';
  ELSIF p_pml_user_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT us.kode_sls) INTO v_sls_codes 
    FROM public.user_sls us JOIN public.pml_ppl mp ON us.user_id = mp.ppl_id 
    WHERE mp.pml_id = p_pml_user_id;
  END IF;

  RETURN QUERY
  WITH intersected_ids AS (
    SELECT a.assignment_id
    FROM public.assignment_anomali a
    WHERE a.status != 'tidak_terdeteksi_lagi'
      AND (p_status IS NULL OR a.status = p_status)
      -- Keterangan filter
      AND (
        p_ket IS NULL 
        OR (p_ket = 'selesai' AND a.status IN ('sesuai_kondisi', 'sudah_diperbaiki', 'tidak_terdeteksi_lagi'))
        OR (p_ket = 'belum' AND a.status = 'belum_ditindaklanjuti')
      )
      -- Nomor filter
      AND (
        p_nomor_anomali IS NULL 
        OR (a.nomor_anomali = p_nomor_anomali AND a.tipe = p_nomor_tipe)
      )
      -- Search filter
      AND (
        p_search IS NULL 
        OR a.assignment_id::text ILIKE '%' || p_search || '%'
        OR a.nama_entitas ILIKE '%' || p_search || '%'
        OR a.kode_sls_gabungan ILIKE '%' || p_search || '%'
      )
      -- Wilayah filter
      AND (p_sls_code IS NULL OR a.kode_sls_gabungan = p_sls_code)
      AND (p_sls_code IS NOT NULL OR p_desa_code IS NULL OR a.kode_desa = p_desa_code)
      AND (p_sls_code IS NOT NULL OR p_desa_code IS NOT NULL OR p_kec_code IS NULL OR a.kode_desa LIKE p_kec_code || '%')
      -- Role filter
      AND (v_sls_codes IS NULL OR a.kode_sls_gabungan = ANY(v_sls_codes))
    GROUP BY a.assignment_id
    HAVING count(DISTINCT a.tipe) = 2
    LIMIT p_limit
  )
  SELECT a.*
  FROM public.assignment_anomali a
  WHERE a.assignment_id IN (SELECT assignment_id FROM intersected_ids)
  ORDER BY a.first_seen DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_both_type_anomalies(text, int, text, text, text, text, text, text, uuid, uuid, int) TO anon, authenticated;

-- ============================================================
-- MARK ASSIGNMENT SYNCED (BYPASS RLS FOR ANONYMOUS BOT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_assignment_synced(p_assignment_id VARCHAR)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.assignment_anomali
  SET is_api_synced = true
  WHERE assignment_id = p_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_assignment_synced(VARCHAR) TO anon, authenticated;

-- ============================================================
-- CLAIM AND FETCH REJECTIONS (CONCURRENCY LOCK USING SKIP LOCKED)
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_and_fetch_rejections(p_limit INT DEFAULT 10)
RETURNS TABLE (assignment_id VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- Ambil ID baris yang akan diklaim dan kunci dengan SKIP LOCKED
  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT id
    FROM public.assignment_anomali
    WHERE is_rejected = true 
      AND is_api_synced = false
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ) sub;

  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  -- Tandai is_api_synced = true langsung di transaksi yang sama
  UPDATE public.assignment_anomali
  SET is_api_synced = true,
      updated_at = NOW()
  WHERE id = ANY(v_ids);

  -- Kembalikan assignment_id yang berhasil diklaim
  RETURN QUERY
  SELECT DISTINCT a.assignment_id::VARCHAR
  FROM public.assignment_anomali a
  WHERE a.id = ANY(v_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_and_fetch_rejections(INT) TO anon, authenticated;

-- ============================================================
-- RELEASE ASSIGNMENT SYNC (IF BOT FAILS OR LOGGED OUT)
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_assignment_sync(p_assignment_id VARCHAR)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.assignment_anomali
  SET is_api_synced = false,
      updated_at = NOW()
  WHERE assignment_id = p_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_assignment_sync(VARCHAR) TO anon, authenticated;
