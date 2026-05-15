const ZKLib = require('node-zklib');
const args = require('minimist')(process.argv.slice(2));

const ip = args.ip || '192.168.0.157';
const port = parseInt(args.port || 4370);
const uid = args.uid;

if (!uid) {
    console.error('❌ Error: Missing --uid argument (e.g. --uid 10)');
    process.exit(1);
}

async function testFingers() {
    const zk = new ZKLib(ip, port, 10000, 4000);
    try {
        console.log(`\n🚀 Connecting to device at ${ip}:${port}...`);
        await zk.createSocket();
        console.log('✅ Connected!');

        console.log(`\n🔍 Fetching fingerprints for UID: ${uid} (indices 0-9)`);
        console.log('--------------------------------------------------');

        let found = [];
        for (let i = 0; i <= 9; i++) {
            const buf = Buffer.alloc(3);
            buf.writeUInt16LE(parseInt(uid), 0);
            buf.writeUInt8(i, 2);

            try {
                const res = await zk.executeCmd(9, buf);
                const replyCode = res && res.length >= 2 ? res.readUInt16LE(0) : 0;
                const size = res ? res.length : 0;
                const rawHex = res ? res.toString('hex').slice(0, 32) : 'NONE';

                let status = '❌ Empty';
                // 2000 = ACK_OK, 2002 = ACK_DATA, 1501 = CMD_DATA, 1500 = CMD_DATA_ALT
                const isFoundCode = [2000, 2002, 1501, 1500].includes(replyCode);
                if (size > 100 && isFoundCode) {
                    status = '✅ FOUND';
                    found.push(i);
                }

                console.log(`[Finger ${i}] Status: ${status} | Code: ${replyCode} | Size: ${size} bytes`);
                if (size > 0) console.log(`           Raw: ${rawHex}...`);

            } catch (err) {
                console.log(`[Finger ${i}] ⚠️ Error: ${err.message}`);
            }
        }

        console.log('--------------------------------------------------');
        console.log(`🏁 Summary for UID ${uid}:`);
        console.log(`   Fingers Detected: ${found.length > 0 ? found.join(', ') : 'NONE'}`);
        console.log(`   Total Templates: ${found.length}`);

        await zk.disconnect();
        console.log('\n👋 Disconnected.');
    } catch (e) {
        console.error(`\n❌ Fatal Error: ${e.message}`);
    }
}

testFingers();
