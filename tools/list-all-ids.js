const ZKLib = require('node-zklib');

async function listIds() {
    const zk = new ZKLib('192.168.0.157', 4370, 10000, 4000);
    try {
        console.log('🚀 Connecting...');
        await zk.createSocket();
        console.log('✅ Connected!\n');

        const users = await zk.getUsers();
        const uData = Array.isArray(users) ? users : (users.data || []);

        console.log('--- DEVICE USER MAPPING ---');
        console.log('UID (Internal) | UserID (Employee #) | Name');
        console.log('-------------------------------------------');
        
        uData.forEach(u => {
            console.log(`${u.uid.toString().padEnd(14)} | ${u.userId.toString().padEnd(18)} | ${u.name}`);
        });

        await zk.disconnect();
    } catch (e) {
        console.error('Error:', e.message);
    }
}

listIds();
