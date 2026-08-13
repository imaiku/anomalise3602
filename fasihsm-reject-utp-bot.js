(async () => {
    console.log("%c[Bot UTP Reject] Memulai bot Reject Anomali UTP...", "color: #10b981; font-weight: bold; font-size: 1.2rem;");

    // ─── 1. Load Supabase ──────────────────────────────────────────────────────
    if (typeof supabase === 'undefined') {
        console.log("[Bot UTP Reject] Memuat library Supabase...");
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        document.head.appendChild(script);
        await new Promise(r => script.onload = r);
    }

    const SUPABASE_URL = "https://vpbhqemomsewrnrggbmd.supabase.co";
    const SUPABASE_KEY = "sb_publishable_si2F2abcWGL6uaq9FueJ0Q_eE5nkol3";
    const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ─── Konstanta ─────────────────────────────────────────────────────────────
    // Batas waktu validasi: 12 Agustus 2026 00:00 WIB = 11 Agustus 2026 17:00 UTC
    const REVOKE_CUTOFF_UTC = new Date('2026-08-11T17:00:00.000Z');

    const HISTORY_API_BASE = 'https://fasih-sm.bps.go.id/app/api/assignment-general/api/assignment-history/get-by-assignment-id';
    const REJECT_API_URL   = 'https://fasih-sm.bps.go.id/app/api/assignment-approval/api/v2/approval';

    // ─── 2. Helper CSRF ───────────────────────────────────────────────────────
    function getCsrfToken() {
        let token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
            document.querySelector('meta[name="_csrf"]')?.getAttribute('content') ||
            document.querySelector('meta[name="csrf"]')?.getAttribute('content');
        if (token) return { token, header: 'X-CSRF-TOKEN' };

        const xsrfCookie = document.cookie.split('; ').find(row =>
            row.startsWith('XSRF-TOKEN=') || row.startsWith('xsrf-token=')
        );
        if (xsrfCookie) {
            return { token: decodeURIComponent(xsrfCookie.split('=')[1]), header: 'X-XSRF-TOKEN' };
        }
        return null;
    }

    // ─── Helper delay ─────────────────────────────────────────────────────────
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ─── Helper format tanggal WIB ────────────────────────────────────────────
    function formatTanggalWIB(isoString) {
        return new Date(isoString).toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
            day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) + ' WIB';
    }

    console.log("%c[Bot UTP Reject] Bot aktif! Memantau antrian 'pending' di database...", "color: #3b82f6; font-weight: bold;");

    // ─── 3. Fungsi Cek History (Pre-Reject Validation) ────────────────────────
    /**
     * Cek apakah assignment sudah pernah "REVOKED BY Pengawas" setelah batas waktu.
     * @returns {{ isRevoked: boolean, tanggal: string|null }}
     */
    async function cekRiwayatRevoke(assignmentId) {
        try {
            const url = `${HISTORY_API_BASE}?assignmentId=${encodeURIComponent(assignmentId)}`;
            const response = await fetch(url, { method: 'GET' });

            if (!response.ok) {
                console.warn(`[Bot UTP Reject] Gagal fetch history untuk ${assignmentId}: HTTP ${response.status}`);
                return { isRevoked: false, tanggal: null };
            }

            const data = await response.json();
            if (!data.success || !Array.isArray(data.data)) {
                return { isRevoked: false, tanggal: null };
            }

            const revokedEntry = data.data.find(h =>
                h.status_alias === 'REVOKED BY Pengawas' &&
                new Date(h.date_created) > REVOKE_CUTOFF_UTC
            );

            if (revokedEntry) {
                return {
                    isRevoked: true,
                    tanggal: formatTanggalWIB(revokedEntry.date_created)
                };
            }

            return { isRevoked: false, tanggal: null };
        } catch (err) {
            console.warn(`[Bot UTP Reject] Error saat fetch history ${assignmentId}:`, err.message);
            return { isRevoked: false, tanggal: null };
        }
    }

    // ─── 4. Fungsi Utama Sync ─────────────────────────────────────────────────
    async function syncUTPRejections() {
        try {
            const { data: claimedRows, error } = await db.rpc('claim_and_fetch_utp_rejections', { p_limit: 20 });

            if (error) throw error;
            if (!claimedRows || claimedRows.length === 0) return;

            console.log(`%c[Bot UTP Reject] Berhasil mengklaim ${claimedRows.length} item antrian...`, "color: #f59e0b; font-weight: bold;");

            const csrf = getCsrfToken();
            const headers = { 'Content-Type': 'application/json' };
            if (csrf) {
                headers[csrf.header] = csrf.token;
                headers['X-CSRF-TOKEN'] = csrf.token;
            }

            let processedIndex = 0;

            for (const row of claimedRows) {
                const assignmentId = row.assignment_id || row.out_assignment_id;

                const loopDelay = 500 + Math.random() * 2000;
                console.log(`[Bot UTP Reject] Menunggu ${Math.round(loopDelay / 1000)}s sebelum proses ID: ${assignmentId}`);
                await sleep(loopDelay);

                try {
                    console.log(`[Bot UTP Reject] Mengecek riwayat history untuk ID: ${assignmentId}`);
                    const historyDelay = 300 + Math.random() * 700;
                    await sleep(historyDelay);

                    const { isRevoked, tanggal } = await cekRiwayatRevoke(assignmentId);

                    if (isRevoked) {
                        const note = `Dilewati: sudah direvoke oleh pengawas pada ${tanggal}`;
                        console.warn(`%c[Bot UTP Reject] SKIPPED (Revoke) ID: ${assignmentId} — ${note}`, "color: #f97316; font-weight: bold;");
                        await db.rpc('update_utp_reject_status', {
                            p_assignment_id: assignmentId,
                            p_status: 'skipped_unapproved',
                            p_note: note
                        });
                        processedIndex++;
                        continue;
                    }

                    console.log(`[Bot UTP Reject] Mengirim POST Reject untuk ID: ${assignmentId}`);

                    const response = await fetch(REJECT_API_URL, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            assignmentId: assignmentId,
                            statusApproval: "false",
                            comment: JSON.stringify({ dataKey: "", notes: [] })
                        })
                    });

                    if (response.status === 401 || response.status === 403 || response.url.includes('/login')) {
                        console.error("%c[Bot UTP Reject] Sesi login habis! Mengembalikan antrean tersisa...", "color: #ef4444; font-weight: bold;");
                        const remainingRows = claimedRows.slice(processedIndex);
                        for (const remRow of remainingRows) {
                            await db.rpc('release_utp_assignment', { p_assignment_id: remRow.assignment_id });
                        }
                        document.title = "⚠️ HARAP LOGIN KEMBALI - Bot UTP Terhenti";
                        alert(
                            "Sesi login Fasih-SM Anda habis!\n\n" +
                            "Semua antrean tersisa telah dikembalikan ke status 'pending'.\n" +
                            "Silakan login ulang lalu jalankan kembali bot."
                        );
                        return;
                    }

                    if (response.ok) {
                        const contentType = response.headers.get('content-type') || '';
                        let isSuccess = false;
                        let failNote = null;

                        if (contentType.includes('application/json')) {
                            const resJson = await response.json();
                            console.log(`[Bot UTP Reject] Response JSON:`, resJson);

                            const msg = (resJson.message || '').toUpperCase();

                            if (msg.includes('REJECTED')) {
                                failNote = `Sudah pernah di-reject sebelumnya (${resJson.message})`;
                            } else if (msg.includes('DRAFT')) {
                                failNote = `Assignment masih berstatus Draft, tidak bisa di-reject (${resJson.message})`;
                            } else if (msg.includes('REVOKED BY PENGAWAS')) {
                                failNote = `Sudah direvoke oleh pengawas (${resJson.message})`;
                            } else if (msg.includes('SUBMITTED BY PENCACAH')) {
                                failNote = `Assignment baru saja di-submit pencacah, belum bisa di-reject (${resJson.message})`;
                            }

                            isSuccess = (
                                resJson.success !== false &&
                                resJson.status !== 'error' &&
                                resJson.status !== 'fail' &&
                                resJson.code !== 400 &&
                                resJson.code !== 500 &&
                                failNote === null
                            );

                            if (!isSuccess && failNote === null) {
                                failNote = `Gagal dari server: ${resJson.message || JSON.stringify(resJson)}`;
                            }

                        } else {
                            const text = await response.text();
                            console.warn(`[Bot UTP Reject] Response non-JSON diterima.`);

                            if (text.includes('login') || text.includes('username') || text.includes('password')) {
                                const remainingRows = claimedRows.slice(processedIndex);
                                for (const remRow of remainingRows) {
                                    await db.rpc('release_utp_assignment', { p_assignment_id: remRow.assignment_id });
                                }
                                document.title = "⚠️ HARAP LOGIN KEMBALI - Bot UTP Terhenti";
                                alert("Sesi login Fasih-SM habis / Terlogout!\n\nSilakan login kembali, lalu jalankan ulang bot.");
                                return;
                            }

                            failNote = `Respon tidak terduga dari server (non-JSON): ${text.substring(0, 200)}`;
                            isSuccess = false;
                        }

                        if (isSuccess) {
                            console.log(`%c[Bot UTP Reject] ✅ SUKSES ID: ${assignmentId}`, "color: #10b981; font-weight: bold;");
                            await db.rpc('update_utp_reject_status', {
                                p_assignment_id: assignmentId,
                                p_status: 'success',
                                p_note: null
                            });
                        } else {
                            console.warn(`%c[Bot UTP Reject] ❌ GAGAL ID: ${assignmentId} — ${failNote}`, "color: #ef4444;");
                            await db.rpc('update_utp_reject_status', {
                                p_assignment_id: assignmentId,
                                p_status: 'failed',
                                p_note: failNote
                            });
                        }

                    } else {
                        const errText = await response.text();
                        const note = `HTTP Error ${response.status}: ${errText.substring(0, 300)}`;
                        console.error(`[Bot UTP Reject] HTTP ${response.status} untuk ID: ${assignmentId}:`, errText);
                        await db.rpc('update_utp_reject_status', {
                            p_assignment_id: assignmentId,
                            p_status: 'failed',
                            p_note: note
                        });
                    }

                } catch (fetchErr) {
                    const note = `Koneksi gagal: ${fetchErr.message}`;
                    console.error(`[Bot UTP Reject] Error koneksi ID: ${assignmentId}:`, fetchErr);
                    await db.rpc('release_utp_assignment', { p_assignment_id: assignmentId });
                }

                processedIndex++;
            }

        } catch (err) {
            console.error('[Bot UTP Reject] Error dalam siklus sync:', err);
        }
    }

    // ─── 5. Loop Dinamis ──────────────────────────────────────────────────────
    async function startDynamicSync() {
        await syncUTPRejections();
        const nextCheckDelay = 5000 + Math.random() * 10000;
        console.log(`%c[Bot UTP Reject] Pemeriksaan berikutnya dalam ${Math.round(nextCheckDelay / 1000)} detik...`, "color: #6b7280; font-style: italic;");
        setTimeout(startDynamicSync, nextCheckDelay);
    }

    startDynamicSync();
})();
