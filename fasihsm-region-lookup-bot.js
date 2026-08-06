/**
 * fasihsm-region-lookup-bot.js
 * ============================================================
 * BOT FASE 1 — Region Lookup & Queue Builder (Multi-Device Safe)
 * ============================================================
 * Jalankan di browser console saat sudah login di fasih-sm.bps.go.id
 *
 * Alur:
 *  [Fase 1] Satu kali: hit /region/level3 → UPDATE wilayah_kec.fasih_region_id
 *  [Fase 2] Per kecamatan: hit /region/level4 → UPDATE wilayah_desa.fasih_region_id
 *  [Fase 3] MULTI-DEVICE: Claim desa → hit /region/level5 → UPDATE wilayah_sls.fasih_region_id
 *             (setiap desa hanya dikerjakan oleh satu device)
 *  [Fase 4] Otomatis setelah semua desa selesai: build fasih_scrape_queue
 *
 * Multi-device:
 *  - Fase 1 & 2: cepat (~28 kec), device pertama selesai duluan, device lain skip otomatis
 *  - Fase 3: menggunakan sistem claim (FOR UPDATE SKIP LOCKED) — aman dijalankan paralel
 *  - Fase 4: setiap device cek apakah masih ada desa yang belum selesai; yang terakhir build queue
 *
 * Untuk restart dari awal: SELECT fasih_reset_desa_lookup(); di Supabase SQL Editor
 * ============================================================
 */

(async () => {
    const LOG_PREFIX = '%c[Bot Region Lookup]';
    const LOG_OK     = 'color: #10b981; font-weight: bold;';
    const LOG_INFO   = 'color: #3b82f6; font-weight: bold;';
    const LOG_WARN   = 'color: #f59e0b; font-weight: bold;';
    const LOG_ERR    = 'color: #ef4444; font-weight: bold;';

    console.log(LOG_PREFIX + ' Memulai Bot Region Lookup (Multi-Device)...', LOG_INFO);

    // ──────────────────────────────────────────────────────
    // KONSTANTA
    // ──────────────────────────────────────────────────────
    const SUPABASE_URL     = 'https://vpbhqemomsewrnrggbmd.supabase.co';
    const SUPABASE_KEY     = 'sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3';
    const GROUP_ID         = 'a45adac1-e711-4c15-b3f9-1f30fc151565';
    const LEVEL2_FULL_CODE = '3602';  // Kabupaten Lebak
    const FASIH_BASE       = 'https://fasih-sm.bps.go.id/app/api/region/api/v1/region';

    const CLAIM_BATCH  = 10;   // Jumlah desa per claim (Fase 3)
    const DELAY_MIN    = 300;  // ms
    const DELAY_MAX    = 1200; // ms

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

    async function fetchFasihRegion(url) {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
        const json = await res.json();
        if (!json.success) throw new Error(`FASIH error: ${json.message}`);
        return json.data || [];
    }

    // ──────────────────────────────────────────────────────
    // FASE 1: Kecamatan (Level 3)
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' [Fase 1] Mengambil & mencocokkan kecamatan...', LOG_INFO);

    const { data: kecList, error: kecErr } = await db
        .from('wilayah_kec')
        .select('kode_kec, nmkec, fasih_region_id')
        .order('kode_kec');

    if (kecErr) { console.error(LOG_PREFIX + ' Gagal ambil wilayah_kec:', LOG_ERR, kecErr); return; }
    console.log(LOG_PREFIX + ` Ditemukan ${kecList.length} kecamatan di Supabase.`, LOG_OK);

    // Cek apakah semua kec sudah punya fasih_region_id
    const kecSudahLengkap = kecList.every(k => k.fasih_region_id);
    if (kecSudahLengkap) {
        console.log(LOG_PREFIX + ' [Fase 1] Semua kecamatan sudah punya fasih_region_id. Skip fetch FASIH.', LOG_INFO);
    } else {
        let fasihKecList = [];
        try {
            fasihKecList = await fetchFasihRegion(
                `${FASIH_BASE}/level3?groupId=${GROUP_ID}&level2FullCode=${LEVEL2_FULL_CODE}`
            );
            console.log(LOG_PREFIX + ` FASIH level3: ${fasihKecList.length} kecamatan.`, LOG_OK);
        } catch (e) {
            console.error(LOG_PREFIX + ' Gagal fetch level3:', LOG_ERR, e);
            return;
        }

        const fasihKecMap = {};
        for (const item of fasihKecList) fasihKecMap[item.fullCode] = item.id;

        let kecUpdated = 0;
        for (const kec of kecList) {
            if (kec.fasih_region_id) continue; // sudah ada, skip
            const fasihId = fasihKecMap[kec.kode_kec];
            if (!fasihId) { console.warn(LOG_PREFIX + ` Tidak match: kec ${kec.kode_kec}`, LOG_WARN); continue; }
            const { error } = await db.from('wilayah_kec').update({ fasih_region_id: fasihId }).eq('kode_kec', kec.kode_kec);
            if (!error) { kec.fasih_region_id = fasihId; kecUpdated++; }
        }
        console.log(LOG_PREFIX + ` [Fase 1] Selesai. ${kecUpdated} kecamatan di-update.`, LOG_OK);
    }

    // Buat map lokal kode_kec → fasih_region_id untuk dipakai di fase berikutnya
    const kecFasihMap = {};
    for (const k of kecList) if (k.fasih_region_id) kecFasihMap[k.kode_kec] = k.fasih_region_id;

    // ──────────────────────────────────────────────────────
    // FASE 2: Desa (Level 4) per Kecamatan
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' [Fase 2] Mengambil & mencocokkan desa per kecamatan...', LOG_INFO);

    const { data: desaListAll, error: desaErr } = await db
        .from('wilayah_desa')
        .select('kode_desa, kode_kec, nmdesa, fasih_region_id, lookup_status')
        .order('kode_desa');

    if (desaErr) { console.error(LOG_PREFIX + ' Gagal ambil wilayah_desa:', LOG_ERR, desaErr); return; }

    const desaSudahLengkap = desaListAll.every(d => d.fasih_region_id);
    if (desaSudahLengkap) {
        console.log(LOG_PREFIX + ' [Fase 2] Semua desa sudah punya fasih_region_id. Skip fetch FASIH.', LOG_INFO);
    } else {
        // Kelompokkan desa yang belum punya fasih_region_id per kecamatan
        const desaBelumByKec = {};
        for (const d of desaListAll) {
            if (d.fasih_region_id) continue;
            if (!desaBelumByKec[d.kode_kec]) desaBelumByKec[d.kode_kec] = [];
            desaBelumByKec[d.kode_kec].push(d);
        }

        let totalDesaUpdated = 0;
        for (const kec of kecList) {
            const desaBelum = desaBelumByKec[kec.kode_kec];
            if (!desaBelum || desaBelum.length === 0) continue; // semua desa di kec ini sudah punya id
            if (!kec.fasih_region_id) { console.warn(LOG_PREFIX + ` Skip kec ${kec.kode_kec} — tidak ada fasih_region_id`, LOG_WARN); continue; }

            await randomDelay();

            let fasihDesaList = [];
            try {
                fasihDesaList = await fetchFasihRegion(
                    `${FASIH_BASE}/level4?groupId=${GROUP_ID}&level3FullCode=${kec.kode_kec}`
                );
            } catch (e) {
                console.warn(LOG_PREFIX + ` Gagal fetch level4 kec ${kec.kode_kec}:`, LOG_WARN, e);
                continue;
            }

            const fasihDesaMap = {};
            for (const item of fasihDesaList) fasihDesaMap[item.fullCode] = item.id;

            let desaUpdated = 0;
            for (const desa of desaBelum) {
                const fasihId = fasihDesaMap[desa.kode_desa];
                if (!fasihId) { console.warn(LOG_PREFIX + ` Tidak match: desa ${desa.kode_desa}`, LOG_WARN); continue; }
                const { error } = await db.from('wilayah_desa').update({ fasih_region_id: fasihId }).eq('kode_desa', desa.kode_desa);
                if (!error) { desa.fasih_region_id = fasihId; desaUpdated++; totalDesaUpdated++; }
            }
            if (desaUpdated > 0) console.log(LOG_PREFIX + ` Kec ${kec.nmkec}: ${desaUpdated} desa di-update.`, LOG_OK);
        }
        console.log(LOG_PREFIX + ` [Fase 2] Selesai. ${totalDesaUpdated} desa di-update.`, LOG_OK);
    }

    // Refresh desa list (pastikan fasih_region_id terbaru)
    const { data: desaList } = await db
        .from('wilayah_desa')
        .select('kode_desa, kode_kec, nmdesa, fasih_region_id, lookup_status')
        .not('fasih_region_id', 'is', null)
        .order('kode_desa');

    if (!desaList || desaList.length === 0) {
        console.error(LOG_PREFIX + ' Tidak ada desa dengan fasih_region_id! Pastikan Fase 2 berhasil.', LOG_ERR);
        return;
    }
    console.log(LOG_PREFIX + ` ${desaList.length} desa siap untuk Fase 3.`, LOG_OK);

    // ──────────────────────────────────────────────────────
    // FASE 3: SLS (Level 5) per Desa — MULTI-DEVICE SAFE
    // Menggunakan sistem claim (fasih_claim_desa_lookup RPC)
    // Setiap device claim batch desa → proses → mark done
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' [Fase 3] Mulai claim desa untuk lookup SLS (multi-device)...', LOG_INFO);

    let fase3Total = 0;

    while (true) {
        // Claim batch desa dari database (FOR UPDATE SKIP LOCKED)
        const { data: claimedDesa, error: claimErr } = await db.rpc('fasih_claim_desa_lookup', {
            p_limit: CLAIM_BATCH
        });

        if (claimErr) {
            console.error(LOG_PREFIX + ' Error claim desa:', LOG_ERR, claimErr);
            await sleep(3000);
            continue;
        }

        if (!claimedDesa || claimedDesa.length === 0) {
            console.log(LOG_PREFIX + ' [Fase 3] Tidak ada desa tersisa untuk diklaim. Selesai!', LOG_OK);
            break;
        }

        console.log(LOG_PREFIX + ` Klaim ${claimedDesa.length} desa berhasil.`, LOG_INFO);

        for (const desa of claimedDesa) {
            await randomDelay();

            let fasihSlsList = [];
            try {
                fasihSlsList = await fetchFasihRegion(
                    `${FASIH_BASE}/level5?groupId=${GROUP_ID}&level4FullCode=${desa.kode_desa}`
                );
            } catch (e) {
                console.warn(LOG_PREFIX + ` Gagal fetch level5 desa ${desa.kode_desa}:`, LOG_WARN, e);
                // Lepas klaim agar bisa di-retry device lain
                await db.from('wilayah_desa')
                    .update({ lookup_status: 'pending', lookup_claimed_at: null })
                    .eq('kode_desa', desa.kode_desa);
                continue;
            }

            // Map fullCode SLS (14 digit) → fasih UUID
            const fasihSlsMap = {};
            for (const item of fasihSlsList) fasihSlsMap[item.fullCode] = item.id;

            // Ambil SLS dari Supabase untuk desa ini
            const { data: slsUntukDesa } = await db
                .from('wilayah_sls')
                .select('kode_sls, fasih_region_id')
                .eq('kode_desa', desa.kode_desa);

            let slsUpdated = 0;
            for (const sls of (slsUntukDesa || [])) {
                const fasihId = fasihSlsMap[sls.kode_sls];
                if (!fasihId) continue;
                if (sls.fasih_region_id === fasihId) { slsUpdated++; continue; } // sudah benar
                const { error } = await db
                    .from('wilayah_sls')
                    .update({ fasih_region_id: fasihId })
                    .eq('kode_sls', sls.kode_sls);
                if (!error) slsUpdated++;
            }

            // Mark desa sebagai done
            await db.from('wilayah_desa')
                .update({ lookup_status: 'done' })
                .eq('kode_desa', desa.kode_desa);

            fase3Total += slsUpdated;
            console.log(LOG_PREFIX + ` ✅ Desa ${desa.kode_desa}: ${slsUpdated} SLS di-update.`, LOG_OK);
        }

        // Jeda antar-batch
        const batchDelay = 1000 + Math.random() * 2000;
        console.log(LOG_PREFIX + ` Jeda ${Math.round(batchDelay / 1000)}s sebelum batch berikutnya...`, 'color:#6b7280; font-style:italic;');
        await sleep(batchDelay);
    }

    console.log(LOG_PREFIX + ` [Fase 3] Selesai. Total ${fase3Total} SLS di-update.`, LOG_OK);

    // ──────────────────────────────────────────────────────
    // FASE 4: Build fasih_scrape_queue
    // Hanya dijalankan jika tidak ada lagi desa yang pending/claimed
    // (device terakhir yang selesai akan menjalankan fase ini)
    // ──────────────────────────────────────────────────────
    console.log(LOG_PREFIX + ' [Fase 4] Mengecek apakah semua desa sudah selesai...', LOG_INFO);

    const { count: sisaDesa } = await db
        .from('wilayah_desa')
        .select('kode_desa', { count: 'exact', head: true })
        .in('lookup_status', ['pending', 'claimed']);

    if (sisaDesa && sisaDesa > 0) {
        console.log(LOG_PREFIX + ` Masih ada ${sisaDesa} desa yang belum selesai di device lain. Fase 4 akan dijalankan oleh device yang terakhir selesai.`, LOG_WARN);
        console.log(LOG_PREFIX + ' Bot selesai di device ini. ✅', LOG_OK);
        return;
    }

    console.log(LOG_PREFIX + ' Semua desa selesai! Membangun fasih_scrape_queue...', LOG_INFO);

    // Ambil semua SLS yang sudah punya fasih_region_id beserta desa & kec-nya
    const { data: slsAll, error: slsAllErr } = await db
        .from('wilayah_sls')
        .select(`
            kode_sls,
            fasih_region_id,
            kode_desa,
            wilayah_desa!inner(fasih_region_id, kode_kec,
                wilayah_kec!inner(fasih_region_id)
            )
        `)
        .not('fasih_region_id', 'is', null);

    if (slsAllErr) {
        console.error(LOG_PREFIX + ' Gagal ambil SLS untuk build queue:', LOG_ERR, slsAllErr);
        return;
    }

    const queuePayload = [];
    for (const sls of (slsAll || [])) {
        const fasihDesaId = sls.wilayah_desa?.fasih_region_id;
        const fasihKecId  = sls.wilayah_desa?.wilayah_kec?.fasih_region_id;
        if (!fasihDesaId || !fasihKecId) continue;
        queuePayload.push({
            kode_sls:      sls.kode_sls,
            fasih_sls_id:  sls.fasih_region_id,
            fasih_desa_id: fasihDesaId,
            fasih_kec_id:  fasihKecId,
            status:        'pending'
        });
    }

    // Upsert dalam batch 500
    const UPSERT_BATCH = 500;
    let queueInserted = 0;
    for (let i = 0; i < queuePayload.length; i += UPSERT_BATCH) {
        const batch = queuePayload.slice(i, i + UPSERT_BATCH);
        const { error } = await db
            .from('fasih_scrape_queue')
            .upsert(batch, { onConflict: 'kode_sls', ignoreDuplicates: false });
        if (error) console.error(LOG_PREFIX + ` Gagal upsert queue batch ${i}:`, LOG_ERR, error);
        else queueInserted += batch.length;
    }

    console.log(LOG_PREFIX + ` [Fase 4] Selesai. ${queueInserted} SLS di-upsert ke fasih_scrape_queue.`, LOG_OK);
    console.log(LOG_PREFIX + ' 🎉 SEMUA FASE SELESAI! Sekarang jalankan fasihsm-capaian-bot.js.', LOG_OK);
    document.title = '✅ Region Lookup Selesai';

    console.table({
        'Total Kecamatan'     : kecList.length,
        'Total Desa Diproses' : fase3Total > 0 ? 'Ya' : 'Skip (sudah ada)',
        'Total SLS (queue)'   : queueInserted
    });
})();
