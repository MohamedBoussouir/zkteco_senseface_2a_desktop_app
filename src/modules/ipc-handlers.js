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

    // Dashboard Stats (Instant Local DB)
    ipcMain.handle('get-dashboard-stats-local', async () => {
        try {
            const usersCount = (await db('users').count('id as cnt').first()).cnt || 0;
            const logsCount = (await db('attendance').count('id as cnt').first()).cnt || 0;
            
            const todayStr = new Date().toISOString().split('T')[0];
            const todayPunches = (await db('attendance').where('timestamp', 'like', `${todayStr}%`).count('id as cnt').first()).cnt || 0;
            
            const usersList = await db('users').select('fingerprints');
            let fpCount = 0;
            usersList.forEach(u => {
                try {
                    const fpData = JSON.parse(u.fingerprints);
                    if (fpData && typeof fpData.count === 'number') fpCount += fpData.count;
                } catch(e) {}
            });

            // Get chart data (last 7 days)
            const chartData = { labels: [], data: [] };
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const count = (await db('attendance').where('timestamp', 'like', `${dateStr}%`).count('id as cnt').first()).cnt || 0;
                chartData.labels.push(dateStr.slice(5)); // MM-DD
                chartData.data.push(count);
            }

            return { success: true, stats: { usersCount, logsCount, todayPunches, fpCount, chartData } };
        } catch(e) {
            return { success: false, error: e.message };
        }
    });

    // Dashboard Stats (Live Hardware)
    ipcMain.handle('get-dashboard-stats-hw', async () => {
        try {
            const device = await db('devices').first();
            let hwInfo = null;
            if (device) {
                try {
                    hwInfo = await withLock(device.ip, [device.port1, device.port2], async (zk) => {
                        return await zk.getInfo();
                    });
                } catch(e) {}
            }
            return { success: true, hwInfo };
        } catch(e) {
            return { success: false, error: e.message };
        }
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

            // 1. Sync users using the central helper (performs obsolete user & log cleanup)
            let usersCount = 0;
            try {
                usersCount = await syncUsersFromDevice(zk, device.id);
            } catch (err) {
                console.error(`[Sync] Failed to fetch users from ${ip}:`, err.message);
                return { success: false, error: 'Device busy or connection timed out' };
            }

            // 2. Sync attendance logs directly and merge them to update existing records
            let logsCount = 0;
            try {
                const logs = await zk.getAttendances();
                const lData = Array.isArray(logs) ? logs : (logs.data || []);
                for (const log of lData) {
                    try {
                        const rawId = log.deviceUserId || log.userId;
                        if (!rawId) continue;

                        let ts = log.recordTime || log.timestamp;
                        if (!ts) continue;
                        
                        const isoTs = ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();

                        const user = await db('users').where({ user_id: rawId.toString(), device_id: device.id }).first();
                        await db('attendance').insert({
                            user_id: rawId.toString(),
                            user_name: user ? user.name : `User ${rawId}`,
                            timestamp: isoTs,
                            status: log.status,
                            device_id: device.id
                        }).onConflict(['user_id', 'timestamp', 'device_id']).merge();
                        logsCount++;
                    } catch (e) {}
                }
            } catch (err) {
                console.error(`[Sync] Failed to fetch attendance logs from ${ip}:`, err.message);
            }

            return { success: true, count: usersCount, logsCount };
        });
    });

    ipcMain.handle('sync-logs-from-device', async (event, { ip, ports }) => {
        return await withLock(ip, ports, async (zk) => {
            const device = await db('devices').where('ip', ip).first();
            if (!device) return { success: false, error: 'Device not found' };

            let logsCount = 0;
            try {
                const logs = await zk.getAttendances();
                const lData = Array.isArray(logs) ? logs : (logs.data || []);
                for (const log of lData) {
                    try {
                        const rawId = log.deviceUserId || log.userId;
                        if (!rawId) continue;

                        let ts = log.recordTime || log.timestamp;
                        if (!ts) continue;
                        
                        const isoTs = ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();

                        const user = await db('users').where({ user_id: rawId.toString(), device_id: device.id }).first();
                        await db('attendance').insert({
                            user_id: rawId.toString(),
                            user_name: user ? user.name : `User ${rawId}`,
                            timestamp: isoTs,
                            status: log.status,
                            device_id: device.id
                        }).onConflict(['user_id', 'timestamp', 'device_id']).merge();
                        logsCount++;
                    } catch (e) {}
                }
            } catch (err) {
                console.error(`[Sync-Logs] Failed to fetch attendance logs from ${ip}:`, err.message);
                return { success: false, error: err.message };
            }

            return { success: true, logsCount };
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
        const res = await deleteFinger(ip, ports, uid, userId, fingerIndex);
        if (res.success) {
            const device = await db('devices').where('ip', ip).first();
            if (device) {
                const user = await db('users').where({ user_id: userId, device_id: device.id }).first();
                if (user && user.fingerprints) {
                    try {
                        const fpData = JSON.parse(user.fingerprints);
                        if (fpData && Array.isArray(fpData.indices)) {
                            fpData.indices = fpData.indices.filter(i => i.toString() !== fingerIndex.toString());
                            fpData.count = fpData.indices.length;
                            await db('users').where('id', user.id).update({ fingerprints: JSON.stringify(fpData) });
                        }
                    } catch(e) {}
                }
            }
        }
        return res;
    });

    ipcMain.handle('delete-all-fingerprints', async (event, { ip, ports, uid, userId }) => {
        const res = await deleteAllFingers(ip, ports, uid, userId);
        if (res.success) {
            const device = await db('devices').where('ip', ip).first();
            if (device) {
                await db('users')
                    .where({ user_id: userId, device_id: device.id })
                    .update({ fingerprints: JSON.stringify({ count: 0, indices: [] }) });
            }
        }
        return res;
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

    ipcMain.handle('set-custom-time', async (event, dateTimeStr) => {
        const { setCustomDeviceTime } = require('./zk/device');
        const devices = await db('devices').select('*');
        let results = [];
        for (const dev of devices) {
            let success = false;
            let error = null;
            for (let i = 0; i < 3; i++) {
                try {
                    await setCustomDeviceTime(dev.ip, [dev.port1, dev.port2], dateTimeStr);
                    success = true;
                    break;
                } catch (e) {
                    error = e.message;
                    await new Promise(r => setTimeout(r, 1000));
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

    ipcMain.handle('get-auto-switch-rules', async () => {
        const device = await db('devices').first();
        if (!device) return { success: false, error: 'No device configured' };
        
        return await withLock(device.ip, [device.port1, device.port2 || device.port], async (zk) => {
            const rules = {};
            for (let i = 1; i <= 4; i++) {
                try {
                    const res = await zk.executeCmd(11, Buffer.from(`AS${i}\0`));
                    const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
                    if (responseStr.includes('=')) {
                        const val = parseInt(responseStr.split('=')[1]);
                        if (!isNaN(val) && val !== -1) {
                            const hour = Math.floor(val / 256);
                            const minute = val % 256;
                            rules[`as${i}`] = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
                        } else {
                            rules[`as${i}`] = '';
                        }
                    } else {
                        rules[`as${i}`] = '';
                    }
                } catch (e) {
                    rules[`as${i}`] = '';
                }
            }
            
            // Query showState
            try {
                const res = await zk.executeCmd(11, Buffer.from(`~ShowState\0`));
                const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
                if (responseStr.includes('=')) {
                    rules.showState = parseInt(responseStr.split('=')[1]) || 0;
                } else {
                    rules.showState = 0;
                }
            } catch(e) {
                rules.showState = 0;
            }

            // Query stateMode
            try {
                const res = await zk.executeCmd(11, Buffer.from(`StateMode\0`));
                const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
                if (responseStr.includes('=')) {
                    rules.stateMode = parseInt(responseStr.split('=')[1]) || 3;
                } else {
                    rules.stateMode = 3;
                }
            } catch(e) {
                rules.stateMode = 3;
            }

            return { success: true, rules };
        });
    });

    ipcMain.handle('set-auto-switch-rules', async (event, { as1, as2, as3, as4, showState, stateMode }) => {
        const device = await db('devices').first();
        if (!device) return { success: false, error: 'No device configured' };

        const encodeZKTime = (timeStr) => {
            if (!timeStr) return -1;
            const [h, m] = timeStr.split(':').map(Number);
            return (h << 8) | m;
        };

        return await withLock(device.ip, [device.port1, device.port2 || device.port], async (zk) => {
            // Write AS1-AS4
            await zk.executeCmd(12, Buffer.from(`AS1=${encodeZKTime(as1)}\0`));
            await zk.executeCmd(12, Buffer.from(`AS2=${encodeZKTime(as2)}\0`));
            await zk.executeCmd(12, Buffer.from(`AS3=${encodeZKTime(as3)}\0`));
            await zk.executeCmd(12, Buffer.from(`AS4=${encodeZKTime(as4)}\0`));

            // Write ShowState
            await zk.executeCmd(12, Buffer.from(`~ShowState=${showState}\0`));

            // Write StateMode
            await zk.executeCmd(12, Buffer.from(`StateMode=${stateMode}\0`));

            // Refresh options
            await zk.executeCmd(1014); 

            return { success: true };
        });
    });
};

module.exports = { setupIpcHandlers };
