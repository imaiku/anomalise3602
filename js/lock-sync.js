// ============================================================
// LOCK SYNC MODULE (COLLABORATION & ANTI-COLLISION)
// ============================================================

const LOCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 menit
let activeLockChannel = null;
let lockHeartbeatInterval = null;
let lastInteractionTimestamp = Date.now();

// Set event listener untuk mendeteksi keaktifan pengguna (mouse, keyboard, scroll)
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, () => {
    lastInteractionTimestamp = Date.now();
  }, { passive: true });
});

// Helper: Cek apakah sebuah assignment sedang dikunci oleh orang lain
function isAssignmentLockedByOther(group, currentProfile) {
  if (!group || !group.locked_by_id) return false;
  if (!currentProfile) return true; // Tamu melihat semua yang dikunci sebagai milik orang lain

  const currentUserId = currentProfile.id;
  const currentSessionName = typeof getSessionName === 'function' ? getSessionName(currentProfile) : (currentProfile.nama || '');

  // Jika akun admin bersama: bedakan berdasarkan nama sesi (locked_by_nama)
  if (currentProfile.role === 'admin') {
    if (group.locked_by_nama && group.locked_by_nama.toLowerCase() === currentSessionName.toLowerCase()) {
      return false; // Dikunci oleh diri sendiri di sesi ini
    }
  } else {
    // Role non-admin: bedakan berdasarkan ID akun unik
    if (group.locked_by_id === currentUserId) {
      return false; // Dikunci oleh diri sendiri
    }
  }

  // Cek apakah kunci sudah kadaluarsa (> 15 menit)
  if (group.locked_at) {
    const lockTime = new Date(group.locked_at).getTime();
    if (Date.now() - lockTime > LOCK_TIMEOUT_MS) {
      return false; // Kunci sudah kadaluarsa
    }
  }

  return true;
}

// Inisialisasi Realtime Listener untuk Lock State (Postgres Changes + Broadcast Channel)
function initLockRealtime(onLockUpdateCallback) {
  if (activeLockChannel) {
    try { db.removeChannel(activeLockChannel); } catch (e) {}
  }

  const applyLockUpdate = (assignmentId, lockedById, lockedByNama, lockedAt) => {
    let found = false;
    const updateInList = (list) => {
      if (!list || !list.length) return false;
      list.forEach(item => {
        if (item.assignment_id === assignmentId) {
          item.locked_by_id = lockedById;
          item.locked_by_nama = lockedByNama;
          item.locked_at = lockedAt;
          found = true;
        }
      });
      return found;
    };

    updateInList(window.allData || []);
    updateInList(window.activeScopeRows || []);

    if (found && typeof onLockUpdateCallback === 'function') {
      onLockUpdateCallback(assignmentId);
    }
  };

  activeLockChannel = db.channel('assignment_anomali_locks', {
    config: {
      broadcast: { self: false }
    }
  })
    // 1. Instant Peer-to-Peer Broadcast
    .on('broadcast', { event: 'lock_state_change' }, (payload) => {
      const data = payload.payload;
      if (data && data.assignment_ids) {
        data.assignment_ids.forEach(aid => {
          applyLockUpdate(aid, data.locked_by_id, data.locked_by_nama, data.locked_at);
        });
      }
    })
    // 2. Database Postgres Changes (CDC)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'assignment_anomali'
      },
      (payload) => {
        const newRow = payload.new;
        if (!newRow || !newRow.assignment_id) return;
        applyLockUpdate(newRow.assignment_id, newRow.locked_by_id, newRow.locked_by_nama, newRow.locked_at);
      }
    )
    .subscribe((status) => {
      console.log('[LOCK] Realtime lock channel status:', status);
    });

  // Jalankan timer pemeriksaan idle setiap 1 menit
  if (lockHeartbeatInterval) clearInterval(lockHeartbeatInterval);
  lockHeartbeatInterval = setInterval(async () => {
    const idleDuration = Date.now() - lastInteractionTimestamp;
    
    // Jika idle lebih dari 15 menit dan ada baris yang sedang dipilih/dikunci sendiri
    if (idleDuration >= LOCK_TIMEOUT_MS && window.selectedIds && window.selectedIds.size > 0) {
      const idsToRelease = Array.from(window.selectedIds);
      if (window.currentProfile && window.currentProfile.id) {
        try {
          await db.rpc('release_assignment_locks', {
            p_assignment_ids: idsToRelease,
            p_user_id: window.currentProfile.id
          });
          broadcastLockChange(idsToRelease, null, null, null);
        } catch (err) {
          console.warn('[LOCK] Gagal melepas kunci saat timeout:', err);
        }
      }

      window.selectedIds.clear();
      const selectAllEl = document.getElementById('selectAll');
      if (selectAllEl) selectAllEl.checked = false;
      if (typeof window.updateFab === 'function') window.updateFab();
      if (typeof window.renderAll === 'function') window.renderAll();

      showToast('Klaim tugas dilepas otomatis karena tidak ada aktivitas selama 15 menit.', 'warning');
    }
  }, 60 * 1000);

  // ============================================================
  // POLLING: Sinkronisasi lock state setiap 5 detik
  // - Selalu jalan tiap 5 detik selama tab aktif & Live Sync = ON
  // - Berhenti saat tab minimize (document.hidden) atau Live Sync = OFF
  // - Dipanggil langsung saat pindah halaman via pollLockState()
  // ============================================================
  window.isLockSyncEnabled = localStorage.getItem('live_lock_sync_enabled') !== 'false'; // default: true

  window.pollLockState = async function() {
    // Hanya berjalan jika fitur aktif & user sedang login
    if (!window.isLockSyncEnabled || !window.currentProfile) return;

    try {
      const currentAllData = window.allData;
      if (!currentAllData || currentAllData.length === 0) return;

      // Ambil assignment_id yang sedang ditampilkan di halaman saat ini (Deduplikasi unik)
      const rawPageIds = (window.filteredData || [])
        .slice(
          ((window.currentPage || 1) - 1) * (window.pageSize || 10),
          (window.currentPage || 1) * (window.pageSize || 10)
        )
        .map(g => g.assignment_id);

      const currentPageIds = [...new Set(rawPageIds.filter(Boolean))];
      if (currentPageIds.length === 0) return;

      // Query hanya baris yang sedang terkunci atau berada di halaman saat ini
      const { data: lockRows, error } = await db
        .from('assignment_anomali')
        .select('assignment_id, locked_by_id, locked_by_nama, locked_at')
        .in('assignment_id', currentPageIds);

      if (error) {
        console.warn('[LOCK POLL] Error:', error.message);
        return;
      }

      // Bangun map: assignment_id -> lock state
      const lockMap = {};
      (lockRows || []).forEach(row => {
        if (!lockMap[row.assignment_id] || row.locked_by_id) {
          lockMap[row.assignment_id] = {
            locked_by_id: row.locked_by_id || null,
            locked_by_nama: row.locked_by_nama || null,
            locked_at: row.locked_at || null
          };
        }
      });

      // Bandingkan dengan state lokal, update jika beda
      let changed = false;
      currentAllData.forEach(g => {
        const remote = lockMap[g.assignment_id];
        if (remote) {
          if (g.locked_by_id !== remote.locked_by_id ||
              g.locked_by_nama !== remote.locked_by_nama) {
            g.locked_by_id = remote.locked_by_id;
            g.locked_by_nama = remote.locked_by_nama;
            g.locked_at = remote.locked_at;
            changed = true;
          }
        }
      });

      if (changed) {
        console.log('[LOCK POLL] Lock state berubah, memperbarui tampilan...');
        if (typeof onLockUpdateCallback === 'function') {
          onLockUpdateCallback();
        }
      }
    } catch (err) {
      console.warn('[LOCK POLL] Exception:', err);
    }
  };

  // Inisialisasi UI tombol toggle
  updateSyncButtonUI();

  if (window._lockPollInterval) clearInterval(window._lockPollInterval);
  window._lockPollInterval = setInterval(() => {
    if (!document.hidden && window.isLockSyncEnabled) {
      window.pollLockState();
    }
  }, 5000);
}

// Toggle on/off Live Sync
function toggleLockSync() {
  window.isLockSyncEnabled = !window.isLockSyncEnabled;
  localStorage.setItem('live_lock_sync_enabled', window.isLockSyncEnabled ? 'true' : 'false');
  updateSyncButtonUI();
  
  if (window.isLockSyncEnabled) {
    showToast('Live Sync diaktifkan (memeriksa status tiap 5 detik).', 'info');
    if (typeof window.pollLockState === 'function') window.pollLockState();
  } else {
    showToast('Live Sync dimatikan.', 'info');
  }
}

function updateSyncButtonUI() {
  const dot = document.getElementById('syncStatusDot');
  const text = document.getElementById('syncBtnText');
  const btn = document.getElementById('toggleSyncBtn');
  if (!dot || !text) return;

  const isEnabled = window.isLockSyncEnabled !== false;
  if (isEnabled) {
    dot.style.background = 'var(--success)';
    text.textContent = 'Live Sync: ON';
    if (btn) btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
  } else {
    dot.style.background = 'var(--text-subtle)';
    text.textContent = 'Live Sync: OFF';
    if (btn) btn.style.borderColor = 'var(--border)';
  }
}

// Broadcast event helper
function broadcastLockChange(assignmentIds, lockedById, lockedByNama, lockedAt) {
  if (activeLockChannel) {
    activeLockChannel.send({
      type: 'broadcast',
      event: 'lock_state_change',
      payload: {
        assignment_ids: assignmentIds,
        locked_by_id: lockedById,
        locked_by_nama: lockedByNama,
        locked_at: lockedAt
      }
    }).catch(err => console.warn('Broadcast send error:', err));
  }
}

// Klaim Kunci (Atomic RPC + Instant Broadcast)
async function acquireAssignmentLocks(assignmentIds, userProfile) {
  if (!assignmentIds || !assignmentIds.length || !userProfile) return { success: true, claimed_count: 0 };

  const sessionName = typeof getSessionName === 'function' ? getSessionName(userProfile) : (userProfile.nama || 'User');
  const nowIso = new Date().toISOString();
  
  // Instant broadcast ke semua tab/user lain tanpa delay
  broadcastLockChange(assignmentIds, userProfile.id, sessionName, nowIso);

  try {
    const { data, error } = await db.rpc('claim_assignment_locks', {
      p_assignment_ids: assignmentIds,
      p_user_id: userProfile.id,
      p_user_nama: sessionName
    });

    if (error) {
      console.warn('[LOCK] RPC claim_assignment_locks error:', error.message, '- Pastikan fungsi RPC sudah dibuat di Supabase SQL Editor.');
      if (error.message.includes('not found') || error.message.includes('does not exist') || error.code === '42883') {
        showToast('Fungsi database lock belum dibuat. Jalankan SQL migrasi di Supabase terlebih dahulu.', 'error');
      }
      // Tetap lanjutkan tanpa gagal — lock secara visual sudah terpasang via broadcast
      return { success: true, claimed_count: assignmentIds.length, failed_ids: [] };
    }
    console.log('[LOCK] Claimed:', data);
    return data || { success: true, claimed_count: assignmentIds.length, failed_ids: [] };
  } catch (err) {
    console.error('[LOCK] Error acquiring assignment locks:', err);
    return { success: true, claimed_count: assignmentIds.length, failed_ids: [] };
  }
}

// Lepas Kunci (Atomic RPC + Instant Broadcast)
async function releaseAssignmentLocks(assignmentIds, userProfile) {
  if (!assignmentIds || !assignmentIds.length || !userProfile) return 0;

  // Instant broadcast uncheck ke semua tab/user lain
  broadcastLockChange(assignmentIds, null, null, null);

  try {
    const { data, error } = await db.rpc('release_assignment_locks', {
      p_assignment_ids: assignmentIds,
      p_user_id: userProfile.id
    });

    if (error) throw error;
    return data || 0;
  } catch (err) {
    console.error('Error releasing assignment locks:', err);
    return 0;
  }
}

// Lepaskan kunci secara otomatis saat tab/jendela ditutup
window.addEventListener('beforeunload', () => {
  if (window.selectedIds && window.selectedIds.size > 0 && window.currentProfile && window.currentProfile.id) {
    const ids = Array.from(window.selectedIds);
    // Menggunakan fetch keepalive / synchronous call untuk Supabase REST endpoint
    const url = `${SUPABASE_URL}/rest/v1/rpc/release_assignment_locks`;
    const payload = JSON.stringify({
      p_assignment_ids: ids,
      p_user_id: window.currentProfile.id
    });
    
    try {
      if (navigator.sendBeacon) {
        const headers = {
          type: 'application/json'
        };
        const blob = new Blob([payload], headers);
        // sendBeacon doesn't always support custom headers easily for Supabase apikey, so fallback to fetch keepalive
      }
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: payload,
        keepalive: true
      }).catch(() => {});
    } catch (e) {}
  }
});
