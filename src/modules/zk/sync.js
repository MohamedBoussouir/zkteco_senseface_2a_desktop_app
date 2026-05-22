const ZKLib = require('node-zklib');
const { db } = require('../db');

const deviceLocks = new Map();

async function withLock(ip, ports, action) {
    while (deviceLocks.get(ip)) {
        await new Promise(r => setTimeout(r, 100));
    }
    deviceLocks.set(ip, true);
    let zk = null;
    try {
        zk = await getZkConnection(ip, ports);
        await new Promise(r => setTimeout(r, 500)); // Pause for stability
        return await action(zk);
    } catch (e) {
        throw e;
    } finally {
        if (zk) {
            try { 
                await zk.executeCmd(1001, Buffer.alloc(0)); // CMD_EXIT
                await zk.disconnect(); 
            } catch (e) { }
        }
        await new Promise(r => setTimeout(r, 500)); // Cool down
        deviceLocks.set(ip, false);
    }
}

async function getZkConnection(ip, ports) {
    let lastError = null;
    for (let port of ports) {
        if (!port) continue;
        let zk = new ZKLib(ip, parseInt(port), 10000, 7000);
        try {
            await zk.createSocket();
            return zk;
        } catch (e) {
            lastError = e;
            try { await zk.disconnect(); } catch (i) { }
        }
    }
    throw new Error(lastError ? lastError.message : 'Could not connect to device');
}

async function syncUsersFromDevice(zk, deviceId) {
    console.log(`[Sync] Fetching users list (Minimal mode)...`);
    const users = await zk.getUsers();
    const uData = Array.isArray(users) ? users : (users.data || []);
    
    // 1. Identify users currently on the device
    const deviceUserIds = [];
    for (const user of uData) {
        const cleanUserId = String(user.userId || '').replace(/[^\x20-\x7E]/g, '').trim();
        if (cleanUserId) {
            deviceUserIds.push(cleanUserId);
        }
    }

    // 2. Identify and delete users in DB that are no longer on the device
    const dbUsers = await db('users').where({ device_id: deviceId }).select('user_id');
    const dbUserIds = dbUsers.map(u => u.user_id);
    const usersToDelete = dbUserIds.filter(id => !deviceUserIds.includes(id));

    if (usersToDelete.length > 0) {
        console.log(`[Sync] Removing ${usersToDelete.length} obsolete users and their logs from database:`, usersToDelete);
        // Delete users
        await db('users').where({ device_id: deviceId }).whereIn('user_id', usersToDelete).delete();
        // Delete logs
        await db('attendance').where({ device_id: deviceId }).whereIn('user_id', usersToDelete).delete();
    }
    
    // 3. Upsert current users
    for (const user of uData) {
        const cleanName = String(user.name || '').replace(/[^\x20-\x7E\u0600-\u06FF]/g, '').trim();
        const cleanUserId = String(user.userId || '').replace(/[^\x20-\x7E]/g, '').trim();
        if (!cleanUserId) continue;

        await db('users').insert({
            uid: user.uid,
            user_id: cleanUserId,
            name: cleanName,
            role: user.role,
            device_id: deviceId
        }).onConflict(['user_id', 'device_id']).merge();
    }
    return uData.length;
}

module.exports = { withLock, getZkConnection, syncUsersFromDevice };
