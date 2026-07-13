// Supabase Configuration
const SUPABASE_URL = 'https://vpbhqemomsewrnrggbmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

// Status labels & colors
const STATUS_CONFIG = {
  belum_ditindaklanjuti: {
    label: 'Belum Ditindaklanjuti',
    color: 'status-pending',
    dot: 'bg-slate-400'
  },
  sesuai_kondisi: {
    label: 'Sesuai Kondisi Lapangan',
    color: 'status-kondisi',
    dot: 'bg-emerald-500'
  },
  sudah_diperbaiki: {
    label: 'Sudah Diperbaiki',
    color: 'status-fixed',
    dot: 'bg-blue-500'
  },
  tidak_terdeteksi_lagi: {
    label: 'Tidak Terdeteksi Lagi',
    color: 'status-clear',
    dot: 'bg-gray-400'
  }
};

const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  PML: 'pml',
  PPL: 'ppl'
};

// Build Fasih-SM link from assignment ID
function buildFasihLink(assignmentId) {
  return `https://fasih-sm.bps.go.id/app/assignment/fd68e454-ba45-4b85-8205-f3bf777ded24/${assignmentId}/edit`;
}

// Build full SLS code from parts
function buildSLSCode(kodeDesa, kodeSLS, kodeSubSLS) {
  return `${kodeDesa}${kodeSLS}${kodeSubSLS}`;
}
