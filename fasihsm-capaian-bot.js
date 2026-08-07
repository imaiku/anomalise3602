/**
 * fasihsm-capaian-bot.js
 * ============================================================
 * BOT FASE 2 — Daily Capaian Scraper
 * ============================================================
 * Jalankan di browser console saat sudah login di fasih-sm.bps.go.id
 *
 * Prasyarat:
 *  - fasih_capaian_schema.sql sudah dijalankan di Supabase
 *  - fasihsm-region-lookup-bot.js sudah dijalankan dan fasih_scrape_queue sudah terisi
 *
 * Fungsi:
 *  1. Tentukan tanggal scraping hari ini
 *  2. Pastikan kolom tanggal ada di fasih_capaian_harian (via RPC fasih_add_date_column)
 *  3. Claim batch SLS dari fasih_scrape_queue (multi-device safe)
 *  4. Per SLS: hit POST report-progress-assignment
 *  5. Parse response → upsert per sub-SLS ke fasih_capaian_harian
 *  6. Mark SLS sebagai 'done' di queue
 *  7. Loop sampai queue habis
 * ============================================================
 */

(async () => {
    const LOG_PREFIX = '%c[Bot Capaian]';
    const LOG_OK = 'color: #10b981; font-weight: bold;';
    const LOG_INFO = 'color: #3b82f6; font-weight: bold;';
    const LOG_WARN = 'color: #f59e0b; font-weight: bold;';
    const LOG_ERR = 'color: #ef4444; font-weight: bold;';

    console.log(LOG_PREFIX + ' Memulai Bot Capaian Harian...', LOG_INFO);

    // ──────────────────────────────────────────────────────
    // KONSTANTA
    // ──────────────────────────────────────────────────────
    const SUPABASE_URL = 'https://vpbhqemomsewrnrggbmd.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';
    const SURVEY_PERIOD_ID = 'fd68e454-ba45-4b85-8205-f3bf777ded24';
    const REGION1_ID = '3d7e1f4e-5445-4770-8dc2-1f69697901b2';
    const REGION2_ID = '6ded025d-0c3a-40b9-b274-ae6f1e748b44';

    const ENDPOINTS = {
        PROGRESS: 'https://fasih-sm.bps.go.id/app/api/analytic/api/v2/assignment/report-progress-assignment',
        ASSIGNMENT: 'https://fasih-sm.bps.go.id/app/api/analytic/api/v2/assignment/report-user-assignment'
    };

    let activeEndpointKey = 'PROGRESS'; // Mulai dari Endpoint Progress
    let activeEndpointUrl = ENDPOINTS[activeEndpointKey];

    const BATCH_SIZE = 20;   // SLS per claim batch
    const CONCURRENCY = 2;    // Maksimal 2 Worker paralel untuk menghindari rate limit
    const DELAY_MIN = 1200; // ms (1.2 detik minimum delay per request)
    const DELAY_MAX = 2500; // ms (2.5 detik maksimum delay per request)

    // ──────────────────────────────────────────────────────
    // LOAD SUPABASE
    // ──────────────────────────────────────────────────────
    if (typeof supabase === 'undefined') {
        console.log(LOG_PREFIX + ' Memuat library Supabase...', LOG_INFO);
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ──────────────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────────────
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const randomDelay = () => sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));

    function getTodayDate() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getCsrfToken() {
        const token =
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            document.querySelector('meta[name="_csrf"]')?.getAttribute('content');
        if (token) return { token, header: 'X-CSRF-TOKEN' };
        const xsrf = document.cookie.split('; ').find(r => r.startsWith('XSRF-TOKEN=') || r.startsWith('xsrf-token='));
        if (xsrf) return { token: decodeURIComponent(xsrf.split('=')[1]), header: 'X-XSRF-TOKEN' };
        return null;
    }

    function buildHeaders() {
        const h = { 'Content-Type': 'application/json' };
        const csrf = getCsrfToken();
        if (csrf) {
            h[csrf.header] = csrf.token;
            h['X-CSRF-TOKEN'] = csrf.token;
        }
        return h;
    }

    function parseCapaianValues(values, mode) {
        if (mode === 'PROGRESS') {
            const result = { total: null, open: null, approved_pengawas: null };
            for (const v of values) {
                const lbl = (v.label || '').toUpperCase().trim();
                if (lbl === 'TOTAL') result.total = v.value ?? 0;
                else if (lbl === 'OPEN') result.open = v.value ?? 0;
                else if (lbl.includes('APPROVED')) result.approved_pengawas = v.value ?? 0;
            }
            return result;
        } else {
            const result = { total: null, assigned: null, have_not_assigned: null };
            for (const v of values) {
                const lbl = (v.label || '').toLowerCase().trim();
                if (lbl === 'total') result.total = v.value ?? 0;
                else if (lbl === 'assigned') result.assigned = v.value ?? 0;
                else if (lbl === 'have-not-assigned' || lbl === 'have_not_assigned') result.have_not_assigned = v.value ?? 0;
            }
            return result;
        }
    }

    function isSessionExpired(res, text) {
        if (res.status === 401 || res.status === 403) return true;
        if (res.url && res.url.includes('/login')) return true;
        if (text && (text.includes('login') || text.includes('username')) && !text.includes('{')) return true;
        return false;
    }

    async function releaseItem(kodeSls) {
        await db.rpc('fasih_set_sls_status', { p_kode_sls: kodeSls, p_status: 'pending' });
    }
    async function markSlsError(kodeSls) {
        await db.rpc('fasih_set_sls_status', { p_kode_sls: kodeSls, p_status: 'error' });
    }

    // ──────────────────────────────────────────────────────
    // INIT & 7-DAY ROLLING SCRAPER CONFIG
    // ──────────────────────────────────────────────────────
    const TODAY = getTodayDate();
    console.log(LOG_PREFIX + ` Tanggal scraping hari ini: ${TODAY}`, LOG_INFO);
    console.log(LOG_PREFIX + ` Endpoint Aktif Pertama: [${activeEndpointKey}]`, LOG_INFO);

    const { error: colErr } = await db.rpc('fasih_add_date_column', { p_date: TODAY });
    if (colErr) {
        console.error(LOG_PREFIX + ' Gagal menambah kolom tanggal:', LOG_ERR, colErr);
        return;
    }
    console.log(LOG_PREFIX + ` Kolom tanggal "${TODAY}" siap.`, LOG_OK);

    const { count: totalEligibleCount } = await db
        .from('fasih_scrape_queue')
        .select('kode_sls', { count: 'exact', head: true })
        .neq('status', 'done');

    const totalQueueSLS = totalEligibleCount || 0;
    console.log(LOG_PREFIX + ` Total SLS belum selesai (status != 'done'): ${totalQueueSLS}`, LOG_INFO);

    const headers = buildHeaders();
    let totalSubSlsProcessed = 0;
    let totalSlsDone = 0;
    let totalSlsError = 0;
    let isAborted = false;
    let consecutiveRateLimits = 0;
    let longCooldownCount = 0;
    const ONE_HOUR_MS = 60 * 60 * 1000;

    function printProgressSummary(statusText = 'BERHENTI') {
        const totalProcessed = totalSlsDone + totalSlsError;
        const pct = totalQueueSLS > 0 ? ((totalProcessed / totalQueueSLS) * 100).toFixed(2) : '0.00';
        console.log(LOG_PREFIX + ` 📊 REKAPITULASI PROGRES [${statusText}]:`, LOG_OK);
        console.table({
            'Status Bot': statusText,
            'Endpoint Aktif Terakhir': activeEndpointKey,
            'Target SLS (>7 Hari / Baru)': totalQueueSLS,
            'SLS Berhasil (Done)': totalSlsDone,
            'SLS Gagal / Skipped': totalSlsError,
            'Total SLS Diproses': `${totalProcessed} / ${totalQueueSLS} (${pct}%)`,
            'Total Sub-SLS Tersimpan': totalSubSlsProcessed,
            'Insiden Long Cooldown': longCooldownCount
        });
    }

    let isSwitchingEndpoint = false;

    // ──────────────────────────────────────────────────────
    // SINGLE WORKER SCRAPER
    // ──────────────────────────────────────────────────────
    async function processSingleSls(item, workerId) {
        if (isAborted) return;
        const { kode_sls, fasih_sls_id, fasih_desa_id, fasih_kec_id } = item;

        await randomDelay();

        const payload = {
            assignmentErrorStatusType: -1,
            assignmentStatusAlias: null,
            currentUserId: null,
            data1: null, data2: null, data3: null, data4: null,
            data5: null, data6: null, data7: null, data8: null,
            data9: null, data10: null,
            region1Id: REGION1_ID,
            region2Id: REGION2_ID,
            region3Id: fasih_kec_id,
            region4Id: fasih_desa_id,
            region5Id: fasih_sls_id,
            regionId: null,
            surveyPeriodId: SURVEY_PERIOD_ID,
            userIdResponsibility: null
        };

        try {
            const currentMode = activeEndpointKey;
            const currentUrl = activeEndpointUrl;

            const res = await fetch(currentUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });

            const rawText = await res.text();

            // 1. DETEKSI RATE LIMIT (HTTP 429 / 503 ATAU pesan di body)
            const isRateLimited = res.status === 429 || res.status === 503 ||
                (rawText && (rawText.toLowerCase().includes('rate limit') || rawText.toLowerCase().includes('too many requests')));

            if (isRateLimited) {
                consecutiveRateLimits++;
                await releaseItem(kode_sls);
                totalSlsError++;

                if (consecutiveRateLimits >= 10) {
                    // JIKA ENDPOINT UTAMA (PROGRESS) RATE LIMIT 10x → AUTO SWITCH KE ENDPOINT ASSIGNMENT!
                    if (activeEndpointKey === 'PROGRESS') {
                        console.warn(LOG_PREFIX + ` 🔀 RATE LIMIT 10x DI ENDPOINT PROGRESS! Auto-Switching ke Endpoint ASSIGNMENT...`, LOG_WARN);
                        activeEndpointKey = 'ASSIGNMENT';
                        activeEndpointUrl = ENDPOINTS.ASSIGNMENT;
                        consecutiveRateLimits = 0;
                        await sleep(3000);
                        return;
                    }

                    // JIKA ENDPOINT ASSIGNMENT JUGA RATE LIMIT 10x → JALANKAN COOLDOWN 1 JAM
                    longCooldownCount++;
                    console.error(LOG_PREFIX + ` 🛑 KEDUA ENDPOINT RATE LIMIT 10x BERTURUT-TURUT! Memulai COOLDOWN PANJANG (1 JAM)...`, LOG_ERR);

                    if (longCooldownCount >= 2) {
                        console.error(LOG_PREFIX + ` ⛔ BATAS LIMIT HARIAN BPS TERCAPAI (2x Long Cooldown berturut-turut)! Menghentikan bot sepenuhnya...`, LOG_ERR);
                        isAborted = true;
                        document.title = '⛔ LIMIT HARIAN TERCAPAI - Bot Terhenti';
                        alert('⚠️ LIMIT HARIAN BPS TERCAPAI!\n\nBot mendeteksi Rate Limit ganda pada kedua endpoint.\nBot dihentikan secara aman.');
                        return;
                    }

                    document.title = '⏳ COOLDOWN 1 JAM - Bot Menunggu';
                    const resumeTime = new Date(Date.now() + ONE_HOUR_MS).toLocaleTimeString('id-ID');
                    console.warn(LOG_PREFIX + ` Bot akan tidur selama 1 jam sampai pkl ${resumeTime}.`, LOG_WARN);

                    await sleep(ONE_HOUR_MS);

                    consecutiveRateLimits = 0;
                    // Kembali coba Endpoint Progress setelah 1 jam
                    activeEndpointKey = 'PROGRESS';
                    activeEndpointUrl = ENDPOINTS.PROGRESS;
                    document.title = `Bot Capaian — ${TODAY}`;
                    console.log(LOG_PREFIX + ' ⏰ Cooldown 1 jam selesai. Kembali mencoba Endpoint PROGRESS...', LOG_OK);
                    return;
                }

                const retryDelay = 12000 + Math.random() * 6000;
                console.warn(LOG_PREFIX + ` ⚠️ Rate Limit ke-${consecutiveRateLimits}/10 [${activeEndpointKey}] pada SLS ${kode_sls}! Cooling down ${Math.round(retryDelay / 1000)}s...`, LOG_WARN);
                await sleep(retryDelay);
                return;
            }

            consecutiveRateLimits = 0;

            if (isSessionExpired(res, rawText)) {
                console.error(LOG_PREFIX + ' ⚠️ Sesi login habis! Stopping bot...', LOG_ERR);
                isAborted = true;
                await releaseItem(kode_sls);
                document.title = '⚠️ HARAP LOGIN KEMBALI - Bot Terhenti';
                alert('Sesi login FASIH-SM habis!\n\nAntrian dikembalikan. Silakan login ulang dan jalankan kembali bot.');
                return;
            }

            let responseData;
            try {
                responseData = JSON.parse(rawText);
            } catch {
                console.warn(LOG_PREFIX + ` [W${workerId}] Response non-JSON untuk SLS ${kode_sls}. Skip.`, LOG_WARN);
                await markSlsError(kode_sls);
                totalSlsError++;
                return;
            }

            if (!Array.isArray(responseData)) {
                console.warn(LOG_PREFIX + ` [W${workerId}] Response bukan array untuk SLS ${kode_sls}:`, LOG_WARN, responseData);
                await markSlsError(kode_sls);
                totalSlsError++;
                return;
            }

            if (responseData.length === 0) {
                await db.rpc('fasih_save_capaian', { p_date: TODAY, p_kode_sls: kode_sls, p_rows: [] });
                totalSlsDone++;
                return;
            }

            const rpcRows = [];
            for (const subItem of responseData) {
                const kodeSubSls = subItem.label;
                if (!kodeSubSls) continue;
                const parsedValues = parseCapaianValues(subItem.values || [], currentMode);
                rpcRows.push({
                    kode_sub_sls: kodeSubSls,
                    ...parsedValues
                });
            }

            const { data: savedCount, error: saveErr } = await db.rpc('fasih_save_capaian', {
                p_date: TODAY,
                p_kode_sls: kode_sls,
                p_rows: rpcRows
            });

            if (saveErr) {
                console.error(LOG_PREFIX + ` [W${workerId}] Gagal save SLS ${kode_sls}:`, LOG_ERR, saveErr);
                await markSlsError(kode_sls);
                totalSlsError++;
            } else {
                totalSubSlsProcessed += savedCount ?? rpcRows.length;
                totalSlsDone++;
                console.log(LOG_PREFIX + ` [W${workerId}] ✅ SLS ${kode_sls} [${currentMode}]: ${rpcRows.length} sub-SLS tersimpan. Total: ${totalSlsDone}`, LOG_OK);
            }

        } catch (fetchErr) {
            console.error(LOG_PREFIX + ` [W${workerId}] Connection error SLS ${kode_sls}:`, LOG_ERR, fetchErr);
            await releaseItem(kode_sls);
            totalSlsError++;
        }
    }

    // ──────────────────────────────────────────────────────
    // MAIN PARALLEL LOOP
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ` Memulai loop scraping paralel (${CONCURRENCY} workers)...`, LOG_INFO);

    while (!isAborted) {
        const { data: claimedBatch, error: claimErr } = await db.rpc('fasih_claim_scrape_queue', {
            p_limit: BATCH_SIZE,
            p_date: TODAY
        });

        if (claimErr) {
            console.error(LOG_PREFIX + ' Error claim queue:', LOG_ERR, claimErr);
            await sleep(5000);
            continue;
        }

        if (!claimedBatch || claimedBatch.length === 0) {
            console.log(LOG_PREFIX + ' ✅ Queue kosong! Semua SLS sudah diproses.', LOG_OK);
            console.log(LOG_PREFIX + ` Ringkasan: ${totalSlsDone} SLS sukses, ${totalSlsError} SLS error, ${totalSubSlsProcessed} sub-SLS di-upsert.`, LOG_OK);
            break;
        }

        console.log(LOG_PREFIX + ` Klaim batch ${claimedBatch.length} SLS berhasil. Menjalankan ${CONCURRENCY} worker...`, LOG_INFO);

        // Eksekusi batch dengan Concurrency Worker Pool
        for (let i = 0; i < claimedBatch.length; i += CONCURRENCY) {
            if (isAborted) {
                // Kembalikan sisa batch jika bot di-abort
                for (const rem of claimedBatch.slice(i)) {
                    await releaseItem(rem.kode_sls);
                }
                break;
            }

            const chunk = claimedBatch.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map((item, idx) => processSingleSls(item, idx + 1)));
        }

        if (!isAborted) {
            const batchDelay = 1000 + Math.random() * 1500;
            await sleep(batchDelay);
        }
    }

    if (isAborted) {
        printProgressSummary('TERHENTI / ABORTED');
    } else {
        console.log(LOG_PREFIX + ' 🎉 Bot Capaian selesai!', LOG_OK);
        printProgressSummary('SELESAI (100%)');
        document.title = `✅ Bot Capaian Selesai — ${TODAY}`;
    }
})();


