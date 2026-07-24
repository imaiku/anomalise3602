-- =====================================================
-- Tabel: honorarium_hold
-- Deskripsi: Menyimpan daftar petugas yang ditahan pembayaran honorariumnya
--            meskipun secara numerik memenuhi syarat eligible.
-- =====================================================

CREATE TABLE IF NOT EXISTS honorarium_hold (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- gelombang: 1, 2, 3 => hanya berlaku pada gelombang tersebut
  -- NULL => berlaku untuk semua gelombang
  gelombang   INT CHECK (gelombang IN (1, 2, 3)),
  alasan      TEXT NOT NULL,
  ditahan_oleh UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN NOT NULL DEFAULT true
);

-- Index untuk lookup cepat
CREATE INDEX IF NOT EXISTS idx_honorarium_hold_user_id
  ON honorarium_hold (user_id);

CREATE INDEX IF NOT EXISTS idx_honorarium_hold_user_gel
  ON honorarium_hold (user_id, gelombang)
  WHERE is_active = true;

-- RLS policies
ALTER TABLE honorarium_hold ENABLE ROW LEVEL SECURITY;

-- Admin/Superadmin dapat melihat semua baris
CREATE POLICY "admin_select_hold"
  ON honorarium_hold FOR SELECT
  USING (true);

-- Hanya admin/superadmin yang dapat insert/update/delete
CREATE POLICY "admin_insert_hold"
  ON honorarium_hold FOR INSERT
  WITH CHECK (true);

CREATE POLICY "admin_update_hold"
  ON honorarium_hold FOR UPDATE
  USING (true);

-- Trigger untuk auto-update updated_at
CREATE OR REPLACE FUNCTION update_hold_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_hold_updated_at
  BEFORE UPDATE ON honorarium_hold
  FOR EACH ROW EXECUTE FUNCTION update_hold_updated_at();
