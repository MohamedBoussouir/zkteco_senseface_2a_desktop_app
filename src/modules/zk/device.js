const { withLock } = require('./sync');

async function rebootDevice(ip, ports) {
    return await withLock(ip, ports, async (zk) => {
        await zk.executeCmd(1004, Buffer.alloc(0)); // CMD_RESTART
        return { success: true };
    });
}

async function syncTime(ip, ports) {
    return await withLock(ip, ports, async (zk) => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const second = now.getSeconds();

        console.log(`[Device] --- NEW MULTI-SYNC STARTING (Time: ${now.toLocaleString()}) ---`);

        try { await zk.disableDevice(); } catch(e) {}

        // Format 0: Command 202 (4-byte encoded) - CRITICAL for K40
        try {
            const encodedTime = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
            const buf4 = Buffer.alloc(4);
            buf4.writeUInt32LE(encodedTime, 0);
            await zk.executeCmd(202, buf4);
            console.log(`[Device] Sent Format 0 (Cmd 202, 4-byte)`);
        } catch (e) {
            console.log(`[Device] Cmd 202 failed: ${e.message}`);
        }

        // Format 1: 4-byte Encoded (Cmd 10)
        try {
            const encodedTime = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
            const buf4 = Buffer.alloc(4);
            buf4.writeUInt32LE(encodedTime, 0);
            await zk.executeCmd(10, buf4);
            console.log(`[Device] Sent Format 1 (Cmd 10, 4-byte)`);
        } catch (e) {}

        // Format 2: 6-byte Array
        try {
            const buf6 = Buffer.from([year % 100, month, day, hour, minute, second]);
            await zk.executeCmd(10, buf6);
            console.log(`[Device] Sent Format 2 (Cmd 10, 6-byte)`);
        } catch (e) {}

        // Format 3: Library Native
        try {
            await zk.setTime(now);
            console.log(`[Device] Sent Format 3 (Library)`);
        } catch (e) {}

        // Refresh Data and Memory
        try { await zk.executeCmd(1013); } catch(e) {}
        try { await zk.executeCmd(1014); } catch(e) {}

        // Audible Confirmation
        try { await zk.executeCmd(1017, Buffer.alloc(0)); } catch(e) {}

        try { await zk.enableDevice(); } catch(e) {}
        
        console.log(`[Device] --- MULTI-SYNC COMPLETE ---`);
        return { success: true };
    });
}

async function setCustomDeviceTime(ip, ports, dateTimeStr) {
    return await withLock(ip, ports, async (zk) => {
        const now = new Date(dateTimeStr);
        if (isNaN(now.getTime())) throw new Error("Invalid date-time specified");
        
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const second = now.getSeconds();

        console.log(`[Device] --- SET CUSTOM TIME STARTING (Time: ${now.toLocaleString()}) ---`);

        try { await zk.disableDevice(); } catch(e) {}

        // Format 0: Command 202 (4-byte encoded) - CRITICAL for K40
        try {
            const encodedTime = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
            const buf4 = Buffer.alloc(4);
            buf4.writeUInt32LE(encodedTime, 0);
            await zk.executeCmd(202, buf4);
            console.log(`[Device] Sent Format 0 (Cmd 202, 4-byte)`);
        } catch (e) {
            console.log(`[Device] Cmd 202 failed: ${e.message}`);
        }

        // Format 1: 4-byte Encoded (Cmd 10)
        try {
            const encodedTime = ((year - 2000) * 12 * 31 + (month - 1) * 31 + (day - 1)) * 24 * 60 * 60 + (hour * 3600 + minute * 60 + second);
            const buf4 = Buffer.alloc(4);
            buf4.writeUInt32LE(encodedTime, 0);
            await zk.executeCmd(10, buf4);
            console.log(`[Device] Sent Format 1 (Cmd 10, 4-byte)`);
        } catch (e) {}

        // Format 2: 6-byte Array
        try {
            const buf6 = Buffer.from([year % 100, month, day, hour, minute, second]);
            await zk.executeCmd(10, buf6);
            console.log(`[Device] Sent Format 2 (Cmd 10, 6-byte)`);
        } catch (e) {}

        // Format 3: Library Native
        try {
            await zk.setTime(now);
            console.log(`[Device] Sent Format 3 (Library)`);
        } catch (e) {}

        // Refresh Data and Memory
        try { await zk.executeCmd(1013); } catch(e) {}
        try { await zk.executeCmd(1014); } catch(e) {}

        // Audible Confirmation
        try { await zk.executeCmd(1017, Buffer.alloc(0)); } catch(e) {}

        try { await zk.enableDevice(); } catch(e) {}
        
        console.log(`[Device] --- CUSTOM TIME COMPLETE ---`);
        return { success: true };
    });
}

async function clearAdmin(ip, ports) {
    return await withLock(ip, ports, async (zk) => {
        await zk.executeCmd(20, Buffer.alloc(0)); // CMD_CLEAR_ADMIN
        return { success: true };
    });
}

async function beep(ip, ports) {
    return await withLock(ip, ports, async (zk) => {
        await zk.executeCmd(1017, Buffer.alloc(0)); // CMD_TESTVOICE
        return { success: true };
    });
}

module.exports = { rebootDevice, syncTime, setCustomDeviceTime, clearAdmin, beep };
