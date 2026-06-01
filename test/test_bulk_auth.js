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

async function testBulkAuth() {
    let zk = new ZKLib('192.168.0.109', 8088, 10000, 4370);
    try {
        await zk.createSocket();
        
        const password = '123456';
        const sessionId = zk.zklibTcp.sessionId || zk.zklibUdp.sessionId;
        const authData = makeCommKey(password, sessionId);
        const authRes = await zk.executeCmd(1102, authData); 
        console.log(`[TEST] Authenticated! Response: ${authRes.readUInt16LE(0)}`);

        // Test Tables
        const tablesToTest = [
            { name: "Fingers (0x07)", byte: 0x07 },
            { name: "Faces (0x08)", byte: 0x08 },
            { name: "BioData (0x0B)", byte: 0x0B }
        ];

        for (const table of tablesToTest) {
            console.log(`\nTesting table: ${table.name}`);
            try {
                // Free data first
                try { await zk.freeData(); } catch(e){}
                
                const reqData = Buffer.from([0x01, table.byte, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                const res = await zk.zklibTcp.readWithBuffer(reqData);
                console.log(`  -> SUCCESS! Data length: ${res && res.data ? res.data.length : 0}`);
            } catch (e) {
                console.log(`  -> ERROR: ${e.message}`);
            }
        }
        
        await zk.disconnect();
    } catch (e) {
        console.error("Error", e);
    }
}

testBulkAuth();
