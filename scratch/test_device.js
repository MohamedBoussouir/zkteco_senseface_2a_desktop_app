const ZKLib = require('node-zklib');

async function testConnection() {
    const ip = '192.168.1.157'; // Updated IP
    const port = 4370;
    
    console.log(`Testing connection to ${ip}:${port}...`);
    let zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('✅ Connection Successful!');
        const info = await zk.getInfo();
        console.log('Device Info:', info);
        await zk.disconnect();
    } catch (e) {
        console.error('❌ Connection Failed:', e.message);
        console.log('Please make sure the device is on the same network and reachable.');
    }
}

testConnection();
