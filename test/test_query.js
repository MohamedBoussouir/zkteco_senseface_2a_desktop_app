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

async function testQuery() {
    let zk = new ZKLib('192.168.0.109', 8088, 10000, 4370);
    try {
        await zk.createSocket();
        
        const password = '123456';
        const sessionId = zk.zklibTcp.sessionId || zk.zklibUdp.sessionId;
        const authData = makeCommKey(password, sessionId);
        await zk.executeCmd(1102, authData); 

        // Test CMD_DEVICE_CMD (11)
        const query1 = Buffer.from('DATA QUERY table="BioTemplate"\x00');
        try {
            const res = await zk.executeCmd(11, query1);
            console.log(`Query BioTemplate: Response Length = ${res ? res.length : 0}`);
            if (res) console.log(res.toString('ascii'));
        } catch(e) {
            console.log("Query BioTemplate failed:", e.message);
        }

        const query2 = Buffer.from('DATA QUERY table="templatev10"\x00');
        try {
            const res2 = await zk.executeCmd(11, query2);
            console.log(`Query templatev10: Response Length = ${res2 ? res2.length : 0}`);
            if (res2) console.log(res2.toString('ascii'));
        } catch(e) {
            console.log("Query templatev10 failed:", e.message);
        }

        await zk.disconnect();
    } catch (e) {
        console.error("Error", e);
    }
}

testQuery();
