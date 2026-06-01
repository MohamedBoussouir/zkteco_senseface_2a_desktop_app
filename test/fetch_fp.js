const ZKLib = require('../node_modules/node-zklib');

async function testFingerprints() {
    const ip = '192.168.0.109';
    const port = 8088;
    
    console.log(`[TEST] Connecting to ${ip}:${port}...`);
    // Using 8088 for both standard port and inport for newer firmwares
    let zk = new ZKLib(ip, port, 10000, 4370);
    
    try {
        await zk.createSocket();
        console.log("[TEST] Connected Successfully!");

        // --- METHOD 1: Try reading via specific Tables (Bulk API) ---
        console.log(`\n--- METHOD 1: Testing Data Tables ---`);
        const tablesToTest = [
            { name: "Fingers (0x07)", byte: 0x07 },
            { name: "Faces (0x08)", byte: 0x08 },
            { name: "BioData (0x0B)", byte: 0x0B },
            { name: "BioPhoto (0x0C)", byte: 0x0C }
        ];

        for (const table of tablesToTest) {
            console.log(`  Testing table: ${table.name}`);
            try {
                // We use a small request payload to avoid timeouts
                const reqData = Buffer.from([0x01, table.byte, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
                const res = await zk.zklibTcp.readWithBuffer(reqData);
                console.log(`    -> SUCCESS! Device responded with data of length: ${res ? res.length : 0}`);
            } catch (e) {
                console.log(`    -> ERROR: ${e.message}`);
            }
        }

        // --- METHOD 2: Try CMD 9 for specific users ---
        console.log(`\n--- METHOD 2: Testing User UID 10 ---`);
        const idToScan = 10;
        let fpCount = 0;
        for (let i = 0; i <= 9; i++) {
            const buf = Buffer.alloc(3);
            buf.writeUInt16LE(idToScan, 0);
            buf.writeUInt8(i, 2);
            try {
                const res = await zk.executeCmd(9, buf);
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
        console.log("\n[TEST] Disconnected.");
    } catch (e) {
        console.error("\n[TEST] Error connecting.");
        console.error(e.message);
    }
}

testFingerprints();
