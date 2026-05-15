const ZKLib = require('node-zklib');

const IP   = '192.168.0.157';
const PORT = 4370;
const UID  = 100;
const SLOT = 3; // الإصبع الذي سنقوم بتجربته

const zk = new ZKLib(IP, PORT, 30000, 4000); // وقت انتظار طويل للتسجيل (30 ثانية)

async function main() {
    try {
        await zk.createSocket();
        console.log("✅ Connected to Device");
        
        // 1. تعطيل الجهاز لبدء التسجيل
        console.log("🔒 Disabling device for enrollment...");
        await zk.disableDevice();

        // 2. تنظيف الخانة قبل التسجيل (Delete existing if any)
        console.log(`🧹 Clearing Slot ${SLOT} for User ${UID} first...`);
        const delBuf = Buffer.alloc(3);
        delBuf.writeUInt16LE(UID, 0);
        delBuf.writeUInt8(SLOT, 2);
        await zk.executeCmd(19, delBuf).catch(e => e);

        // 3. أمر التسجيل (CMD 61) بتنسيق SSR المضمون
        // التنسيق: UserID (24 bytes) + FingerIndex (1 byte) + Flag (1 byte)
        console.log(`🚀 Sending Enroll Command (CMD 61) for UID:${UID}, Slot:${SLOT}...`);
        const enrollBuf = Buffer.alloc(26);
        enrollBuf.fill(0);
        enrollBuf.write(UID.toString(), 0, 'ascii'); // UserID كـ String
        enrollBuf.writeUInt8(SLOT, 24);             // رقم الإصبع دائماً في المركز 24
        enrollBuf.writeUInt8(1, 25);                // Flag

        console.log(`   Buffer Hex: ${enrollBuf.toString('hex')}`);
        
        // إرسال الأمر وانتظار الاستجابة (الجهاز سيبدأ في طلب البصمة 3 مرات)
        console.log("\n📢 PLEASE PRESS FINGER 3 TIMES ON THE DEVICE SENSOR NOW...");
        
        const result = await zk.executeCmd(61, enrollBuf);
        const resData = result.data || result;

        if (resData && resData.readUInt16LE(0) === 2000) {
            console.log("\n✅ ENROLLMENT SUCCESSFUL (Device acknowledged)");
        } else {
            console.log("\n❌ ENROLLMENT FAILED or TIMEOUT");
            if (resData) console.log(`   Response Code: ${resData.readUInt16LE(0)}`);
        }

        // 4. إعادة تفعيل الجهاز
        console.log("\n🔓 Enabling device...");
        await zk.enableDevice();
        
        await zk.disconnect();
        console.log("🔌 Disconnected");

    } catch (e) {
        console.error("💥 ERROR:", e);
        try { await zk.enableDevice(); } catch(err){}
        try { await zk.disconnect(); } catch(err){}
    }
}

main();
