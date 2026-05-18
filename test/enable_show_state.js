const ZKLib = require('node-zklib');

async function run() {
    const ip = '192.168.0.157';
    const port = 4370;
    
    console.log(`Connecting to ZK Terminal at ${ip}:${port}...`);
    const zk = new ZKLib(ip, port, 10000, 4000);
    
    try {
        await zk.createSocket();
        console.log('Connected successfully!\n');
        
        console.log('Enabling state keys display on device screen (~ShowState=1)...');
        await zk.executeCmd(12, Buffer.from(`~ShowState=1\0`));
        
        // Refresh options to apply settings
        console.log('Applying changes to device memory (CMD_REFRESHOPTION)...');
        await zk.executeCmd(1014); // CMD_REFRESHOPTION
        
        console.log('\nReading back values to verify:');
        const res = await zk.executeCmd(11, Buffer.from(`~ShowState\0`));
        const responseStr = res.slice(8).toString('ascii').replace(/\0/g, '');
        console.log(`~ShowState Option is now: "${responseStr}"`);
        
    } catch (e) {
        console.error('An error occurred:', e.message);
    } finally {
        try {
            await zk.disconnect();
            console.log('\nDisconnected.');
        } catch (e) {}
    }
}

run();
