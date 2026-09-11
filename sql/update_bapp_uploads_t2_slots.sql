-- ============================================================
-- Migrasi Penambahan Kolom 2 Slot Upload untuk Termin 2
-- Tabel: public.bapp_uploads_t2
-- ============================================================

ALTER TABLE public.bapp_uploads_t2
  ADD COLUMN IF NOT EXISTS screenshot_uninstall TEXT,
  ADD COLUMN IF NOT EXISTS crop_top_uninstall NUMERIC(5,1) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS crop_bottom_uninstall NUMERIC(5,1) DEFAULT NULL;

COMMENT ON COLUMN public.bapp_uploads_t2.screenshot IS 'Slot 1: Bukti Capaian FASIH (Base64 JPEG)';
COMMENT ON COLUMN public.bapp_uploads_t2.screenshot_uninstall IS 'Slot 2: Bukti Uninstall FASIH (Base64 JPEG)';
COMMENT ON COLUMN public.bapp_uploads_t2.crop_top_uninstall IS 'Batas crop atas untuk slot uninstall';
COMMENT ON COLUMN public.bapp_uploads_t2.crop_bottom_uninstall IS 'Batas crop bawah untuk slot uninstall';
