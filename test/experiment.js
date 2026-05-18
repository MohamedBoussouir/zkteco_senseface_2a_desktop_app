const ZKLib = require('node-zklib');

async function testGetFingerprints() {
    const ip = '192.168.0.157';
    const port = 4370;

    console.log(`[Test] Connecting to device at ${ip}:${port}...`);
    let zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log("[Test] Connected successfully!");

        // هذا هو الأمر (Payload) لطلب جميع البصمات (Fingerprint Templates) 
        // استناداً إلى توثيق البروتوكول (CMD_DATA_WRRQ مع المتغيرات المطلوبة)
        const reqData = Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        
        console.log("[Test] Requesting all fingerprint templates...");
        
        // استخدام الدالة readWithBuffer لجلب البيانات الكبيرة
        const res = await zk.zklibTcp.readWithBuffer(reqData);
        const data = res.data;
        
        if (!data || data.length < 4) {
            console.log("[Test] No fingerprint data found or buffer is empty.");
            return;
        }

        const totalSize = data.readUInt32LE(0);
        console.log(`[Test] Total templates data size: ${totalSize} bytes`);
        
        let offset = 4;
        let count = 0;
        
        while (offset < data.length) {
            const entrySize = data.readUInt16LE(offset);
            if (entrySize === 0) break; // End of data
            
            const userSn = data.readUInt16LE(offset + 2);
            const fingerIndex = data.readUInt8(offset + 4);
            const flag = data.readUInt8(offset + 5);
            const templateSize = entrySize - 6;
            
            console.log(`\n--- Fingerprint #${++count} ---`);
            console.log(`User Internal SN: ${userSn}`);
            console.log(`Finger Index: ${fingerIndex} (0-9)`);
            console.log(`Flag (1=Valid, 3=Duress): ${flag}`);
            console.log(`Template Size: ${templateSize} bytes`);
            
            // الانتقال إلى البصمة التالية
            offset += entrySize;
        }
        
        console.log(`\n[Test] Finished reading ${count} fingerprints.`);
        
    } catch (e) {
        console.error("[Test] Error:", e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log("[Test] Disconnected.");
        } catch (err) {}
    }
}

testGetFingerprints();
