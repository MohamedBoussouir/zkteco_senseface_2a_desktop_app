const { db } = require('./db');
const { withLock, syncUsersFromDevice } = require('./zk/sync');

let isSyncing = false;
let loopStarted = false;

async function startBackgroundSync(mainWindow) {
    const runSync = async () => {
        if (isSyncing) return;
        isSyncing = true;
        console.log('[Scheduler] Executing sync cycle...');

        try {
            const devices = await db('devices').select('*');
            for (const device of devices) {
                try {
                    await withLock(device.ip, [device.port1, device.port2], async (zk) => {
                        console.log(`[Sync] Smart Quick-Sync started for ${device.ip}...`);
                        try {
                            await syncUsersFromDevice(zk, device.id);
                        } catch (e) {
                            console.error(`[Sync] Skipping users fetch for ${device.ip} due to timeout:`, e.message);
                        }
                        const logs = await zk.getAttendances();
                        const lData = Array.isArray(logs) ? logs : (logs.data || []);
                        for (const log of lData) {
                            try {
                                const rawId = log.deviceUserId || log.userId;
                                if (!rawId) continue;

                                let ts = log.recordTime || log.timestamp;
                                if (!ts) continue;
                                
                                // Ensure standard ISO format for DB storage
                                const isoTs = ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();

                                const user = await db('users').where({ user_id: rawId.toString(), device_id: device.id }).first();
                                await db('attendance').insert({
                                    user_id: rawId.toString(),
                                    user_name: user ? user.name : `User ${rawId}`,
                                    timestamp: isoTs,
                                    status: log.status,
                                    device_id: device.id
                                }).onConflict(['user_id', 'timestamp', 'device_id']).merge();
                            } catch (e) { }
                        }
                    });
                } catch (e) {
                    console.error(`[Scheduler] Failed to sync device ${device.ip}:`, e.message || e);
                }
            }
            if (mainWindow) mainWindow.webContents.send('background-sync-complete');
        } catch (e) {
            console.error('[Scheduler] Sync error:', e.message || e);
        } finally {
            isSyncing = false;
        }
        setTimeout(runSync, 30 * 60 * 1000); 
    };

    if (loopStarted) {
        console.log('[Scheduler] Manual sync trigger requested.');
        if (!isSyncing) return runSync();
        return;
    }
    
    loopStarted = true;
    console.log('[Scheduler] Background sync loop initialized.');
    runSync();
}

module.exports = { startBackgroundSync };
