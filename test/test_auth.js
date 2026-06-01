const ZKLib = require('../node_modules/node-zklib');

function makeCommKey(keyStr, sessionId, ticks = 50) {
    const key = parseInt(keyStr, 10);
    let k = 0;
    for (let i = 0; i < 32; i++) {
        if ((key & (1 << i)) !== 0) {
            k = ((k << 1) | 1) >>> 0;
        } else {
            k = (k << 1) >>> 0;
        }
    }
    k = (k + sessionId) >>> 0;

    let buf = Buffer.alloc(4);
    buf.writeUInt32LE(k, 0);

    buf[0] ^= 'Z'.charCodeAt(0);
    buf[1] ^= 'K'.charCodeAt(0);
    buf[2] ^= 'S'.charCodeAt(0);
    buf[3] ^= 'O'.charCodeAt(0);

    let h1 = buf.readUInt16LE(0);
    let h2 = buf.readUInt16LE(2);
    buf.writeUInt16LE(h2, 0);
    buf.writeUInt16LE(h1, 2);

    let B = 0xff & ticks;
    buf[0] ^= B;
    buf[1] ^= B;
    buf[2] = B;
    buf[3] ^= B;

    return buf;
}

async function testAuth() {
    let zk = new ZKLib('192.168.0.109', 8088, 10000, 4370);
    try {
        await zk.createSocket();
        console.log("[TEST] Connected!");
        
        const password = '123456';
        const sessionId = zk.zklibTcp.sessionId || zk.zklibUdp.sessionId;
        console.log(`[TEST] Authenticating with Session ID: ${sessionId} using CommKey: ${password}`);
        
        const authData = makeCommKey(password, sessionId);
        try {
            const authRes = await zk.executeCmd(1102, authData); // CMD_AUTH
            let authCmdId = authRes && authRes.length >= 2 ? authRes.readUInt16LE(0) : 'none';
            console.log(`[TEST] Auth Response: ${authCmdId} (2000 means OK)`);
        } catch(e) {
            console.error(`[TEST] Auth Failed: ${e.message}`);
        }

        // Now test getting fingerprint for UID 10
        console.log(`\n--- Testing UID 10 after Auth ---`);
        let fpCount = 0;
        for (let i = 0; i <= 9; i++) {
            const buf = Buffer.alloc(3);
            buf.writeUInt16LE(10, 0);
            buf.writeUInt8(i, 2);
            try {
                const res = await zk.executeCmd(9, buf); // CMD_USERTEMP_RRQ
                let cmdId = res && res.length >= 2 ? res.readUInt16LE(0) : 'none';
                console.log(`  Finger ${i}: CMD Response = ${cmdId}, Length = ${res ? res.length : 0}`);
                
                if (cmdId === 1500 || cmdId === 1501 || cmdId === 2002 || (cmdId === 2000 && res.length > 20)) {
                    fpCount++;
                    try { await zk.freeData(); } catch(e){}
                }
            } catch(e) {
                console.log(`  Finger ${i}: Error = ${e.message}`);
            }
        }
        console.log(`[RESULT] UID 10: Found ${fpCount} fingerprints using CMD 9`);

        await zk.disconnect();
    } catch (e) {
        console.error("Error", e);
    }
}

testAuth();
