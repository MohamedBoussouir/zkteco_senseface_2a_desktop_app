const { db } = require('../db');
const { withLock } = require('./sync');

const activeEnrollments = new Map();

/**
 * NEW GENERATION ENROLLMENT FLOW
 * 1. Clears existing template in slot (to force UI)
 * 2. Triggers CMD 10
 * 3. Polls for success
 */
async function enrollFingerprint(ip, ports, uid, userId, fingerIndex, mainWindow) {
    const lockKey = `${ip}_${uid}_${fingerIndex}`;
    if (activeEnrollments.get(lockKey)) return { success: false, error: 'Already in progress' };

    activeEnrollments.set(lockKey, true);
    console.log(`[Enroll] --- STARTING CLEAN ENROLLMENT: UID ${uid}, Finger ${fingerIndex} ---`);

    try {
        return await withLock(ip, ports, async (zk) => {
            console.log(`[Enroll] --- MATCHING SCRIPT LOGIC (UID ${uid}, Finger ${fingerIndex}) ---`);
            
            // 1. Disable device to focus UI
            try { await zk.disableDevice(); } catch(e) {}
            await new Promise(r => setTimeout(r, 500));

            // 2. Clear existing slot (CMD 19) to be safe
            try {
                const delBuf = Buffer.alloc(3);
                delBuf.writeUInt16LE(parseInt(uid), 0);
                delBuf.writeUInt8(parseInt(fingerIndex), 2);
                await zk.executeCmd(19, delBuf); 
                await new Promise(r => setTimeout(r, 300));
            } catch (e) { }

            // 3. Play Voice Prompt (Please press finger)
            try {
                const voiceBuf = Buffer.alloc(2);
                voiceBuf.writeUInt16LE(4, 0); 
                await zk.executeCmd(1017, voiceBuf);
                await new Promise(r => setTimeout(r, 300));
            } catch (e) { }

            // 4. FIXED SSR FORMAT: UserID(24 bytes fixed) + Finger(1) + Flag(1)
            // This ensures the finger index is always at offset 24 regardless of ID length
            const idStr = (userId || uid || '').toString();
            const enrollBuf = Buffer.alloc(26); 
            enrollBuf.fill(0);
            enrollBuf.write(idStr, 0, 'ascii'); // Write ID starting at 0
            enrollBuf.writeUInt8(parseInt(fingerIndex), 24); // Finger ALWAYS at offset 24
            enrollBuf.writeUInt8(1, 25); // Flag ALWAYS at offset 25
            
            console.log(`[Enroll] Sending CMD 61 with Buffer: ${enrollBuf.toString('hex')} (UserID: ${idStr}, Finger: ${fingerIndex})`);
            await zk.executeCmd(61, enrollBuf);

            console.log(`[Enroll] --- BLIND WAIT MODE (15s) ---`);
            console.log(`[Enroll] Please press finger 3 times on the device NOW.`);
            
            // JUST WAIT 15 SECONDS
            await new Promise(r => setTimeout(r, 15000)); 

            // 5. Re-enable device
            try { await zk.enableDevice(); } catch(e) {}

            // FINISH
            console.log(`[Enroll] Process complete. Notifying UI.`);
            
            if (mainWindow) {
                mainWindow.webContents.send('fingerprint-enrolled', { uid, userId, fingerIndex });
            }
            
            return { success: true };
        });
    } catch (err) {
        console.error(`[Enroll] Fatal Error:`, err);
        return { success: false, error: err.message };
    } finally {
        activeEnrollments.delete(lockKey);
    }
}

function abortEnrollment() {}

module.exports = { enrollFingerprint, abortEnrollment };
