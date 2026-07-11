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

-- Helper function: get current user role
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS VARCHAR AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

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
  WHERE mp.pml_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

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
CREATE POLICY "anomali_ref_select" ON public.anomali_ref FOR SELECT TO authenticated USING (true);
CREATE POLICY "anomali_ref_admin" ON public.anomali_ref FOR ALL TO authenticated
  USING (get_my_role() = 'superadmin');

-- UPLOAD_BATCHES: all can read, superadmin manages
CREATE POLICY "batches_select" ON public.upload_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "batches_admin" ON public.upload_batches FOR ALL TO authenticated
  USING (get_my_role() = 'superadmin');

-- ASSIGNMENT_ANOMALI: read based on role, update based on SLS access
CREATE POLICY "aa_select_all" ON public.assignment_anomali FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('superadmin', 'admin', 'pml')
    OR kode_sls_gabungan IN (SELECT kode_sls FROM public.get_my_sls())
  );

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

-- STATUS_HISTORY: all authenticated can read, insert on update
CREATE POLICY "history_select" ON public.status_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "history_insert" ON public.status_history FOR INSERT TO authenticated WITH CHECK (true);

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
-- VALUES ('YOUR-SUPERADMIN-UUID-HERE', 'superadmin', 'Super Admin', 'superadmin', 'admin@anomali.id');
