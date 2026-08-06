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
    const LOG_OK     = 'color: #10b981; font-weight: bold;';
    const LOG_INFO   = 'color: #3b82f6; font-weight: bold;';
    const LOG_WARN   = 'color: #f59e0b; font-weight: bold;';
    const LOG_ERR    = 'color: #ef4444; font-weight: bold;';

    console.log(LOG_PREFIX + ' Memulai Bot Capaian Harian...', LOG_INFO);

    // ──────────────────────────────────────────────────────
    // KONSTANTA
    // ──────────────────────────────────────────────────────
    const SUPABASE_URL     = 'https://vpbhqemomsewrnrggbmd.supabase.co';
    const SUPABASE_KEY     = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';
    const SURVEY_PERIOD_ID = 'fd68e454-ba45-4b85-8205-f3bf777ded24';
    const REGION1_ID       = '3d7e1f4e-5445-4770-8dc2-1f69697901b2'; // Prov Banten
    const REGION2_ID       = '6ded025d-0c3a-40b9-b274-ae6f1e748b44'; // Kab Lebak
    const FASIH_CAPAIAN_URL = 'https://fasih-sm.bps.go.id/app/api/analytic/api/v2/assignment/report-progress-assignment';

    const BATCH_SIZE  = 20;   // SLS per claim (jangan terlalu besar)
    const DELAY_MIN   = 800;  // ms minimum delay antar SLS
    const DELAY_MAX   = 2500; // ms maksimum delay
    const UPSERT_CHUNK = 100; // sub-SLS per upsert batch

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
        // Gunakan zona waktu lokal (WIB)
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

    function parseCapaianValues(values) {
        const result = { total: 0, open: 0, approved_pengawas: 0 };
        for (const v of values) {
            const lbl = (v.label || '').toUpperCase().trim();
            if (lbl === 'TOTAL') result.total = v.value ?? 0;
            else if (lbl === 'OPEN') result.open = v.value ?? 0;
            else if (lbl.includes('APPROVED')) result.approved_pengawas = v.value ?? 0;
        }
        return result;
    }

    function isSessionExpired(res, text) {
        if (res.status === 401 || res.status === 403) return true;
        if (res.url && res.url.includes('/login')) return true;
        if (text && (text.includes('login') || text.includes('username')) && !text.includes('{')) return true;
        return false;
    }

    async function releaseItem(kodeSls) {
        await db
            .from('fasih_scrape_queue')
            .update({ status: 'pending', claimed_at: null })
            .eq('kode_sls', kodeSls);
    }

    // ──────────────────────────────────────────────────────
    // INIT
    // ──────────────────────────────────────────────────────
    const TODAY = getTodayDate();
    console.log(LOG_PREFIX + ` Tanggal scraping: ${TODAY}`, LOG_INFO);

    // ──────────────────────────────────────────────────────
    // AUTO-DETECT HARI BARU → Reset queue otomatis
    // Cek scrape_date terakhir di queue. Jika berbeda dari
    // TODAY, berarti ini hari baru → reset queue.
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' Mengecek tanggal scraping terakhir di queue...', LOG_INFO);
    const { data: lastDoneRow } = await db
        .from('fasih_scrape_queue')
        .select('scrape_date')
        .not('scrape_date', 'is', null)
        .order('scrape_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    const lastScrapeDate = lastDoneRow?.scrape_date
        ? String(lastDoneRow.scrape_date).substring(0, 10)  // ambil YYYY-MM-DD saja
        : null;

    if (!lastScrapeDate) {
        // Queue belum pernah dijalankan sama sekali — langsung mulai
        console.log(LOG_PREFIX + ' Queue belum pernah dijalankan. Mulai dari awal.', LOG_INFO);
    } else if (lastScrapeDate === TODAY) {
        // Hari yang sama — lanjut dari sisa queue (resume mode)
        console.log(LOG_PREFIX + ` Resume: queue sudah pernah berjalan hari ini (${TODAY}). Melanjutkan sisa...`, LOG_INFO);
    } else {
        // Hari berbeda — ini hari baru, reset queue
        console.log(LOG_PREFIX + ` Hari baru terdeteksi! Terakhir: ${lastScrapeDate} → Sekarang: ${TODAY}`, LOG_WARN);
        console.log(LOG_PREFIX + ' Auto-reset queue untuk hari baru...', LOG_WARN);
        const { error: resetErr } = await db.rpc('fasih_reset_scrape_queue');
        if (resetErr) {
            console.error(LOG_PREFIX + ' Gagal reset queue:', LOG_ERR, resetErr);
            return;
        }
        console.log(LOG_PREFIX + ' ✅ Queue berhasil di-reset. Siap scraping hari baru!', LOG_OK);
    }

    // Pastikan kolom tanggal sudah ada di fasih_capaian_harian
    console.log(LOG_PREFIX + ` Memastikan kolom "${TODAY}" ada di fasih_capaian_harian...`, LOG_INFO);
    const { error: colErr } = await db.rpc('fasih_add_date_column', { p_date: TODAY });
    if (colErr) {
        console.error(LOG_PREFIX + ' Gagal menambah kolom tanggal:', LOG_ERR, colErr);
        return;
    }
    console.log(LOG_PREFIX + ` Kolom "${TODAY}" siap.`, LOG_OK);

    const headers = buildHeaders();
    let totalSubSlsProcessed = 0;
    let totalSlsDone = 0;
    let totalSlsError = 0;

    // ──────────────────────────────────────────────────────
    // MAIN LOOP
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' Memulai loop scraping...', LOG_INFO);

    while (true) {
        // Claim batch SLS dari queue
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

        console.log(LOG_PREFIX + ` Klaim ${claimedBatch.length} SLS berhasil.`, LOG_INFO);

        for (let idx = 0; idx < claimedBatch.length; idx++) {
            const item = claimedBatch[idx];
            const { kode_sls, fasih_sls_id, fasih_desa_id, fasih_kec_id } = item;

            const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
            console.log(LOG_PREFIX + ` [${totalSlsDone + totalSlsError + 1}] Menunggu ${Math.round(delay)}ms sebelum scrape SLS ${kode_sls}...`, 'color:#6b7280;');
            await sleep(delay);

            // Build payload
            const payload = {
                assignmentErrorStatusType: -1,
                assignmentStatusAlias:     null,
                currentUserId:             null,
                data1: null, data2: null, data3: null, data4: null,
                data5: null, data6: null, data7: null, data8: null,
                data9: null, data10: null,
                region1Id:       REGION1_ID,
                region2Id:       REGION2_ID,
                region3Id:       fasih_kec_id,
                region4Id:       fasih_desa_id,
                region5Id:       fasih_sls_id,
                regionId:        null,
                surveyPeriodId:  SURVEY_PERIOD_ID,
                userIdResponsibility: null
            };

            try {
                const res = await fetch(FASIH_CAPAIAN_URL, {
                    method:  'POST',
                    headers: headers,
                    body:    JSON.stringify(payload)
                });

                const rawText = await res.text();

                // Deteksi sesi habis
                if (isSessionExpired(res, rawText)) {
                    console.error(LOG_PREFIX + ' ⚠️ Sesi login habis! Mengembalikan semua item yang tersisa...', LOG_ERR);
                    // Kembalikan semua yang masih claimed
                    for (const rem of claimedBatch.slice(idx)) {
                        await releaseItem(rem.kode_sls);
                    }
                    document.title = '⚠️ HARAP LOGIN KEMBALI - Bot Capaian Terhenti';
                    alert('Sesi login FASIH-SM habis!\n\nSemua antrian yang tersisa sudah dikembalikan. Silakan login ulang dan jalankan kembali bot.');
                    return;
                }

                let responseData;
                try {
                    responseData = JSON.parse(rawText);
                } catch {
                    console.warn(LOG_PREFIX + ` Response non-JSON untuk SLS ${kode_sls}. Skip.`, LOG_WARN);
                    await db.from('fasih_scrape_queue').update({ status: 'error' }).eq('kode_sls', kode_sls);
                    totalSlsError++;
                    continue;
                }

                // Response adalah array sub-SLS
                if (!Array.isArray(responseData)) {
                    console.warn(LOG_PREFIX + ` Response bukan array untuk SLS ${kode_sls}:`, LOG_WARN, responseData);
                    await db.from('fasih_scrape_queue').update({ status: 'error' }).eq('kode_sls', kode_sls);
                    totalSlsError++;
                    continue;
                }

                if (responseData.length === 0) {
                    console.log(LOG_PREFIX + ` SLS ${kode_sls}: tidak ada sub-SLS di response (array kosong).`, 'color:#6b7280;');
                    await db.from('fasih_scrape_queue').update({ status: 'done', done_at: new Date().toISOString() }).eq('kode_sls', kode_sls);
                    totalSlsDone++;
                    continue;
                }

                // Parse setiap sub-SLS dari response
                const upsertRows = [];
                for (const item of responseData) {
                    const kodeSubSls = item.label; // 16 digit
                    if (!kodeSubSls) continue;
                    const capaianData = parseCapaianValues(item.values || []);
                    upsertRows.push({
                        kode_sub_sls: kodeSubSls,
                        [TODAY]:      capaianData,
                        updated_at:   new Date().toISOString()
                    });
                }

                // Upsert ke fasih_capaian_harian dalam chunk
                let upsertOk = true;
                for (let ci = 0; ci < upsertRows.length; ci += UPSERT_CHUNK) {
                    const chunk = upsertRows.slice(ci, ci + UPSERT_CHUNK);
                    const { error: upsertErr } = await db
                        .from('fasih_capaian_harian')
                        .upsert(chunk, { onConflict: 'kode_sub_sls' });
                    if (upsertErr) {
                        console.error(LOG_PREFIX + ` Gagal upsert chunk SLS ${kode_sls}:`, LOG_ERR, upsertErr);
                        upsertOk = false;
                    }
                }

                if (upsertOk) {
                    totalSubSlsProcessed += upsertRows.length;
                    await db
                        .from('fasih_scrape_queue')
                        .update({ status: 'done', done_at: new Date().toISOString() })
                        .eq('kode_sls', kode_sls);
                    totalSlsDone++;
                    console.log(LOG_PREFIX + ` ✅ SLS ${kode_sls}: ${upsertRows.length} sub-SLS di-upsert.`, LOG_OK);
                } else {
                    await db.from('fasih_scrape_queue').update({ status: 'error' }).eq('kode_sls', kode_sls);
                    totalSlsError++;
                }

            } catch (fetchErr) {
                console.error(LOG_PREFIX + ` Error koneksi SLS ${kode_sls}:`, LOG_ERR, fetchErr);
                await releaseItem(kode_sls);
                totalSlsError++;
            }
        } // end for claimedBatch

        // Jeda antar-batch
        const batchDelay = 2000 + Math.random() * 3000;
        console.log(LOG_PREFIX + ` Jeda ${Math.round(batchDelay / 1000)}s sebelum batch berikutnya...`, 'color:#6b7280; font-style:italic;');
        await sleep(batchDelay);
    }

    console.log(LOG_PREFIX + ' 🎉 Bot Capaian selesai!', LOG_OK);
    document.title = `✅ Bot Capaian Selesai — ${TODAY}`;
})();
