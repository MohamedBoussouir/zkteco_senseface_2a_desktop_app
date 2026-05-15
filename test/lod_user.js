const ZKLib = require('node-zklib');

const IP   = '192.168.0.157';
const PORT = 4370;
const TARGET_UID = 100;

const zk = new ZKLib(IP, PORT, 10000, 4000);

async function main() {
    await zk.createSocket();
    console.log("✅ Connected\n");
    await zk.disableDevice().catch(e => e);

    // =============================================
    // الطريقة الجديدة: CMD_DATA_WRRQ (1503)
    // نطلب جلب بيانات نوع 0x02 = Fingerprint Templates
    // هذا مشابه لـ REQUEST_DATA.GET_USERS لكن للبصمات
    // =============================================

    // GET_TEMPLATES: type=0x02 (fingerprints), subtype=0x09
    const reqTemplates = Buffer.from([0x01, 0x02, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    
    console.log("📋 [Method 1] Requesting ALL templates via CMD_DATA_WRRQ...");
    try {
        const result = await zk.zklibTcp.readWithBuffer(reqTemplates);
        if (result && result.data && result.data.length > 0) {
            console.log(`  ✅ Got ${result.data.length} bytes of template data!`);
            // تحليل البيانات
            console.log(`  First 32 bytes: ${result.data.slice(0, 32).toString('hex')}`);
            
            // حاول قراءة سجلات البصمات
            // كل سجل بصمة يبدأ بـ UID (2 bytes) + FingerID (1 byte) + ...
            let offset = 4; // تخطي الـ header الأول
            let count = 0;
            while (offset + 6 < result.data.length) {
                const uid = result.data.readUInt16LE(offset);
                const fingerId = result.data.readUInt8(offset + 2);
                const size = result.data.readUInt16LE(offset + 3);
                
                if (uid === TARGET_UID) {
                    console.log(`  → UID:${uid} Finger:${fingerId} Size:${size}b`);
                    count++;
                }
                offset += 3 + size + 2; // UID + FingerID + Size + Template + CRC?
                if (size === 0 || size > 5000) break;
            }
            console.log(`  Total for UID ${TARGET_UID}: ${count} fingerprints`);
        } else {
            console.log("  ❌ No template data returned");
        }
    } catch(e) {
        console.log("  ❌ Error:", e.message);
    }

    // =============================================
    // الطريقة 2: نفس الطريقة لكن بنوع مختلف
    // =============================================
    const reqTemplates2 = Buffer.from([0x01, 0x09, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    
    console.log("\n📋 [Method 2] Requesting templates with type 0x09/0x06...");
    try {
        const result = await zk.zklibTcp.readWithBuffer(reqTemplates2);
        if (result && result.data && result.data.length > 0) {
            console.log(`  ✅ Got ${result.data.length} bytes`);
            console.log(`  First 32 bytes: ${result.data.slice(0, 32).toString('hex')}`);
        } else {
            console.log("  ❌ No data");
        }
    } catch(e) {
        console.log("  ❌ Error:", e.message);
    }

    // =============================================
    // الطريقة 3: CMD_USERTEMP_RRQ (9) مع buffer فارغ = جلب الكل
    // =============================================
    console.log("\n📋 [Method 3] CMD_USERTEMP_RRQ with empty buffer...");
    try {
        const res = await zk.executeCmd(9, Buffer.alloc(0));
        const data = res.data || res;
        if (data && data.length > 8) {
            console.log(`  ✅ Got ${data.length} bytes | code:${data.readUInt16LE(0)} | ${data.slice(0,16).toString('hex')}`);
        } else {
            console.log("  ❌ No useful data");
        }
    } catch(e) {
        console.log("  ❌ Error:", e.message);
    }

    await zk.enableDevice().catch(e => e);
    await zk.disconnect();
    console.log("\n🔌 Disconnected");
}

main().catch(console.error);
