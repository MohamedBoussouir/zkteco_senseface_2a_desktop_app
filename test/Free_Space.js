const ZKLib = require("node-zklib");

/**
 * سكربت تشخيصي متقدم لجهاز K40
 * يرسل أمر التسجيل ثم "يراقب" الجهاز لمعرفة هل تم الحفظ بنجاح أم لا
 */
async function diagnosticEnrollK40(uid, fingerIndex) {
    const IP = '192.168.0.157';
    const PORT = 4370;
    const zk = new ZKLib(IP, PORT, 10000, 4000);

    try {
        console.log(`[DIAGNOSTIC] Connecting to K40 at ${IP}...`);
        await zk.createSocket();
        console.log("[SUCCESS] Connected.");

        // 4. بدء التسجيل (CMD 61) بنظام SSR المتقدم
        console.log(`[K40] Sending StartEnroll (CMD 61) for UserID ${uid}...`);
        const idStr = uid.toString();
        const enrollBuf = Buffer.alloc(idStr.length + 3);
        enrollBuf.write(idStr, 0, 'ascii');
        enrollBuf.writeUInt8(0, idStr.length); // Null terminator
        enrollBuf.writeUInt8(parseInt(fingerIndex), idStr.length + 1);
        enrollBuf.writeUInt8(1, idStr.length + 2); // Start Flag
        await zk.executeCmd(61, enrollBuf); 

        console.log("\n--- ACTION REQUIRED ---");
        console.log("Please place your finger on the sensor 3 times NOW.");
        console.log("-----------------------\n");

        // 5. حلقة المراقبة (Polling)
        // سنحاول الفحص كل 3 ثوانٍ لمدة 30 ثانية
        let captured = false;
        for (let i = 1; i <= 10; i++) {
            console.log(`[CHECK ${i}/10] Checking if finger is registered...`);

            const checkBuf = Buffer.alloc(3);
            checkBuf.writeUInt16LE(parseInt(uid), 0);
            checkBuf.writeUInt8(parseInt(fingerIndex), 2);

            try {
                const res = await zk.executeCmd(9, checkBuf); // CMD 9 = جلب القالب
                if (res && res.length > 100) {
                    console.log(`\n[!!! SUCCESS !!!] Template detected! Size: ${res.length} bytes.`);
                    captured = true;
                    break;
                }
            } catch (err) {
                // طبيعي أن يفشل الفحص إذا كان المستخدم لم ينتهِ بعد
            }

            await new Promise(r => setTimeout(r, 3000));
        }

        if (!captured) {
            console.log("\n[FAILED] No fingerprint detected after 30 seconds.");
        }

        console.log("[K40] Enabling device and disconnecting...");
        await zk.enableDevice();
        await zk.disconnect();
        console.log("[FINISHED]");

    } catch (e) {
        console.error("[CRITICAL ERROR]:", e.message);
        try { await zk.disconnect(); } catch (i) { }
    }
}

diagnosticEnrollK40(1, 1);