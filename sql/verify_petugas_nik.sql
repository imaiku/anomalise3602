-- ==============================================================================
-- Function: verify_petugas_nik
-- Purpose : Verifikasi NIK secara server-side tanpa mengekspos NIK asli ke client
-- ==============================================================================

CREATE OR REPLACE FUNCTION verify_petugas_nik(p_profile_id UUID, p_input_nik TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match BOOLEAN;
BEGIN
  -- Cocokkan input NIK dengan field nik di tabel profiles
  SELECT (TRIM(nik) = TRIM(p_input_nik)) INTO v_match
  FROM public.profiles
  WHERE id = p_profile_id;

  RETURN COALESCE(v_match, false);
END;
$$;

-- Grant execution permission to public/anon/authenticated roles
GRANT EXECUTE ON FUNCTION verify_petugas_nik(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_petugas_nik(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_petugas_nik(UUID, TEXT) TO service_role;
