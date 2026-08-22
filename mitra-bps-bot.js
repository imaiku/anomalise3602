/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  BOT MITRA BPS — MULTI-DEVICE AUTO-RECOVERY QUEUE & EXPORT EXCEL            ║
 * ║  Jalankan di browser console saat sudah login di manajemen-mitra.bps.go.id   ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

(async () => {
    const LOG_PREFIX = '%c[Bot Mitra BPS]';
    const LOG_OK     = 'color: #10b981; font-weight: bold;';
    const LOG_INFO   = 'color: #3b82f6; font-weight: bold;';
    const LOG_WARN   = 'color: #f59e0b; font-weight: bold;';
    const LOG_ERR    = 'color: #ef4444; font-weight: bold;';

    console.log(LOG_PREFIX + ' Menginisialisasi Bot Mitra BPS (Auto-Recovery & Realtime DB)...', LOG_INFO);

    // ─── 0. Konfigurasi Database & Auth ───
    const SUPABASE_URL = "https://vpbhqemomsewrnrggbmd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3";

    const DEFAULT_AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3ODczNDE3NTYsIm4iOiJJcmdpIEZhaHJvemkgUy5Uci5TdGF0LiIsInIiOiIxIiwidHlwZSI6ImFkbWluIiwidW4iOiJpcmdpLmZhaHJvemkiLCJ3IjpbIjM2LTAyIl19.7FvxsaFAj9rIin3dYhOu5vapvKmieY2nGmwn2G4Ri_w";

    function getAuthToken() {
        try {
            const raw = localStorage.getItem('token') || 
                        localStorage.getItem('auth_token') || 
                        localStorage.getItem('access_token') ||
                        sessionStorage.getItem('token') || 
                        sessionStorage.getItem('auth_token');
            if (raw) return raw.replace(/^"(.*)"$/, '$1');
        } catch(e) {}
        return DEFAULT_AUTH_TOKEN;
    }

    const AUTH_TOKEN = getAuthToken();
    const CLIENT_ID = 'PC-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const BATCH_CLAIM_SIZE = 3; // Batch kecil (3 data) agar mitigasi abort sangat cepat
    const DELAY_MIN = 2200; // 2.2s
    const DELAY_MAX = 3800; // 3.8s
    const RATE_LIMIT_AUTO_WAIT_SECONDS = 30;
    const BASE_URL = 'https://mitra-api.bps.go.id';

    // ─── 1. Robust Loader untuk SheetJS & Supabase ───
    async function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`Gagal memuat ${url}`));
            document.head.appendChild(s);
        });
    }

    async function ensureSheetJS() {
        if (window.XLSX && window.XLSX.utils && window.XLSX.utils.json_to_sheet) {
            return window.XLSX;
        }
        const CDNS = [
            'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
            'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
        ];
        for (const cdn of CDNS) {
            try {
                await loadScript(cdn);
                if (window.XLSX && window.XLSX.utils && window.XLSX.utils.json_to_sheet) {
                    return window.XLSX;
                }
            } catch (e) {}
        }
        return window.XLSX || null;
    }

    async function ensureSupabase() {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            return window.supabase;
        }
        const CDNS = [
            'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
            'https://unpkg.com/@supabase/supabase-js@2'
        ];
        for (const cdn of CDNS) {
            try {
                await loadScript(cdn);
                if (window.supabase && typeof window.supabase.createClient === 'function') {
                    return window.supabase;
                }
            } catch (e) {}
        }
        return window.supabase || null;
    }

    await ensureSheetJS();
    await ensureSupabase();

    if (!window.supabase) {
        alert("Gagal memuat library Supabase. Periksa koneksi internet!");
        return;
    }

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ─── 2. Interceptor (Fetch + XHR) ───
    window._isCaptchaResolved = false;
    window._lastRevealedNikMap = window._lastRevealedNikMap || {};

    function onCaptchaSuccessDetected(source) {
        console.log(LOG_PREFIX + ` Interceptor (${source}) ✅ CAPTCHA RESOLVED! Melanjutkan bot...`, LOG_OK);
        window._isCaptchaResolved = true;
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const res = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            if (url.includes('resolve-rate-limit')) onCaptchaSuccessDetected('Fetch');
            if (url.includes('/api/mitra/reveal-info/nik/') && res.ok) {
                const clone = res.clone();
                clone.json().then(data => {
                    const nik = data?.mitra?.nik;
                    const idMatch = url.match(/\/nik\/(\d+)/);
                    if (nik && idMatch && idMatch[1]) {
                        window._lastRevealedNikMap[idMatch[1]] = nik;
                    }
                }).catch(() => {});
            }
        } catch(e) {}
        return res;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._reqUrl = url;
        return originalOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                if (this._reqUrl && this._reqUrl.includes('resolve-rate-limit') && this.status >= 200 && this.status < 300) {
                    onCaptchaSuccessDetected('XHR/Axios');
                }
                if (this._reqUrl && this._reqUrl.includes('/api/mitra/reveal-info/nik/') && this.status === 200) {
                    const data = JSON.parse(this.responseText);
                    const nik = data?.mitra?.nik;
                    const idMatch = this._reqUrl.match(/\/nik\/(\d+)/);
                    if (nik && idMatch && idMatch[1]) {
                        window._lastRevealedNikMap[idMatch[1]] = nik;
                    }
                }
            } catch(e) {}
        });
        return originalSend.apply(this, args);
    };

    // ─── 3. Auto-Release saat Tab Ditutup / Refresh ───
    window._currentClaimedIds = new Set();
    
    window.addEventListener('beforeunload', () => {
        if (window._currentClaimedIds.size > 0) {
            const ids = Array.from(window._currentClaimedIds);
            db.from('mitra_data_sync')
                .update({ queue_status: 'pending', claimed_by: null, claimed_at: null })
                .in('id_mitra', ids);
        }
    });

    // ─── 4. Floating Panel UI ───
    const oldUI = document.getElementById('mitra-bot-floating-panel');
    if (oldUI) oldUI.remove();

    const panel = document.createElement('div');
    panel.id = 'mitra-bot-floating-panel';
    panel.style = `
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        background: #0f172a; color: #f8fafc; padding: 14px 18px;
        border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px;
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #334155; width: 340px;
    `;

    panel.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 8px;">
            <div style="font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                <span>🤖 Bot Mitra BPS</span>
                <span style="font-size: 10px; background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px;">${CLIENT_ID}</span>
            </div>
            <span id="mitra-db-stat" style="font-size: 11px; color: #a78bfa; font-weight: bold;">DB: ... / ...</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 3px;">
            <div id="mitra-bot-status" style="color: #cbd5e1; font-size: 12px; font-weight: 500;">Menginisialisasi...</div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
                <span id="mitra-device-stat">Sesi PC ini: 0 tersimpan</span>
                <span id="mitra-stale-stat" style="color: #f59e0b; cursor: pointer;" title="Klik untuk paksa reset antrean macet">Macet: 0</span>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px;">
            <button id="btn-resume-bot" style="background: #10b981; color: white; border: none; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">▶️ Lanjut</button>
            <button id="btn-reset-stale" style="background: #f59e0b; color: white; border: none; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">🔄 Reset Macet</button>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 6px;">
            <button id="btn-export-db-bot" style="background: #6366f1; color: white; border: none; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
                📥 Export DB (.xlsx)
            </button>
            <button id="btn-stop-bot" style="background: #ef4444; color: white; border: none; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">⏹️ Stop</button>
        </div>
    `;
    document.body.appendChild(panel);

    function updateFloatingStatus(statusText, dbStatText = null, deviceStatText = null, staleText = null) {
        const el = document.getElementById('mitra-bot-status');
        if (el && statusText) el.innerText = statusText;
        if (dbStatText) {
            const dbEl = document.getElementById('mitra-db-stat');
            if (dbEl) dbEl.innerText = dbStatText;
        }
        if (deviceStatText) {
            const devEl = document.getElementById('mitra-device-stat');
            if (devEl) devEl.innerText = deviceStatText;
        }
        if (staleText) {
            const stEl = document.getElementById('mitra-stale-stat');
            if (stEl) stEl.innerText = staleText;
        }
    }

    document.getElementById('btn-resume-bot').onclick = () => {
        console.log(LOG_PREFIX + ' Tombol Lanjut Ditekan!', LOG_INFO);
        window._isCaptchaResolved = true;
    };

    document.getElementById('btn-stop-bot').onclick = async () => {
        window.isMitraBotStopped = true;
        updateFloatingStatus("Menghentikan bot & melepas klaim...");
        if (window._currentClaimedIds.size > 0) {
            const ids = Array.from(window._currentClaimedIds);
            await db.from('mitra_data_sync')
                .update({ queue_status: 'pending', claimed_by: null, claimed_at: null })
                .in('id_mitra', ids);
            window._currentClaimedIds.clear();
        }
        updateFloatingStatus("Bot dihentikan. Semua antrean aman.");
        console.log(LOG_PREFIX + ' Bot dihentikan. Antrean telah dilepas.', LOG_WARN);
    };

    // Fungsi reset antrean macet
    async function resetStaleQueues(seconds = 90) {
        updateFloatingStatus(`Mereset antrean macet (> ${seconds}s)...`);
        console.log(LOG_PREFIX + ` Mereset antrean macet/ter-abort (> ${seconds} detik)...`, LOG_WARN);
        
        let resetCount = 0;
        const { data: countRpc, error: rpcErr } = await db.rpc('reset_stale_mitra_claims', { p_seconds: seconds });
        if (!rpcErr) {
            resetCount = countRpc || 0;
        } else {
            // Direct query fallback
            const timeoutStr = new Date(Date.now() - seconds * 1000).toISOString();
            const { data: staleRows } = await db
                .from('mitra_data_sync')
                .select('id_mitra')
                .eq('nik_revealed', false)
                .or(`and(queue_status.eq.claimed,claimed_at.lt.${timeoutStr}),queue_status.eq.failed`);

            if (staleRows && staleRows.length > 0) {
                const ids = staleRows.map(r => r.id_mitra);
                await db.from('mitra_data_sync')
                    .update({ queue_status: 'pending', claimed_by: null, claimed_at: null })
                    .in('id_mitra', ids);
                resetCount = ids.length;
            }
        }

        console.log(LOG_PREFIX + ` ✅ Berhasil mereset ${resetCount} antrean macet ke status 'pending'.`, LOG_OK);
        updateFloatingStatus(`Reset berhasil: ${resetCount} antrean dipulihkan.`);
        return resetCount;
    }

    document.getElementById('btn-reset-stale').onclick = async () => {
        await resetStaleQueues(60);
    };
    document.getElementById('mitra-stale-stat').onclick = async () => {
        await resetStaleQueues(60);
    };

    document.getElementById('btn-export-db-bot').onclick = async () => {
        await window.exportAllMitraFromDB();
    };

    // ─── 5. Helpers & DB Sync ───
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomDelay = () => sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));

    function buildHeaders() {
        return {
            'Accept': '*/*',
            'Authorization': `Bearer ${AUTH_TOKEN}`,
            'x-app-name': 'manajemen-mitra'
        };
    }

    // ─── 6. Export Seluruh Data Database ke Excel ───
    function downloadCSVFallback(rowsData, filename) {
        if (!rowsData || rowsData.length === 0) return;
        const headers = Object.keys(rowsData[0]);
        const csvContent = [
            headers.join(','),
            ...rowsData.map(row => 
                headers.map(fieldName => {
                    let val = row[fieldName] ?? '';
                    val = String(val).replace(/"/g, '""');
                    return `"${val}"`;
                }).join(',')
            )
        ].join('\r\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.replace('.xlsx', '.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log(LOG_PREFIX + ` 📥 File CSV tersimpan: "${link.download}"`, LOG_OK);
    }

    window.exportAllMitraFromDB = async function() {
        updateFloatingStatus("Mengunduh data dari database...");
        console.log(LOG_PREFIX + ' Mengambil data dari tabel mitra_data_sync di Supabase...', LOG_INFO);

        try {
            let allRows = [];
            let from = 0;
            const pageSize = 1000;

            while (true) {
                const { data, error } = await db
                    .from('mitra_data_sync')
                    .select('*')
                    .order('id_mitra', { ascending: true })
                    .range(from, from + pageSize - 1);

                if (error) throw error;
                if (!data || data.length === 0) break;

                allRows = allRows.concat(data);
                console.log(LOG_PREFIX + ` Terambil ${allRows.length} data...`, LOG_INFO);
                if (data.length < pageSize) break;
                from += pageSize;
            }

            if (allRows.length === 0) {
                alert("Database masih kosong! Jalankan bot untuk mengisi data.");
                updateFloatingStatus("Database kosong.");
                return;
            }

            const exportData = allRows.map((r, idx) => ({
                'No':               idx + 1,
                'ID Mitra':         r.id_mitra,
                'ID MS':            r.id_ms || '',
                'Username':         r.username || '',
                'Nama Lengkap':     r.nama_lengkap || '',
                'NIK':              r.nik || '',
                'Status NIK':       r.nik_revealed ? 'Terbuka' : 'Tersamarkan',
                'No. Telpon':       r.no_telp || '',
                'Email':            r.email || '',
                'Tgl Lahir':        r.tgl_lahir || '',
                'Jenis Kelamin':    r.jenis_kelamin || '',
                'Agama':            r.agama || '',
                'Pendidikan':       r.pendidikan || '',
                'Pekerjaan':        r.pekerjaan || '',
                'Status Kawin':     r.status_kawin || '',
                'Alamat Detail':    r.alamat_detail || '',
                'Desa':             r.desa || '',
                'Kecamatan':        r.kecamatan || '',
                'Kabupaten':        r.kabupaten || '',
                'Provinsi':         r.provinsi || '',
                'Bank':             r.bank || '',
                'No. Rekening':     r.rekening || '',
                'NPWP':             r.npwp || '',
                'Sobat ID':         r.sobat_id || '',
                'Punya Motor':      r.is_motor || '',
                'Punya Laptop':     r.is_laptop || '',
                'HP Android':       r.is_hp_android || '',
                'Bisa Komputer':    r.is_bisa_komputer || '',
                'Posisi':           r.posisi || '',
                'Status Mitra':     r.status_mitra || '',
                'Satker':           r.satker || '',
                'Status Antrean':   r.queue_status || '',
                'Terakhir Update':  r.updated_at || ''
            }));

            const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            const filename = `DATA_MITRA_BPS_LEBAK_ALL_${timestamp}.xlsx`;

            const xlsx = await ensureSheetJS();
            if (xlsx && xlsx.utils && xlsx.utils.json_to_sheet) {
                const ws = xlsx.utils.json_to_sheet(exportData);
                const colWidths = Object.keys(exportData[0] ?? {}).map(key => ({
                    wch: Math.max(key.length, 14)
                }));
                ws['!cols'] = colWidths;

                const wb = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(wb, ws, 'Data Mitra Database');
                xlsx.writeFile(wb, filename);
                console.log(LOG_PREFIX + ` 📥 File Excel tersimpan: "${filename}" (${exportData.length} baris)`, LOG_OK);
            } else {
                downloadCSVFallback(exportData, filename);
            }

            updateFloatingStatus(`Export selesai: ${exportData.length} mitra.`);
        } catch (err) {
            console.error(LOG_PREFIX + ' Gagal export database:', LOG_ERR, err);
            alert("Gagal export database: " + err.message);
            updateFloatingStatus("Export gagal: " + err.message);
        }
    };

    // ─── 7. Inisialisasi Master Data ───
    async function syncMasterDataToDB() {
        const { count, error: countErr } = await db
            .from('mitra_data_sync')
            .select('id_mitra', { count: 'exact', head: true });

        if (countErr) {
            alert("⚠️ PERHATIAN:\nTabel 'mitra_data_sync' belum dibuat di Supabase!\n\nJalankan file sql/mitra_scrape_system.sql di Supabase SQL Editor.");
            return 0;
        }

        if (count && count > 0) return count;

        updateFloatingStatus("Mengambil master data dari BPS API...");
        let mitras = [];
        try {
            const res = await fetch(`${BASE_URL}/api/mitra-kepka/by-year-wil/2026/36/02`, {
                method: 'GET',
                headers: buildHeaders()
            });
            if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
            const json = await res.json();
            mitras = json?.mitras ?? json?.data ?? json ?? [];
        } catch (err) {
            console.error(LOG_PREFIX + ' Gagal ambil daftar mitra BPS:', LOG_ERR, err);
            return 0;
        }

        if (!mitras.length) return 0;

        const formattedRows = mitras.map(m => {
            const d = m.mitra_detail ?? {};
            const initialNik = d.nik ?? '';
            const isRevealed = Boolean(initialNik && !initialNik.includes('*'));
            return {
                id_mitra:         m.id_mitra,
                id_ms:            m.id_ms ? String(m.id_ms) : '',
                username:         d.username ?? m.CreatedBy ?? '',
                nama_lengkap:     d.nama_lengkap ?? '',
                nik:              initialNik,
                no_telp:          d.no_telp ?? '',
                email:            d.email ?? '',
                tgl_lahir:        d.tgl_lahir ?? '',
                jenis_kelamin:    d.jns_kelamin === '1' ? 'Laki-laki' : d.jns_kelamin === '2' ? 'Perempuan' : '',
                agama:            d.agama ?? '',
                pendidikan:       d.pendidikan ?? '',
                pekerjaan:        d.pekerjaan ?? '',
                status_kawin:     d.status_kawin ?? '',
                alamat_detail:    d.alamat_detail ?? '',
                desa:             d.alamat_desa ?? '',
                kecamatan:        d.alamat_kec ?? '',
                kabupaten:        d.alamat_kab ?? '',
                provinsi:         d.alamat_prov ?? '',
                bank:             d.kd_bank ?? '',
                rekening:         d.rekening ?? '',
                npwp:             d.npwp ?? '',
                sobat_id:         d.sobat_id ?? '',
                is_motor:         d.is_motor === '1' ? 'Ya' : 'Tidak',
                is_laptop:        d.is_laptop === '1' ? 'Ya' : 'Tidak',
                is_hp_android:    d.is_hp_android === '1' ? 'Ya' : 'Tidak',
                is_bisa_komputer: d.is_bisa_komputer === '1' ? 'Ya' : 'Tidak',
                posisi:           m.nama_pos ?? '',
                status_mitra:     m.ket_status ?? '',
                satker:           m.nama_satker ?? '',
                nik_revealed:     isRevealed,
                queue_status:     isRevealed ? 'done' : 'pending'
            };
        });

        for (let i = 0; i < formattedRows.length; i += 100) {
            const chunk = formattedRows.slice(i, i + 100);
            await db.from('mitra_data_sync').upsert(chunk, { onConflict: 'id_mitra' });
        }

        return formattedRows.length;
    }

    // ─── 8. Statistik Global & Stale Tracker ───
    async function getGlobalStats() {
        try {
            const { count: total } = await db
                .from('mitra_data_sync')
                .select('id_mitra', { count: 'exact', head: true });

            const { count: done } = await db
                .from('mitra_data_sync')
                .select('id_mitra', { count: 'exact', head: true })
                .eq('nik_revealed', true);

            const staleThreshold = new Date(Date.now() - 90 * 1000).toISOString();
            const { count: stale } = await db
                .from('mitra_data_sync')
                .select('id_mitra', { count: 'exact', head: true })
                .eq('nik_revealed', false)
                .or(`and(queue_status.eq.claimed,claimed_at.lt.${staleThreshold}),queue_status.eq.failed`);

            return { total: total || 0, done: done || 0, stale: stale || 0 };
        } catch(e) {
            return { total: 0, done: 0, stale: 0 };
        }
    }

    // ─── 9. Reveal NIK dengan Heartbeat & Rate Limit ───
    async function revealNik(idMitra, nama) {
        if (window._lastRevealedNikMap[idMitra]) {
            return window._lastRevealedNikMap[idMitra];
        }

        while (true) {
            if (window.isMitraBotStopped) return null;

            // Heartbeat agar antrean yang sedang diproses tidak direbut PC lain
            db.from('mitra_data_sync')
                .update({ claimed_at: new Date().toISOString() })
                .eq('id_mitra', idMitra)
                .catch(() => {});

            try {
                const revRes = await fetch(`${BASE_URL}/api/mitra/reveal-info/nik/${idMitra}`, {
                    method: 'GET',
                    headers: buildHeaders()
                });

                if (revRes.ok) {
                    const revJson = await revRes.json();
                    const nik = revJson?.mitra?.nik;
                    if (nik && !nik.includes('*')) {
                        window._lastRevealedNikMap[idMitra] = nik;
                        return nik;
                    }
                }

                // Rate Limit 429 / 403
                if (revRes.status === 429 || revRes.status === 403) {
                    console.warn(LOG_PREFIX + ` ⚠️ [RATE LIMIT 429] Jeda ${RATE_LIMIT_AUTO_WAIT_SECONDS}s atau Captcha...`, LOG_WARN);
                    window._isCaptchaResolved = false;

                    for (let sec = RATE_LIMIT_AUTO_WAIT_SECONDS; sec > 0; sec--) {
                        if (window.isMitraBotStopped) return null;
                        if (window._isCaptchaResolved) {
                            console.log(LOG_PREFIX + ' [Timer Dibatalkan] Captcha disolve lebih awal!', LOG_OK);
                            break;
                        }

                        // Perbarui heartbeat setiap 10 detik selama countdown
                        if (sec % 10 === 0) {
                            db.from('mitra_data_sync')
                                .update({ claimed_at: new Date().toISOString() })
                                .eq('id_mitra', idMitra)
                                .catch(() => {});
                        }

                        updateFloatingStatus(`⏳ Rate-limit: lanjut dlm ${sec}s...`);
                        await sleep(1000);
                    }

                    updateFloatingStatus("Melanjutkan request NIK...");
                    await sleep(1000);
                    continue;
                }

                return null;
            } catch (e) {
                console.warn(LOG_PREFIX + ` Network error: ${e.message}`, LOG_WARN);
                await sleep(2500);
            }
        }
    }

    // ─── 10. Main Loop Auto-Recovery Queue ───
    window.isMitraBotStopped = false;
    let localSuccess = 0;

    await syncMasterDataToDB();
    console.log(LOG_PREFIX + ` [${CLIENT_ID}] Memulai antrean Auto-Recovery...`, LOG_OK);

    let emptyCycles = 0;

    while (!window.isMitraBotStopped) {
        const stats = await getGlobalStats();
        const statStr = `DB: ${stats.done}/${stats.total} (${stats.total ? Math.round((stats.done/stats.total)*100) : 0}%)`;
        const staleStr = `Macet: ${stats.stale}`;
        updateFloatingStatus("Mengklaim antrean...", statStr, `Sesi PC ini: ${localSuccess} tersimpan`, staleStr);

        // 1. Klaim antrean via RPC (otomatis merebut item yang ditinggal > 90s)
        let claimedRows = [];
        const { data: claimed, error: claimErr } = await db.rpc('claim_mitra_scrape_queue', {
            p_limit: BATCH_CLAIM_SIZE,
            p_client_id: CLIENT_ID
        });

        if (!claimErr && claimed && claimed.length > 0) {
            claimedRows = claimed;
        } else {
            // Direct query fallback
            const staleThreshold = new Date(Date.now() - 90 * 1000).toISOString();
            const { data: fallbackData } = await db
                .from('mitra_data_sync')
                .select('*')
                .eq('nik_revealed', false)
                .or(`queue_status.eq.pending,queue_status.eq.failed,and(queue_status.eq.claimed,claimed_at.lt.${staleThreshold})`)
                .order('id_mitra', { ascending: true })
                .limit(BATCH_CLAIM_SIZE);

            if (fallbackData && fallbackData.length > 0) {
                const ids = fallbackData.map(r => r.id_mitra);
                await db.from('mitra_data_sync')
                    .update({ 
                        queue_status: 'claimed', 
                        claimed_by: CLIENT_ID, 
                        claimed_at: new Date().toISOString() 
                    })
                    .in('id_mitra', ids);
                claimedRows = fallbackData;
            }
        }

        // 2. Jika antrean lokal kosong
        if (!claimedRows || claimedRows.length === 0) {
            // Cek apakah masih ada data yang belum ter-reveal di database
            const { count: sisaBelum } = await db
                .from('mitra_data_sync')
                .select('id_mitra', { count: 'exact', head: true })
                .eq('nik_revealed', false);

            if (sisaBelum && sisaBelum > 0) {
                emptyCycles++;
                // Jika sudah 2 kali siklus kosong tapi masih ada sisa, paksa auto-reset antrean yang nyangkut
                if (emptyCycles >= 2) {
                    console.log(LOG_PREFIX + ` ⚠️ Terdeteksi ${sisaBelum} antrean terhambat di PC lain. Menjalankan auto-recovery...`, LOG_WARN);
                    await resetStaleQueues(30);
                    emptyCycles = 0;
                    await sleep(2000);
                    continue;
                }

                updateFloatingStatus(`Menunggu ${sisaBelum} sisa antrean...`, statStr, null, `Macet: ${stats.stale}`);
                console.log(LOG_PREFIX + ` Sisa ${sisaBelum} mitra sedang dikerjakan device lain. Menunggu 5 detik...`, LOG_INFO);
                await sleep(5000);
                continue;
            }

            updateFloatingStatus("🎉 Semua data mitra lengkap!", statStr, null, "Macet: 0");
            console.log(LOG_PREFIX + ' 🎉 SEMUA DATA MITRA TELAH LENGKAP & TERBUKA DI DATABASE!', LOG_OK);
            break;
        }

        emptyCycles = 0;
        window._currentClaimedIds = new Set(claimedRows.map(r => r.id_mitra));
        console.log(LOG_PREFIX + ` [${CLIENT_ID}] Memproses ${claimedRows.length} antrean aktif...`, LOG_INFO);

        for (const item of claimedRows) {
            if (window.isMitraBotStopped) break;

            const idMitra = item.id_mitra;
            const nama = item.nama_lengkap || `id_mitra=${idMitra}`;

            updateFloatingStatus(`Memproses: ${nama}`, statStr, `Sesi PC ini: ${localSuccess} tersimpan`, staleStr);
            console.log(LOG_PREFIX + ` (${CLIENT_ID}) Memproses ${nama} (ID: ${idMitra})...`, LOG_INFO);

            let nikLengkap = item.nik;
            let isRevealed = Boolean(nikLengkap && !nikLengkap.includes('*'));

            if (!isRevealed) {
                nikLengkap = await revealNik(idMitra, nama);
                isRevealed = Boolean(nikLengkap && !nikLengkap.includes('*'));
            }

            // SIMPAN LANGSUNG KE SUPABASE REALTIME
            const updatePayload = {
                nik: nikLengkap || item.nik || '',
                nik_revealed: isRevealed,
                queue_status: isRevealed ? 'done' : 'failed',
                claimed_by: null,
                claimed_at: null,
                updated_at: new Date().toISOString()
            };

            const { error: updateErr } = await db
                .from('mitra_data_sync')
                .update(updatePayload)
                .eq('id_mitra', idMitra);

            if (updateErr) {
                console.error(LOG_PREFIX + ` ❌ Gagal update Supabase ID ${idMitra}:`, updateErr);
            } else {
                if (isRevealed) {
                    localSuccess++;
                    console.log(LOG_PREFIX + ` 💾 [DB UPDATE OK] ${nama} -> NIK: ${nikLengkap}`, LOG_OK);
                } else {
                    console.warn(LOG_PREFIX + ` ⚠️ [STATUS FAILED/RETRY LATER] ${nama}`, LOG_WARN);
                }
            }

            window._currentClaimedIds.delete(idMitra);
            await randomDelay();
        }

        window._currentClaimedIds.clear();
        await sleep(1000);
    }

    if (!window.isMitraBotStopped) {
        updateFloatingStatus("🎉 Selesai!", null, `Total tersimpan: ${localSuccess} data.`, "Macet: 0");
        console.log(LOG_PREFIX + ' ✅ Bot selesai memproses seluruh antrean.', LOG_OK);
    }
})();
