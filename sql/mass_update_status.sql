-- ============================================================
-- SQL SCRIPT: PEMBARUAN STATUS MASAL & RIWAYAT PERUBAHAN
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================

DO $$
DECLARE
    -- ==========================================
    -- KONFIGURASI PARAMETER (Ubah bagian ini)
    -- ==========================================
    v_nomor_anomali    INTEGER     := 6;                                                     -- Nomor anomali yang ingin diubah
    v_tipe             VARCHAR     := 'keluarga';                                            -- Tipe entitas: 'keluarga' atau 'usaha'
    v_status_lama      VARCHAR     := 'belum_ditindaklanjuti';                               -- Status awal sebelum diubah
    v_status_baru      VARCHAR     := 'sudah_diperbaiki';                                    -- Status tujuan baru
    
    v_diubah_oleh_nama VARCHAR     := 'Admin (SQL Editor)';                                  -- Nama pengubah di riwayat
    v_diubah_oleh_id   UUID        := NULL;                                                  -- UUID user pengubah (jika ada)
    v_timestamp        TIMESTAMPTZ := '2026-07-14 09:00:00+07';                              -- Waktu perubahan (kemarin/sekarang)
    v_catatan          TEXT        := 'Pembaruan massal anomali keluarga #6 menjadi Sudah Diperbaiki.'; -- Catatan perubahan
    
    -- ==========================================
    -- VARIABEL INTERNAL
    -- ==========================================
    r RECORD;
    v_count INTEGER := 0;
BEGIN
    -- 1. Loop mencari data anomali yang sesuai kriteria
    FOR r IN 
        SELECT a.id, a.status 
        FROM public.assignment_anomali a
        WHERE a.nomor_anomali = v_nomor_anomali 
          AND a.tipe = v_tipe 
          AND a.status = v_status_lama
    LOOP
        -- 2. Update status di tabel assignment_anomali
        UPDATE public.assignment_anomali 
        SET status = v_status_baru,
            updated_at = v_timestamp
        WHERE id = r.id;

        -- 3. Sisipkan catatan riwayat ke tabel status_history
        INSERT INTO public.status_history (
            assignment_anomali_id, 
            status_lama, 
            status_baru, 
            diubah_oleh_nama, 
            diubah_oleh_id, 
            catatan, 
            sumber,
            created_at
        ) VALUES (
            r.id, 
            v_status_lama, 
            v_status_baru, 
            v_diubah_oleh_nama, 
            v_diubah_oleh_id, 
            v_catatan, 
            'manual',
            v_timestamp
        );
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Berhasil memperbarui % data anomali beserta riwayatnya.', v_count;
END $$;
