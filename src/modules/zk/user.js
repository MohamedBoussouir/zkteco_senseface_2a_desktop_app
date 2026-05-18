const { db } = require('../db');
const { withLock } = require('./sync');

async function createUser(ip, ports, user) {
    return await withLock(ip, ports, async (zk) => {
        const buf = Buffer.alloc(72);
        buf.fill(0);
        buf.writeUInt16LE(parseInt(user.uid), 0);
        buf.writeUInt8(user.role || 0, 2);
        buf.write((user.password || '').toString(), 3, 8, 'ascii');
        buf.write((user.name || '').toString(), 11, 24, 'ascii');
        buf.writeUInt32LE(0, 35);
        buf.write((user.userId || '').toString(), 48, 24, 'ascii');

        await zk.executeCmd(8, buf); // CMD_SET_USER
        try { await zk.executeCmd(1013, Buffer.alloc(0)); } catch (e) { }

        const device = await db('devices').where('ip', ip).first();
        if (device) {
            await db('users').insert({
                uid: user.uid,
                user_id: user.userId,
                name: user.name,
                role: user.role,
                device_id: device.id
            }).onConflict(['user_id', 'device_id']).merge();
        }
        return { success: true };
    });
}

async function deleteUser(ip, ports, uid, userId) {
    return await withLock(ip, ports, async (zk) => {
        const b = Buffer.alloc(2);
        b.writeUInt16LE(parseInt(uid), 0);
        await zk.executeCmd(18, b);
        if (userId) await zk.executeCmd(18, Buffer.from(userId.toString() + '\0'));
        await zk.executeCmd(1013, Buffer.alloc(0));

        const device = await db('devices').where('ip', ip).first();
        if (device) {
            await db('users').where({ uid, device_id: device.id }).delete();
        }
        return { success: true };
    });
}

async function deleteFinger(ip, ports, uid, userId, fingerIndex) {
    return await withLock(ip, ports, async (zk) => {
        try { await zk.disableDevice(); } catch (e) { }

        const idStr = userId.toString();
        const fStr = fingerIndex.toString();
        const nUid = parseInt(uid);
        const nFinger = parseInt(fingerIndex);

        console.log(`[Delete] Attempting ULTRA-STRIKE deletion for UID: ${uid}, UserID: ${userId}, Finger: ${fingerIndex}`);

        // Format 1: Standard Binary (3 bytes)
        const b1 = Buffer.alloc(3);
        b1.writeUInt16LE(nUid, 0);
        b1.writeUInt8(nFinger, 2);
        await zk.executeCmd(19, b1);

        // Format 2: Dual String (ID + \0 + FingerID_String)
        const b2 = Buffer.from(idStr + '\0' + fStr);
        await zk.executeCmd(19, b2);

        // Format 3: SSR Fixed (25 bytes)
        const b3 = Buffer.alloc(25);
        b3.fill(0);
        b3.write(idStr, 0, 'ascii');
        b3.writeUInt8(nFinger, 24);
        await zk.executeCmd(19, b3);

        // Format 4: 32-bit UID (5 bytes)
        const b4 = Buffer.alloc(5);
        b4.writeUInt32LE(nUid, 0);
        b4.writeUInt8(nFinger, 4);
        await zk.executeCmd(19, b4);

        // // Format 5: Extended SSR (64 bytes)
        const b5 = Buffer.alloc(64);
        b5.fill(0);
        b5.write(idStr, 0, 'ascii');
        b5.writeUInt8(nFinger, 24);
        await zk.executeCmd(19, b5);

        try {
            await zk.executeCmd(1013, Buffer.alloc(0)); // Refresh Cache
            await zk.enableDevice();
        } catch (e) { }

        // Database update is handled in ipc-handlers.js
        return { success: true };
    });
}

async function deleteAllFingers(ip, ports, uid, userId) {
    return await withLock(ip, ports, async (zk) => {
        try { await zk.disableDevice(); } catch (e) {}

        const nUid = parseInt(uid);
        const idStr = userId.toString();
        console.log(`[Delete-All] Clearing ALL fingerprints for UID:${uid}, UserID:${userId}...`);

        // احذف كل الخانات من 0 إلى 9 بكل الصيغ
        for (let finger = 0; finger <= 9; finger++) {
            // Format 1: Binary (3 bytes)
            const b1 = Buffer.alloc(3);
            b1.writeUInt16LE(nUid, 0);
            b1.writeUInt8(finger, 2);
            await zk.executeCmd(19, b1).catch(e => e);

            // Format 2: SSR Fixed (25 bytes)
            const b2 = Buffer.alloc(25);
            b2.fill(0);
            b2.write(idStr, 0, 'ascii');
            b2.writeUInt8(finger, 24);
            await zk.executeCmd(19, b2).catch(e => e);
        }

        try {
            await zk.executeCmd(1013, Buffer.alloc(0));
            await zk.enableDevice();
        } catch (e) {}

        // Database update is handled in ipc-handlers.js
        console.log(`[Delete-All] Done.`);
        return { success: true };
    });
}

module.exports = { createUser, deleteUser, deleteFinger, deleteAllFingers };
