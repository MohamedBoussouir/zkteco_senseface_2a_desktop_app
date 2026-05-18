const ZKLib = require('node-zklib');

async function testGetUsersAndFingerprints() {
    const ip = '192.168.0.157';
    const port = 4370;

    console.log(`[Test] Connecting to device at ${ip}:${port}...`);
    let zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log("[Test] Connected successfully!");

        // 1. جلب قائمة المستخدمين
        console.log("\n[Test] Fetching users list...");
        const usersRes = await zk.getUsers();
        const usersList = usersRes.data || [];
        
        // إنشاء قاموس (Map) لسهولة البحث عن المستخدم باستخدام المعرف الداخلي (uid)
        const usersMap = {};
        usersList.forEach(u => {
            // تنظيف الأسماء من الحروف غير الصالحة إذا وجدت
            u.cleanName = (u.name || '').replace(/[^\x20-\x7E\u0600-\u06FF]/g, '').trim();
            u.cleanUserId = (u.userId || '').replace(/[^\x20-\x7E]/g, '').trim();
            
            usersMap[u.uid] = u;
            // تجهيز مصفوفة فارغة للبصمات لكل مستخدم
            usersMap[u.uid].fingerprints = [];
        });
        
        console.log(`[Test] Found ${usersList.length} users.`);

        // 2. جلب جميع البصمات (Fingerprint Templates)
        const reqData = Buffer.from([0x01, 0x07, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        console.log("\n[Test] Requesting all fingerprint templates...");
        
        const fpRes = await zk.zklibTcp.readWithBuffer(reqData);
        const data = fpRes.data;
        
        if (data && data.length >= 4) {
            let offset = 4;
            let fpCount = 0;
            
            while (offset < data.length) {
                const entrySize = data.readUInt16LE(offset);
                if (entrySize === 0) break;
                
                const userSn = data.readUInt16LE(offset + 2);
                const fingerIndex = data.readUInt8(offset + 4);
                const flag = data.readUInt8(offset + 5);
                const templateSize = entrySize - 6;
                
                // إضافة البصمة إلى المستخدم المناسب
                if (usersMap[userSn]) {
                    usersMap[userSn].fingerprints.push({
                        fingerIndex,
                        flag,
                        templateSize
                    });
                }
                
                fpCount++;
                offset += entrySize;
            }
            console.log(`[Test] Found ${fpCount} fingerprints in total.\n`);
        } else {
            console.log("[Test] No fingerprint data found.\n");
        }

        // 3. طباعة النتيجة مجمعة لكل مستخدم
        console.log("==================================================");
        console.log("             USERS AND FINGERPRINTS               ");
        console.log("==================================================");
        
        usersList.forEach(user => {
            // تجاوز المستخدمين الفارغين
            if (!user.cleanUserId) return;
            
            console.log(`User ID: ${user.cleanUserId} | Name: ${user.cleanName || 'N/A'} | Internal SN: ${user.uid}`);
            
            if (user.fingerprints && user.fingerprints.length > 0) {
                console.log(`  -> Registered Fingerprints: ${user.fingerprints.length}`);
                user.fingerprints.forEach(fp => {
                    const status = fp.flag === 1 ? "Valid" : fp.flag === 3 ? "Duress" : "Unknown";
                    console.log(`     - Finger Index: ${fp.fingerIndex} | Status: ${status} | Size: ${fp.templateSize} bytes`);
                });
            } else {
                console.log(`  -> No fingerprints registered.`);
            }
            console.log("--------------------------------------------------");
        });
        
    } catch (e) {
        console.error("[Test] Error:", e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log("\n[Test] Disconnected.");
        } catch (err) {}
    }
}

testGetUsersAndFingerprints();
