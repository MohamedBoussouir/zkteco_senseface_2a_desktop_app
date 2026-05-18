const { ipcMain } = require('electron');
const { db } = require('./db');
const path = require('path');
const { app } = require('electron');
const licensing = require('./licensing');
const { withLock, syncUsersFromDevice, getZkConnection } = require('./zk/sync');
const { enrollFingerprint, abortEnrollment } = require('./zk/enroll');
const { createUser, deleteUser, deleteFinger, deleteAllFingers } = require('./zk/user');
const { rebootDevice, syncTime, clearAdmin, beep } = require('./zk/device');

function setupIpcHandlers(mainWindow) {
    // Licensing
    ipcMain.handle('verify-license', async () => licensing.verifyLicense());
    ipcMain.handle('get-machine-id', async () => ({ mid: licensing.getMachineId() }));

    // Devices
    ipcMain.handle('get-devices', async () => db('devices').select('*'));
    ipcMain.handle('test-device-connection', async (event, { ip, ports }) => {
        try {
            return await withLock(ip, ports, async (zk) => ({ success: true }));
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
    ipcMain.handle('add-device', async (event, device) => {
        const [id] = await db('devices').insert(device);
        return { success: true, id };
    });
    ipcMain.handle('update-device', async (event, { id, ...dev }) => {
        await db('devices').where('id', id).update(dev);
        return { success: true };
    });
    ipcMain.handle('delete-device', async (event, id) => {
        await db('devices').where('id', id).delete();
        await db('users').where('device_id', id).delete();
        return { success: true };
    });

    // Device Actions
    ipcMain.handle('reboot-device', async (event, { ip, ports }) => rebootDevice(ip, ports));
    ipcMain.handle('sync-time', async (event, { ip, ports }) => syncTime(ip, ports));
    ipcMain.handle('clear-device-admin', async (event, { ip, ports }) => clearAdmin(ip, ports));
    ipcMain.handle('beep-device', async (event, { ip, ports }) => beep(ip, ports));
    ipcMain.handle('emergency-stop', async (event, { ip }) => {
        abortEnrollment(ip);
        return { success: true };
    });

    // Users
    ipcMain.handle('get-local-users', async () => db('users').select('*'));
    ipcMain.handle('get-users', async () => db('users').select('*')); // Support both names
    ipcMain.handle('fetch-device-users', async (event, { ip, ports }) => {
        try {
            const device = await db('devices').where('ip', ip).first();
            if (!device) throw new Error('Device not found');
            return await withLock(ip, ports, async (zk) => {
                const count = await syncUsersFromDevice(zk, device.id);
                return { success: true, count };
            });
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('sync-all-devices', async (event) => {
        const { startBackgroundSync } = require('./scheduler');
        startBackgroundSync(mainWindow);
        return { success: true };
    });

    ipcMain.handle('create-user', async (event, { ip, ports, uid, userId, name, role, user }) => {
        // Handle both object-style and flat-style parameters
        const userData = user || { uid, userId, name, role };

        const res = await createUser(ip, ports, userData);
        if (res.success) {
            const device = await db('devices').where('ip', ip).first();
            if (device) {
                await db('users').insert({
                    uid: userData.uid,
                    user_id: (userData.userId || userData.uid).toString(),
                    name: userData.name || 'Unknown',
                    role: userData.role || 0,
                    device_id: device.id,
                    fingerprints: '[]'
                }).onConflict(['user_id', 'device_id']).merge();
            }
        }
        return res;
    });
    ipcMain.handle('delete-user', async (event, { ip, ports, uid, userId }) => deleteUser(ip, ports, uid, userId));
    ipcMain.handle('delete-user-finger', async (event, { ip, ports, uid, userId, fingerIndex }) => {
        const fIdx = parseInt(fingerIndex);
        console.log(`[IPC] Deleting finger ${fIdx} for User ${userId} (UID: ${uid}) on ${ip}`);
        return deleteFinger(ip, ports, uid, userId, fIdx);
    });

    // Fingerprints
    ipcMain.handle('enroll-fingerprint', async (event, { ip, ports, uid, userId, fingerIndex }) => {
        return enrollFingerprint(ip, ports, uid, userId, fingerIndex, mainWindow);
    });
    ipcMain.handle('abort-enrollment', async (event, { ip }) => {
        abortEnrollment(ip);
        return { success: true };
    });

    ipcMain.handle('sync-users-from-device', async (event, { ip, ports }) => {
        return await withLock(ip, ports, async (zk) => {
            const device = await db('devices').where('ip', ip).first();
            if (!device) return { success: false, error: 'Device not found' };

            const users = await zk.getUsers();
            if (!Array.isArray(users)) {
                console.error(`[Sync] Failed to fetch users from ${ip}: Response was not an array`);
                return { success: false, error: 'Device busy or connection timed out' };
            }

            for (const u of users) {
                await db('users')
                    .insert({
                        uid: u.uid,
                        user_id: u.userId,
                        name: u.name,
                        role: u.role,
                        password: u.password,
                        device_id: device.id
                    })
                    .onConflict(['user_id', 'device_id'])
                    .merge();
            }
            return { success: true, count: users.length };
        });
    });

    ipcMain.handle('get-users-fingerprints', async (event, { ip, ports, users }) => {
        return await withLock(ip, ports, async (zk) => {
            const device = await db('devices').where('ip', ip).first();
            if (!device) return { success: false, error: 'Device not found' };

            console.log(`[Sync-Bio] Starting FAST BULK sync for ${users.length} users...`);
            try { await zk.disableDevice(); } catch (e) {}

            let results = [];
            const usersMap = {};
            for (const u of users) {
                usersMap[u.uid] = { ...u, fpCount: 0, fpIndices: [] };
            }

            try {
                const reqData = Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                const fpRes = await zk.zklibTcp.readWithBuffer(reqData);
                const data = fpRes.data;

                if (data && data.length >= 4) {
                    let offset = 4;
                    while (offset < data.length) {
                        const entrySize = data.readUInt16LE(offset);
                        if (entrySize === 0) break;
                        
                        const userSn = data.readUInt16LE(offset + 2);
                        const fingerIndex = data.readUInt8(offset + 4); // <-- هذا هو السطر الذي نسيته سابقاً وتسبب في الخطأ
                        const flag = data.readUInt8(offset + 5);
                        
                        // flag 1 = Valid, 3 = Duress
                        if ((flag === 1 || flag === 3) && usersMap[userSn]) {
                            usersMap[userSn].fpCount++;
                            if (!usersMap[userSn].fpIndices.includes(fingerIndex)) {
                                usersMap[userSn].fpIndices.push(fingerIndex);
                            }
                        }
                        
                        offset += entrySize;
                    }
                }
            } catch (e) {
                console.error('[Sync-Bio] Error during bulk fetch:', e.message);
            }

            for (const u of users) {
                const finalCount = usersMap[u.uid].fpCount;
                const indices = usersMap[u.uid].fpIndices;
                console.log(`  -> [RESULT] User ${u.user_id}: ${finalCount} real fingerprints. Indices: ${indices.join(',')}`);
                
                await db('users')
                    .where({ user_id: u.user_id, device_id: device.id })
                    .update({ fingerprints: JSON.stringify({ count: finalCount, indices }) });
                
                results.push({ user_id: u.user_id, count: finalCount, indices });
            }

            try { await zk.enableDevice(); } catch (e) {}
            return { success: true, results };
        });
    });

    ipcMain.handle('delete-user-fingerprint', async (event, { ip, ports, uid, userId, fingerIndex }) => {
        return deleteFinger(ip, ports, uid, userId, fingerIndex);
    });

    ipcMain.handle('delete-all-fingerprints', async (event, { ip, ports, uid, userId }) => {
        return deleteAllFingers(ip, ports, uid, userId);
    });

    // Logs
    ipcMain.handle('get-logs', async () => db('attendance').select('*').orderBy('id', 'desc').limit(1000));
    ipcMain.handle('delete-log', async (event, id) => {
        await db('attendance').where('id', id).delete();
        return { success: true };
    });
    ipcMain.handle('delete-all-logs', async () => {
        await db('attendance').delete();
        return { success: true };
    });
    ipcMain.handle('clear-all-logs', async () => {
        await db('attendance').delete();
        return { success: true };
    });
    ipcMain.handle('delete-multiple-logs', async (event, ids) => {
        await db('attendance').whereIn('id', ids).delete();
        return { success: true };
    });
    ipcMain.handle('open-db-folder', async () => {
        const { shell } = require('electron');
        shell.openPath(app.getPath('userData'));
        return { success: true };
    });

    // Playground & Diagnostic
    ipcMain.handle('playground-cmd', async (event, { ip, port, cmd, uid }) => {
        return await withLock(ip, [port], async (zk) => {
            try {
                if (cmd === 'beep') {
                    // CMD 1017 is CMD_TESTVOICE, which is more reliable for K40 sound tests
                    await zk.executeCmd(1017, Buffer.alloc(0));
                    return { success: true, data: 'Beep/Voice command sent successfully' };
                }
                if (cmd === 'device-info' || cmd === 'getInfo') {
                    const info = await zk.getInfo();
                    return { success: true, data: JSON.stringify(info, null, 2) };
                }
                if (cmd === 'list-users' || cmd === 'getUsers') {
                    const users = await zk.getUsers();
                    return { success: true, data: JSON.stringify(users, null, 2) };
                }
                if (cmd === 'device-time' || cmd === 'getTime') {
                    const time = await zk.getTime();
                    return { success: true, data: time.toString() };
                }
                if (cmd === 'scan-fingers' || cmd === 'scanFingers' || cmd === 'getFingers') {
                    let results = [];
                    const idToScan = parseInt(uid || 0);
                    for (let i = 0; i <= 9; i++) {
                        const buf = Buffer.alloc(3);
                        buf.writeUInt16LE(idToScan, 0);
                        buf.writeUInt8(i, 2);
                        try {
                            const res = await zk.executeCmd(9, buf);
                            if (res && res.length > 100 && [1500, 1501, 2000, 2002].includes(res.readUInt16LE(0))) {
                                results.push(i);
                            }
                        } catch (e) { }
                    }
                    return { success: true, data: results.length > 0 ? `Registered Finger Indices for UID ${idToScan}: ${results.join(', ')}` : `No fingerprints found for UID ${idToScan}` };
                }
                if (cmd === 'getAttendance') {
                    const logs = await zk.getAttendances();
                    return { success: true, data: JSON.stringify(logs.data || logs, null, 2) };
                }
                if (cmd === 'reboot') {
                    try {
                        await zk.executeCmd(1004, Buffer.alloc(0)); // CMD_RESTART
                        await new Promise(r => setTimeout(r, 500));
                        await zk.executeCmd(1001, Buffer.alloc(0)); // CMD_EXIT
                    } catch (e) { }
                    return { success: true, data: 'Reboot command (1004) sent successfully.' };
                }
                return { success: false, error: 'Unknown command: ' + cmd };
            } catch (e) {
                return { success: false, error: e.message };
            }
        });
    });

    ipcMain.handle('reboot-all-devices', async () => {
        const { rebootDevice } = require('./zk/device');
        const devices = await db('devices').select('*');
        let results = [];
        for (const dev of devices) {
            try {
                await rebootDevice(dev.ip, [dev.port1, dev.port2]);
                results.push({ ip: dev.ip, success: true });
            } catch (e) {
                results.push({ ip: dev.ip, success: false });
            }
        }
        return results;
    });

    ipcMain.handle('sync-all-times', async () => {
        const { syncTime } = require('./zk/device');
        const devices = await db('devices').select('*');
        let results = [];
        for (const dev of devices) {
            let success = false;
            let error = null;
            // Retry up to 3 times
            for (let i = 0; i < 3; i++) {
                try {
                    await syncTime(dev.ip, [dev.port1, dev.port2]);
                    success = true;
                    break;
                } catch (e) {
                    error = e.message;
                    await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                }
            }
            results.push({ ip: dev.ip, success, error });
        }
        return results;
    });

    ipcMain.handle('get-late-report', async (event, { date, startTime, endTime }) => {
        const users = await db('users').select('user_id', 'name');
        const logs = await db('attendance').where('timestamp', 'like', `${date}%`).select('*');

        const getMinutes = (ts) => {
            const d = new Date(ts);
            return d.getHours() * 60 + d.getMinutes();
        };
        const parseTimeStr = (str) => {
            const [h, m] = str.split(':').map(Number);
            return h * 60 + m;
        };

        return users.map(user => {
            const userLogs = logs.filter(l => l.user_id === user.user_id);
            if (userLogs.length === 0) {
                return { name: user.name, user_id: user.user_id, first: '--', last: '--', worked: '--', delay: '--', status: 'Absent' };
            }

            userLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const first = userLogs[0].timestamp;
            const last = userLogs[userLogs.length - 1].timestamp;

            const firstMin = getMinutes(first);
            const startMin = parseTimeStr(startTime);
            const diffMs = new Date(last) - new Date(first);
            const hoursWorked = (diffMs / (1000 * 60 * 60)).toFixed(2);

            let delay = '--';
            let status = 'On Time';
            if (firstMin > startMin) {
                delay = `+${firstMin - startMin} mins`;
                status = 'Late';
            }

            return {
                name: user.name,
                user_id: user.user_id,
                first: new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                last: new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                worked: `${hoursWorked} hrs`,
                delay,
                status
            };
        });
    });
};

module.exports = { setupIpcHandlers };
