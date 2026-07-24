(async () => {
    console.log("%c[Bot Sync Reject] Memulai bot dengan mitigasi Status Sudah Rejected...", "color: #10b981; font-weight: bold; font-size: 1.2rem;");

    // 1. Load Supabase
    if (typeof supabase === 'undefined') {
        console.log("[Bot Sync Reject] Memuat library Supabase...");
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        document.head.appendChild(script);
        await new Promise(r => script.onload = r);
    }

    const SUPABASE_URL = "https://vpbhqemomsewrnrggbmd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3";
    const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // 2. Fungsi Deteksi CSRF
    function getCsrfToken() {
        let token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
            document.querySelector('meta[name="csrf"]')?.getAttribute('content');
        if (token) return { token, header: 'X-CSRF-TOKEN' };

        const xsrfCookie = document.cookie.split('; ').find(row => row.startsWith('XSRF-TOKEN=') || row.startsWith('xsrf-token='));
        if (xsrfCookie) {
            return { token: decodeURIComponent(xsrfCookie.split('=')[1]), header: 'X-XSRF-TOKEN' };
        }
        return null;
    }

    // Helper delay
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    console.log("%c[Bot Sync Reject] Bot aktif dan memantau antrean database dengan interval dinamis/acak!", "color: #3b82f6; font-weight: bold;");

    // 3. Perulangan Sync
    async function syncRejections() {
        try {
            const { data: claimedRows, error } = await db.rpc('claim_and_fetch_rejections', { p_limit: 50 });

            if (error) throw error;
            if (!claimedRows || claimedRows.length === 0) return;

            const claimedIds = claimedRows.map(r => r.assignment_id);
            console.log(`%c[Bot Sync Reject] Berhasil mengklaim ${claimedIds.length} antrean...`, "color: #f59e0b;");

            const csrf = getCsrfToken();
            const headers = { 'Content-Type': 'application/json' };
            if (csrf) {
                headers[csrf.header] = csrf.token;
                headers['X-CSRF-TOKEN'] = csrf.token;
            }

            let processedIndex = 0;

            for (const assignmentId of claimedIds) {
                // Berikan jeda acak sebelum setiap request agar menyerupai tindakan manusia (0.5s - 3s)
                const loopDelay = 500 + Math.random() * 2500;
                console.log(`[Bot Sync Reject] Menunggu ${Math.round(loopDelay) / 1000} detik sebelum memproses ID: ${assignmentId}`);
                await sleep(loopDelay);

                console.log(`[Bot Sync Reject] Mengirim POST Reject untuk ID: ${assignmentId}`);

                try {
                    const response = await fetch('https://fasih-sm.bps.go.id/app/api/assignment-approval/api/v2/approval', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            assignmentId: assignmentId,
                            statusApproval: "false",
                            comment: JSON.stringify({ dataKey: "", notes: [] })
                        })
                    });

                    // --- MITIGASI JIKA STATUS HTTP ADALAH LOGOUT ---
                    if (response.status === 401 || response.status === 403 || response.url.includes('/login')) {
                        console.error("%c[Bot Sync Reject] Sesi login habis! Mengembalikan antrean tersisa...", "color: #ef4444; font-weight: bold;");
                        const remainingIds = claimedIds.slice(processedIndex);
                        for (const remId of remainingIds) {
                            await db.rpc('release_assignment_sync', { p_assignment_id: remId });
                        }
                        document.title = "⚠️ HARAP LOGIN KEMBALI - Bot Terhenti";
                        alert("Sesi login Fasih-SM Anda habis!\n\nSemua antrean tersisa telah dikembalikan secara aman ke database. Silakan login ulang dan jalankan kembali bot.");
                        return;
                    }

                    if (response.ok) {
                        const contentType = response.headers.get('content-type') || '';
                        let isActuallySuccess = false;

                        if (contentType.includes('application/json')) {
                            const resJson = await response.json();
                            console.log(`[Bot Sync Reject] Respon JSON dari BPS:`, resJson);

                            // Deteksi jika respon adalah pesan error "Sudah Rejected" atau status assignment tidak mendukung/terlewati
                            const isAlreadyRejected = resJson.message && (
                                resJson.message.toUpperCase().includes('REJECTED') ||
                                resJson.message.toUpperCase().includes('DRAFT') ||
                                resJson.message.toUpperCase().includes('REVOKED BY PENGAWAS') ||
                                resJson.message.toUpperCase().includes('SUBMITTED BY PENCACAH')
                            );

                            isActuallySuccess = (resJson.success !== false &&
                                resJson.status !== 'error' &&
                                resJson.status !== 'fail' &&
                                resJson.code !== 400 &&
                                resJson.code !== 500) || isAlreadyRejected;
                        } else {
                            const text = await response.text();
                            console.warn(`[Bot Sync Reject] Respon non-JSON diterima.`);

                            if (text.includes('login') || text.includes('username') || text.includes('password') || text.includes('form')) {
                                console.error("%c[Bot Sync Reject] Halaman login terdeteksi. Sesi habis!", "color: #ef4444; font-weight: bold;");
                                const remainingIds = claimedIds.slice(processedIndex);
                                for (const remId of remainingIds) {
                                    await db.rpc('release_assignment_sync', { p_assignment_id: remId });
                                }
                                document.title = "⚠️ HARAP LOGIN KEMBALI - Bot Terhenti";
                                alert("Sesi login Fasih-SM Anda habis / Terlogout!\n\nSilakan login kembali di tab ini, segarkan halaman (F5), dan jalankan ulang script bot.");
                                return;
                            }
                        }

                        if (isActuallySuccess) {
                            console.log(`%c[Bot Sync Reject] SUKSES/DONE untuk ID: ${assignmentId} (Tersinkronisasi)`, "color: #10b981;");
                        } else {
                            console.warn(`%c[Bot Sync Reject] GAGAL di server BPS untuk ID: ${assignmentId}. Melepas klaim...`, "color: #ef4444;");
                            await db.rpc('release_assignment_sync', { p_assignment_id: assignmentId });
                        }
                    } else {
                        const errText = await response.text();
                        console.error(`[Bot Sync Reject] HTTP Error ${response.status}. Melepas klaim ID: ${assignmentId}. Response:`, errText);
                        await db.rpc('release_assignment_sync', { p_assignment_id: assignmentId });
                    }
                } catch (fetchErr) {
                    console.error(`[Bot Sync Reject] Error koneksi saat reject ID: ${assignmentId}. Melepas klaim...`, fetchErr);
                    await db.rpc('release_assignment_sync', { p_assignment_id: assignmentId });
                }

                processedIndex++;
            }
        } catch (err) {
            console.error('[Bot Sync Reject] Error dalam perulangan sync:', err);
        }
    }

    // Perulangan dinamis dengan jeda acak setelah setiap eksekusi
    async function startDynamicSync() {
        await syncRejections();
        // Berikan jeda acak antar-siklus pemeriksaan (misalnya 5 sampai 15 detik)
        const nextCheckDelay = 5000 + Math.random() * 10000;
        console.log(`%c[Bot Sync Reject] Pemeriksaan berikutnya dalam ${Math.round(nextCheckDelay / 1000)} detik...`, "color: #6b7280; font-style: italic;");
        setTimeout(startDynamicSync, nextCheckDelay);
    }

    startDynamicSync();
})();
