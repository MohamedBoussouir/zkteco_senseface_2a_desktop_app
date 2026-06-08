const { ipcMain } = require('electron');
const { db } = require('./db');
const path = require('path');
const { app } = require('electron');
const licensing = require('./licensing');
const { queueAdmsCommand, startAdmsServer, stopAdmsServer } = require('./adms-server');
const { exec } = require('child_process');

function setupIpcHandlers(mainWindow) {
    // Licensing
    ipcMain.handle('verify-license', async () => licensing.verifyLicense());
    ipcMain.handle('get-machine-id', async () => ({ mid: licensing.getMachineId() }));
    ipcMain.handle('save-license-key', async (event, key) => licensing.saveLicenseKey(key));

    // Devices
    ipcMain.handle('get-devices', async () => db('devices').select('*'));
    ipcMain.handle('test-device-connection', async (event, { ip, ports, deviceId, sn }) => {
        try {
            const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('sn', sn || ip).first();
            if (!device) return { success: false, error: 'Device not found' };
            const isOnline = (Date.now() - (device.last_seen || 0)) < 900000;
            return { success: isOnline, error: isOnline ? null : 'Device offline or not connected recently.' };
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

    ipcMain.handle('scan-devices', async (event, durationMs = 10000) => {
        const { getDiscoveredDevices, clearDiscoveredDevices } = require('./adms-server');
        clearDiscoveredDevices();
        return new Promise(resolve => {
            setTimeout(() => {
                const devices = getDiscoveredDevices();
                resolve({ success: true, devices });
            }, durationMs);
        });
    });

    // Device Actions
    ipcMain.handle('reboot-device', async (event, { ip, ports, deviceId, sn }) => {
        queueAdmsCommand('REBOOT');
        return { success: true };
    });
    ipcMain.handle('sync-time', async (event, { ip, ports, deviceId, sn }) => {
        // We queue a dummy command, or log that ADMS syncs time automatically if device asks
        return { success: true };
    });
    ipcMain.handle('clear-device-admin', async (event, { ip, ports, deviceId, sn }) => {
        queueAdmsCommand('CLEAR ADMIN');
        return { success: true };
    });
    ipcMain.handle('beep-device', async (event, { ip, ports, deviceId, sn }) => {
        return { success: false, error: 'Beep not supported via ADMS' };
    });
    ipcMain.handle('emergency-stop', async (event, { ip }) => {
        return { success: true };
    });

    const getUsersQuery = async () => {
        const rawUsers = await db('users')
            .leftJoin('work_patterns', 'users.work_pattern_id', 'work_patterns.id')
            .leftJoin('devices', 'users.device_id', 'devices.id')
            .select(
                'users.user_id',
                db.raw('MAX(users.uid) as uid'),
                db.raw('MAX(users.name) as name'),
                db.raw('MAX(users.role) as role'),
                db.raw('MAX(users.photo) as photo'),
                db.raw('MAX(users.work_pattern_id) as work_pattern_id'),
                db.raw('MAX(work_patterns.name) as pattern_name'),
                db.raw("GROUP_CONCAT(users.fingerprints, '|||') as all_fingerprints"),
                db.raw("GROUP_CONCAT(devices.id, '|||') as device_ids"),
                db.raw("GROUP_CONCAT(devices.name, '|||') as device_names"),
                db.raw("GROUP_CONCAT(devices.ip, '|||') as device_ips")
            )
            .groupBy('users.user_id');

        return rawUsers.map(u => {
            // merge fingerprints visually
            let mergedIndices = new Set();
            if (u.all_fingerprints) {
                u.all_fingerprints.split('|||').forEach(fpStr => {
                    try {
                        const fp = JSON.parse(fpStr);
                        if (fp && Array.isArray(fp.indices)) {
                            fp.indices.forEach(idx => mergedIndices.add(idx));
                        } else if (Array.isArray(fp)) {
                            fp.forEach(idx => mergedIndices.add(idx));
                        }
                    } catch (e) {}
                });
            }
            
            u.fingerprints = JSON.stringify({
                count: mergedIndices.size,
                indices: Array.from(mergedIndices)
            });

            // parse devices
            const ids = u.device_ids ? u.device_ids.split('|||') : [];
            const names = u.device_names ? u.device_names.split('|||') : [];
            const ips = u.device_ips ? u.device_ips.split('|||') : [];
            
            const devicesArr = [];
            for (let i = 0; i < ids.length; i++) {
                if (ids[i]) {
                    devicesArr.push({ 
                        id: parseInt(ids[i]), 
                        name: names[i] || 'Unknown', 
                        ip: ips[i] || '0.0.0.0' 
                    });
                }
            }
            u.assigned_devices = devicesArr;
            
            return u;
        });
    };

    ipcMain.handle('get-local-users', async () => getUsersQuery());
    ipcMain.handle('get-users', async () => getUsersQuery()); // Support both names
    ipcMain.handle('fetch-device-users', async (event, { ip, ports, deviceId, sn }) => {
        try {
            const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('sn', sn || ip).first();
            if (!device) throw new Error('Device not found');
            queueAdmsCommand('DATA QUERY userinfo');
            queueAdmsCommand('DATA QUERY templatev10');
            queueAdmsCommand('DATA QUERY BIODATA');
            return { success: true, count: 0, message: 'Sync commands queued via ADMS' };
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
                } catch (e) { }
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
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // Dashboard Stats (Live Hardware) - Simulated from Local DB for ADMS
    ipcMain.handle('get-dashboard-stats-hw', async () => {
        try {
            let localFpCount = 0;
            try {
                const usersList = await db('users').select('fingerprints');
                usersList.forEach(u => {
                    try {
                        const fpData = JSON.parse(u.fingerprints);
                        if (fpData && typeof fpData.count === 'number') localFpCount += fpData.count;
                    } catch (e) { }
                });
            } catch (e) { }

            return { success: true, hwInfo: { fpCounts: localFpCount } };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('create-user', async (event, { ip, ports, uid, userId, name, role, work_pattern_id, user, deviceId }) => {
        const userData = user || { uid, userId, name, role, work_pattern_id };
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        // ADMS fields must be separated by tabs (\t), not spaces
        queueAdmsCommand(`DATA UPDATE userinfo PIN=${userData.userId}\tName=${userData.name}\tPri=${userData.role || 0}`);
        
        await db('users').insert({
            uid: userData.uid,
            user_id: (userData.userId || userData.uid).toString(),
            name: userData.name || 'Unknown',
            role: userData.role || 0,
            device_id: device.id,
            fingerprints: '{"count": 0, "indices": []}',
            work_pattern_id: userData.work_pattern_id || null
        }).onConflict(['user_id', 'device_id']).merge();
        
        return { success: true };
    });

    ipcMain.handle('update-user', async (event, { ip, ports, uid, userId, name, role, work_pattern_id, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        queueAdmsCommand(`DATA UPDATE userinfo PIN=${userId}\tName=${name}\tPri=${role || 0}`);
        
        await db('users').where({ user_id: userId.toString(), device_id: device.id }).update({
            name: name,
            role: role || 0,
            work_pattern_id: work_pattern_id || null
        });
        
        return { success: true };
    });

    ipcMain.handle('delete-user', async (event, { ip, ports, uid, userId, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        // Send both variants to cover different firmware versions
        queueAdmsCommand(`DATA DELETE user PIN=${userId}`);
        queueAdmsCommand(`DATA DELETE userinfo PIN=${userId}`);
        
        await db('users').where({ user_id: userId.toString(), device_id: device.id }).delete();
        await db('attendance').where({ user_id: userId.toString(), device_id: device.id }).delete();
        
        return { success: true };
    });

    ipcMain.handle('delete-user-finger', async (event, { ip, ports, uid, userId, fingerIndex, deviceId }) => {
        queueAdmsCommand(`DATA DELETE templatev10 Pin=${userId}\tFingerID=${fingerIndex}`);
        queueAdmsCommand(`DATA DELETE BIODATA Pin=${userId}\tNo=${fingerIndex}`);
        queueAdmsCommand(`DATA DELETE fingrtmp PIN=${userId}\tFID=${fingerIndex}`);
        return { success: true };
    });

    // Fingerprints
    ipcMain.handle('enroll-fingerprint', async (event, { ip, ports, uid, userId, fingerIndex, deviceId }) => {
        const { queueAdmsCommand } = require('./adms-server');
        // We use \t (Tab) to separate parameters so modern ZKTeco firmware parses them correctly instead of merging into PIN
        queueAdmsCommand(`ENROLL_FP PIN=${userId}\tFID=${fingerIndex}\tRETRY=3\tOVERWRITE=1`);
        return { success: true, message: 'Enrollment command queued. Please wait for the device to pick it up.' };
    });
    ipcMain.handle('abort-enrollment', async (event, { ip }) => {
        return { success: true };
    });

    ipcMain.handle('delete-user-face', async (event, { ip, ports, uid, userId, deviceId }) => {
        const { queueAdmsCommand } = require('./adms-server');
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        // Send ADMS commands to delete the face
        queueAdmsCommand(`DATA DELETE BIOPHOTO PIN=${userId}`);
        queueAdmsCommand(`DATA DELETE BIODATA Pin=${userId}\tType=9`);

        // Remove the photo from the database
        await db('users').where({ user_id: userId, device_id: device.id }).update({ photo: null });

        return { success: true };
    });

    ipcMain.handle('upload-face-photo', async (event, { ip, deviceId, userId, photoBase64 }) => {
        const { queueAdmsCommand } = require('./adms-server');
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (device && device.sn) {
            // Calculate raw binary size from base64 string
            const binarySize = Buffer.from(photoBase64, 'base64').length;
            // Type 9 is Face in BIOPHOTO
            queueAdmsCommand(`DATA UPDATE BIOPHOTO PIN=${userId}\tType=9\tSize=${binarySize}\tContent=${photoBase64}`);
            // Also update USERPIC so it displays on the screen
            queueAdmsCommand(`DATA UPDATE USERPIC PIN=${userId}\tSize=${binarySize}\tContent=${photoBase64}`);
            
            // Save photo to local database
            await db('users').where('user_id', userId).update({ photo: photoBase64 });
            
            return { success: true };
        }
        return { success: false, error: 'Device SN not found' };
    });

    ipcMain.handle('sync-users-from-device', async (event, { ip, ports, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };
        
        // Reset last_sync_time for all users on this device to detect deletions
        await db('users').where('device_id', device.id).update({ last_sync_time: 0 });

        // Queue commands to force the device to push all users and fingerprints via ADMS
        queueAdmsCommand('DATA QUERY userinfo');
        queueAdmsCommand('DATA QUERY templatev10');
        queueAdmsCommand('DATA QUERY BIODATA');
        queueAdmsCommand('DATA QUERY BIOPHOTO');
        
        // Start a timeout to delete users that weren't pushed
        setTimeout(async () => {
            try {
                // Anyone still at 0 after 20 seconds was deleted from the device!
                const deletedCount = await db('users')
                    .where('device_id', device.id)
                    .where('last_sync_time', 0)
                    .delete();
                if (deletedCount > 0) {
                    console.log(`[ADMS Sync Cleanup] Auto-deleted ${deletedCount} users from local DB because they are missing from device.`);
                    // Optionally notify frontend here if possible
                }
            } catch (e) { console.error('Cleanup error:', e); }
        }, 20000); // 20 seconds should be enough for the device to push all chunks

        const res = await db('users').where('device_id', device.id).count('id as c');
        const count = res[0].c || 0;
        return { success: true, count: count, logsCount: 0, message: "Sync commands sent! Deleted users will vanish within 20 seconds." };
    });

    ipcMain.handle('sync-logs-from-device', async (event, { ip, ports, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        // Force device to push its attendance logs
        queueAdmsCommand('DATA QUERY ATTLOG');

        return { success: true, logsCount: 0, message: "Sync command sent! Logs will appear shortly via ADMS." };
    });

    ipcMain.handle('get-users-fingerprints', async (event, { ip, ports, users, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        const results = [];
        for (const u of users) {
            const user = await db('users').where({ user_id: u.user_id, device_id: device.id }).first();
            if (user && user.fingerprints) {
                try {
                    const fpData = JSON.parse(user.fingerprints);
                    if (Array.isArray(fpData)) {
                        results.push({ user_id: u.user_id, count: fpData.length, indices: fpData });
                    } else {
                        results.push({ user_id: u.user_id, count: fpData.count || 0, indices: fpData.indices || [] });
                    }
                } catch(e) {
                    results.push({ user_id: u.user_id, count: 0, indices: [] });
                }
            } else {
                results.push({ user_id: u.user_id, count: 0, indices: [] });
            }
        }
        return { success: true, results };
    });

    ipcMain.handle('delete-user-fingerprint', async (event, { ip, ports, uid, userId, fingerIndex, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        queueAdmsCommand(`DATA DELETE templatev10 Pin=${userId}\tFingerID=${fingerIndex}`);
        queueAdmsCommand(`DATA DELETE BIODATA Pin=${userId}\tNo=${fingerIndex}`);
        queueAdmsCommand(`DATA DELETE fingrtmp PIN=${userId}\tFID=${fingerIndex}`);

        const user = await db('users').where({ user_id: userId, device_id: device.id }).first();
        if (user && user.fingerprints) {
            try {
                let fpData = JSON.parse(user.fingerprints);
                if (Array.isArray(fpData)) {
                    fpData = { count: fpData.length, indices: fpData };
                }
                if (fpData && Array.isArray(fpData.indices)) {
                    fpData.indices = fpData.indices.filter(i => i.toString() !== fingerIndex.toString());
                    fpData.count = fpData.indices.length;
                    await db('users').where('id', user.id).update({ fingerprints: JSON.stringify(fpData) });
                }
            } catch (e) { }
        }
        return { success: true };
    });

    ipcMain.handle('delete-all-fingerprints', async (event, { ip, ports, uid, userId, deviceId }) => {
        const device = deviceId ? await db('devices').where('id', deviceId).first() : await db('devices').where('ip', ip).first();
        if (!device) return { success: false, error: 'Device not found' };

        queueAdmsCommand(`DATA DELETE templatev10 Pin=${userId}`);
        queueAdmsCommand(`DATA DELETE BIODATA Pin=${userId}`);
        queueAdmsCommand(`DATA DELETE fingrtmp PIN=${userId}`);

        await db('users')
            .where({ user_id: userId, device_id: device.id })
            .update({ fingerprints: JSON.stringify({ count: 0, indices: [] }) });
        
        return { success: true };
    });

    // Logs
    // Logs
    ipcMain.handle('get-logs', async (event, { page = 1, limit = 15, searchQuery = '', filterDate = '' } = {}) => {
        const offset = (page - 1) * limit;
        
        let query = db('attendance');
        
        if (searchQuery) {
            query = query.where(function() {
                this.where('user_name', 'like', `%${searchQuery}%`)
                    .orWhere('user_id', searchQuery);
            });
        }
        
        if (filterDate) {
            query = query.where('timestamp', 'like', `${filterDate}%`);
        }
        
        const countRes = await query.clone().count('id as cnt').first();
        const totalCount = countRes ? countRes.cnt : 0;
        
        const rawLogs = await query.clone().select('*').orderBy('timestamp', 'desc').limit(limit).offset(offset);
        const calcSetting = await db('settings').where('key', 'calc_mode').first();
        const mode = calcSetting ? calcSetting.value : 'calculated';

        if (mode !== 'calculated') {
            return { logs: rawLogs, totalCount, currentPage: page };
        }


        // Group logs by user_id and date part of the timestamp (YYYY-MM-DD)
        const groups = {};
        for (const log of rawLogs) {
            if (!log.timestamp) continue;
            // Handle ISO string timestamps
            const dateStr = log.timestamp.substring(0, 10);
            const key = `${log.user_id}_${dateStr}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(log);
        }

        // Apply First-In Last-Out calculation to each user's daily group
        for (const key in groups) {
            const group = groups[key];
            // Sort ascending to easily find earliest and latest punches
            group.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // Earliest is always Check-In (0 / Arrivée)
            group[0].status = 0;

            if (group.length > 1) {
                // Latest is Check-Out (1 / Départ)
                group[group.length - 1].status = 1;

                // Intermediate punches are marked as Break / Intermediate (2)
                for (let i = 1; i < group.length - 1; i++) {
                    group[i].status = 2;
                }
            }
        }

        // Sort back descending by timestamp to keep chronological grid view consistent
        rawLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return { logs: rawLogs, totalCount, currentPage: page };
    });
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
        // Most real-time commands aren't supported. Queue what we can.
        if (cmd === 'reboot') {
            queueAdmsCommand('REBOOT');
            return { success: true, data: 'Reboot command queued.' };
        }
        if (cmd === 'device-info' || cmd === 'getInfo') {
            queueAdmsCommand('INFO');
            return { success: true, data: 'Info command queued. Check logs later.' };
        }
        return { success: false, error: `Command ${cmd} not supported in ADMS mode.` };
    });

    ipcMain.handle('reboot-all-devices', async () => {
        queueAdmsCommand('REBOOT');
        return [{ ip: 'All Devices', success: true }];
    });

    ipcMain.handle('clear-device-logs', async () => {
        queueAdmsCommand('CLEAR LOG');
        return [{ ip: 'All Devices', success: true }];
    });

    ipcMain.handle('sync-all-times', async () => {
        // ADMS syncs time automatically, but we can queue it
        return [{ ip: 'All Devices', success: true }];
    });

    ipcMain.handle('set-custom-time', async (event, dateTimeStr) => {
        return [{ ip: 'All Devices', success: false, error: 'Not supported via ADMS' }];
    });

    ipcMain.handle('get-late-report', async (event, { date, startTime, endTime, mode, month, year, startDateParam, endDateParam }) => {
        let startDate = date;
        let endDate = date;
        let reportMode = mode || 'day';

        if (reportMode === 'month') {
            const [yearPart, monthPart] = month.split('-').map(Number);
            const lastDay = new Date(yearPart, monthPart, 0).getDate();
            const lastDayStr = String(lastDay).padStart(2, '0');
            startDate = `${month}-01`;
            endDate = `${month}-${lastDayStr}`;
        } else if (reportMode === 'year') {
            startDate = `${year}-01-01`;
            endDate = `${year}-12-31`;
        } else if (reportMode === 'range') {
            startDate = startDateParam;
            endDate = endDateParam;
        }

        const rawUsers = await db('users').select('user_id', 'name', 'work_pattern_id').orderBy('work_pattern_id', 'desc');
        const usersMap = new Map();
        for (const u of rawUsers) {
            if (!usersMap.has(u.user_id)) {
                usersMap.set(u.user_id, u);
            } else if (!usersMap.get(u.user_id).work_pattern_id && u.work_pattern_id) {
                usersMap.set(u.user_id, u); // Prefer entry with assigned work pattern
            }
        }
        const users = Array.from(usersMap.values());
        const endDateTime = new Date(`${endDate}T23:59:59.999Z`);
        endDateTime.setDate(endDateTime.getDate() + 1);
        const endDatePlusOne = endDateTime.toISOString().split('T')[0];

        const logs = await db('attendance')
            .where('timestamp', '>=', startDate)
            .andWhere('timestamp', '<=', `${endDatePlusOne}T23:59:59.999Z`)
            .select('*');
        const schedules = await db('schedules')
            .where('date', '>=', startDate)
            .andWhere('date', '<=', endDate)
            .select('*');
        const shifts = await db('shifts').select('*');
        const workPatternDays = await db('work_pattern_days').select('*');

        const getMinutes = (ts) => {
            const d = new Date(ts);
            return d.getHours() * 60 + d.getMinutes();
        };
        const parseTimeStr = (str) => {
            const [h, m] = str.split(':').map(Number);
            return h * 60 + m;
        };

        const getDatesInRange = (startStr, endStr) => {
            const dates = [];
            const start = new Date(startStr + 'T00:00:00');
            const end = new Date(endStr + 'T00:00:00');
            let current = new Date(start);
            while (current <= end) {
                const y = current.getFullYear();
                const m = String(current.getMonth() + 1).padStart(2, '0');
                const d = String(current.getDate()).padStart(2, '0');
                dates.push(`${y}-${m}-${d}`);
                current.setDate(current.getDate() + 1);
            }
            return dates;
        };

        const results = [];
        const dateList = getDatesInRange(startDate, endDate);

        for (const user of users) {
            const userLogs = logs.filter(l => l.user_id === user.user_id);
            const userSchedules = schedules.filter(s => s.user_id === user.user_id);

            const dailyRecords = [];
            let totalDays = 0; 
            let presentDays = 0; 
            let absentDays = 0; 
            let lateDays = 0; 
            let offDaysCount = 0; 
            let workedOffDays = 0; 
            let totalDelayMins = 0;
            let totalWorkedHrs = 0;

            for (const currentDate of dateList) {
                const userSchedule = userSchedules.find(s => s.date === currentDate);
                
                let expectedStart = startTime;
                let expectedEnd = endTime;
                let isOffDay = false;
                let shiftName = '';

                let foundShiftInSchedule = false;
                if (userSchedule) {
                    if (userSchedule.is_off_day) {
                        isOffDay = true;
                        foundShiftInSchedule = true;
                    } else if (userSchedule.shift_id) {
                        const shift = shifts.find(s => s.id === userSchedule.shift_id);
                        if (shift) {
                            expectedStart = shift.start_time;
                            expectedEnd = shift.end_time;
                            shiftName = shift.name;
                            foundShiftInSchedule = true;
                        }
                    }
                } 
                
                if (!foundShiftInSchedule && user.work_pattern_id) {
                    const dOfWeek = new Date(currentDate).getDay();
                    const patternDay = workPatternDays.find(p => p.pattern_id === user.work_pattern_id && p.day_of_week === dOfWeek);
                    if (patternDay) {
                        if (patternDay.shift_id) {
                            const shift = shifts.find(s => s.id === patternDay.shift_id);
                            if (shift) {
                                expectedStart = shift.start_time;
                                expectedEnd = shift.end_time;
                                shiftName = shift.name;
                            }
                        } else {
                            isOffDay = true;
                        }
                    }
                }

                const startMin = parseTimeStr(expectedStart);
                const endMin = parseTimeStr(expectedEnd);
                const isNightShift = endMin < startMin;
                
                let dayLogs = [];
                if (isNightShift) {
                    const nextDate = new Date(currentDate);
                    nextDate.setDate(nextDate.getDate() + 1);
                    const nextDateStr = nextDate.toISOString().split('T')[0];
                    
                    dayLogs = userLogs.filter(l => {
                         if (l.timestamp.startsWith(currentDate)) {
                             const m = getMinutes(l.timestamp);
                             return m >= startMin - 300; // up to 5 hours before shift
                         } else if (l.timestamp.startsWith(nextDateStr)) {
                             const m = getMinutes(l.timestamp);
                             return m <= endMin + 360; // up to 6 hours after shift ends
                         }
                         return false;
                    });
                } else {
                    dayLogs = userLogs.filter(l => l.timestamp.startsWith(currentDate));
                }

                if (isOffDay) {
                    offDaysCount++;
                    if (dayLogs.length === 0) {
                        dailyRecords.push({
                            date: currentDate,
                            first: '--',
                            last: '--',
                            worked: '--',
                            delay: '--',
                            expected: 'Off Day',
                            status: 'Off Day'
                        });
                    } else {
                        workedOffDays++;
                        dayLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                        const first = dayLogs[0].timestamp;
                        const last = dayLogs[dayLogs.length - 1].timestamp;
                        const diffMs = new Date(last) - new Date(first);
                        const hoursWorked = (diffMs / (1000 * 60 * 60)).toFixed(2);
                        const hoursWorkedNum = parseFloat(hoursWorked) || 0;
                        totalWorkedHrs += hoursWorkedNum;

                        dailyRecords.push({
                            date: currentDate,
                            first: new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            last: new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            worked: `${hoursWorked} hrs`,
                            delay: '--',
                            expected: 'Off Day (Worked)',
                            status: 'On Time'
                        });
                    }
                } else {
                    totalDays++; 
                    if (dayLogs.length === 0) {
                        absentDays++;
                        dailyRecords.push({
                            date: currentDate,
                            first: '--',
                            last: '--',
                            worked: '--',
                            delay: '--',
                            expected: `${expectedStart} - ${expectedEnd}`,
                            status: 'Absent'
                        });
                    } else {
                        presentDays++;
                        dayLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                        const first = dayLogs[0].timestamp;
                        const last = dayLogs[dayLogs.length - 1].timestamp;

                        const diffMs = new Date(last) - new Date(first);
                        const hoursWorked = (diffMs / (1000 * 60 * 60)).toFixed(2);
                        const hoursWorkedNum = parseFloat(hoursWorked) || 0;
                        totalWorkedHrs += hoursWorkedNum;

                        const firstPunchDate = new Date(first);
                        const expectedStartDate = new Date(`${currentDate}T${expectedStart}:00`);
                        
                        let delayVal = 0;
                        let delayStr = '--';
                        let status = 'On Time';
                        
                        if (firstPunchDate > expectedStartDate) {
                            delayVal = Math.floor((firstPunchDate - expectedStartDate) / 60000);
                            delayStr = `+${delayVal} mins`;
                            status = 'Late';
                            lateDays++;
                            totalDelayMins += delayVal;
                        }

                        dailyRecords.push({
                            date: currentDate,
                            first: new Date(first).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            last: new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            worked: `${hoursWorked} hrs`,
                            delay: delayStr,
                            expected: `${expectedStart} - ${expectedEnd}${shiftName ? ` (${shiftName})` : ''}`,
                            status
                        });
                    }
                }
            }

            if (reportMode === 'day') {
                const record = dailyRecords[0] || {
                    date: date,
                    first: '--',
                    last: '--',
                    worked: '--',
                    delay: '--',
                    expected: `${startTime} - ${endTime}`,
                    status: 'Absent'
                };
                results.push({
                    name: user.name,
                    user_id: user.user_id,
                    first: record.first,
                    last: record.last,
                    worked: record.worked,
                    delay: record.delay,
                    expected: record.expected,
                    status: record.status
                });
            } else {
                results.push({
                    name: user.name,
                    user_id: user.user_id,
                    totalDays,
                    presentDays,
                    absentDays,
                    lateDays,
                    offDays: offDaysCount,
                    workedOffDays,
                    totalDelayMins,
                    totalWorkedHrs: totalWorkedHrs.toFixed(2),
                    dailyDetails: dailyRecords
                });
            }
        }
        return results;
    });

    // Shifts & Schedules IPC Handlers
    ipcMain.handle('get-shifts', async () => {
        return db('shifts').select('*');
    });

    ipcMain.handle('add-shift', async (event, shift) => {
        const [id] = await db('shifts').insert(shift);
        return { success: true, id };
    });

    ipcMain.handle('delete-shift', async (event, id) => {
        await db('shifts').where('id', id).delete();
        return { success: true };
    });

    // Work Patterns IPC Handlers
    ipcMain.handle('get-work-patterns', async () => {
        const patterns = await db('work_patterns').select('*');
        const days = await db('work_pattern_days').select('*');
        return patterns.map(p => ({
            ...p,
            days: days.filter(d => d.pattern_id === p.id)
        }));
    });

    ipcMain.handle('save-work-pattern', async (event, { id, name, days }) => {
        let patternId = id;
        if (!patternId) {
            const [newId] = await db('work_patterns').insert({ name });
            patternId = newId;
        } else {
            await db('work_patterns').where('id', patternId).update({ name });
        }

        await db('work_pattern_days').where('pattern_id', patternId).delete();

        if (days && days.length > 0) {
            const daysData = days.map(d => ({
                pattern_id: patternId,
                day_of_week: d.day_of_week,
                shift_id: d.shift_id
            }));
            await db('work_pattern_days').insert(daysData);
        }

        return { success: true, id: patternId };
    });

    ipcMain.handle('delete-work-pattern', async (event, id) => {
        await db('work_patterns').where('id', id).delete();
        return { success: true };
    });

    ipcMain.handle('get-schedules', async (event, { date }) => {
        return db('schedules').where('date', date).select('*');
    });

    ipcMain.handle('save-schedule', async (event, schedule) => {
        await db('schedules').insert(schedule).onConflict(['user_id', 'date']).merge();
        return { success: true };
    });

    ipcMain.handle('bulk-save-schedules', async (event, { userIds, dates, shiftId, isOffDay }) => {
        for (const userId of userIds) {
            for (const date of dates) {
                await db('schedules').insert({
                    user_id: userId.toString(),
                    date,
                    shift_id: isOffDay ? null : shiftId,
                    is_off_day: isOffDay ? 1 : 0
                }).onConflict(['user_id', 'date']).merge();
            }
        }
        return { success: true };
    });

    ipcMain.handle('get-calc-mode', async () => {
        const row = await db('settings').where('key', 'calc_mode').first();
        return { success: true, mode: row ? row.value : 'calculated' };
    });

    ipcMain.handle('get-default-shift', async () => {
        const startRow = await db('settings').where('key', 'default_start_time').first();
        const endRow = await db('settings').where('key', 'default_end_time').first();
        return { 
            success: true, 
            start_time: startRow ? startRow.value : '08:00',
            end_time: endRow ? endRow.value : '17:00'
        };
    });

    ipcMain.handle('save-default-shift', async (event, { start_time, end_time }) => {
        await db('settings').insert({ key: 'default_start_time', value: start_time }).onConflict('key').merge();
        await db('settings').insert({ key: 'default_end_time', value: end_time }).onConflict('key').merge();
        return { success: true };
    });

    ipcMain.handle('save-calc-mode', async (event, mode) => {
        await db('settings').insert({ key: 'calc_mode', value: mode }).onConflict('key').merge();

        const device = await db('devices').first();
        if (!device) return { success: true, msg: 'Saved locally (No device configured)' };

        try {
            return await withLock(device.ip, [device.port1, device.port2 || device.port], async (zk) => {
                await zk.disableDevice();

                // Disable all auto timers completely to avoid firmware conflicts!
                await zk.executeCmd(12, Buffer.from('AS1=-1\0'));
                await zk.executeCmd(12, Buffer.from('AS2=-1\0'));
                await zk.executeCmd(12, Buffer.from('AS3=-1\0'));
                await zk.executeCmd(12, Buffer.from('AS4=-1\0'));
                await zk.executeCmd(12, Buffer.from('AS5=-1\0'));
                await zk.executeCmd(12, Buffer.from('AS6=-1\0'));

                if (mode === 'calculated') {
                    // Smart calculation mode: hide all state words/buttons on the screen!
                    console.log('[Strategy] Activating Calculated mode (hiding state buttons)');
                    await zk.executeCmd(12, Buffer.from('~ShowState=0\0'));
                    await zk.executeCmd(12, Buffer.from('StateMode=3\0')); // Manual+Auto but with show=0 it's perfectly clean
                } else {
                    // Device manual selection mode: show F1/F2 status keys!
                    console.log('[Strategy] Activating Keypad Manual mode (showing state buttons)');
                    await zk.executeCmd(12, Buffer.from('~ShowState=1\0'));
                    await zk.executeCmd(12, Buffer.from('StateMode=3\0')); // Allows F1/F2 keys
                }

                // Apply changes to options memory
                await zk.executeCmd(1014); // CMD_REFRESHOPTION

                await zk.enableDevice();
                return { success: true };
            });
        } catch (e) {
            console.error('[Strategy] Failed to program device:', e.message);
            return { success: false, error: 'Saved locally, but failed to update device hardware: ' + e.message };
        }
    });

    // ADMS Port & Firewall
    ipcMain.handle('get-adms-port', async () => {
        try {
            const p = await db('settings').where('key', 'adms_port').first();
            return { success: true, port: p ? parseInt(p.value) : 80 };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('set-adms-port', async (event, port) => {
        try {
            await db('settings').insert({ key: 'adms_port', value: port.toString() }).onConflict('key').merge();
            stopAdmsServer();
            startAdmsServer(port, mainWindow);
            return { success: true, message: 'Port updated successfully.' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
};

module.exports = { setupIpcHandlers };
