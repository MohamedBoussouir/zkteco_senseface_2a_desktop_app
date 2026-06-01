const ZKLib = require('../node_modules/node-zklib');

async function test1011() {
    let zk = new ZKLib('192.168.0.109', 8088, 10000, 4370);
    try {
        await zk.createSocket();
        
        console.log("Testing CMD_TEST_TEMP (1011) for UID 10...");
        
        for (let i = 0; i <= 9; i++) {
            const buf = Buffer.alloc(3);
            buf.writeUInt16LE(10, 0); // UID 10
            buf.writeUInt8(i, 2);     // Finger Index
            try {
                const res = await zk.executeCmd(1011, buf);
                let cmdId = res && res.length >= 2 ? res.readUInt16LE(0) : 'none';
                console.log(`Finger ${i}: CMD Response = ${cmdId}, Length = ${res ? res.length : 0}`);
            } catch (e) {
                console.log(`Finger ${i}: Error = ${e.message}`);
            }
        }
        
        await zk.disconnect();
    } catch (e) {
        console.error("Error", e);
    }
}

test1011();
