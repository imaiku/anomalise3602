// ============================================================
// AUTH MODULE
// ============================================================

function toAuthEmail(username) {
  const trimmed = username.trim();
  if (trimmed.includes('@')) {
    return trimmed;
  }
  const isNumeric = /^\d+$/.test(trimmed);
  if (isNumeric) {
    // PPL / PML: use sobatid format
    return `${trimmed}@ppl.anomali3602.se`;
  } else {
    // Admin / Superadmin
    if (trimmed === 'superadmin') {
      return 'superadmin@anomali3602.se';
    }
    return `${trimmed}@admin.anomali3602.se`;
  }
}

// Login function
async function login(username, password) {
  const email = toAuthEmail(username);
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// Logout
async function logout() {
  sessionStorage.removeItem('admin_session_name');
  await db.auth.signOut();
  window.location.href = '/login.html';
}

// Get current session + profile
async function getSession() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data: profile } = await db
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  return { session, profile };
}

// Get display name for current session
function getSessionName(profile) {
  if (profile.role === 'admin') {
    return sessionStorage.getItem('admin_session_name') || 'Admin';
  }
  return profile.nama;
}

// Guard: redirect if not logged in
async function requireAuth(allowedRoles = null) {
  const session = await getSession();
  if (!session || !session.profile) {
    window.location.href = '/login.html';
    return null;
  }
  if (!session.profile.is_active) {
    await logout();
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(session.profile.role)) {
    window.location.href = '/dashboard.html';
    return null;
  }
  // Admin: ensure name is set for this session
  if (session.profile.role === 'admin' && !sessionStorage.getItem('admin_session_name')) {
    showAdminNameModal(session.profile);
    return null;
  }
  return session;
}

// Show name prompt modal for shared admin account
function showAdminNameModal(profile) {
  const modal = document.getElementById('adminNameModal');
  if (modal) modal.classList.add('open');
}

// Submit admin name
function submitAdminName(name) {
  if (!name || name.trim().length < 2) return false;
  sessionStorage.setItem('admin_session_name', name.trim());
  const modal = document.getElementById('adminNameModal');
  if (modal) modal.classList.remove('open');
  return true;
}

// Check if user can edit a specific SLS
async function canEditSLS(kode_sls_gabungan, profile) {
  if (['superadmin', 'admin'].includes(profile.role)) return true;
  if (profile.role === 'pml') {
    const { data } = await db.rpc('get_pml_sls');
    return data && data.some(r => r.kode_sls === kode_sls_gabungan);
  }
  if (profile.role === 'ppl') {
    const { data } = await db.rpc('get_my_sls');
    return data && data.some(r => r.kode_sls === kode_sls_gabungan);
  }
  return false;
}
